import { corsHeaders } from '../_shared/cors.ts'

/**
 * Real Zendesk metrics for one Full Auto snapshot window — Total Tickets,
 * Resolution Time, and Handle Rate. Automation Rate and Escalation Rate stay
 * manual (see operator_automation_snapshots) — those are set deliberately by
 * an admin, not derived. Called once, at "Add snapshot" time — not polled.
 *
 * Scope matches zendesk-tickets' definition of a "ticket" (native_messaging
 * chat channel + the same operational-noise exclusions), so Total Tickets
 * here means the same thing as everywhere else gameLM touches ZD volume.
 */

const ZD_BASE = 'https://conduet.zendesk.com/api/v2'
const MAX_METRIC_TICKETS = 300 // safety cap on per-ticket metrics fetches

const EXCLUDED_CATEGORY_TAGS = [
  'other__test_ticket', 'other__spam', 'other__disconnected_call',
  'other__disconnected_call/chat', 'other__duplicate/merged_tickets',
  'other__wrong_number', 'other__outbound_call',
  'other__outbound_call_disconnected', 'other__outbound_tweet',
]

// "Resolution tier" custom field (key: standard::resolution_tier) — Non-
// automated / Assisted escalation / Contained resolution / Verified
// resolution. Any value set means gameLM's pipeline actually engaged the
// ticket; null means it never entered the pipeline (routed straight to a
// human, e.g. P&F/VIP) -- that's the Handle Rate signal, verified live
// against real BetSaracen tickets before wiring this in.
const RESOLUTION_TIER_FIELD_ID = 50338948285851

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { brand_id, start_date, end_date } = await req.json()
    if (!brand_id || !start_date || !end_date) {
      return new Response(JSON.stringify({ error: 'brand_id, start_date, and end_date are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const apiToken = Deno.env.get('ZENDESK_API_TOKEN')
    const email    = Deno.env.get('ZENDESK_EMAIL')
    if (!apiToken || !email) {
      return new Response(JSON.stringify({ error: 'ZENDESK_API_TOKEN and ZENDESK_EMAIL must be set' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const zdHeaders = { Authorization: `Basic ${btoa(`${email}/token:${apiToken}`)}` }

    async function zdCount(query: string): Promise<number> {
      const res = await fetch(`${ZD_BASE}/search/count.json?query=${encodeURIComponent(query)}`, { headers: zdHeaders })
      if (!res.ok) return 0
      const d = await res.json()
      return d.count ?? 0
    }

    const exclusion = EXCLUDED_CATEGORY_TAGS.map(t => `-tags:${t}`).join(' ')
    const dateClause = `created>=${start_date} created<=${end_date}`
    const baseFilter = `type:ticket via:native_messaging brand_id:${brand_id} ${dateClause} ${exclusion}`.replace(/\s+/g, ' ').trim()

    const totalTickets = await zdCount(baseFilter)

    // Ticket ids + custom fields for this window, capped — a single-brand
    // week/month is normally well under the cap, but never silently pretend
    // we sampled more than we did. Search results already carry
    // custom_fields, so no extra per-ticket detail call is needed for the
    // Resolution tier lookup below.
    const tickets: { id: number; hasResolutionTier: boolean }[] = []
    let url: string | null = `${ZD_BASE}/search.json?query=${encodeURIComponent(baseFilter)}&sort_by=created_at&sort_order=desc`
    let capped = false
    while (url && tickets.length < MAX_METRIC_TICKETS) {
      const res = await fetch(url, { headers: zdHeaders })
      if (!res.ok) break
      const data = await res.json()
      for (const t of data.results ?? []) {
        if (tickets.length >= MAX_METRIC_TICKETS) break
        const tierField = (t.custom_fields ?? []).find((c: any) => c.id === RESOLUTION_TIER_FIELD_ID)
        tickets.push({ id: t.id, hasResolutionTier: tierField?.value != null })
      }
      url = data.next_page ?? null
      if (url && tickets.length >= MAX_METRIC_TICKETS) capped = true
    }

    // Per-ticket metrics (resolution time only), batched to stay within ZD
    // rate limits.
    async function fetchMetrics(id: number): Promise<any | null> {
      const res = await fetch(`${ZD_BASE}/tickets/${id}/metrics.json`, { headers: zdHeaders })
      if (!res.ok) return null
      const d = await res.json()
      return d.ticket_metric ?? null
    }
    const BATCH = 20
    const metrics: any[] = []
    for (let i = 0; i < tickets.length; i += BATCH) {
      const chunk = tickets.slice(i, i + BATCH)
      const results = await Promise.all(chunk.map(t => fetchMetrics(t.id)))
      metrics.push(...results.filter(Boolean))
    }

    // Median, not mean -- full_resolution_time_in_minutes measures calendar
    // time to SOLVED, so a handful of tickets left open/unresponsive for days
    // (auto-closed later) blow the mean up by orders of magnitude. Verified
    // live: one BetSaracen window had mean=555min vs median=13min for the
    // exact same tickets. Median reflects what a typical handled chat took.
    const resolved = metrics
      .filter(m => m.full_resolution_time_in_minutes?.calendar != null)
      .map(m => m.full_resolution_time_in_minutes.calendar as number)
      .sort((a, b) => a - b)
    const resolutionTimeMinutes = resolved.length
      ? resolved.length % 2 === 1
        ? resolved[(resolved.length - 1) / 2]
        : Math.round(((resolved[resolved.length / 2 - 1] + resolved[resolved.length / 2]) / 2) * 10) / 10
      : null

    // Handle Rate: % of sampled tickets gameLM's pipeline actually engaged
    // (any Resolution tier value set) -- a coverage metric, not a success
    // rate. Replaces an earlier "never reassigned" proxy that just measured
    // each operator's own routing architecture instead.
    const handledCount = tickets.filter(t => t.hasResolutionTier).length
    const handleRate = tickets.length
      ? Math.round((handledCount / tickets.length) * 1000) / 10
      : null

    return new Response(JSON.stringify({
      total_tickets: totalTickets,
      resolution_time_minutes: resolutionTimeMinutes,
      handle_rate: handleRate,
      sampled_tickets: tickets.length,
      capped,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
