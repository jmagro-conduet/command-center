import { corsHeaders } from '../_shared/cors.ts'

// Lists Zendesk brands so an admin can map each gameLM operator to its real
// ZD brand — used by the operator config UI's brand picker, and by this
// project's own tooling to look up brand ids when wiring up a new operator.

const ZD_BASE = 'https://conduet.zendesk.com/api/v2'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const apiToken = Deno.env.get('ZENDESK_API_TOKEN')
    const email    = Deno.env.get('ZENDESK_EMAIL')
    if (!apiToken || !email) {
      return new Response(JSON.stringify({ error: 'ZENDESK_API_TOKEN and ZENDESK_EMAIL must be set' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const zdHeaders = { Authorization: `Basic ${btoa(`${email}/token:${apiToken}`)}` }
    const res = await fetch(`${ZD_BASE}/brands.json`, { headers: zdHeaders })
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `ZD ${res.status}: ${(await res.text()).slice(0, 300)}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const data = await res.json()
    const brands = (data.brands ?? []).map((b: any) => ({ id: b.id, name: b.name, subdomain: b.subdomain, active: b.active }))

    return new Response(JSON.stringify({ brands }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
