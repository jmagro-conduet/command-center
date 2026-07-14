// eval-quality (Eval 3 — Response Quality)
// Scores each gameLM suggested response across 5 quality categories.
// Now uses full conversation thread for accurate context-aware scoring.
// Also outputs THEME_TAG to surface recurring patterns.
//
// POST body: { ids: string[], threads?: Record<string, string> }
// `threads` is an optional pre-built conversationThread per issue id — auto-eval
// builds these once and shares them with eval-accuracy to avoid both functions
// independently re-fetching the same ticket context. Falls back to a self-fetch
// per issue when not provided (e.g. the Backfill Evaluations admin tool).

import { QUALITY_SYSTEM, QUALITY_PROMPT_VERSION, QualityResult, parseQualityOutput } from '../_shared/eval-quality-prompt.ts'
import { ThreadIssue, buildConversationThread } from '../_shared/conversation-thread.ts'

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

interface UsageStats { input: number; cacheWrite: number; cacheRead: number }
interface ScoreOutcome { result: QualityResult | null; usage: UsageStats | null; debugError: string | null }

// ── Claude call ──────────────────────────────────────────────────────────────

async function scoreQuality(
  conversationThread: string,
  suggestedResponse: string
): Promise<ScoreOutcome> {
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
        max_tokens: 450,
        // Identical on every call — cache it so repeat calls pay ~10% of base input price.
        system: [{ type: 'text', text: QUALITY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Conversation thread:\n${conversationThread}\n\ngameLM suggested response:\n"${suggestedResponse}"`,
        }],
      }),
    })
    if (!res.ok) {
      return { result: null, usage: null, debugError: `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}` }
    }
    const data = await res.json()
    const usage: UsageStats = {
      input:      data.usage?.input_tokens ?? 0,
      cacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
      cacheRead:  data.usage?.cache_read_input_tokens ?? 0,
    }
    const raw    = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const parsed = parseQualityOutput(raw)
    return { result: parsed, usage, debugError: parsed ? null : `parse failure, raw: ${raw.slice(0, 500)}` }
  } catch (e) {
    return { result: null, usage: null, debugError: `fetch threw: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ids, threads }: { ids: string[]; threads?: Record<string, string> } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: 'ids array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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
    const debugErrors: string[] = []
    let cacheRead = 0, cacheWrite = 0, uncachedInput = 0

    // Process concurrently — cap at 5 parallel Claude calls, matching eval-issue-v2.
    const CONCURRENCY = 5
    for (let i = 0; i < issues.length; i += CONCURRENCY) {
      const chunk = issues.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map(async (issue: any) => {
        const playerMsg = (issue.customer_input    ?? '').trim()
        const suggested = (issue.suggested_response ?? '').trim()

        if (!playerMsg || !suggested) { skipped++; return }

        // Use the pre-built thread if the caller supplied one; otherwise fetch it.
        let conversationThread = threads?.[issue.id]
        if (!conversationThread) {
          conversationThread = `Player: "${playerMsg}"`
          try {
            const ctxRes = await fetch(
              `${SUPABASE_URL}/rest/v1/ticket_issues?ticket_id=eq.${issue.ticket_id}&select=id,customer_input,suggested_response&order=logged_at.asc`,
              { headers: sbHeaders }
            )
            const ticketIssues: ThreadIssue[] = await ctxRes.json()
            if (Array.isArray(ticketIssues) && ticketIssues.length > 1) {
              conversationThread = buildConversationThread(ticketIssues, issue.id, playerMsg)
            }
          } catch { /* fall back to single-turn */ }
        }

        const { result, usage, debugError } = await scoreQuality(conversationThread, suggested)
        if (usage) { cacheRead += usage.cacheRead; cacheWrite += usage.cacheWrite; uncachedInput += usage.input }
        if (!result || result.score === null) { errors++; debugErrors.push(debugError ?? 'unknown'); return }

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
            theme_detail:           result.themeDetail,
            quality_ran_at:         new Date().toISOString(),
            quality_prompt_version: QUALITY_PROMPT_VERSION,
          }),
        })

        if (patchRes.ok) processed++; else errors++
      }))
    }

    return new Response(JSON.stringify({ processed, skipped, errors, debugErrors, cacheStats: { cacheRead, cacheWrite, uncachedInput } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
