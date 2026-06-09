// backfill-evals
// Queries ticket_issues for rows needing accuracy / quality evaluation.
//
// POST body: { operator_id?: string, since?: string, force?: boolean }
//   force: when true, returns ALL scorable issues in the window (not just unscored ones)
//          — useful after a prompt update to refresh scores across the board.
//
// Returns: { accuracyIds: string[], qualityIds: string[], totalUnique: number, force: boolean }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const sbHeaders = {
  apikey:        SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  Prefer:        'count=none',
}

// Paginate through ticket_issues and collect all matching IDs.
async function queryIds(
  missingField: string,
  force: boolean,
  operatorId?: string,
  since?: string,
): Promise<string[]> {
  const PAGE   = 1000
  const ids: string[] = []
  let   offset = 0

  while (true) {
    let url =
      `${SUPABASE_URL}/rest/v1/ticket_issues` +
      `?select=id` +
      `&suggested_response=not.is.null` +
      `&issue_type=neq.No%20response`

    // In normal mode only fetch rows missing the eval; in force mode fetch all scorable rows
    if (!force) url += `&${missingField}=is.null`

    url += `&limit=${PAGE}&offset=${offset}`

    if (operatorId) url += `&operator_id=eq.${encodeURIComponent(operatorId)}`
    if (since)      url += `&created_at=gte.${encodeURIComponent(since)}`

    const res  = await fetch(url, { headers: sbHeaders })
    const data = await res.json() as { id: string }[] | { message: string }

    if (!Array.isArray(data) || data.length === 0) break
    ids.push(...data.map(r => r.id))
    if (data.length < PAGE) break
    offset += PAGE
  }

  return ids
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body  = await req.json().catch(() => ({})) as {
      operator_id?: string
      since?:       string
      force?:       boolean
    }
    const opId  = body.operator_id
    const since = body.since
    const force = body.force ?? false

    // In force mode both lists are the same set, so only query once
    let accuracyIds: string[]
    let qualityIds:  string[]

    if (force) {
      // Re-score everything in the window — same IDs for both evals
      accuracyIds = await queryIds('accuracy_ran_at', true, opId, since)
      qualityIds  = accuracyIds
    } else {
      ;[accuracyIds, qualityIds] = await Promise.all([
        queryIds('accuracy_ran_at', false, opId, since),
        queryIds('quality_ran_at',  false, opId, since),
      ])
    }

    const totalUnique = new Set([...accuracyIds, ...qualityIds]).size

    return new Response(
      JSON.stringify({ accuracyIds, qualityIds, totalUnique, force }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
