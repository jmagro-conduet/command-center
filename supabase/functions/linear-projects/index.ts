import { corsHeaders } from '../_shared/cors.ts'

// Lists Linear projects so an admin can map each gameLM operator to the
// Linear project its bug triage/classification should compare against —
// used by the operator config UI's project picker. Same role as
// zendesk-brands, one API call away from the read-only LINEAR_API_KEY.

const LINEAR_API = 'https://api.linear.app/graphql'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const apiKey = Deno.env.get('LINEAR_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LINEAR_API_KEY must be set in edge function secrets' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Optional search term (name contains, case-insensitive) -- the
    // workspace has 100+ projects (mostly future-roadmap placeholders
    // unrelated to bug tracking), so the picker searches server-side
    // instead of loading everything. Accepts either a query string (for
    // direct curl/testing) or a JSON body (supabase-js's functions.invoke
    // is always a POST, so the real caller uses the body).
    const url = new URL(req.url)
    let search = url.searchParams.get('search')?.trim()
    if (!search && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      search = typeof body?.search === 'string' ? body.search.trim() : undefined
    }

    const gql = `
      query($filter: ProjectFilter) {
        projects(first: 50, filter: $filter) {
          nodes { id name state }
        }
      }
    `
    const variables = search ? { filter: { name: { containsIgnoreCase: search } } } : {}
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql, variables }),
    })
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Linear ${res.status}: ${(await res.text()).slice(0, 300)}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const data = await res.json()
    if (data.errors) {
      return new Response(JSON.stringify({ error: `Linear GraphQL error: ${JSON.stringify(data.errors).slice(0, 300)}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const projects = (data.data?.projects?.nodes ?? []).map((p: any) => ({ id: p.id, name: p.name, state: p.state ?? null }))

    return new Response(JSON.stringify({ projects }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
