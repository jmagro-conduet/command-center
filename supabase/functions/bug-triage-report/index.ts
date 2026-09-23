// bug-triage-report
// AI analysis over every bug report for an operator that isn't dismissed as
// Won't Fix, filed within a lookback window (default 30 days, caller-
// configurable via `days`) -- NOT filtered by status. Statuses like
// resolved/duplicate/related are easy to forget to set in the moment, so
// filtering by them would silently drop real, recent bugs that are still
// worth a theme or a resolution brief; a date window doesn't have that
// failure mode. On top of that, bugs already carrying a real link (a filed
// ticket, a confirmed duplicate, a confirmed Linear match) are excluded
// entirely -- those are context fields set only by a deliberate action, so
// unlike status they're a trustworthy "already handled" signal, and
// re-analyzing them risks producing a second, competing ticket for
// something already tracked. Produces two things in one run:
//   1. A per-bug "resolution brief" (description / steps to reproduce / suggested fix /
//      expected behavior / actual behavior / impact) an engineer can pick up cold —
//      grounded in the reported fields AND any attached evidence (screenshots/PDFs),
//      read natively via Claude's multimodal content blocks.
//   2. A cross-cutting "themes" pass across ALL analyzed bugs looking for a shared
//      deeper root cause even when individual bugs were manually tagged under
//      different failing_component values.
//
// On-demand from the Bug Tracker's Engineering Report tab (admin-only UI). Every run
// is persisted as its own row (bug_triage_reports) so past runs stay browsable as
// history, same pattern as eval_triage_reports.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

// Hard cap so one run can't blow past the edge function's execution window when an
// operator has a large open-bug backlog. Highest severity + most recent are kept;
// anything dropped is reported back (never silently).
const MAX_BUGS = 30
const CONCURRENCY = 4

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const trunc = (s: string | null | undefined, n = 320) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '')

const SHARED_CONTEXT = `"gameLM" is an AI customer-service co-pilot for iGaming/sports-betting support agents. In CoPilot mode it drafts a suggested response a human agent reviews before sending; in Full Auto mode it can respond directly. Bugs are reported by support agents and QA when gameLM's behavior didn't match what it should have done.`

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'steps_to_reproduce', 'suggested_fix', 'expected_behavior', 'actual_behavior', 'impact'],
  properties: {
    description:        { type: 'string', description: '2-4 sentences summarizing the bug for an engineer with zero prior context on it' },
    steps_to_reproduce:  { type: 'string', description: 'numbered steps, reconstructed from the reported conversation/context — say so if steps must be inferred rather than directly observed' },
    suggested_fix:       { type: 'string', description: 'a concrete engineering angle to investigate — prompt/instruction change, knowledge-base gap, tool or data access issue, guardrail, etc.' },
    expected_behavior:   { type: 'string' },
    actual_behavior:     { type: 'string' },
    impact:              { type: 'string', description: 'who is affected and how — player trust, compliance/RG exposure, agent workload, etc. — weighted by the reported severity and mode' },
  },
}

const THEMES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['themes'],
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'explanation', 'bug_indices'],
        properties: {
          title:        { type: 'string', description: 'short name for the shared root cause' },
          explanation:  { type: 'string', description: 'the SPECIFIC shared mechanism tying these bugs together (e.g. the exact knowledge-base article that\'s missing/wrong, the exact tool call that\'s misfiring, the exact prompt ambiguity) -- not a category label like "these are all payments issues". If you can\'t name a specific mechanism, these bugs don\'t belong in the same theme. Also say what engineering should investigate to confirm/fix it at the root.' },
          bug_indices:  { type: 'array', items: { type: 'integer' }, description: 'the idx value of every bug that belongs to this theme, copied from the input' },
        },
      },
    },
  },
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const operatorId: string = body.operator_id
    const generatedBy: string | null = body.generated_by ?? null
    if (!operatorId) return json({ error: 'operator_id is required' }, 400)

    const days = Number.isFinite(body.days) && body.days > 0 ? Math.floor(body.days) : 30
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bug_reports?operator_id=eq.${operatorId}&status=neq.wont_fix&created_at=gte.${sinceIso}&select=*&order=created_at.desc`,
      { headers: sb },
    )
    if (!listRes.ok) return json({ error: 'Failed to load bug reports' }, 500)
    const inWindow: any[] = await listRes.json()

    // Exclude bugs that already have a real, confirmed link -- a filed
    // ticket, a confirmed duplicate, or a confirmed Linear match. These are
    // context fields set only by a deliberate reviewer action, unlike status
    // (which gets repurposed for other bucketing), so they're the reliable
    // signal for "this bug no longer needs a new brief/theme; it's already
    // handled." Regenerating a brief/theme for it would just risk producing
    // a second, competing ticket for something already tracked.
    const isAlreadyHandled = (b: any) => !!(b.filed_ticket_id || b.filed_ticket_url || b.canonical_bug_id || b.linear_issue_id || b.linear_issue_url)
    const allOpen: any[] = inWindow.filter(b => !isAlreadyHandled(b))
    const excludedHandled = inWindow.length - allOpen.length
    if (allOpen.length === 0) {
      return json({
        error: excludedHandled > 0
          ? `All ${excludedHandled} bugs from the last ${days} days are already linked or filed -- nothing new to analyze.`
          : `No bugs from the last ${days} days for this operator (excluding Won't Fix).`,
      }, 404)
    }

    const totalOpen = allOpen.length
    const sorted = [...allOpen].sort((a, b) => {
      const sevDiff = (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9)
      if (sevDiff !== 0) return sevDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    const truncated = totalOpen > MAX_BUGS
    const bugs = sorted.slice(0, MAX_BUGS)

    let totalInput = 0, totalOutput = 0, calls = 0
    const tally = (u: any) => { if (u) { totalInput += u.input_tokens ?? 0; totalOutput += u.output_tokens ?? 0 }; calls++ }

    // ── Per-bug resolution briefs ──────────────────────────────────────────
    const briefSystem = `You are a senior engineer writing a resolution brief for a single reported bug in gameLM. ${SHARED_CONTEXT} Ground every field strictly in the reported text and any attached evidence — never invent ticket details, player words, or facts you weren't given. Write for an engineer who has never seen this ticket before.`
    const briefs = await mapLimit(bugs, CONCURRENCY, async bug => {
      const result = await callClaude(briefSystem, buildBugContent(bug), BRIEF_SCHEMA, 1200)
      tally(result.usage)
      return {
        bug_id: bug.id,
        ticket_id: bug.ticket_id,
        ticket_number: bug.ticket_number,
        mode: bug.mode,
        severity: bug.severity,
        failing_component: bug.failing_component,
        status: bug.status,
        ...(result.data ?? { error: [result.error, result.body].filter(Boolean).join(' — ') || 'Generation failed' }),
      }
    })

    // ── Cross-cutting themes ────────────────────────────────────────────────
    const indexed = bugs.map((b, i) => ({
      idx: i + 1,
      ticket_number: b.ticket_number,
      mode: b.mode,
      severity: b.severity,
      failing_component: b.failing_component,
      expected_outcome: trunc(b.expected_outcome),
      actual_outcome: trunc(b.actual_outcome),
      additional_context: trunc(b.additional_context),
    }))
    const themesSystem = `You are a senior engineer looking for deeper, cross-cutting root causes across a batch of gameLM bugs. Individually-tagged "failing components" can share one true underlying cause (a specific knowledge-base gap, a shared prompt ambiguity, a tool/data-access limitation) even when the manual tags differ — find those clusters.

These theme groupings become real, filed Linear tickets covering multiple bugs at once, so precision matters more than coverage: a bug sitting ungrouped costs nothing, but a bug forced into a theme it doesn't truly share a root cause with produces a vague, harder-to-triangulate ticket. Group bugs ONLY when you can point to one SPECIFIC shared mechanism between them (the same missing KB article, the same misfiring tool call, the same prompt ambiguity) -- never on category/component similarity alone ("both payments-related" is not a shared mechanism). Prefer several small, tight themes over one broad one. It's fine, and expected, to return few or zero themes when the bugs are mostly unrelated -- do not force a grouping to avoid an empty result. Reference bugs ONLY by their idx integer, copied exactly from the input — never invent an idx.`
    const themesResult = await callClaude(
      themesSystem,
      `CANDIDATE BUGS (idx is how you must reference each one):\n${JSON.stringify(indexed)}`,
      THEMES_SCHEMA,
      3000,
    )
    tally(themesResult.usage)

    const byIdx = new Map(bugs.map((b, i) => [i + 1, b]))
    const themes = (themesResult.data?.themes ?? []).map((t: any) => {
      const related = (Array.isArray(t.bug_indices) ? t.bug_indices : [])
        .map((i: number) => byIdx.get(i))
        .filter(Boolean)
        .map((b: any) => ({ bug_id: b.id, ticket_id: b.ticket_id, ticket_number: b.ticket_number }))
      return { title: t.title, explanation: t.explanation, bugs: related }
    })

    const themesError = !themesResult.data
      ? [themesResult.error, themesResult.body].filter(Boolean).join(' — ') || 'Theme generation failed'
      : null

    const generated_at = new Date().toISOString()
    const meta = { total_open: totalOpen, analyzed: bugs.length, truncated, themes_error: themesError, days, excluded_handled: excludedHandled }
    const usage = { input_tokens: totalInput, output_tokens: totalOutput, calls }
    // `statuses` predates the date-window filter (it used to BE the filter) --
    // kept as a text[] column for the legacy not-null constraint, now just a
    // human-readable note of what actually ran, not something re-parsed.
    const statuses = [`last ${days} days (excl. wont_fix)`]

    // Best-effort persistence — a save failure shouldn't lose the report the admin
    // is looking at right now, just mean it won't show up in History later.
    let id: string | null = null
    try {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bug_triage_reports`, {
        method: 'POST',
        headers: { ...sb, Prefer: 'return=representation' },
        body: JSON.stringify({
          operator_id: operatorId, generated_at, generated_by: generatedBy,
          bug_count: bugs.length, statuses, briefs, themes, usage, meta,
        }),
      })
      if (insertRes.ok) { const rows = await insertRes.json(); id = rows?.[0]?.id ?? null }
    } catch { /* persistence is best-effort */ }

    return json({ id, generated_at, generated_by: generatedBy, bug_count: bugs.length, statuses, briefs, themes, usage, meta })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
