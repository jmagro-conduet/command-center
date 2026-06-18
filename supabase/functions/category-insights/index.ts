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
  const prefPct  = totalVerdict ? Math.round((preferenceEdits  / totalVerdict) * 100) : null
  const corrPct  = totalVerdict ? Math.round((correctionEdits  / totalVerdict) * 100) : null
  const enhPct   = totalVerdict ? Math.round((enhancementEdits / totalVerdict) * 100) : null

  const verdictSummary = totalVerdict > 0
    ? `Edit breakdown (human-reviewed): ${correctionEdits} actual corrections (${corrPct}%), ${preferenceEdits} preference overrides (${prefPct}%), ${enhancementEdits} enhancements (${enhPct}%)`
    : 'Edit breakdown: not yet human-reviewed'

  const accEntries = Object.entries(accClasses).filter(([, n]) => n > 0)
  const accSummary = accEntries.length > 0
    ? accEntries.map(([cls, n]) => `${cls}: ${n}`).join(', ')
    : 'No accuracy flags recorded'

  return `You are a senior CS operations analyst reviewing AI-assisted support performance data for a sports betting operator.

The AI tool (gameLM) suggests responses to customer support queries. Agents review each suggestion and categorise it as:
- Perfect: sent as-is (no edits)
- Majority edit: agent made significant changes
- Partial edit: agent made minor changes
- No response: gameLM returned nothing useful

You are analysing the category: **${category}**

METRICS (last period):
- Total interactions: ${vol}
- Perfect rate: ${perfectRate}% (want this high — means gameLM is ready to send)
- Edit dependency: ${editDependency}% (want this low — means agents are editing too often)
- No response rate: ${noRespRate}% (want this low — means gameLM has no useful answer)
- ${verdictSummary}
- Accuracy flags: ${accSummary}

Provide two short, specific insight blocks. Be direct and grounded in the numbers above.

**OPERATIONS** — recurring human and process themes that explain why agents are editing or overriding. Focus on: agent behaviour patterns (e.g. preference-driven edits, vocabulary habits, "good enough" mentality), training gaps, or workflow friction. Reference the specific verdict data if available.

**TECHNICAL** — recurring system and model themes that explain no responses or accuracy corrections. Focus on: query sub-types that gameLM struggles with in this category, knowledge gaps, edge cases, or accuracy error patterns.

Rules:
- Each block: 2–3 bullet points maximum
- Reference actual numbers from the data
- Be specific to this category (${category}) — not generic AI advice
- If preference edits dominate, call it out in Operations: agents may be overriding for style, not accuracy
- If no-response rate is high, investigate what sub-types of ${category} queries are likely causing it
- No preamble, no closing summary, no filler phrases
- If the data volume is too low to draw conclusions, say so honestly in one line

Return ONLY the two blocks in this exact format:

OPERATIONS
• [insight]
• [insight]

TECHNICAL
• [insight]
• [insight]`
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
