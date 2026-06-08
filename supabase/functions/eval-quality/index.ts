// eval-quality (Eval 3 — Response Quality)
// Scores each gameLM suggested response across 5 quality categories.
// Now uses full conversation thread for accurate context-aware scoring.
// Also outputs THEME_TAG to surface recurring patterns.
//
// POST body: { ids: string[] }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!

const sbHeaders = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quality assurance evaluator for gameLM, an AI-powered customer service platform for sports betting and iGaming operators. Your job is to score a gameLM suggested response across five quality categories using the rubric below.

You are scoring the suggested response only — not any edited version submitted by a human agent.

You are provided with:
- The full conversation thread (all prior player messages and agent responses in this ticket, in order)
- The gameLM suggested response to the player's most recent message

Use the full conversation thread only for Category 3 (Information Gathering) — to assess what context has already been established. For all other categories, score based on the player's most recent message and the suggested response alone.

---

### Scoring Rubric

Score each category on a scale of 1 to 5.

A score of 4 or above in every category is the target standard.

---

**Category 1 — Intent Recognition (weight: 25%)**
Does the response address what the player actually asked?
- 1: Response addresses a different question than what the player asked
- 3: Broadly correct topic but misses the specific intent
- 5: Intent correctly identified; response directly addresses the player's actual issue

**Category 2 — Resolution Quality (weight: 25%)**
Does the response provide the correct resolution, policy, and next step?
- 1: Incorrect resolution, wrong policy applied, or harmful next step
- 3: Correct direction but incomplete — a step is missing or partially wrong
- 5: Correct resolution, correct policy, correct next step fully executed

**Category 3 — Information Gathering (weight: 20%)**
Did the response ask the right follow-up questions before attempting to resolve, where clarification was still needed at this point in the conversation?

Use the full conversation thread to assess what information has already been established. Do not penalise the response for not re-asking for information already provided earlier in the thread.

- 1: No follow-up asked where clarification was clearly still needed
- 3: Some follow-up attempted but incomplete, redundant given prior context, or asked in the wrong order
- 5: Right questions, right order, given what has already been established

If no clarification was needed — because the player's message was self-contained or required context was already present in the thread — score this category 5.

**Category 4 — Response Clarity (weight: 15%)**
Is the response easy for the player to understand and act on?
- 1: Confusing, ambiguous, or requires the player to re-read
- 3: Mostly clear but contains jargon or one unclear element
- 5: Clear, concise, and easy for the player to follow and act on

**Category 5 — Brand Alignment (weight: 15%)**
Does the response match the operator's tone, terminology, and communication standard?
- 1: Off-brand — robotic, pushy, overly formal, or uses wrong terminology
- 3: Mostly appropriate but tone is slightly off — too stiff, too casual, or missing expected warmth
- 5: Friendly, confident, and conversational. Warm and approachable, clear without jargon, lightly upbeat but never pushy.

---

### Weighted Average

Apply the following weights:
- Intent Recognition: 25%
- Resolution Quality: 25%
- Information Gathering: 20%
- Response Clarity: 15%
- Brand Alignment: 15%

---

### Your Task

1. Read the full conversation thread and the gameLM suggested response.
2. Score the response across all five categories.
3. Identify the primary topic of this conversation.
4. Return your output strictly in the format below.

---

### Output Format

INTENT_RECOGNITION: [1-5]
RESOLUTION_QUALITY: [1-5]
INFORMATION_GATHERING: [1-5]
RESPONSE_CLARITY: [1-5]
BRAND_ALIGNMENT: [1-5]
WEIGHTED_AVERAGE: [calculated to 2 decimal places]
FLAG: [YES / NO — flag YES if any single category scores 1]
FLAG_REASON: [If flagged, state which category scored 1 and quote the relevant response text. Otherwise "None".]
THEME_TAG: [choose the single most relevant: Account Access | Bet Dispute | Bet Placement | Bonus / Promotion | Deposit / Withdrawal | Game Dispute | KYC / Verification | Responsible Gaming | Settlement / Results | Technical Issue | Account Administration | General Query]

Do not add commentary outside this format. Do not classify accuracy errors — that is handled by Eval 2. Do not suggest rewrites.`

// ── Conversation thread builder ───────────────────────────────────────────────

interface TicketIssue {
  id: string
  customer_input: string | null
  suggested_response: string | null
}

function buildConversationThread(
  ticketIssues: TicketIssue[],
  currentId: string,
  currentInput: string
): string {
  const lines: string[] = []
  for (const ti of ticketIssues) {
    if (ti.id === currentId) break
    if (ti.customer_input?.trim())     lines.push(`Player: "${ti.customer_input.trim()}"`)
    if (ti.suggested_response?.trim()) lines.push(`Agent: "${ti.suggested_response.trim()}"`)
  }
  lines.push(`Player: "${currentInput}"`)
  return lines.join('\n')
}

// ── Parser ───────────────────────────────────────────────────────────────────

interface QualityResult {
  intent:        number | null
  resolution:    number | null
  infoGathering: number | null
  clarity:       number | null
  brand:         number | null
  score:         number | null
  flag:          boolean | null
  flagReason:    string | null
  themeTag:      string | null
}

function parseQualityOutput(text: string): QualityResult {
  const num = (pattern: RegExp) => {
    const m = text.match(pattern)
    return m ? parseInt(m[1], 10) : null
  }

  const intent        = num(/INTENT_RECOGNITION:\s*([1-5])/i)
  const resolution    = num(/RESOLUTION_QUALITY:\s*([1-5])/i)
  const infoGathering = num(/INFORMATION_GATHERING:\s*([1-5])/i)
  const clarity       = num(/RESPONSE_CLARITY:\s*([1-5])/i)
  const brand         = num(/BRAND_ALIGNMENT:\s*([1-5])/i)

  let score: number | null = null
  if (intent !== null && resolution !== null && infoGathering !== null && clarity !== null && brand !== null) {
    score = parseFloat(
      ((intent * 0.25) + (resolution * 0.25) + (infoGathering * 0.20) + (clarity * 0.15) + (brand * 0.15)).toFixed(2)
    )
  }

  const flagMatch       = text.match(/^FLAG:\s*(YES|NO)/im)
  const flag            = flagMatch ? flagMatch[1].toUpperCase() === 'YES' : null

  const flagReasonMatch = text.match(/FLAG_REASON:\s*([\s\S]+?)(?=\nTHEME_TAG:|$)/i)
  const flagReason      = flagReasonMatch?.[1]?.trim() ?? null

  const themeMatch = text.match(/THEME_TAG:\s*([^\n]+)/i)
  const themeTag   = themeMatch?.[1]?.trim() ?? null

  return { intent, resolution, infoGathering, clarity, brand, score, flag, flagReason, themeTag }
}

// ── Claude call ──────────────────────────────────────────────────────────────

async function scoreQuality(
  conversationThread: string,
  suggestedResponse: string
): Promise<QualityResult | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 320,
        system:     SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Conversation thread:\n${conversationThread}\n\ngameLM suggested response:\n"${suggestedResponse}"`,
        }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const raw  = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    return parseQualityOutput(raw)
  } catch {
    return null
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ids }: { ids: string[] } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: 'ids array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch issue rows — include ticket_id for conversation context
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ticket_issues?id=in.(${ids.join(',')})&select=id,ticket_id,customer_input,suggested_response`,
      { headers: sbHeaders }
    )
    const issues = await fetchRes.json()
    if (!Array.isArray(issues)) {
      return new Response(JSON.stringify({ error: 'Failed to fetch issues' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let processed = 0, skipped = 0, errors = 0

    for (const issue of issues) {
      const playerMsg = (issue.customer_input    ?? '').trim()
      const suggested = (issue.suggested_response ?? '').trim()

      if (!playerMsg || !suggested) { skipped++; continue }

      // Build full conversation thread from all prior exchanges in this ticket
      let conversationThread = `Player: "${playerMsg}"`
      try {
        const ctxRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ticket_issues?ticket_id=eq.${issue.ticket_id}&select=id,customer_input,suggested_response&order=logged_at.asc`,
          { headers: sbHeaders }
        )
        const ticketIssues: TicketIssue[] = await ctxRes.json()
        if (Array.isArray(ticketIssues) && ticketIssues.length > 1) {
          conversationThread = buildConversationThread(ticketIssues, issue.id, playerMsg)
        }
      } catch { /* fall back to single-turn if context fetch fails */ }

      const result = await scoreQuality(conversationThread, suggested)
      if (!result || result.score === null) { errors++; continue }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${issue.id}`, {
        method:  'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          quality_intent:         result.intent,
          quality_resolution:     result.resolution,
          quality_info_gathering: result.infoGathering,
          quality_clarity:        result.clarity,
          quality_brand:          result.brand,
          quality_score:          result.score,
          quality_flag:           result.flag,
          quality_flag_reason:    result.flagReason,
          theme_tag:              result.themeTag,
          quality_ran_at:         new Date().toISOString(),
        }),
      })

      if (patchRes.ok) processed++; else errors++
    }

    return new Response(JSON.stringify({ processed, skipped, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
