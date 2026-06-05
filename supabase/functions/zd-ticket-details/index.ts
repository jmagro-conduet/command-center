// zd-ticket-details
// Accepts an array of { supabase_id, ticket_number } objects.
// For each ticket: fetches ZD metadata, ticket metrics (resolution time + FCR),
// player message count via audits API, and classifies the last player message
// for sentiment using Claude Haiku. Patches all fields in one DB write.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ZD_EMAIL             = Deno.env.get('ZENDESK_EMAIL')!
const ZD_TOKEN             = Deno.env.get('ZENDESK_API_TOKEN')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!
const ZD_BASE              = 'https://conduet.zendesk.com/api/v2'

const sbHeaders = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

const zdHeaders = {
  Authorization:  `Basic ${btoa(`${ZD_EMAIL}/token:${ZD_TOKEN}`)}`,
  'Content-Type': 'application/json',
}

interface TicketInput {
  supabase_id:   string
  ticket_number: string
}

interface ZDResult {
  supabase_id:           string
  ticket_number:         string
  zd_created_at:         string | null
  zd_message_count:      number | null
  zd_resolution_minutes: number | null
  zd_fcr:                boolean | null
  zd_player_sentiment:   string | null
  error?:                string
}

// Agent/admin ID cache — fetched once per request, reused across all tickets in the batch
let agentIdCache: Set<number> | null = null

async function getAgentIds(): Promise<Set<number>> {
  if (agentIdCache) return agentIdCache
  const ids = new Set<number>()
  for (const role of ['agent', 'admin']) {
    let url: string | null = `${ZD_BASE}/users.json?role=${role}&per_page=100`
    while (url) {
      const res = await fetch(url, { headers: zdHeaders })
      if (!res.ok) break
      const data = await res.json()
      ;(data.users ?? []).forEach((u: any) => ids.add(u.id))
      url = data.next_page ?? null
    }
  }
  agentIdCache = ids
  return ids
}

// ── ZD data fetchers ────────────────────────────────────────────────────────

async function fetchZDTicket(ticketNumber: string): Promise<{ created_at: string } | null> {
  const res = await fetch(`${ZD_BASE}/tickets/${ticketNumber}.json`, { headers: zdHeaders })
  if (!res.ok) return null
  const data = await res.json()
  return data.ticket ? { created_at: data.ticket.created_at } : null
}

// Ticket metrics endpoint: resolution time (calendar minutes) + reopen count for FCR
async function fetchTicketMetrics(ticketNumber: string): Promise<{ resolutionMinutes: number | null; fcr: boolean | null }> {
  const res = await fetch(`${ZD_BASE}/tickets/${ticketNumber}/metrics.json`, { headers: zdHeaders })
  if (!res.ok) return { resolutionMinutes: null, fcr: null }
  const data = await res.json()
  const m = data.ticket_metric
  if (!m) return { resolutionMinutes: null, fcr: null }
  // Use calendar (wall-clock) minutes, not business hours
  const resolutionMinutes = m.full_resolution_time_in_minutes?.calendar ?? null
  // FCR: ticket was resolved (resolution_time not null) AND never reopened.
  // Excluding unresolved tickets prevents open/pending tickets (reopens=0 trivially)
  // from inflating the rate.
  const resolved = resolutionMinutes !== null && resolutionMinutes > 0
  const fcr = resolved ? (typeof m.reopens === 'number' ? m.reopens === 0 : null) : null
  return { resolutionMinutes, fcr }
}

// For native messaging, ZD sometimes stores the full chat transcript in a single
// Comment event body formatted as "(HH:MM AM/PM) Name: text". Parse it and return
// only the last player message — not the agent's closing line.
function extractLastLineFromTranscript(body: string): string {
  const isTranscript = /\(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\)/i.test(body)
  if (!isTranscript) return body

  const segments = body
    .split(/(?=\(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\))/i)
    .map((p: string) => {
      const m = p.match(/^\([^)]+\)\s*([^:]+):\s*(.+)/s)
      return m ? { name: m[1].trim(), msg: m[2].trim() } : null
    })
    .filter(Boolean) as { name: string; msg: string }[]

  // BetSaracen's verification flow always collects the player's name upfront.
  // Format in transcript: "Web User [hash]: Name: John Smith Email: ..."
  // Extract it so we can identify the player's segments by name.
  let playerFirstName: string | null = null
  const nameMatch = body.match(/Name:\s*([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)*\s+(?:Email:|Date)/m)
  if (nameMatch) playerFirstName = nameMatch[1].toLowerCase()

  // Non-bot segments only
  const nonBot = segments.filter(s => !/^(BetSaracen|Web User)/i.test(s.name))

  if (playerFirstName) {
    // Filter to segments where the speaker name starts with the player's first name
    const playerSegs = nonBot.filter(s => s.name.toLowerCase().startsWith(playerFirstName!))
    if (playerSegs.length > 0) return playerSegs[playerSegs.length - 1].msg.trim()
  }

  // Fallback: exclude obvious agent closing messages and return the last remaining line
  const agentClosingPattern = /thank you for contacting|have a great|feel free to contact|if you have any other questions|you can also contact us/i
  const nonClosing = nonBot.filter(s => !agentClosingPattern.test(s.msg))

  if (nonClosing.length > 0) return nonClosing[nonClosing.length - 1].msg.trim()
  if (nonBot.length > 0) return nonBot[nonBot.length - 1].msg.trim()
  return body
}

// Audits API: count non-agent messages + capture the last player message text.
// Native messaging (live chat) tickets store player messages as audit events,
// not standard comments — this approach covers both channel types.
async function fetchAuditData(
  ticketNumber: string,
  agentIds: Set<number>
): Promise<{ count: number; lastPlayerMessage: string | null }> {
  let count = 0
  let lastPlayerMessage: string | null = null
  let url: string | null = `${ZD_BASE}/tickets/${ticketNumber}/audits.json?per_page=100`
  let isFirst = true

  while (url) {
    const res = await fetch(url, { headers: zdHeaders })
    if (!res.ok) break
    const data = await res.json()

    for (const audit of (data.audits ?? [])) {
      if (agentIds.has(audit.author_id)) { isFirst = false; continue }

      const events: any[] = audit.events ?? []

      // First non-agent audit: count if it contains a Create event (ticket opener)
      if (isFirst) {
        if (events.some((e: any) => e.type === 'Create')) { count++; isFirst = false; continue }
      }
      isFirst = false

      // Count any Comment event from a non-agent; also capture the text for sentiment
      const commentEvent = events.find((e: any) => e.type === 'Comment')
      if (commentEvent) {
        count++
        const raw = (commentEvent.plain_body ?? commentEvent.body ?? '').trim()
        // If the body is a full chat transcript, extract just the last non-bot line
        if (raw) lastPlayerMessage = extractLastLineFromTranscript(raw).slice(0, 2000)
      }
    }

    url = data.next_page ?? null
  }

  return { count, lastPlayerMessage }
}

// ── Sentiment classification ────────────────────────────────────────────────

const SENTIMENT_PROMPT = `You classify the sentiment of a player's final message to a customer support agent.

COMPLIMENT — Player expressed genuine appreciation or positive feedback about the agent or support they received, beyond a routine closing. Examples: "you were so helpful!", "amazing service", "you're the best", "that solved everything, thank you so much!"
NEUTRAL — Standard acknowledgment or closing with no clear sentiment. Examples: "ok", "thanks", "got it", "bye", "understood", "alright"
NEGATIVE — Player expressed frustration, dissatisfaction, or an unresolved concern. Examples: "this didn't help", "still not working", "very disappointed"

Important: "thanks" or "thank you" alone = NEUTRAL. Only classify as COMPLIMENT when there is additional genuine positive language beyond the routine acknowledgment.

Respond with ONLY valid JSON — no markdown, no explanation:
{"verdict": "COMPLIMENT"|"NEUTRAL"|"NEGATIVE", "confidence": 0-100}`

async function classifySentiment(message: string): Promise<{ verdict: string; confidence: number } | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5', // fast + cheap for simple 3-way classification
        max_tokens: 64,
        system:     SENTIMENT_PROMPT,
        messages:   [{ role: 'user', content: `Player message: "${message}"` }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const raw  = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ── Per-ticket processor ────────────────────────────────────────────────────

async function processTicket(t: TicketInput, agentIds: Set<number>): Promise<ZDResult> {
  if (!/^\d{5,7}$/.test(t.ticket_number)) {
    return { ...t, zd_created_at: null, zd_message_count: null, zd_resolution_minutes: null, zd_fcr: null, zd_player_sentiment: null, error: 'invalid ticket number' }
  }

  // Fetch ZD ticket info, metrics, and audit data in parallel
  const [zdTicket, metrics, auditData] = await Promise.all([
    fetchZDTicket(t.ticket_number),
    fetchTicketMetrics(t.ticket_number),
    fetchAuditData(t.ticket_number, agentIds),
  ])

  if (!zdTicket) {
    return { ...t, zd_created_at: null, zd_message_count: null, zd_resolution_minutes: null, zd_fcr: null, zd_player_sentiment: null, error: 'not found in ZD' }
  }

  // Classify sentiment on the last player message if one was found
  let sentiment: { verdict: string; confidence: number } | null = null
  if (auditData.lastPlayerMessage) {
    sentiment = await classifySentiment(auditData.lastPlayerMessage)
  }

  // Write everything in a single DB patch
  await fetch(`${SUPABASE_URL}/rest/v1/tickets?id=eq.${t.supabase_id}`, {
    method:  'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body:    JSON.stringify({
      zd_created_at:           zdTicket.created_at,
      zd_message_count:        auditData.count,
      zd_resolution_minutes:   metrics.resolutionMinutes,
      zd_fcr:                  metrics.fcr,
      zd_last_player_message:  auditData.lastPlayerMessage,
      zd_player_sentiment:     sentiment?.verdict     ?? null,
      zd_sentiment_confidence: sentiment?.confidence  ?? null,
    }),
  })

  return {
    ...t,
    zd_created_at:         zdTicket.created_at,
    zd_message_count:      auditData.count,
    zd_resolution_minutes: metrics.resolutionMinutes,
    zd_fcr:                metrics.fcr,
    zd_player_sentiment:   sentiment?.verdict ?? null,
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tickets }: { tickets: TicketInput[] } = await req.json()
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return new Response(
        JSON.stringify({ error: 'tickets array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const agentIds = await getAgentIds()
    const results: ZDResult[] = []
    for (const t of tickets) {
      results.push(await processTicket(t, agentIds))
    }

    const ok     = results.filter(r => !r.error).length
    const failed = results.filter(r =>  r.error).length

    return new Response(
      JSON.stringify({ processed: ok, failed, agentIdsLoaded: agentIds.size, results }),
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
