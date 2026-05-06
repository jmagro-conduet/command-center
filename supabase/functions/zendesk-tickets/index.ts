import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { start_date, end_date } = await req.json()

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

    const credentials = btoa(`${email}/token:${apiToken}`)
    const zdHeaders = {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    }

    const query = `type:ticket via:native_messaging brand_id:8399147779099 created>=${start_date} created<=${end_date}`

    // 1. Get total count (fast endpoint)
    const countUrl = `https://conduet.zendesk.com/api/v2/search/count.json?query=${encodeURIComponent(query)}`
    const countRes = await fetch(countUrl, { headers: zdHeaders })
    if (!countRes.ok) {
      const errText = await countRes.text()
      return new Response(
        JSON.stringify({ error: `Zendesk API error: ${countRes.status} ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const countData = await countRes.json()
    const count = countData.count ?? 0

    // 2. Paginate search results to build per-agent breakdown
    const assigneeCounts = new Map<number, number>()

    if (count > 0) {
      let nextUrl: string | null =
        `https://conduet.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=100`

      while (nextUrl) {
        const res = await fetch(nextUrl, { headers: zdHeaders })
        if (!res.ok) break
        const data = await res.json()
        for (const ticket of data.results ?? []) {
          if (ticket.assignee_id) {
            assigneeCounts.set(
              ticket.assignee_id,
              (assigneeCounts.get(ticket.assignee_id) ?? 0) + 1
            )
          }
        }
        nextUrl = data.next_page ?? null
      }
    }

    // 3. Resolve assignee IDs to names/emails (batched, max 100 per call)
    const agentMap = new Map<number, { name: string; email: string }>()
    const ids = [...assigneeCounts.keys()]

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100)
      const usersRes = await fetch(
        `https://conduet.zendesk.com/api/v2/users/show_many.json?ids=${batch.join(',')}`,
        { headers: zdHeaders }
      )
      if (usersRes.ok) {
        const usersData = await usersRes.json()
        for (const u of usersData.users ?? []) {
          agentMap.set(u.id, { name: u.name ?? '', email: u.email ?? '' })
        }
      }
    }

    // 4. Build sorted per-agent array
    const agents = [...assigneeCounts.entries()]
      .map(([id, agentCount]) => ({
        name:  agentMap.get(id)?.name  ?? `Agent ${id}`,
        email: agentMap.get(id)?.email ?? '',
        count: agentCount,
      }))
      .sort((a, b) => b.count - a.count)

    return new Response(
      JSON.stringify({ count, agents }),
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
