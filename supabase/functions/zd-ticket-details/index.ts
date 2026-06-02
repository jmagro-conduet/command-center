// zd-ticket-details
// Accepts an array of { supabase_id, ticket_number } objects.
// For each: fetches ZD ticket created_at + player message count,
// then patches the tickets row with zd_created_at + zd_message_count.
// Called fire-and-forget from LogTicket after submission,
// and in bulk from the backfill script.

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
  supabase_id:       string
  ticket_number:     string
  zd_created_at:     string | null
  zd_message_count:  number | null
  error?:            string
}

async function fetchZDTicket(ticketNumber: string): Promise<{ created_at: string; requester_id: number } | null> {
  const res = await fetch(`${ZD_BASE}/tickets/${ticketNumber}.json`, { headers: zdHeaders })
  if (!res.ok) return null
  const data = await res.json()
  return { created_at: data.ticket?.created_at, requester_id: data.ticket?.requester_id }
}

async function countPlayerMessages(ticketNumber: string, requesterId: number): Promise<number> {
  let count = 0
  let url: string | null = `${ZD_BASE}/tickets/${ticketNumber}/comments.json?per_page=100`

  while (url) {
    const res = await fetch(url, { headers: zdHeaders })
    if (!res.ok) break
    const data = await res.json()
    const comments: any[] = data.comments ?? []
    count += comments.filter((c: any) => c.author_id === requesterId && c.public === true).length
    url = data.next_page ?? null
  }

  return count
}

async function processTicket(t: TicketInput): Promise<ZDResult> {
  // Skip non-numeric or obviously wrong ticket numbers
  if (!/^\d{5,7}$/.test(t.ticket_number)) {
    return { ...t, zd_created_at: null, zd_message_count: null, error: 'invalid ticket number' }
  }

  const zdTicket = await fetchZDTicket(t.ticket_number)
  if (!zdTicket) {
    return { ...t, zd_created_at: null, zd_message_count: null, error: 'not found in ZD' }
  }

  const messageCount = await countPlayerMessages(t.ticket_number, zdTicket.requester_id)

  // Patch the Supabase tickets row
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

    // Process sequentially to respect ZD rate limits
    const results: ZDResult[] = []
    for (const t of tickets) {
      results.push(await processTicket(t))
    }

    const ok     = results.filter(r => !r.error).length
    const failed = results.filter(r =>  r.error).length

    return new Response(
      JSON.stringify({ processed: ok, failed, results }),
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
