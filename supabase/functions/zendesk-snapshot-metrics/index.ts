import { corsHeaders } from '../_shared/cors.ts'

/**
 * Real Zendesk metrics for one Full Auto snapshot window — Total Tickets,
 * Resolution Time, and Handle Rate. Automation Rate and Escalation Rate stay
 * manual (see operator_automation_snapshots) — ZD has no native concept of
 * gameLM's "fully automatable" definition, and the pilot's own
 * gamelm_full_auto_* tag semantics aren't confirmed stable enough to build a
 * KPI on yet. Called once, at "Add snapshot" time — not polled.
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

    // Ticket ids for this window, capped — a single-brand week/month is
    // normally well under the cap, but never silently pretend we sampled
    // more than we did.
    const ticketIds: number[] = []
    let url: string | null = `${ZD_BASE}/search.json?query=${encodeURIComponent(baseFilter)}&sort_by=created_at&sort_order=desc`
    let capped = false
    while (url && ticketIds.length < MAX_METRIC_TICKETS) {
      const res = await fetch(url, { headers: zdHeaders })
      if (!res.ok) break
      const data = await res.json()
      for (const t of data.results ?? []) {
        if (ticketIds.length < MAX_METRIC_TICKETS) ticketIds.push(t.id)
      }
      url = data.next_page ?? null
      if (url && ticketIds.length >= MAX_METRIC_TICKETS) capped = true
    }

    // Per-ticket metrics, batched to stay within ZD rate limits.
    async function fetchMetrics(id: number): Promise<any | null> {
      const res = await fetch(`${ZD_BASE}/tickets/${id}/metrics.json`, { headers: zdHeaders })
      if (!res.ok) return null
      const d = await res.json()
      return d.ticket_metric ?? null
    }
    const BATCH = 20
    const metrics: any[] = []
    for (let i = 0; i < ticketIds.length; i += BATCH) {
      const chunk = ticketIds.slice(i, i + BATCH)
      const results = await Promise.all(chunk.map(fetchMetrics))
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

    // Handle rate proxy: % of sampled tickets that never got reassigned or
    // transferred to another group — a single agent/group handled it start
    // to finish.
    const handled = metrics.filter(m => m.assignee_stations === 1 && m.group_stations === 1)
    const handleRate = metrics.length
      ? Math.round((handled.length / metrics.length) * 1000) / 10
      : null

    return new Response(JSON.stringify({
      total_tickets: totalTickets,
      resolution_time_minutes: resolutionTimeMinutes,
      handle_rate: handleRate,
      sampled_tickets: metrics.length,
      capped,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
