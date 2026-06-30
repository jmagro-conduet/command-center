// eval-triage-report
// Per-section engineering triage report. Called once per section
// ('corrections' | 'enhancements' | 'accuracy' | 'quality') so each LLM call is
// focused, deep, and never truncates. Pulls that section's eval data, aggregates
// it (deterministic — never depends on the LLM), samples the worst cases (with the
// qualitative "why" fields), and has Claude produce a prioritized triage analysis.
//
// Reliability: the synthesis uses Anthropic STRUCTURED OUTPUTS (output_config.format)
// so the response is schema-valid JSON by construction — no code-fence stripping, no
// mid-JSON truncation, no "hope it parses". The deterministic layer (aggregates +
// drill-down via instance_filter) is returned independently of the synthesis, so the
// page is useful even if synthesis hiccups.
//
// On-demand from the "Eval Reports" top-level page (SuperAdmin-only UI). Accepts an
// optional range_start/range_end (ISO timestamps, either may be omitted for an
// open-ended bound) to scope which ticket_issues rows feed the analysis. The caller
// (the Generate modal) resolves presets like "Last 7 days" into concrete bounds and
// also sends range_label — a display string we store as-is and never interpret.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

const SECTIONS = ['corrections', 'enhancements', 'accuracy', 'quality'] as const
type Section = typeof SECTIONS[number]

const trunc = (s: string | null, n = 340) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '')
const tally = (arr: any[], key: string) => {
  const m: Record<string, number> = {}
  for (const r of arr) { const k = r[key] || 'NONE'; m[k] = (m[k] || 0) + 1 }
  return m
}
const avg = (arr: any[], key: string) => {
  const v = arr.map(r => r[key]).filter((x: any) => x != null)
  return v.length ? +(v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(2) : null
}

async function fetchRows(operatorId: string, filter: string, cols: string, rangeStart?: string, rangeEnd?: string): Promise<any[]> {
  const sinceFilter = rangeStart ? `&created_at=gte.${encodeURIComponent(rangeStart)}` : ''
  const untilFilter = rangeEnd ? `&created_at=lte.${encodeURIComponent(rangeEnd)}` : ''
  const rows: any[] = []
  for (let from = 0; from < 6000; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?operator_id=eq.${operatorId}&${filter}${sinceFilter}${untilFilter}&select=${cols}&order=created_at.desc&limit=1000&offset=${from}`, { headers: sb })
    if (!r.ok) break
    const chunk = await r.json()
    if (!Array.isArray(chunk) || chunk.length === 0) break
    rows.push(...chunk)
    if (chunk.length < 1000) break
  }
  return rows
}

const SHARED_CONTEXT = `"gameLM" is an AI customer-service agent for iGaming / sports-betting operators. It currently runs in CoPilot mode: it DRAFTS a suggested response that a human agent reviews before sending — it cannot itself perform account actions.`

const BREVITY = `Keep it tight and high-signal: AT MOST 5 findings and AT MOST 4 top_priorities, each field a few sentences. Lean on the qualitative fields — that's the real signal; don't just restate counts.

For every finding, populate instance_filter so a reviewer can pull the underlying tickets: instance_filter.themes MUST contain the EXACT theme_tag string(s) the finding draws from, copied verbatim from the data (e.g. "Deposit / Withdrawal", "Account Access", "General Query") — do not paraphrase or merge them.`

// JSON Schema for structured outputs. additionalProperties:false + full required on every
// object is required by the structured-outputs contract. Accuracy adds error_class to the
// drill filter; the other sections omit it.
function schemaFor(isAccuracy: boolean) {
  const instanceFilterProps: Record<string, unknown> = {
    themes: { type: 'array', items: { type: 'string' }, description: 'EXACT theme_tag string(s), verbatim from the data' },
  }
  const instanceFilterRequired = ['themes']
  if (isAccuracy) {
    instanceFilterProps.error_class = { type: 'string', enum: ['P1A', 'P1B', 'P2'], description: 'dominant accuracy error class for this finding' }
    instanceFilterRequired.push('error_class')
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'executive_summary', 'findings', 'top_priorities'],
    properties: {
      headline: { type: 'string', description: 'one-line takeaway for this section' },
      executive_summary: { type: 'string', description: '2-4 sentences on the biggest, most actionable problems' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'theme', 'severity', 'evidence', 'likely_root_cause', 'recommended_investigation', 'instance_filter'],
          properties: {
            title: { type: 'string', description: 'short issue name' },
            theme: { type: 'string', description: 'dominant theme/category this shows up in' },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            evidence: { type: 'string', description: 'the pattern in the data that shows this (not raw counts)' },
            likely_root_cause: { type: 'string', description: 'hypothesis: prompt / knowledge base / tool access / model behaviour' },
            recommended_investigation: { type: 'string', description: 'concrete next step or fix to investigate' },
            instance_filter: { type: 'object', additionalProperties: false, required: instanceFilterRequired, properties: instanceFilterProps },
          },
        },
      },
      top_priorities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rank', 'issue', 'why_it_matters', 'suggested_fix'],
          properties: {
            rank: { type: 'integer' },
            issue: { type: 'string' },
            why_it_matters: { type: 'string' },
            suggested_fix: { type: 'string' },
          },
        },
      },
    },
  }
}

interface SectionBuild { aggregates: any; userMsg: string; system: string; schema: unknown }

async function buildSection(section: Section, operatorId: string, rangeStart?: string, rangeEnd?: string): Promise<SectionBuild | null> {
  // CORRECTIONS — gameLM was factually WRONG. Requires a technical fix. Engineering must act.
  if (section === 'corrections') {
    const rows = await fetchRows(operatorId, 'eval_verdict=not.is.null',
      'eval_verdict,reasoning,final_edits,customer_input,suggested_response,theme_tag', rangeStart, rangeEnd)
    if (rows.length === 0) return null
    const aggregates = { ran: rows.length, byVerdict: tally(rows, 'eval_verdict') }
    const samples = rows.filter(r => r.eval_verdict === 'CORRECTION').slice(0, 22).map(r => ({
      theme: r.theme_tag, player: trunc(r.customer_input), gamelm: trunc(r.suggested_response),
      agent_fix: trunc(r.final_edits), agent_reason: trunc(r.reasoning),
    }))
    const system = `You are a senior engineer triaging gameLM. ${SHARED_CONTEXT} The EDIT eval flags when a human agent had to change the AI's suggested response. A CORRECTION means the AI was FACTUALLY WRONG — these REQUIRE an engineering fix. Focus ONLY on corrections: what gameLM gets wrong, why, and what to change (prompt, knowledge base, guardrail) to stop it. This is the must-fix bucket — treat every finding as work engineering needs to action. ${BREVITY}`
    const userMsg = `EDIT-EVAL AGGREGATES (verdict mix):\n${JSON.stringify(aggregates)}\n\nCORRECTION SAMPLES (agent_reason = why the human changed the AI's response; agent_fix = what they sent instead):\n${JSON.stringify(samples)}`
    return { aggregates, userMsg, system, schema: schemaFor(false) }
  }

  // ENHANCEMENTS — gameLM was OK but incomplete; the agent added value. Nice-to-have / backlog.
  if (section === 'enhancements') {
    const rows = await fetchRows(operatorId, 'eval_verdict=not.is.null',
      'eval_verdict,reasoning,final_edits,customer_input,suggested_response,theme_tag', rangeStart, rangeEnd)
    if (rows.length === 0) return null
    const aggregates = { ran: rows.length, byVerdict: tally(rows, 'eval_verdict') }
    const samples = rows.filter(r => r.eval_verdict === 'ENHANCEMENT').slice(0, 22).map(r => ({
      theme: r.theme_tag, player: trunc(r.customer_input), gamelm: trunc(r.suggested_response),
      agent_addition: trunc(r.final_edits), agent_reason: trunc(r.reasoning),
    }))
    const system = `You are a senior engineer reviewing gameLM. ${SHARED_CONTEXT} The EDIT eval flags ENHANCEMENT when the AI's suggested response was acceptable but INCOMPLETE — the human added value (extra detail, a proactive step, a clarification) rather than fixing an error. These are NICE-TO-HAVE opportunities, NOT bugs and NOT urgent. Identify where gameLM is consistently leaving value on the table — what it tends to omit, by theme — so the team can TRACK these and decide later whether to fold them in. Frame findings as "opportunities to make the model more complete", with a lower-urgency tone than corrections. ${BREVITY}`
    const userMsg = `EDIT-EVAL AGGREGATES (verdict mix):\n${JSON.stringify(aggregates)}\n\nENHANCEMENT SAMPLES (agent_reason = why the human enhanced the response; agent_addition = what they added):\n${JSON.stringify(samples)}`
    return { aggregates, userMsg, system, schema: schemaFor(false) }
  }

  if (section === 'accuracy') {
    const rows = await fetchRows(operatorId, 'accuracy_ran_at=not.is.null',
      'accuracy_error_class,accuracy_evidence,accuracy_reasoning,customer_input,suggested_response,theme_tag', rangeStart, rangeEnd)
    if (rows.length === 0) return null
    const themeAccuracy: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      if (r.accuracy_error_class && r.accuracy_error_class !== 'NONE') {
        const t = r.theme_tag || '—'; themeAccuracy[t] = themeAccuracy[t] || {}
        themeAccuracy[t][r.accuracy_error_class] = (themeAccuracy[t][r.accuracy_error_class] || 0) + 1
      }
    }
    const aggregates = { ran: rows.length, byClass: tally(rows, 'accuracy_error_class'), themeAccuracy }
    const sev: Record<string, number> = { P1A: 0, P1B: 1, P2: 2 }
    const samples = rows.filter(r => ['P1A', 'P1B', 'P2'].includes(r.accuracy_error_class))
      .sort((a, b) => sev[a.accuracy_error_class] - sev[b.accuracy_error_class]).slice(0, 26).map(r => ({
        class: r.accuracy_error_class, theme: r.theme_tag, player: trunc(r.customer_input),
        gamelm: trunc(r.suggested_response), evidence: trunc(r.accuracy_evidence), reasoning: trunc(r.accuracy_reasoning),
      }))
    const system = `You are a senior engineer triaging gameLM. ${SHARED_CONTEXT} The ACCURACY eval flags: P1A = regulatory / false action-claim (highest severity — e.g. claiming it performed an account action it cannot do), P1B = hallucination (invented facts, unbacked guarantees, wrong topic), P2 = account-data error (asserting account state it can't see). Find the patterns, root causes, and fixes to drive these down, prioritising P1A then P1B. For every finding, set instance_filter.error_class to the dominant class (P1A, P1B, or P2). ${BREVITY}`
    const userMsg = `ACCURACY AGGREGATES:\n${JSON.stringify(aggregates)}\n\nERROR SAMPLES (evidence = the exact text that triggered the flag):\n${JSON.stringify(samples)}`
    return { aggregates, userMsg, system, schema: schemaFor(true) }
  }

  if (section === 'quality') {
    const rows = (await fetchRows(operatorId, 'quality_ran_at=not.is.null',
      'quality_score,quality_intent,quality_resolution,quality_info_gathering,quality_clarity,quality_brand,quality_flag,quality_flag_reason,customer_input,suggested_response,theme_tag', rangeStart, rangeEnd)).filter(r => r.quality_score != null)
    if (rows.length === 0) return null
    const aggregates = {
      ran: rows.length, avgScore: avg(rows, 'quality_score'),
      dims: { intent: avg(rows, 'quality_intent'), resolution: avg(rows, 'quality_resolution'), info_gathering: avg(rows, 'quality_info_gathering'), clarity: avg(rows, 'quality_clarity'), brand: avg(rows, 'quality_brand') },
      below35: rows.filter(r => (r.quality_score || 0) < 3.5).length, flagged: rows.filter(r => r.quality_flag).length,
    }
    const samples = rows.filter(r => (r.quality_score || 0) < 3.5)
      .sort((a, b) => (a.quality_score || 0) - (b.quality_score || 0)).slice(0, 22).map(r => ({
        score: r.quality_score, theme: r.theme_tag, player: trunc(r.customer_input),
        gamelm: trunc(r.suggested_response), flag_reason: trunc(r.quality_flag_reason),
      }))
    const system = `You are a senior engineer triaging gameLM. ${SHARED_CONTEXT} The QUALITY eval scores five 1-5 dimensions: intent (understood the ask), resolution (actually resolved it), info_gathering (asked for the right info), clarity, brand. Identify which dimensions and themes drag scores down, the root causes, and fixes. ${BREVITY}`
    const userMsg = `QUALITY AGGREGATES (dimension averages reveal the weak link):\n${JSON.stringify(aggregates)}\n\nLOW-SCORE SAMPLES (<3.5; flag_reason = why it was flagged):\n${JSON.stringify(samples)}`
    return { aggregates, userMsg, system, schema: schemaFor(false) }
  }

  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const operatorId: string = body.operator_id
    const section: string = body.section
    const generatedBy: string | null = body.generated_by ?? null
    const rangeStart: string | undefined = body.range_start || undefined
    const rangeEnd: string | undefined = body.range_end || undefined
    const rangeLabel: string = typeof body.range_label === 'string' && body.range_label ? body.range_label : 'All time'
    if (!operatorId) return json({ error: 'operator_id is required' }, 400)
    if (!SECTIONS.includes(section as Section)) return json({ error: `section must be ${SECTIONS.join(' | ')}` }, 400)

    const built = await buildSection(section as Section, operatorId, rangeStart, rangeEnd)
    if (!built) return json({ error: `No ${section} eval data for this operator in the selected range yet.` }, 404)

    // Structured outputs: the response is schema-valid JSON by construction.
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        system: built.system,
        messages: [{ role: 'user', content: built.userMsg }],
        output_config: { format: { type: 'json_schema', schema: built.schema } },
      }),
    })

    let synthesis: any
    if (aiRes.ok) {
      const d = await aiRes.json()
      if (d.stop_reason === 'refusal') {
        synthesis = { error: 'The model declined to analyze this batch. Try Regenerate.' }
      } else {
        const block = d.content?.find((b: any) => b.type === 'text')
        const raw = block?.text ?? ''
        try {
          // output_config.format guarantees raw is schema-valid JSON — no fence stripping needed.
          synthesis = JSON.parse(raw)
        } catch {
          synthesis = { error: 'Unexpected non-JSON response. Try Regenerate.', stop_reason: d.stop_reason }
        }
      }
    } else {
      synthesis = { error: `Anthropic API ${aiRes.status}`, body: (await aiRes.text()).slice(0, 800) }
    }

    const generated_at = new Date().toISOString()

    // Persist a shared, append-only snapshot so all SuperAdmins see the same report
    // without re-running, AND can browse every prior run (flat timeline, no window
    // "lanes" — History just lists every row for this operator+section newest-first).
    // Best-effort: only store a clean synthesis (don't pollute history with an error
    // row), and never let a persistence failure (e.g. table not yet migrated) break
    // the response.
    if (synthesis && !synthesis.error) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/eval_triage_reports`, {
          method: 'POST',
          headers: sb,
          body: JSON.stringify({
            operator_id: operatorId, section, aggregates: built.aggregates, synthesis, generated_at, generated_by: generatedBy,
            range_start: rangeStart ?? null, range_end: rangeEnd ?? null, range_label: rangeLabel,
          }),
        })
      } catch { /* persistence is best-effort */ }
    }

    // Aggregates are deterministic and returned regardless of synthesis outcome —
    // the page stays useful even if the narrative call fails.
    return json({ section, range_start: rangeStart ?? null, range_end: rangeEnd ?? null, range_label: rangeLabel, generated_at, aggregates: built.aggregates, synthesis, generated_by: generatedBy })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
