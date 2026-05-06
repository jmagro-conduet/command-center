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
    const base = `https://conduet.zendesk.com/api/v2/search.json`
    const authHeaders = {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    }

    // Query both channel types in parallel — classic Chat uses 'chat', newer Messaging uses 'native_messaging'
    const channels = ['chat', 'native_messaging']
    const results = await Promise.all(channels.map(async ch => {
      const query = `type:ticket channel:${ch} created>=${start_date} created<=${end_date}`
      const res = await fetch(`${base}?query=${encodeURIComponent(query)}&per_page=1`, { headers: authHeaders })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Zendesk API error (${ch}): ${res.status} ${errText}`)
      }
      const json = await res.json()
      return { channel: ch, count: json.count ?? 0 }
    }))

    const total = results.reduce((sum, r) => sum + r.count, 0)

    return new Response(
      JSON.stringify({ count: total, breakdown: results }),
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
