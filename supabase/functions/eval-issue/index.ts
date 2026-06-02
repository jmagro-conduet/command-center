import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY      = Deno.env.get('ANTHROPIC_API_KEY')!

const sbHeaders = {
  apikey:        SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

interface IssueRow {
  id:                 string
  issue_type:         string
  customer_input:     string | null
  suggested_response: string | null
  final_edits:        string | null
  reasoning:          string | null
}

interface EvalResult {
  verdict:    'CORRECTION' | 'ENHANCEMENT' | 'PREFERENCE'
  confidence: number
  reasoning:  string
}

const EVAL_SYSTEM = `You are evaluating a customer service AI called gameLM. An agent reviewed gameLM's suggested response and made an edit before sending it to a player.

Classify the edit into ONE of three categories:

CORRECTION — the edit was necessary because gameLM made an error:
- Wrong account detail (email, name, DOB, SSN, amount, date)
- Hallucinated issue (e.g. told player their account was suspended when it wasn't)
- Wrong product information (feature that doesn't exist, wrong policy, wrong timeframe)
- Closed a ticket that was still unresolved or pending
- Response addressed the wrong issue entirely
- Repeated a verification request after the player was already verified

ENHANCEMENT — the edit added genuine value but gameLM's original was not wrong:
- Added escalation status the agent had taken ("raised to trading team")
- Added VIP or account-specific context gameLM doesn't have access to
- Added relevant information that answered more than gameLM did
- Replaced a generic closing appropriate to the actual conversation state
- Replaced an unnecessary clarifying question with the direct answer when
  the definitive answer was already knowable from the player's message
  (e.g. gameLM asks "What seems to be the issue?" for a casino question
  when the correct answer — "we don't offer casino products" — could have
  been given immediately, saving an unnecessary round-trip)

PREFERENCE — the edit was stylistic only and the original was fully send-worthy:
- Rephrasing with the same meaning and no added information
- Changing greeting or sign-off style ("You're very welcome" → "Alright")
- Removing or changing the agent's name or surname
- Punctuation, capitalisation, or filler word changes only
- Personal communication voice with no substantive change

IMPORTANT RULES:
1. Weight the agent's stated reason heavily — it is more reliable than the edit diff.
2. "Confirm your email" or "unable to verify your account" responses have a known high error rate. When agents replace these, default to CORRECTION unless the edit is clearly stylistic.
3. Closing edits are NOT automatically PREFERENCE — if the conversation was unresolved or pending, a changed closing is CORRECTION.
4. When ambiguous between CORRECTION and ENHANCEMENT, choose ENHANCEMENT.
5. When ambiguous between ENHANCEMENT and PREFERENCE, choose ENHANCEMENT.
6. Only score PREFERENCE when you are confident the original was fully send-worthy.

Return ONLY valid JSON — no other text, no markdown, no explanation outside the JSON:
{"verdict":"CORRECTION","confidence":85,"reasoning":"Brief explanation."}`

function buildUserMessage(row: IssueRow): string {
  return `Player message: ${row.customer_input ?? '(not provided)'}

gameLM suggested response: ${row.suggested_response ?? '(not provided)'}

Agent's final response: ${row.final_edits ?? '(not provided)'}

Agent's stated reason: ${row.reasoning ?? '(not provided)'}`
}

async function fetchRow(id: string): Promise<IssueRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${id}&select=id,issue_type,customer_input,suggested_response,final_edits,reasoning&limit=1`,
    { headers: sbHeaders }
  )
  const rows = await res.json()
  return rows?.[0] ?? null
}

async function writeVerdict(id: string, result: EvalResult): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${id}`, {
    method:  'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body:    JSON.stringify({
      eval_verdict:    result.verdict,
      eval_confidence: result.confidence,
      eval_reasoning:  result.reasoning,
      eval_ran_at:     new Date().toISOString(),
    }),
  })
}

async function evalRow(client: Anthropic, row: IssueRow): Promise<EvalResult> {
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 256,
    system:     EVAL_SYSTEM,
    messages:   [{ role: 'user', content: buildUserMessage(row) }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  try {
    const parsed = JSON.parse(text)
    if (!['CORRECTION', 'ENHANCEMENT', 'PREFERENCE'].includes(parsed.verdict)) {
      throw new Error(`Unexpected verdict: ${parsed.verdict}`)
    }
    return {
      verdict:    parsed.verdict,
      confidence: Math.min(100, Math.max(0, parseInt(parsed.confidence, 10) || 50)),
      reasoning:  parsed.reasoning ?? '',
    }
  } catch {
    // Fallback: extract verdict from text if JSON parse fails
    const v = text.includes('CORRECTION') ? 'CORRECTION'
            : text.includes('ENHANCEMENT') ? 'ENHANCEMENT'
            : 'PREFERENCE'
    return { verdict: v as EvalResult['verdict'], confidence: 50, reasoning: 'Parse error — verdict inferred from text.' }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ids }: { ids: string[] } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'ids array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    let processed = 0, skipped = 0, errors = 0
    const errorList: string[] = []

    // Process concurrently — cap at 5 parallel Claude calls
    const CONCURRENCY = 5
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map(async id => {
        try {
          const row = await fetchRow(id)
          if (!row) { skipped++; return }

          // Only eval Majority/Partial edits with both sides present
          if (!['Majority edit', 'Partial edit'].includes(row.issue_type)) { skipped++; return }
          if (!row.suggested_response?.trim() || !row.final_edits?.trim())  { skipped++; return }

          const result = await evalRow(client, row)
          await writeVerdict(id, result)
          processed++
        } catch (e: unknown) {
          errors++
          errorList.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }))
    }

    return new Response(
      JSON.stringify({ processed, skipped, errors, errorList }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
