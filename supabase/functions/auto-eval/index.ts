// auto-eval — server-side dispatcher that runs the eval flows automatically.
//
// Triggered by a Supabase Database Webhook on INSERT into `ticket_issues`
// (one call per inserted row), OR called manually with { ids: string[] }.
//
// It mirrors the routing logic in LogTicket.tsx, but server-side so it can't be
// interrupted by a closing browser tab:
//   - edit eval     (eval-issue-v2) on Majority/Partial edits that have final_edits
//   - accuracy eval (eval-accuracy) on any issue with a suggested_response (not "No response")
//   - quality eval  (eval-quality)  on any issue with a suggested_response (not "No response")
//
// accuracy and quality both need the full per-ticket conversation thread. Rather
// than have each independently re-fetch it (2x the same DB reads on every ticket),
// this dispatcher builds each thread once and passes it to both via `threads`.
// eval-issue-v2 only ever looks at the single row being edited, so it needs no
// thread. Each downstream function still falls back to self-fetching when
// `threads` is absent (e.g. calls from the Backfill Evaluations admin tool).

import { ThreadIssue, buildConversationThread } from '../_shared/conversation-thread.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const sbHeaders = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

interface IssueRow {
  id:                 string
  ticket_id:          string
  issue_type:         string | null
  final_edits:        string | null
  suggested_response: string | null
  customer_input:     string | null
}

// Invoke a sibling eval function with a list of ids (plus optional extra body
// fields, e.g. pre-built conversation threads). Fire the request and wait for
// it so the dispatcher stays alive until scoring completes.
async function invokeEval(fnName: string, ids: string[], extra: Record<string, unknown> = {}): Promise<boolean> {
  if (ids.length === 0) return true
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method:  'POST',
      headers: sbHeaders,
      body:    JSON.stringify({ ids, ...extra }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Build the conversationThread string for each id in `ids`, fetching each
// distinct ticket's full issue history exactly once regardless of how many
// of its issues are in `ids`.
async function buildThreads(rows: IssueRow[], ids: string[]): Promise<Record<string, string>> {
  const byId = new Map(rows.map(r => [r.id, r]))
  const ticketIds = new Set<string>()
  for (const id of ids) {
    const row = byId.get(id)
    if (row) ticketIds.add(row.ticket_id)
  }
  if (ticketIds.size === 0) return {}

  const ctxRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ticket_issues?ticket_id=in.(${Array.from(ticketIds).join(',')})` +
      `&select=id,ticket_id,customer_input,suggested_response&order=logged_at.asc`,
    { headers: sbHeaders }
  )
  const ctxRows: (ThreadIssue & { ticket_id: string })[] = await ctxRes.json()
  const byTicket = new Map<string, ThreadIssue[]>()
  for (const r of Array.isArray(ctxRows) ? ctxRows : []) {
    const list = byTicket.get(r.ticket_id) ?? []
    list.push(r)
    byTicket.set(r.ticket_id, list)
  }

  const threads: Record<string, string> = {}
  for (const id of ids) {
    const row = byId.get(id)
    const playerMsg = (row?.customer_input ?? '').trim()
    if (!row || !playerMsg) continue
    const ticketIssues = byTicket.get(row.ticket_id) ?? []
    threads[id] = ticketIssues.length > 1
      ? buildConversationThread(ticketIssues, id, playerMsg)
      : `Player: "${playerMsg}"`
  }
  return threads
}

// Extract the ids to score from the request body. Accepts:
//   - Database Webhook payload:  { type, table, record: { id, ... } }
//   - Manual call:               { ids: string[] }  or  { id: string }
function extractIds(body: any): string[] {
  if (Array.isArray(body?.ids)) return body.ids.filter((x: unknown) => typeof x === 'string')
  if (typeof body?.id === 'string') return [body.id]
  if (body?.record?.id) return [body.record.id]
  return []
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const ids  = extractIds(body)

    if (ids.length === 0) {
      return new Response(JSON.stringify({ skipped: 'no ids in payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch the rows so we can route each to the right eval(s).
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ticket_issues?id=in.(${ids.join(',')})&select=id,ticket_id,issue_type,final_edits,suggested_response,customer_input`,
      { headers: sbHeaders }
    )
    const rows = await fetchRes.json() as IssueRow[]
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ skipped: 'no matching rows' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Edit eval — only Majority/Partial edits that actually have final_edits.
    const editIds = rows
      .filter(r => (r.issue_type === 'Majority edit' || r.issue_type === 'Partial edit') && r.final_edits)
      .map(r => r.id)

    // Accuracy + quality — anything with a suggested response (excludes "No response").
    const accQualIds = rows
      .filter(r => r.issue_type !== 'No response' && r.suggested_response)
      .map(r => r.id)

    // Build once, share with both — halves the redundant context-fetching.
    const threads = await buildThreads(rows, accQualIds)

    const [editOk, accOk, quaOk] = await Promise.all([
      invokeEval('eval-issue-v2', editIds),
      invokeEval('eval-accuracy', accQualIds, { threads }),
      invokeEval('eval-quality',  accQualIds, { threads }),
    ])

    return new Response(
      JSON.stringify({
        received:  ids.length,
        edit:      { count: editIds.length,    ok: editOk },
        accuracy:  { count: accQualIds.length, ok: accOk },
        quality:   { count: accQualIds.length, ok: quaOk },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
