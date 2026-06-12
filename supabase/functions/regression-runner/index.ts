// regression-runner
// Fetches all active gold cases, runs the appropriate eval on each,
// compares to the expected output, and records pass/fail to eval_regression_runs.
//
// POST body: { eval_type?: 'edit' | 'accuracy' | 'quality', triggered_by?: string }

import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders } from '../_shared/cors.ts'
import {
  EVAL_SYSTEM,
  FEW_SHOT,
  buildEditUserMessage,
} from '../_shared/eval-edit-prompt.ts'
import {
  ACCURACY_SYSTEM,
  TicketIssue,
  AccuracyResult,
  buildConversationThread,
  parseAccuracyOutput,
} from '../_shared/eval-accuracy-prompt.ts'
import {
  QUALITY_SYSTEM,
  parseQualityOutput,
} from '../_shared/eval-quality-prompt.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!

const sbHeaders = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

interface GoldCase {
  id:                  string
  eval_type:           string
  ticket_issue_id:     string | null
  expected_verdict:    string | null
  expected_error_class: string | null
  player_input:        string | null
  suggested_response:  string | null
  final_edits:         string | null
  agent_reasoning:     string | null
  conversation_thread: string | null
}

interface RunResult {
  case_id:   string
  eval_type: string
  expected:  string
  got:       string
  passed:    boolean
  reasoning: string
}

async function fetchGoldCases(evalType?: string): Promise<GoldCase[]> {
  let url = `${SUPABASE_URL}/rest/v1/eval_gold_cases?is_active=eq.true&select=*`
  if (evalType) url += `&eval_type=eq.${evalType}`
  const res = await fetch(url, { headers: sbHeaders })
  return res.json()
}

// ── Hydrate a case from ticket_issues if text fields are missing ──────────────

async function hydrateCase(c: GoldCase): Promise<GoldCase> {
  if (!c.ticket_issue_id) return c
  const hasText = c.player_input || c.suggested_response
  if (hasText) return c
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${c.ticket_issue_id}&select=customer_input,suggested_response,final_edits,reasoning&limit=1`,
    { headers: sbHeaders }
  )
  const rows = await res.json()
  const row = rows?.[0]
  if (!row) return c
  return {
    ...c,
    player_input:       row.customer_input,
    suggested_response: row.suggested_response,
    final_edits:        row.final_edits,
    agent_reasoning:    row.reasoning,
  }
}

// ── Fetch conversation thread for accuracy cases ──────────────────────────────

async function fetchConversationThread(ticketIssueId: string, playerInput: string): Promise<string> {
  // Get ticket_id for this issue
  const issueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ticket_issues?id=eq.${ticketIssueId}&select=ticket_id&limit=1`,
    { headers: sbHeaders }
  )
  const issueRows = await issueRes.json()
  const ticketId = issueRows?.[0]?.ticket_id
  if (!ticketId) return `Player: "${playerInput}"`

  const ctxRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ticket_issues?ticket_id=eq.${ticketId}&select=id,customer_input,suggested_response&order=logged_at.asc`,
    { headers: sbHeaders }
  )
  const ticketIssues: TicketIssue[] = await ctxRes.json()
  if (!Array.isArray(ticketIssues) || ticketIssues.length <= 1) return `Player: "${playerInput}"`
  return buildConversationThread(ticketIssues, ticketIssueId, playerInput)
}

// ── Edit eval ─────────────────────────────────────────────────────────────────

async function runEditCase(client: Anthropic, c: GoldCase): Promise<RunResult> {
  const expected = (c.expected_verdict ?? '').toUpperCase()
  const fewShotMessages = FEW_SHOT.flatMap(ex => [
    { role: 'user'      as const, content: ex.user      },
    { role: 'assistant' as const, content: ex.assistant },
  ])

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 256,
    system:     EVAL_SYSTEM,
    messages:   [
      ...fewShotMessages,
      {
        role: 'user',
        content: buildEditUserMessage({
          customer_input:     c.player_input,
          suggested_response: c.suggested_response,
          final_edits:        c.final_edits,
          reasoning:          c.agent_reasoning,
        }),
      },
    ],
  })

  const raw  = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let got = '', reasoning = ''
  try {
    const parsed = JSON.parse(text)
    got       = (parsed.verdict ?? '').toUpperCase()
    reasoning = parsed.reasoning ?? ''
  } catch {
    got = text.includes('CORRECTION') ? 'CORRECTION'
        : text.includes('ENHANCEMENT') ? 'ENHANCEMENT'
        : text.includes('PREFERENCE') ? 'PREFERENCE'
        : 'UNKNOWN'
  }

  // NONE cases: eval-issue is never called in production (no edit = no issue row),
  // so for regression we check that a pre-approved NONE response isn't misclassified.
  return { case_id: c.id, eval_type: 'edit', expected, got, passed: got === expected, reasoning }
}

// ── Accuracy eval ─────────────────────────────────────────────────────────────

async function runAccuracyCase(c: GoldCase): Promise<RunResult> {
  const expected = (c.expected_error_class ?? '').toUpperCase()
  const playerInput = c.player_input ?? ''
  const suggested   = c.suggested_response ?? ''

  // Build or reuse conversation thread
  let thread = c.conversation_thread ?? ''
  if (!thread && c.ticket_issue_id) {
    thread = await fetchConversationThread(c.ticket_issue_id, playerInput)
  }
  if (!thread) thread = `Player: "${playerInput}"`

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
      system:     ACCURACY_SYSTEM,
      messages: [{
        role:    'user',
        content: `Conversation thread:\n${thread}\n\ngameLM suggested response:\n"${suggested}"`,
      }],
    }),
  })

  let got = 'UNKNOWN', reasoning = ''
  if (res.ok) {
    const data    = await res.json()
    const raw     = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const result: AccuracyResult = parseAccuracyOutput(raw)
    got       = (result.errorClass ?? 'UNKNOWN').toUpperCase()
    reasoning = result.reasoning ?? ''
  }

  return { case_id: c.id, eval_type: 'accuracy', expected, got, passed: got === expected, reasoning }
}

// ── Quality eval ─────────────────────────────────────────────────────────────
// expected_verdict is 'HIGH' (score >= 4.0) or 'LOW' (score < 3.5)

async function runQualityCase(c: GoldCase): Promise<RunResult> {
  const expected    = (c.expected_verdict ?? '').toUpperCase()
  const playerInput = c.player_input ?? ''
  const suggested   = c.suggested_response ?? ''

  let thread = c.conversation_thread ?? ''
  if (!thread && c.ticket_issue_id) {
    thread = await fetchConversationThread(c.ticket_issue_id, playerInput)
  }
  if (!thread) thread = `Player: "${playerInput}"`

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
        role:    'user',
        content: `Conversation thread:\n${thread}\n\ngameLM suggested response:\n"${suggested}"`,
      }],
    }),
  })

  let score: number | null = null
  let reasoning = ''
  if (res.ok) {
    const data   = await res.json()
    const raw    = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const result = parseQualityOutput(raw)
    score        = result.score
    reasoning    = result.flagReason ?? (score !== null ? `Score: ${score}` : 'Parse error')
  }

  const got    = score !== null ? score.toFixed(2) : 'ERROR'
  const passed = score !== null && (
    expected === 'HIGH' ? score >= 4.0 :
    expected === 'LOW'  ? score <  3.5 : false
  )

  return { case_id: c.id, eval_type: 'quality', expected, got, passed, reasoning }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body: { eval_type?: string; triggered_by?: string } = await req.json().catch(() => ({}))
    const evalType    = body.eval_type
    const triggeredBy = body.triggered_by ?? 'manual'

    const allCases = await fetchGoldCases(evalType)
    if (!Array.isArray(allCases) || allCases.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No active gold cases found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    const results: RunResult[] = []

    for (const rawCase of allCases) {
      try {
        const c = await hydrateCase(rawCase)
        if (!c.player_input && !c.suggested_response) continue

        let result: RunResult
        if (c.eval_type === 'edit') {
          result = await runEditCase(client, c)
        } else if (c.eval_type === 'accuracy') {
          result = await runAccuracyCase(c)
        } else if (c.eval_type === 'quality') {
          result = await runQualityCase(c)
        } else {
          continue
        }
        results.push(result)
      } catch {
        results.push({
          case_id:   rawCase.id,
          eval_type: rawCase.eval_type,
          expected:  rawCase.expected_verdict ?? rawCase.expected_error_class ?? '',
          got:       'ERROR',
          passed:    false,
          reasoning: 'Runner exception',
        })
      }
    }

    const total    = results.length
    const passed   = results.filter(r => r.passed).length
    const failed   = total - passed
    const passRate = total > 0 ? Math.round((passed / total) * 10000) / 100 : 0

    // Write run record
    const runRes = await fetch(`${SUPABASE_URL}/rest/v1/eval_regression_runs`, {
      method:  'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        triggered_by: triggeredBy,
        eval_type:    evalType ?? null,
        total_cases:  total,
        passed,
        failed,
        pass_rate:    passRate,
        results:      results,
      }),
    })
    const runRows = await runRes.json()
    const runId   = runRows?.[0]?.id ?? null

    return new Response(
      JSON.stringify({ run_id: runId, total, passed, failed, pass_rate: passRate, results }),
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
