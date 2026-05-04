import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url    = new URL(req.url)
    const start  = url.searchParams.get('start_date')
    const end    = url.searchParams.get('end_date')

    if (!start || !end) {
      return new Response(
        JSON.stringify({ error: 'start_date and end_date query params are required' }),
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

    // Basic auth: base64({email}/token:{api_token})
    const credentials = btoa(`${email}/token:${apiToken}`)

    // Search for native_messaging (Zendesk live chat) tickets in date range
    const query = `type:ticket channel:native_messaging created>=${start} created<=${end}`
    const zdUrl = `https://conduet.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=1`

    const zdRes = await fetch(zdUrl, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    })

    if (!zdRes.ok) {
      const errText = await zdRes.text()
      return new Response(
        JSON.stringify({ error: `Zendesk API error: ${zdRes.status} ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await zdRes.json()

    return new Response(
      JSON.stringify({ count: data.count ?? 0 }),
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
