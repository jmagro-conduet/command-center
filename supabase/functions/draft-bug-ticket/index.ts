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
//
// When `existing_ticket_ref` is passed alongside a single bug_report_id,
// this switches to a different mode entirely: instead of drafting a new
// ticket, it produces a short comment-shaped note for pasting onto an
// ALREADY-FILED ticket (see EXAMPLE_SCHEMA) -- for when a new bug is just
// another occurrence of something already tracked, not something new.
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
    description: { type: 'string', description: 'narrative paragraph(s) framing the bug for someone with zero prior context: what happened, in what mode/scenario, who is affected. Ground strictly in the reported fields and evidence -- never invent specifics not present in the input. May reference the ticket_number/ticket_id if one was given. If there are multiple distinct observations (e.g. more than one thing went wrong), use a "- " bulleted list instead of run-on prose.' },
    steps_to_recreate: { type: 'string', description: 'ALWAYS a numbered list ("1. ", "2. ", ...) reconstructing how to reproduce the issue from the reported conversation/context. After the numbered steps, end with reference lines pulled verbatim from the input fields (never invent an id): one "Ticket ID: <id>" line per contributing bug that has a ticket_number/ticket_id -- there is usually just one, but there may be several when this draft covers a themed group of bugs; if a related/duplicate ticket reference was separately identified via QA triage, add one further "Related Ticket ID: <reference>" line per reference too. Omit any of these lines entirely rather than inventing one.' },
    expected_behavior: { type: 'string', description: 'what gameLM should have done -- from the reporter\'s expected_outcome field, cleaned up into a clear statement. Use a "- " bulleted list instead of one run-on sentence if there\'s more than one distinct expected behavior (e.g. different handling per scenario).' },
    actual_behavior: { type: 'string', description: 'what gameLM actually did -- from the reporter\'s actual_outcome field, cleaned up into a clear statement. Use a "- " bulleted list instead of one run-on sentence if there\'s more than one distinct observed behavior.' },
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

// "Add example to existing ticket" -- this bug isn't getting its own new
// Linear ticket, it's a further occurrence of something already filed.
// Produces a short comment-shaped note instead of the full four-section
// template, since it's meant to be pasted onto an EXISTING ticket, not
// stand alone as one.
const EXAMPLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['comment'],
  properties: {
    comment: { type: 'string', description: 'a short note (2-5 sentences, or a tight "- " bulleted list if there\'s more than one distinct point) for pasting as a Linear COMMENT on an already-filed ticket, describing this new occurrence of the same underlying issue -- NOT a full ticket with its own title/description/steps sections. Ground strictly in the reported fields and evidence; never invent specifics. End with a "Ticket ID: <id>" line if the bug has one, so the example stays traceable back to Command Center.' },
  },
}

function bugFieldsText(bug: any, relatedRefs: string[]): string {
  return [
    `Ticket ID: ${bug.ticket_id ?? 'not provided'}`,
    `Ticket #: ${bug.ticket_number ?? 'not provided'}`,
    `Mode: ${bug.mode}`,
    `Severity (as tagged by reporter): ${bug.severity ?? 'not specified'}`,
    `Failing component (as tagged by reporter): ${bug.failing_component ?? 'not specified'}`,
    bug.player_input ? `Player conversation input: ${bug.player_input}` : null,
    bug.suggested_response ? `gameLM's suggested/actual response in the conversation: ${bug.suggested_response}` : null,
    bug.mode === 'full_auto' && bug.resolution_outcome ? `Resolution outcome (Full Auto engagement signal, no human review step in this mode): ${bug.resolution_outcome}` : null,
    bug.expected_outcome ? `Expected outcome (as reported by CS agent): ${bug.expected_outcome}` : `Expected outcome: not filled out by the reporter`,
    bug.actual_outcome ? `Actual outcome (as reported by CS agent): ${bug.actual_outcome}` : `Actual outcome: not filled out by the reporter`,
    bug.additional_context ? `Additional context from reporter: ${bug.additional_context}` : null,
    relatedRefs.length > 0
      ? `Related/duplicate ticket(s) identified by QA triage (${bug.triage_status}): ${relatedRefs.join('; ')} -- cite each as its own "Related Ticket ID" line in steps_to_recreate so the draft cross-references them.`
      : null,
  ].filter(Boolean).join('\n')
}

// The triage step (classify-bug-report) persists up to a handful of matches
// as {source, id, title} -- id is a bug_reports uuid for a Command Center
// match, or a Linear issue URL for a Linear match. Command Center matches
// need a lookup for their own ticket_id/ticket_number; Linear matches
// already carry a usable title from triage, so no extra API call needed.
async function resolveRelatedTicketRefs(bug: any): Promise<string[]> {
  const matches: { source: 'command_center' | 'linear'; id: string; title?: string }[] = Array.isArray(bug.triage_matches) ? bug.triage_matches : []
  if (matches.length === 0) return []
  if (bug.triage_status !== 'related' && bug.triage_status !== 'duplicate') return []

  const refs: string[] = []
  for (const m of matches) {
    if (m.source === 'command_center') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports?id=eq.${m.id}&select=ticket_id,ticket_number`, { headers: sb })
      const matched = res.ok ? (await res.json())[0] : null
      if (matched?.ticket_id) refs.push(`Ticket ID ${matched.ticket_id}`)
      else if (matched?.ticket_number) refs.push(`Ticket #${matched.ticket_number}`)
    } else {
      refs.push(m.title ? `${m.title} (${m.id})` : m.id)
    }
  }
  return refs
}

function pushEvidence(content: any[], bug: any): void {
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
}

function buildBugContent(bug: any, relatedRefs: string[]): any[] {
  const content: any[] = [{ type: 'text', text: bugFieldsText(bug, relatedRefs) }]
  pushEvidence(content, bug)
  return content
}

// Drafting one ticket from a themed GROUP of bugs (Engineering Report's
// Root Cause Themes -> "Draft ticket from this theme") rather than a single
// bug -- no triage-match resolution here, since the whole point is that
// these bugs ARE the group, not a link to something else.
function buildMultiBugContent(bugs: any[], theme?: { title: string; explanation?: string }): any[] {
  const content: any[] = [{
    type: 'text',
    text: theme
      ? `These ${bugs.length} bug reports were grouped by an engineering triage pass as sharing one root cause -- draft ONE ticket that covers all of them together, not one per bug.\nTheme: ${theme.title}${theme.explanation ? `\nWhy grouped together: ${theme.explanation}` : ''}`
      : `These ${bugs.length} bug reports were selected together -- draft ONE ticket that covers all of them.`,
  }]
  bugs.forEach((bug, i) => {
    content.push({ type: 'text', text: `--- Bug ${i + 1} of ${bugs.length} ---\n${bugFieldsText(bug, [])}` })
    pushEvidence(content, bug)
  })
  return content
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const bugReportId: string | undefined = body.bug_report_id
    const bugReportIds: string[] | undefined = Array.isArray(body.bug_report_ids) ? body.bug_report_ids.filter((id: unknown) => typeof id === 'string') : undefined
    const themeTitle: string | undefined = typeof body.theme_title === 'string' ? body.theme_title : undefined
    const themeExplanation: string | undefined = typeof body.theme_explanation === 'string' ? body.theme_explanation : undefined
    const existingTicketRef: string | undefined = typeof body.existing_ticket_ref === 'string' ? body.existing_ticket_ref : undefined
    if (!bugReportId && (!bugReportIds || bugReportIds.length === 0)) return json({ error: 'bug_report_id or bug_report_ids is required' }, 400)

    if (existingTicketRef) {
      if (!bugReportId) return json({ error: 'bug_report_id is required with existing_ticket_ref' }, 400)
      const bugRes = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports?id=eq.${bugReportId}&select=*`, { headers: sb })
      if (!bugRes.ok) return json({ error: 'Failed to load bug report' }, 500)
      const bug = (await bugRes.json())[0]
      if (!bug) return json({ error: 'Bug report not found' }, 404)

      const exampleSystem = `You are helping a QA reviewer add a new occurrence of an already-known bug as a COMMENT on an existing, already-filed Linear ticket (${existingTicketRef}) -- you are NOT drafting a new ticket. ${SHARED_CONTEXT} Ground the note strictly in the reported fields, the conversation, and any attached evidence -- never invent player words, steps, or facts you weren't given. Keep it short and scannable; this supplements an existing ticket, it doesn't replace it.`
      const exampleRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 700,
          system: exampleSystem,
          messages: [{ role: 'user', content: buildBugContent(bug, []) }],
          output_config: { format: { type: 'json_schema', schema: EXAMPLE_SCHEMA } },
        }),
      })
      if (!exampleRes.ok) return json({ error: `Anthropic API ${exampleRes.status}: ${(await exampleRes.text()).slice(0, 500)}` }, 502)
      const ed = await exampleRes.json()
      if (ed.stop_reason === 'refusal') return json({ error: 'The model declined to draft this example.' }, 502)
      const eBlock = ed.content?.find((b: any) => b.type === 'text')
      let example: any
      try {
        example = JSON.parse(eBlock?.text ?? '')
      } catch {
        return json({ error: 'Unexpected non-JSON response.' }, 502)
      }
      return json({ comment: example.comment, existing_ticket_ref: existingTicketRef, usage: ed.usage ?? null })
    }

    let content: any[]
    if (bugReportIds && bugReportIds.length > 0) {
      const idFilter = bugReportIds.map(id => `"${id}"`).join(',')
      const bugsRes = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports?id=in.(${idFilter})&select=*`, { headers: sb })
      if (!bugsRes.ok) return json({ error: 'Failed to load bug reports' }, 500)
      const bugs: any[] = await bugsRes.json()
      if (bugs.length === 0) return json({ error: 'No matching bug reports found' }, 404)
      content = bugReportIds.length === 1
        ? buildBugContent(bugs[0], await resolveRelatedTicketRefs(bugs[0]))
        : buildMultiBugContent(bugs, themeTitle ? { title: themeTitle, explanation: themeExplanation } : undefined)
    } else {
      const bugRes = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports?id=eq.${bugReportId}&select=*`, { headers: sb })
      if (!bugRes.ok) return json({ error: 'Failed to load bug report' }, 500)
      const bug = (await bugRes.json())[0]
      if (!bug) return json({ error: 'Bug report not found' }, 404)
      content = buildBugContent(bug, await resolveRelatedTicketRefs(bug))
    }

    const isMulti = !!bugReportIds && bugReportIds.length > 1

    const system = `You are helping a QA reviewer turn a support agent's raw bug submission into a properly-shaped Linear bug ticket for gameLM engineering. ${SHARED_CONTEXT}

Match this exact real ticket template used by this team:
### Description
### Steps to recreate
### Expected behavior
### Actual behavior

Do NOT write a "Suggestions" section -- that's added later by a dev or PM during triage, not generated here. Ground every field strictly in the reported fields, the conversation, and any attached evidence (screenshots/PDFs) -- never invent player words, steps, or facts you weren't given. Where the agent's submission is too thin to write a section with confidence, still produce your best-effort draft from what's there, but flag it via low_confidence_sections rather than silently presenting an inference as fact.

Favor scannability: use plain-text "- " bullets or "1. " numbered lists inside a field whenever it holds more than one distinct item (steps are always numbered; description/expected/actual behavior become bullets only when there's genuinely more than one point, not for a single-sentence answer).${
      isMulti ? ` This draft covers ${bugReportIds!.length} bug reports grouped together as sharing one root cause -- synthesize them into ONE cohesive ticket rather than concatenating each bug's own description in turn, and call out any place they genuinely differ (e.g. different failing components or severities) rather than glossing over it.` : ''
    }`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: isMulti ? 2600 : 1800,
        system,
        messages: [{ role: 'user', content }],
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
