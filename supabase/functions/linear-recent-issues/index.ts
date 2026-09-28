// linear-recent-issues
//
// Read-only lookup: recent issues in one of an operator's linked Linear
// projects, for backfilling bug_reports.filed_ticket_id/status when a
// ticket was created in Linear (e.g. from a theme draft) but the reviewer
// never came back to click "Log filed ticket" in Command Center. Each
// draft (see draft-bug-ticket) is instructed to embed a "Ticket ID: <id>"
// line per contributing bug specifically so this kind of reconciliation is
// possible -- the caller matches those lines back to bug_reports.ticket_id
// itself, this function just returns the raw issue list.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LINEAR_API_KEY = Deno.env.get('LINEAR_API_KEY')
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
const LINEAR_API = 'https://api.linear.app/graphql'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (!LINEAR_API_KEY) return json({ error: 'LINEAR_API_KEY not configured' }, 500)
    const body = await req.json().catch(() => ({}))
    const operatorId: string = body.operator_id
    const limit: number = Number.isFinite(body.limit) && body.limit > 0 ? Math.min(Math.floor(body.limit), 100) : 50
    if (!operatorId) return json({ error: 'operator_id is required' }, 400)

    const opRes = await fetch(`${SUPABASE_URL}/rest/v1/operators?id=eq.${operatorId}&select=id,name,linear_projects`, { headers: sb })
    const operator = opRes.ok ? (await opRes.json())[0] ?? null : null
    const linearProjects: { id: string; name: string }[] = Array.isArray(operator?.linear_projects) ? operator.linear_projects : []
    if (linearProjects.length === 0) return json({ error: 'This operator has no Linear project linked (Settings -> Linear projects).' }, 404)

    const gql = `
      query($filter: IssueFilter) {
        issues(first: ${limit}, filter: $filter, orderBy: updatedAt) {
          nodes { identifier title description url createdAt updatedAt state { name type } project { name } }
        }
      }
    `
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql, variables: { filter: { project: { id: { in: linearProjects.map(p => p.id) } } } } }),
    })
    if (!res.ok) return json({ error: `Linear API ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502)
    const data = await res.json()
    if (data.errors) return json({ error: `Linear API error: ${JSON.stringify(data.errors).slice(0, 300)}` }, 502)

    return json({ issues: data.data?.issues?.nodes ?? [], linear_projects: linearProjects })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
