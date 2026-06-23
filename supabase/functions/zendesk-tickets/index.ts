import { corsHeaders } from '../_shared/cors.ts'

/**
 * Zendesk ticket counts for gameLM adoption tracking.
 *
 * Previous approach: one big paginated search query → groups by assignee_id.
 * Problem: ZD Search API silently caps pagination at 1,000 results, so agents
 * whose tickets land outside the first 1,000 are severely undercounted.
 *
 * New approach:
 *   - Team total  : single /search/count.json (no pagination, always accurate)
 *   - Per-agent   : one /search/count.json per agent email (parallel, always accurate)
 *
 * Channel filter: via:native_messaging — matches Zendesk Messaging (live chat).
 * No brand_id filter — agents work across brands; the channel filter is the
 * meaningful scope for gameLM.
 */

const ZD_BASE = 'https://conduet.zendesk.com/api/v2'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { start_date, end_date, agent_emails } = body

    if (!start_date || !end_date) {
      return new Response(
        JSON.stringify({ error: 'start_date and end_date are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiToken = Deno.env.get('ZENDESK_API_TOKEN')
    const email    = Deno.env.get('ZENDESK_EMAIL')

    if (!apiToken || !email) {
      return new Response(
        JSON.stringify({ error: 'ZENDESK_API_TOKEN and ZENDESK_EMAIL must be set in edge function secrets' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const zdHeaders = {
      Authorization: `Basic ${btoa(`${email}/token:${apiToken}`)}`,
      'Content-Type': 'application/json',
    }

    async function zdCount(query: string): Promise<number> {
      const res = await fetch(
        `${ZD_BASE}/search/count.json?query=${encodeURIComponent(query)}`,
        { headers: zdHeaders }
      )
      if (!res.ok) return 0
      const d = await res.json()
      return d.count ?? 0
    }

    // Category tags excluded from adoption counts — operational "Other::" buckets,
    // not genuine gameLM-eligible player support. Counting them inflates the ZD
    // denominator and unfairly tanks adoption rate. Verified each tag matches in ZD
    // search (combined exclusion = sum of individual counts, no overlap).
    const EXCLUDED_CATEGORY_TAGS = [
      'other__test_ticket',               // internal/QA test conversations
      'other__spam',                      // phishing / junk
      'other__disconnected_call',         // no real conversation handled
      'other__disconnected_call/chat',
      'other__duplicate/merged_tickets',  // not distinct, loggable work
      'other__wrong_number',
      'other__outbound_call',             // agent-initiated, not inbound support
      'other__outbound_call_disconnected',
      'other__outbound_tweet',
    ]
    const exclusion = EXCLUDED_CATEGORY_TAGS.map(t => `-tags:${t}`).join(' ')

    const dateClause = `created>=${start_date} created<=${end_date}`
    const baseFilter = `type:ticket via:native_messaging ${dateClause} ${exclusion}`.trim()

    // 1. Team total — single count, no pagination needed
    const totalCount = await zdCount(baseFilter)

    // 2. Per-agent counts — parallel count queries, one per agent email
    //    Each query returns <500 results so there's no pagination cap issue.
    const emails: string[] = Array.isArray(agent_emails)
      ? agent_emails.filter((e: unknown) => typeof e === 'string' && e.includes('@'))
      : []

    const agentCounts = emails.length > 0
      ? await Promise.all(
          emails.map(async (agentEmail: string) => {
            const count = await zdCount(
              `${baseFilter} assignee:${agentEmail}`
            )
            return { email: agentEmail, count }
          })
        )
      : []

    return new Response(
      JSON.stringify({ count: totalCount, agents: agentCounts }),
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
