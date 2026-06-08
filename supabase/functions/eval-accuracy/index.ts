// eval-accuracy (Eval 2 — Response Accuracy)
// Checks each gameLM suggested response for P1A / P1B / P2 accuracy errors.
// Now uses full conversation thread for context-aware classification.
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

const SYSTEM_PROMPT = `You are a quality assurance evaluator for gameLM, an AI-powered customer service platform for sports betting and iGaming operators. Your job is to review a gameLM suggested response and determine whether it contains a P1 or P2 error as defined below.

You are provided with the full conversation thread leading up to this response, followed by the gameLM suggested response. Use the conversation history to understand the player's intent and context before evaluating.

---

### Error Classification

**P1A — Regulatory level (highest severity)**
The response does or implies something that could require operator reporting to a regulator or creates direct legal exposure. Detectable from the response text alone.

Examples:
- Offering to place a bet on behalf of a player
- Confirming an action gameLM cannot take: "Yes, your bet has been automatically cashed out"
- Providing responsible gambling guidance or advice without authorisation

**P1B — High-impact hallucination**
Two detectable patterns:

Pattern 1 — Topic mismatch: the response addresses a materially different subject than what the player asked, given the full conversation context. Use the thread to establish the player's actual intent.

Pattern 2 — Unsupported confident claim: the response makes a specific, definitive factual claim that goes beyond what the conversation called for. Examples:
- Stating a specific minimum bet amount when the player only asked whether they could bet at all
- Diagnosing a cause with certainty ("this is definitely a bank error")
- Confirming a specific processing time as a guarantee rather than an estimate

P1B flagged by this eval requires human review to confirm whether the claim is actually wrong.

**P2 — Account data error**
The response makes a specific claim about the player's account data — balances, transaction history, bet records — presenting absence of data as a confirmed fact.

Examples:
- "I can't see any deposits on your account" when the player asked whether a deposit went through
- "You didn't make any bets on Saturday" stated as fact

**P3 — Misunderstanding**
P3 is a quality issue handled by Eval 3. Do not classify P3 as P1 or P2 in this eval.

---

### Your Task

1. Read the full conversation thread and the gameLM suggested response.
2. Check for P1A, P1B, and P2 errors using the definitions above.
3. Return your classification strictly in the format below.

---

### Output Format

ERROR_CLASS: [P1A / P1B / P2 / NONE]
EVIDENCE: [Quote the exact language from the suggested response that triggered the classification, or "None" if no error found]
REASONING: [One to two sentences. For P1B, state which pattern applies and note that human review is required to confirm. For NONE, confirm what was checked and why it passed.]
HUMAN_REVIEW_REQUIRED: [YES / NO — always YES for P1B]

Do not add commentary outside this format. Do not suggest fixes.

If uncertain between P1A and P1B, classify as P1A.`

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

interface AccuracyResult {
  errorClass:  'P1A' | 'P1B' | 'P2' | 'NONE' | null
  evidence:    string | null
  reasoning:   string | null
  humanReview: boolean | null
}

function parseAccuracyOutput(text: string): AccuracyResult {
  const errorClassMatch  = text.match(/ERROR_CLASS:\s*(P1A|P1B|P2|NONE)/i)
  const evidenceMatch    = text.match(/EVIDENCE:\s*([\s\S]+?)(?=\nREASONING:|\nHUMAN_REVIEW)/i)
  const reasoningMatch   = text.match(/REASONING:\s*([\s\S]+?)(?=\nHUMAN_REVIEW)/i)
  const humanReviewMatch = text.match(/HUMAN_REVIEW_REQUIRED:\s*(YES|NO)/i)

  const errorClass = errorClassMatch?.[1]?.toUpperCase() as AccuracyResult['errorClass'] ?? null
  return {
    errorClass,
    evidence:    evidenceMatch?.[1]?.trim() ?? null,
    reasoning:   reasoningMatch?.[1]?.trim() ?? null,
    humanReview: humanReviewMatch
      ? humanReviewMatch[1].toUpperCase() === 'YES'
      : (errorClass !== null && errorClass !== 'NONE'),
  }
}

// ── Claude call ──────────────────────────────────────────────────────────────

async function classifyAccuracy(
  conversationThread: string,
  suggestedResponse: string
): Promise<AccuracyResult | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 512,
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
    return parseAccuracyOutput(raw)
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

      const result = await classifyAccuracy(conversationThread, suggested)
      if (!result || !result.errorClass) { errors++; continue }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${issue.id}`, {
        method:  'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          accuracy_error_class:  result.errorClass,
          accuracy_evidence:     result.evidence,
          accuracy_reasoning:    result.reasoning,
          accuracy_human_review: result.humanReview,
          accuracy_ran_at:       new Date().toISOString(),
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
