// zd-ticket-details
// Accepts an array of { supabase_id, ticket_number } objects.
// For each: fetches ZD ticket created_at + player message count via audits API,
// then patches the tickets row with zd_created_at + zd_message_count.
//
// Uses the audits API (not comments) because native messaging / live chat tickets
// store player messages as audit events, not as standard comments. Agent messages
// are excluded by fetching the ZD agent list and filtering them out — giving an
// accurate count of player inputs per ticket.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ZD_EMAIL             = Deno.env.get('ZENDESK_EMAIL')!
const ZD_TOKEN             = Deno.env.get('ZENDESK_API_TOKEN')!
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
  supabase_id:      string
  ticket_number:    string
  zd_created_at:    string | null
  zd_message_count: number | null
  error?:           string
}

// Fetch all ZD agent user IDs once per request — used to exclude agent messages
// from the player message count. Cached in module scope for the request lifetime.
let agentIdCache: Set<number> | null = null

async function getAgentIds(): Promise<Set<number>> {
  if (agentIdCache) return agentIdCache

  const ids = new Set<number>()
  let url: string | null = `${ZD_BASE}/users.json?role=agent&per_page=100`

  while (url) {
    const res = await fetch(url, { headers: zdHeaders })
    if (!res.ok) break
    const data = await res.json()
    const users: any[] = data.users ?? []
    users.forEach((u: any) => ids.add(u.id))
    url = data.next_page ?? null
  }

  // Also fetch admins — they can also respond to tickets
  let adminUrl: string | null = `${ZD_BASE}/users.json?role=admin&per_page=100`
  while (adminUrl) {
    const res = await fetch(adminUrl, { headers: zdHeaders })
    if (!res.ok) break
    const data = await res.json()
    const users: any[] = data.users ?? []
    users.forEach((u: any) => ids.add(u.id))
    adminUrl = data.next_page ?? null
  }

  agentIdCache = ids
  return ids
}

async function fetchZDTicket(ticketNumber: string): Promise<{ created_at: string } | null> {
  const res = await fetch(`${ZD_BASE}/tickets/${ticketNumber}.json`, { headers: zdHeaders })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.ticket) return null
  return { created_at: data.ticket.created_at }
}

// Count player messages using the audits API.
// Audits capture every event on the ticket including native messaging chat messages.
// We count Comment-type events where the author is NOT one of our agents/admins.
async function countPlayerMessages(ticketNumber: string, agentIds: Set<number>): Promise<number> {
  let count = 0
  let url: string | null = `${ZD_BASE}/tickets/${ticketNumber}/audits.json?per_page=100`

  while (url) {
    const res = await fetch(url, { headers: zdHeaders })
    if (!res.ok) break
    const data = await res.json()
    const audits: any[] = data.audits ?? []

    for (const audit of audits) {
      const authorId: number = audit.author_id
      // Skip anything authored by an agent or admin
      if (agentIds.has(authorId)) continue

      // Count Comment events that are public (player-facing messages)
      const events: any[] = audit.events ?? []
      const hasPublicComment = events.some(
        (e: any) => e.type === 'Comment' && e.public === true
      )
      if (hasPublicComment) count++
    }

    url = data.next_page ?? null
  }

  return count
}

async function processTicket(t: TicketInput, agentIds: Set<number>): Promise<ZDResult> {
  if (!/^\d{5,7}$/.test(t.ticket_number)) {
    return { ...t, zd_created_at: null, zd_message_count: null, error: 'invalid ticket number' }
  }

  const zdTicket = await fetchZDTicket(t.ticket_number)
  if (!zdTicket) {
    return { ...t, zd_created_at: null, zd_message_count: null, error: 'not found in ZD' }
  }

  const messageCount = await countPlayerMessages(t.ticket_number, agentIds)

  await fetch(`${SUPABASE_URL}/rest/v1/tickets?id=eq.${t.supabase_id}`, {
    method:  'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body:    JSON.stringify({
      zd_created_at:    zdTicket.created_at,
      zd_message_count: messageCount,
    }),
  })

  return { ...t, zd_created_at: zdTicket.created_at, zd_message_count: messageCount }
}

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

    // Fetch agent IDs once for the whole batch
    const agentIds = await getAgentIds()

    // Process sequentially to respect ZD rate limits
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
