// classify-bug-report
//
// Reduces the cognitive load of triaging a newly drafted bug report: is this
// brand-new, related-but-distinct, a near-duplicate that should be added as a
// supporting example against an existing ticket rather than filed separately,
// or a possible non-issue (expected behavior given a known content/policy
// gap, or a scenario out of scope for gameLM -- a real, recurring pattern
// from RSI UAT)? Compares the target bug against the operator's other open
// Command Center bug_reports AND, when the operator has a linear_project_id
// configured (Settings -> Linear project), open issues in that Linear
// project.
//
// Distinct from bug-triage-report, which is a batch thematic summarizer over
// many bugs for an engineering handoff -- this is a single-bug classifier
// run at ticket-drafting time, meant to be fast and cheap enough to call
// every time a CS agent submits or edits a bug report.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const LINEAR_API_KEY    = Deno.env.get('LINEAR_API_KEY')
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
const LINEAR_API = 'https://api.linear.app/graphql'

const MAX_CC_CANDIDATES = 40
const MAX_LINEAR_CANDIDATES = 60

const SHARED_CONTEXT = `"gameLM" is an AI customer-service co-pilot for iGaming/sports-betting support agents. In CoPilot mode it drafts a suggested response a human agent reviews before sending; in Full Auto mode it can respond directly. Bugs are reported by support agents and QA when gameLM's behavior didn't match what it should have done. During real QA cycles (e.g. RSI UAT), a lot of reported "bugs" turned out to be non-issues or out-of-scope scenarios -- gameLM behaving correctly given a real content/policy gap, or a scenario outside what it was ever meant to handle.`

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reasoning', 'matched_ref'],
  properties: {
    status: {
      type: 'string',
      enum: ['new', 'related', 'duplicate', 'possible_non_issue'],
      description: 'new: no meaningful overlap with any candidate. related: shares a root cause or theme with a candidate but is a distinct enough scenario to deserve its own ticket. duplicate: close enough to a candidate\'s underlying issue that this should be added as a supporting example against it, not filed as a new ticket. possible_non_issue: the reported behavior looks like expected/correct behavior given a known content or policy gap, or is an out-of-scope scenario for gameLM -- flag for human judgment, never treat as decisively dismissed.',
    },
    reasoning: { type: 'string', description: '2-4 sentences a QA reviewer can act on immediately. When status is related, duplicate, or possible_non_issue, explicitly cite the matched candidate.' },
    matched_ref: { type: 'string', description: 'the ref value (e.g. "cc:2" or "linear:0") of the single best-matching candidate, copied exactly from the input. Empty string when status is "new" or nothing meaningfully matches.' },
  },
}

const trunc = (s: string | null | undefined, n = 400) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '')

function bugFieldsText(bug: any): string {
  return [
    `Ticket #: ${bug.ticket_number ?? 'n/a'}`,
    `Mode: ${bug.mode}`,
    `Severity: ${bug.severity}`,
    `Failing component (as tagged by the reporter): ${bug.failing_component ?? 'not specified'}`,
    bug.player_input ? `Player conversation input: ${bug.player_input}` : null,
    bug.suggested_response ? `gameLM suggested response: ${bug.suggested_response}` : null,
    `Expected outcome (as reported): ${bug.expected_outcome}`,
    `Actual outcome (as reported): ${bug.actual_outcome}`,
    bug.additional_context ? `Additional context: ${bug.additional_context}` : null,
  ].filter(Boolean).join('\n')
}

function buildBugContent(bug: any): any[] {
  const content: any[] = [{ type: 'text', text: bugFieldsText(bug) }]
  const evidence = Array.isArray(bug.evidence) ? bug.evidence : []
  for (const ev of evidence) {
    if (typeof ev?.url !== 'string') continue
    if (typeof ev.type === 'string' && ev.type.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'url', url: ev.url } })
    } else if (ev.type === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'url', url: ev.url } })
    } else if (ev.name) {
      content.push({ type: 'text', text: `[Attached file not directly readable by the model: ${ev.name}]` })
    }
  }
  return content
}

async function callClaude(system: string, content: any, schema: unknown, maxTokens: number) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  })
  if (!res.ok) return { error: `Anthropic API ${res.status}`, body: (await res.text()).slice(0, 500) }
  const d = await res.json()
  if (d.stop_reason === 'refusal') return { error: 'The model declined this item.' }
  const block = d.content?.find((b: any) => b.type === 'text')
  try {
    return { data: JSON.parse(block?.text ?? ''), usage: d.usage ?? null }
  } catch {
    return { error: 'Unexpected non-JSON response.' }
  }
}

async function fetchLinearIssues(projectId: string): Promise<any[]> {
  if (!LINEAR_API_KEY) return []
  const gql = `
    query($filter: IssueFilter) {
      issues(first: ${MAX_LINEAR_CANDIDATES}, filter: $filter, orderBy: updatedAt) {
        nodes {
          identifier
          title
          description
          url
          state { name type }
          labels { nodes { name } }
        }
      }
    }
  `
  try {
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql, variables: { filter: { project: { id: { eq: projectId } } } } }),
    })
    if (!res.ok) return []
    const data = await res.json()
    if (data.errors) return []
    return data.data?.issues?.nodes ?? []
  } catch {
    return []
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const bugReportId: string = body.bug_report_id
    if (!bugReportId) return json({ error: 'bug_report_id is required' }, 400)

    const bugRes = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports?id=eq.${bugReportId}&select=*`, { headers: sb })
    if (!bugRes.ok) return json({ error: 'Failed to load bug report' }, 500)
    const bug = (await bugRes.json())[0]
    if (!bug) return json({ error: 'Bug report not found' }, 404)

    const opRes = await fetch(`${SUPABASE_URL}/rest/v1/operators?id=eq.${bug.operator_id}&select=id,name,linear_project_id`, { headers: sb })
    const operator = opRes.ok ? (await opRes.json())[0] ?? null : null

    // Only compare against canonical/original bugs -- rows already filed as a
    // duplicate (canonical_bug_id set) point at another candidate that's
    // already in this list, so including them would just be noise.
    const ccRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bug_reports?operator_id=eq.${bug.operator_id}&id=neq.${bugReportId}&status=in.(open,investigating)&canonical_bug_id=is.null&select=id,ticket_number,mode,severity,failing_component,expected_outcome,actual_outcome,additional_context&order=created_at.desc&limit=${MAX_CC_CANDIDATES}`,
      { headers: sb },
    )
    const ccCandidates: any[] = ccRes.ok ? await ccRes.json() : []

    const linearIssues = operator?.linear_project_id ? await fetchLinearIssues(operator.linear_project_id) : []

    const resolveMatch = (ref: string) => {
      if (ref.startsWith('cc:')) {
        const c = ccCandidates[parseInt(ref.slice(3), 10)]
        if (!c) return { matched_source: null, matched_id: null, matched_title: null }
        return { matched_source: 'command_center', matched_id: c.id, matched_title: c.ticket_number ? `Ticket #${c.ticket_number}` : `Bug ${String(c.id).slice(0, 8)}` }
      }
      if (ref.startsWith('linear:')) {
        const iss = linearIssues[parseInt(ref.slice(7), 10)]
        if (!iss) return { matched_source: null, matched_id: null, matched_title: null }
        return { matched_source: 'linear', matched_id: iss.url, matched_title: `${iss.identifier}: ${iss.title}` }
      }
      return { matched_source: null, matched_id: null, matched_title: null }
    }

    const persist = async (fields: Record<string, unknown>) => {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/bug_reports?id=eq.${bugReportId}`, { method: 'PATCH', headers: sb, body: JSON.stringify(fields) })
      } catch { /* persistence is best-effort */ }
    }

    // Nothing to compare against -- skip the Claude call, it can only say "new".
    if (ccCandidates.length === 0 && linearIssues.length === 0) {
      const result = {
        status: 'new' as const,
        reasoning: operator?.linear_project_id
          ? 'No other open Command Center bugs or Linear issues found to compare against for this operator.'
          : 'No other open Command Center bugs found to compare against, and this operator has no Linear project linked (Settings -> Linear project) for cross-checking.',
        matched_source: null, matched_id: null, matched_title: null,
      }
      const triaged_at = new Date().toISOString()
      await persist({ triage_status: result.status, triage_reasoning: result.reasoning, triage_matched_source: null, triage_matched_id: null, triaged_at })
      return json({ ...result, triaged_at, meta: { cc_candidates: 0, linear_candidates: 0, linear_project_linked: !!operator?.linear_project_id } })
    }

    const ccList = ccCandidates.map((c, i) => ({
      ref: `cc:${i}`,
      ticket_number: c.ticket_number,
      mode: c.mode,
      severity: c.severity,
      failing_component: c.failing_component,
      expected_outcome: trunc(c.expected_outcome),
      actual_outcome: trunc(c.actual_outcome),
      additional_context: trunc(c.additional_context),
    }))
    const linearList = linearIssues.map((iss: any, i: number) => ({
      ref: `linear:${i}`,
      identifier: iss.identifier,
      title: iss.title,
      description: trunc(iss.description, 600),
      state: iss.state?.name,
      state_type: iss.state?.type,
      labels: (iss.labels?.nodes ?? []).map((l: any) => l.name),
    }))

    const system = `You are a QA triage assistant for gameLM bug reports. ${SHARED_CONTEXT}

Compare the NEW BUG REPORT below against the candidate lists (existing open Command Center bugs, and existing Linear issues for this operator, if any) and classify it as new / related / duplicate / possible_non_issue. Reference a matched candidate ONLY by its exact "ref" string copied from the input (e.g. "cc:2" or "linear:0") -- never invent a ref, ticket number, or identifier. Pick at most one best match. A Linear issue whose state_type is "duplicate" or "canceled" can still be the right match if the new report describes the same underlying scenario -- say so in your reasoning.`

    const content = [
      ...buildBugContent(bug),
      { type: 'text', text: `EXISTING COMMAND CENTER BUGS FOR THIS OPERATOR:\n${JSON.stringify(ccList)}\n\nEXISTING LINEAR ISSUES FOR THIS OPERATOR'S PROJECT:\n${JSON.stringify(linearList)}` },
    ]

    const result = await callClaude(system, content, CLASSIFY_SCHEMA, 900)
    if (!result.data) {
      return json({ error: [result.error, result.body].filter(Boolean).join(' — ') || 'Classification failed' }, 502)
    }

    const matched = resolveMatch(result.data.matched_ref ?? '')
    const triaged_at = new Date().toISOString()
    await persist({
      triage_status: result.data.status,
      triage_reasoning: result.data.reasoning,
      triage_matched_source: matched.matched_source,
      triage_matched_id: matched.matched_id,
      triaged_at,
    })

    return json({
      status: result.data.status,
      reasoning: result.data.reasoning,
      ...matched,
      triaged_at,
      meta: { cc_candidates: ccCandidates.length, linear_candidates: linearIssues.length, linear_project_linked: !!operator?.linear_project_id },
    })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
