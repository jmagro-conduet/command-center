// eval-triage-report
// Per-section engineering triage report. Called once per section ('corrections' |
// 'accuracy' | 'quality') so each LLM call is focused, deep, and never truncates.
// Pulls that section's eval data, aggregates it, samples the worst cases (with the
// qualitative "why" fields), and has Claude produce a prioritized triage analysis.
// On-demand from Admin Settings → Report tab (SuperAdmin-only UI).
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

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

async function fetchRows(operatorId: string, filter: string, cols: string): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; from < 6000; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?operator_id=eq.${operatorId}&${filter}&select=${cols}&order=created_at.desc&limit=1000&offset=${from}`, { headers: sb })
    if (!r.ok) break
    const chunk = await r.json()
    if (!Array.isArray(chunk) || chunk.length === 0) break
    rows.push(...chunk)
    if (chunk.length < 1000) break
  }
  return rows
}

const SHARED_CONTEXT = `"gameLM" is an AI customer-service agent for iGaming / sports-betting operators. It currently runs in CoPilot mode: it DRAFTS a suggested response that a human agent reviews before sending — it cannot itself perform account actions.`

const SCHEMA = `{
  "headline": "one-line takeaway for this section",
  "executive_summary": "2-4 sentences on the biggest, most fixable problems in this section",
  "findings": [
    { "title": "short issue name",
      "theme": "dominant theme/category this shows up in",
      "severity": "critical" | "high" | "medium" | "low",
      "evidence": "the pattern in the data that shows this (not raw counts)",
      "likely_root_cause": "hypothesis: prompt / knowledge base / tool access / model behaviour",
      "recommended_investigation": "concrete next step or fix to investigate" }
  ],
  "top_priorities": [ { "rank": 1, "issue": "...", "why_it_matters": "...", "suggested_fix": "..." } ]
}`

const BREVITY = `Keep it tight and high-signal: AT MOST 5 findings and AT MOST 4 top_priorities, each field a few sentences. Lean on the qualitative fields — that's the real signal; don't just restate counts. Return ONLY valid, complete JSON, no markdown.`

interface SectionBuild { aggregates: any; userMsg: string; system: string }

async function buildSection(section: string, operatorId: string): Promise<SectionBuild | null> {
  if (section === 'corrections') {
    const rows = await fetchRows(operatorId, 'eval_verdict=not.is.null',
      'eval_verdict,reasoning,final_edits,customer_input,suggested_response,theme_tag')
    if (rows.length === 0) return null
    const aggregates = { ran: rows.length, byVerdict: tally(rows, 'eval_verdict') }
    const samples = rows.filter(r => r.eval_verdict === 'CORRECTION').slice(0, 22).map(r => ({
      theme: r.theme_tag, player: trunc(r.customer_input), gamelm: trunc(r.suggested_response),
      agent_fix: trunc(r.final_edits), agent_reason: trunc(r.reasoning),
    }))
    const system = `You are a senior engineer triaging gameLM. ${SHARED_CONTEXT} The EDIT eval flags when a human agent had to change the AI's suggested response: CORRECTION = the AI was factually wrong; ENHANCEMENT = ok but incomplete; PREFERENCE = stylistic; AGENT_ERROR = the human made a correct response worse. Focus on CORRECTIONS — what gameLM gets wrong and why. ${BREVITY}`
    const userMsg = `EDIT-EVAL AGGREGATES:\n${JSON.stringify(aggregates)}\n\nCORRECTION SAMPLES (agent_reason = why the human changed the AI's response; agent_fix = what they sent instead):\n${JSON.stringify(samples)}\n\nReturn ONLY JSON matching:\n${SCHEMA}`
    return { aggregates, userMsg, system }
  }

  if (section === 'accuracy') {
    const rows = await fetchRows(operatorId, 'accuracy_ran_at=not.is.null',
      'accuracy_error_class,accuracy_evidence,accuracy_reasoning,customer_input,suggested_response,theme_tag')
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
    const system = `You are a senior engineer triaging gameLM. ${SHARED_CONTEXT} The ACCURACY eval flags: P1A = regulatory / false action-claim (highest severity — e.g. claiming it performed an account action it cannot do), P1B = hallucination (invented facts, unbacked guarantees, wrong topic), P2 = account-data error (asserting account state it can't see). Find the patterns, root causes, and fixes to drive these down, prioritising P1A then P1B. ${BREVITY}`
    const userMsg = `ACCURACY AGGREGATES:\n${JSON.stringify(aggregates)}\n\nERROR SAMPLES (evidence = the exact text that triggered the flag):\n${JSON.stringify(samples)}\n\nReturn ONLY JSON matching:\n${SCHEMA}`
    return { aggregates, userMsg, system }
  }

  if (section === 'quality') {
    const rows = (await fetchRows(operatorId, 'quality_ran_at=not.is.null',
      'quality_score,quality_intent,quality_resolution,quality_info_gathering,quality_clarity,quality_brand,quality_flag,quality_flag_reason,customer_input,suggested_response,theme_tag')).filter(r => r.quality_score != null)
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
    const userMsg = `QUALITY AGGREGATES (dimension averages reveal the weak link):\n${JSON.stringify(aggregates)}\n\nLOW-SCORE SAMPLES (<3.5; flag_reason = why it was flagged):\n${JSON.stringify(samples)}\n\nReturn ONLY JSON matching:\n${SCHEMA}`
    return { aggregates, userMsg, system }
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
    if (!operatorId) return json({ error: 'operator_id is required' }, 400)
    if (!['corrections', 'accuracy', 'quality'].includes(section)) return json({ error: 'section must be corrections | accuracy | quality' }, 400)

    const built = await buildSection(section, operatorId)
    if (!built) return json({ error: `No ${section} eval data for this operator yet.` }, 404)

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 4096, system: built.system, messages: [{ role: 'user', content: built.userMsg }] }),
    })

    let synthesis: any
    if (aiRes.ok) {
      const d = await aiRes.json()
      const raw = d.content?.[0]?.type === 'text' ? d.content[0].text.trim() : ''
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      try { synthesis = JSON.parse(cleaned) } catch { synthesis = { parse_error: true, raw: cleaned.slice(0, 4000) } }
    } else {
      synthesis = { error: `Anthropic API ${aiRes.status}` }
    }

    return json({ section, generated_at: new Date().toISOString(), aggregates: built.aggregates, synthesis })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
