import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders } from '../_shared/cors.ts'
import { EVAL_SYSTEM, EDIT_PROMPT_VERSION, FEW_SHOT, buildEditUserMessage } from '../_shared/eval-edit-prompt.ts'

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
  verdict:    'CORRECTION' | 'ENHANCEMENT' | 'PREFERENCE' | 'AGENT_ERROR'
  confidence: number
  reasoning:  string
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
      edit_prompt_version: EDIT_PROMPT_VERSION,
    }),
  })
}

interface UsageStats { input: number; cacheWrite: number; cacheRead: number }

async function evalRow(client: Anthropic, row: IssueRow): Promise<{ result: EvalResult; usage: UsageStats }> {
  // System prompt + few-shot examples are identical on every call — cache the
  // whole prefix (marker goes on the LAST few-shot block) so repeat calls pay
  // ~10% of base input price for this ~6K-token fixed portion.
  const fewShotMessages = FEW_SHOT.flatMap((ex, i) => {
    const isLast = i === FEW_SHOT.length - 1
    return [
      { role: 'user' as const, content: ex.user },
      {
        role: 'assistant' as const,
        content: isLast
          ? [{ type: 'text' as const, text: ex.assistant, cache_control: { type: 'ephemeral' as const } }]
          : ex.assistant,
      },
    ]
  })

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 256,
    system:     [{ type: 'text', text: EVAL_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [...fewShotMessages, { role: 'user', content: buildEditUserMessage(row) }],
  })

  const usage: UsageStats = {
    input:      msg.usage.input_tokens,
    cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
    cacheRead:  msg.usage.cache_read_input_tokens ?? 0,
  }

  const raw  = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  // Strip markdown code fences if Claude wraps the JSON
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(text)
    if (!['CORRECTION', 'ENHANCEMENT', 'PREFERENCE', 'AGENT_ERROR'].includes(parsed.verdict)) {
      throw new Error(`Unexpected verdict: ${parsed.verdict}`)
    }
    return {
      result: {
        verdict:    parsed.verdict,
        confidence: Math.min(100, Math.max(0, parseInt(parsed.confidence, 10) || 50)),
        reasoning:  parsed.reasoning ?? '',
      },
      usage,
    }
  } catch {
    // Fallback: extract verdict from text if JSON parse fails
    const v = text.includes('AGENT_ERROR') ? 'AGENT_ERROR'
            : text.includes('CORRECTION')  ? 'CORRECTION'
            : text.includes('ENHANCEMENT') ? 'ENHANCEMENT'
            : 'PREFERENCE'
    return {
      result: { verdict: v as EvalResult['verdict'], confidence: 50, reasoning: 'Parse error — verdict inferred from text.' },
      usage,
    }
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
    let cacheRead = 0, cacheWrite = 0, uncachedInput = 0
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

          const { result, usage } = await evalRow(client, row)
          cacheRead += usage.cacheRead; cacheWrite += usage.cacheWrite; uncachedInput += usage.input
          await writeVerdict(id, result)
          processed++
        } catch (e: unknown) {
          errors++
          errorList.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }))
    }

    return new Response(
      JSON.stringify({ processed, skipped, errors, errorList, cacheStats: { cacheRead, cacheWrite, uncachedInput } }),
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
