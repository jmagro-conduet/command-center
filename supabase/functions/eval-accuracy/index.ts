// eval-accuracy (Eval 2 — Response Accuracy)
// Checks each gameLM suggested response for P1A / P1B / P2 accuracy errors.
//
// P1A — Regulatory: response does/implies something that creates legal exposure
// P1B — Hallucination: topic mismatch OR unsupported confident claim
// P2  — Account data error: presents absence of data as confirmed fact
// NONE — Clean response
//
// POST body: { ids: string[] }
// ids — ticket_issue IDs to evaluate

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

// ── System prompt (Eval 2 — Response Accuracy) ─────────────────────────────

const SYSTEM_PROMPT = `You are a quality assurance evaluator for gameLM, an AI-powered customer service platform for sports betting and iGaming operators. Your job is to review a gameLM suggested response and determine whether it contains a P1 or P2 error as defined below.

You are reviewing the suggested response in the context of the player's message. You do not have access to the player's account data or any backend system data.

---

### Error Classification

**P1A — Regulatory level (highest severity)**
The response does or implies something that could require operator reporting to a regulator or creates direct legal exposure. This is detectable from the response text alone — no account data needed.

Examples of P1A language:
- Offering to place a bet on behalf of a player: "I'll place that bet for you"
- Confirming an action gameLM cannot take: "Yes, your bet has been automatically cashed out"
- Providing responsible gambling guidance or advice without authorisation

**P1B — High-impact hallucination**
Two detectable patterns using only the player message and suggested response:

Pattern 1 — Topic mismatch: the response addresses a materially different subject than what the player asked. If a player asks what time a withdrawal will arrive and the response discusses deposit methods, that is a hallucination regardless of whether the deposit content is accurate.

Pattern 2 — Unsupported confident claim: the response makes a specific, definitive factual claim (a figure, a diagnosis, a policy statement) that goes beyond what the player's question called for, or that cannot be verified from the conversation alone. Examples:
- Stating a specific minimum bet amount when the player only asked whether they could bet at all
- Diagnosing a cause with certainty ("this is definitely a bank error") when the player only reported a symptom
- Confirming a specific processing time as a guarantee rather than an estimate

P1B flagged by this eval requires human review to confirm whether the claim is actually wrong. The eval surfaces the risk; a human closes the loop.

**P2 — Account data error**
The response makes a specific claim about the player's account data — balances, transaction history, bet records — in a way that presents absence of data as a confirmed fact. Detectable from the response text alone.

Examples:
- "I can't see any deposits on your account" when the player asked whether a deposit went through
- "You didn't make any bets on Saturday" stated as a fact rather than a data retrieval result

**P3 — Misunderstanding**
The response addresses the wrong topic or closes prematurely. P3 is a quality issue handled by Eval 3, not an accuracy error. Do not classify P3 as P1 or P2 in this eval.

---

### Your Task

1. Read the player message and the gameLM suggested response.
2. Check for P1A, P1B, and P2 errors using the definitions above.
3. Return your classification strictly in the format below.

---

### Output Format

ERROR_CLASS: [P1A / P1B / P2 / NONE]
EVIDENCE: [Quote the exact language from the suggested response that triggered the classification, or "None" if no error found]
REASONING: [One to two sentences. For P1B, state which pattern applies — topic mismatch or unsupported confident claim — and note that human review is required to confirm. For NONE, confirm what was checked and why it passed.]
HUMAN_REVIEW_REQUIRED: [YES / NO — always YES for P1B]

Do not add commentary outside this format. Do not suggest fixes. Do not score response quality — that is handled by Eval 3.

If uncertain between P1A and P1B, classify as P1A.`

// ── Parser ──────────────────────────────────────────────────────────────────

interface AccuracyResult {
  errorClass:   'P1A' | 'P1B' | 'P2' | 'NONE' | null
  evidence:     string | null
  reasoning:    string | null
  humanReview:  boolean | null
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
    humanReview: humanReviewMatch ? humanReviewMatch[1].toUpperCase() === 'YES' : (errorClass !== null && errorClass !== 'NONE'),
  }
}

// ── Claude call ─────────────────────────────────────────────────────────────

async function classifyAccuracy(
  playerMessage: string,
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
        model:      'claude-sonnet-4-5', // P1A classification is safety-critical — use sonnet
        max_tokens: 512,
        system:     SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Player message:\n"${playerMessage}"\n\ngameLM suggested response:\n"${suggestedResponse}"`,
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

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ids }: { ids: string[] } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: 'ids array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch issue rows
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ticket_issues?id=in.(${ids.join(',')})&select=id,customer_input,suggested_response`,
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
      const playerMsg  = (issue.customer_input   ?? '').trim()
      const suggested  = (issue.suggested_response ?? '').trim()

      if (!playerMsg || !suggested) { skipped++; continue }

      const result = await classifyAccuracy(playerMsg, suggested)
      if (!result || !result.errorClass) { errors++; continue }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${issue.id}`, {
        method:  'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          accuracy_error_class:   result.errorClass,
          accuracy_evidence:      result.evidence,
          accuracy_reasoning:     result.reasoning,
          accuracy_human_review:  result.humanReview,
          accuracy_ran_at:        new Date().toISOString(),
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
