// eval-quality (Eval 3 — Response Quality)
// Scores each gameLM suggested response across 5 quality categories.
// Now uses full conversation thread for accurate context-aware scoring.
// Also outputs THEME_TAG to surface recurring patterns.
//
// POST body: { ids: string[] }

import { QUALITY_SYSTEM, QUALITY_PROMPT_VERSION, QualityResult, parseQualityOutput } from '../_shared/eval-quality-prompt.ts'

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

// ── Claude call ──────────────────────────────────────────────────────────────

let lastDebugError: string | null = null

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
        max_tokens: 450,
        system:     QUALITY_SYSTEM,
        messages: [{
          role: 'user',
          content: `Conversation thread:\n${conversationThread}\n\ngameLM suggested response:\n"${suggestedResponse}"`,
        }],
      }),
    })
    if (!res.ok) { lastDebugError = `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`; return null }
    const data = await res.json()
    const raw  = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const parsed = parseQualityOutput(raw)
    if (!parsed) lastDebugError = `parse failure, raw: ${raw.slice(0, 500)}`
    return parsed
  } catch (e) {
    lastDebugError = `fetch threw: ${e instanceof Error ? e.message : String(e)}`
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

    for (const issue of issues) {
      const playerMsg = (issue.customer_input    ?? '').trim()
      const suggested = (issue.suggested_response ?? '').trim()

      if (!playerMsg || !suggested) { skipped++; continue }

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
      } catch { /* fall back to single-turn */ }

      const result = await scoreQuality(conversationThread, suggested)
      if (!result || result.score === null) { errors++; debugErrors.push(lastDebugError ?? 'unknown'); continue }

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
    }

    return new Response(JSON.stringify({ processed, skipped, errors, debugErrors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
