// eval-accuracy (Eval 2 — Response Accuracy)
// Checks each gameLM suggested response for P1A / P1B / P2 accuracy errors.
// Now uses full conversation thread for context-aware classification.
//
// POST body: { ids: string[] }

import { corsHeaders } from '../_shared/cors.ts'
import {
  ACCURACY_SYSTEM,
  ACCURACY_PROMPT_VERSION,
  TicketIssue,
  AccuracyResult,
  buildConversationThread,
  parseAccuracyOutput,
} from '../_shared/eval-accuracy-prompt.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!

const sbHeaders = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

// ── Claude call ──────────────────────────────────────────────────────────────

let lastDebugError: string | null = null
let lastUsage: { input: number; cacheWrite: number; cacheRead: number } | null = null

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
        // Identical on every call — cache it so repeat calls pay ~10% of base input price.
        system: [{ type: 'text', text: ACCURACY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Conversation thread:\n${conversationThread}\n\ngameLM suggested response:\n"${suggestedResponse}"`,
        }],
      }),
    })
    if (!res.ok) { lastDebugError = `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`; lastUsage = null; return null }
    const data = await res.json()
    lastUsage = {
      input:      data.usage?.input_tokens ?? 0,
      cacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
      cacheRead:  data.usage?.cache_read_input_tokens ?? 0,
    }
    const raw  = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const parsed = parseAccuracyOutput(raw)
    if (!parsed) lastDebugError = `parse failure, raw: ${raw.slice(0, 500)}`
    return parsed
  } catch (e) {
    lastDebugError = `fetch threw: ${e instanceof Error ? e.message : String(e)}`
    lastUsage = null
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
    const debugErrors: string[] = []
    let cacheRead = 0, cacheWrite = 0, uncachedInput = 0

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
      if (lastUsage) { cacheRead += lastUsage.cacheRead; cacheWrite += lastUsage.cacheWrite; uncachedInput += lastUsage.input }
      if (!result || !result.errorClass) { errors++; debugErrors.push(lastDebugError ?? 'unknown'); continue }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${issue.id}`, {
        method:  'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          accuracy_error_class:  result.errorClass,
          accuracy_evidence:     result.evidence,
          accuracy_reasoning:    result.reasoning,
          accuracy_human_review: result.humanReview,
          accuracy_ran_at:       new Date().toISOString(),
          accuracy_prompt_version: ACCURACY_PROMPT_VERSION,
        }),
      })

      if (patchRes.ok) processed++; else errors++
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
