// draft-bug-ticket
//
// A CS agent's raw bug submission is often sparse -- they're juggling other
// things and don't always fully "bake" a ticket. This turns whatever they
// did fill out (player_input, gameLM's suggested_response, expected/actual
// outcome, evidence) into a properly-shaped draft matching the real Linear
// bug template (confirmed against CON-1934): Description / Steps to recreate
// / Expected behavior / Actual behavior. No "Suggestions" section -- that's
// a dev/PM addition after triage, not something to auto-generate here.
//
// Grounds every field strictly in what was actually reported; never invents
// specifics. Anything that had to be inferred (steps reconstructed from a
// conversation, impact not stated) is flagged in low_confidence_sections
// instead of silently written as fact, so a reviewer knows exactly what to
// double-check before filing. Output is an editable preview -- actually
// creating the Linear ticket (write access) is a later phase, not this.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

const SHARED_CONTEXT = `"gameLM" is an AI customer-service co-pilot for iGaming/sports-betting support agents. In CoPilot mode it drafts a suggested response a human agent reviews before sending; in Full Auto mode it can respond directly. Bugs are reported by support agents and QA when gameLM's behavior didn't match what it should have done.`

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'steps_to_recreate', 'expected_behavior', 'actual_behavior', 'low_confidence_sections'],
  properties: {
    title: { type: 'string', description: 'short, specific ticket title (under ~100 chars) describing the concrete failure -- not a generic label like "gameLM bug"' },
    description: { type: 'string', description: 'narrative paragraph(s) framing the bug for someone with zero prior context: what happened, in what mode/scenario, who is affected. Ground strictly in the reported fields and evidence -- never invent specifics not present in the input. May reference the ticket_number/ticket_id if one was given.' },
    steps_to_recreate: { type: 'string', description: 'numbered list reconstructing how to reproduce the issue from the reported conversation/context. If a ticket_number or ticket_id was provided, end with a final line "Ticket ID: <that id>"; otherwise omit that line entirely rather than inventing one.' },
    expected_behavior: { type: 'string', description: 'what gameLM should have done -- from the reporter\'s expected_outcome field, cleaned up into a clear statement' },
    actual_behavior: { type: 'string', description: 'what gameLM actually did -- from the reporter\'s actual_outcome field, cleaned up into a clear statement' },
    low_confidence_sections: {
      type: 'array',
      description: 'flag any of the four sections above that required real inference beyond what the CS agent actually provided. Empty array if the submission was already complete enough that nothing was inferred.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'reason'],
        properties: {
          section: { type: 'string', enum: ['title', 'description', 'steps_to_recreate', 'expected_behavior', 'actual_behavior'] },
          reason: { type: 'string', description: 'what specifically is thin or uncertain and needs a human to confirm before filing -- e.g. "steps had to be reconstructed from the conversation, agent didn\'t list them" or "expected behavior wasn\'t explicitly stated, inferred from context"' },
        },
      },
    },
  },
}

function bugFieldsText(bug: any): string {
  return [
    `Ticket #: ${bug.ticket_number ?? 'not provided'}`,
    `Mode: ${bug.mode}`,
    `Severity (as tagged by reporter): ${bug.severity ?? 'not specified'}`,
    `Failing component (as tagged by reporter): ${bug.failing_component ?? 'not specified'}`,
    bug.player_input ? `Player conversation input: ${bug.player_input}` : null,
    bug.suggested_response ? `gameLM's suggested/actual response in the conversation: ${bug.suggested_response}` : null,
    bug.expected_outcome ? `Expected outcome (as reported by CS agent): ${bug.expected_outcome}` : `Expected outcome: not filled out by the reporter`,
    bug.actual_outcome ? `Actual outcome (as reported by CS agent): ${bug.actual_outcome}` : `Actual outcome: not filled out by the reporter`,
    bug.additional_context ? `Additional context from reporter: ${bug.additional_context}` : null,
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

    const system = `You are helping a QA reviewer turn a support agent's raw bug submission into a properly-shaped Linear bug ticket for gameLM engineering. ${SHARED_CONTEXT}

Match this exact real ticket template used by this team:
### Description
### Steps to recreate
### Expected behavior
### Actual behavior

Do NOT write a "Suggestions" section -- that's added later by a dev or PM during triage, not generated here. Ground every field strictly in the reported fields, the conversation, and any attached evidence (screenshots/PDFs) -- never invent player words, steps, or facts you weren't given. Where the agent's submission is too thin to write a section with confidence, still produce your best-effort draft from what's there, but flag it via low_confidence_sections rather than silently presenting an inference as fact.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1800,
        system,
        messages: [{ role: 'user', content: buildBugContent(bug) }],
        output_config: { format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      }),
    })
    if (!res.ok) return json({ error: `Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}` }, 502)
    const d = await res.json()
    if (d.stop_reason === 'refusal') return json({ error: 'The model declined to draft this ticket.' }, 502)
    const block = d.content?.find((b: any) => b.type === 'text')
    let draft: any
    try {
      draft = JSON.parse(block?.text ?? '')
    } catch {
      return json({ error: 'Unexpected non-JSON response.' }, 502)
    }

    return json({ ...draft, usage: d.usage ?? null })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
