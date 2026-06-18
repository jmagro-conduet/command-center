import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders } from '../_shared/cors.ts'

interface CategoryInsightRequest {
  category: string
  vol: number
  perfectRate: number
  editDependency: number
  noRespRate: number
  // Verdict breakdown (why edits happened — from human review)
  preferenceEdits: number   // PREFERENCE verdicts
  correctionEdits: number   // CORRECTION verdicts
  enhancementEdits: number  // ENHANCEMENT verdicts
  // Accuracy error class distribution
  accClasses: Record<string, number>  // e.g. { 'HALLUCINATION': 3, 'MISSING_INFO': 5 }
}

function buildPrompt(req: CategoryInsightRequest): string {
  const { category, vol, perfectRate, editDependency, noRespRate, preferenceEdits, correctionEdits, enhancementEdits, accClasses } = req

  const totalVerdict = preferenceEdits + correctionEdits + enhancementEdits

  // Translate internal labels into plain English before passing to Claude
  const editContext = totalVerdict > 0 ? [
    correctionEdits > 0   && `${correctionEdits} of ${totalVerdict} reviewed edits were genuine fixes (the AI response was wrong or missing key info)`,
    preferenceEdits > 0   && `${preferenceEdits} of ${totalVerdict} reviewed edits were style or tone choices by the agent (the AI was correct but the agent rewrote it anyway)`,
    enhancementEdits > 0  && `${enhancementEdits} of ${totalVerdict} reviewed edits added extra detail on top of a good response`,
  ].filter(Boolean).join('. ') : null

  // Translate accClass codes into plain descriptions
  const accDescriptions: Record<string, string> = {
    'HALLUCINATION':   'made up information',
    'MISSING_INFO':    'left out important details',
    'WRONG_OUTCOME':   'reached the wrong conclusion',
    'OUTDATED':        'used outdated information',
    'MISUNDERSTOOD':   'misread what the customer was asking',
  }
  const accEntries = Object.entries(accClasses).filter(([, n]) => n > 0)
  const accContext = accEntries.length > 0
    ? accEntries.map(([cls, n]) => `${n} case${n > 1 ? 's' : ''} where the AI ${accDescriptions[cls] ?? 'had an accuracy issue'}`).join(', ')
    : null

  return `You are helping a leadership team understand why gameLM — an AI customer support tool for a sports betting operator — is not yet fully automatic for a specific query type.

gameLM suggests responses. Agents either send them as-is or edit them before sending. We want more sent as-is.

Query type: ${category}
Total interactions reviewed: ${vol}
Sent without any edits: ${perfectRate}%
Required edits before sending: ${editDependency}%
gameLM had no useful response: ${noRespRate}%
${editContext ? `Why agents edited: ${editContext}` : ''}
${accContext ? `Accuracy problems found: ${accContext}` : ''}

Write two sections for a leadership audience. Plain English only — no jargon, no acronyms, no internal codes. Always refer to the AI as "gameLM", never "the AI" or "the model".

OPERATIONS — what the team is doing that causes edits. 2 bullets max. One plain sentence each, under 20 words.

TECHNICAL — what gameLM struggles with for this query type. 2 bullets max, each with 2–3 sub-bullets.
  Main bullet: the broad theme (e.g. "gameLM struggles with complex multi-part queries")
  Sub-bullets: specific examples of player inputs or situations that typically produce no response or a wrong response. Make these feel real — phrase them the way a player would actually ask (e.g. "My bet was settled wrong because the score was updated late").

Rules:
- No jargon, no acronyms, no internal labels
- Specific to ${category} — not generic
- If not enough data: one bullet only: "Not enough data yet to identify clear patterns."

Format exactly:
OPERATIONS
• [sentence]
• [sentence]

TECHNICAL
• [broad theme]
  - [specific player input example or situation]
  - [specific player input example or situation]
  - [specific player input example or situation]
• [broad theme]
  - [specific player input example or situation]
  - [specific player input example or situation]`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: CategoryInsightRequest = await req.json()
    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages:   [{ role: 'user', content: buildPrompt(body) }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    return new Response(
      JSON.stringify({ insights: text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
