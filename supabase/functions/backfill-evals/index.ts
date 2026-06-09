// backfill-evals
// Queries ticket_issues for all rows that still need accuracy or quality evaluation.
// Separate ID lists are returned so the caller can fan out to eval-accuracy and
// eval-quality independently in chunks sized for each model's throughput.
//
// POST body: { operator_id?: string, since?: string }  ← since = ISO date string (inclusive)
// Returns:   { accuracyIds: string[], qualityIds: string[], totalUnique: number }

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
async function queryIds(missingField: string, operatorId?: string, since?: string): Promise<string[]> {
  const PAGE   = 1000
  const ids: string[] = []
  let   offset = 0

  while (true) {
    let url =
      `${SUPABASE_URL}/rest/v1/ticket_issues` +
      `?select=id` +
      `&suggested_response=not.is.null` +
      `&issue_type=neq.No%20response` +
      `&${missingField}=is.null` +
      `&limit=${PAGE}&offset=${offset}`

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
    const body  = await req.json().catch(() => ({})) as { operator_id?: string; since?: string }
    const opId  = body.operator_id
    const since = body.since   // ISO string, e.g. "2025-05-01T00:00:00.000Z"

    const [accuracyIds, qualityIds] = await Promise.all([
      queryIds('accuracy_ran_at', opId, since),
      queryIds('quality_ran_at',  opId, since),
    ])

    const totalUnique = new Set([...accuracyIds, ...qualityIds]).size

    return new Response(
      JSON.stringify({ accuracyIds, qualityIds, totalUnique }),
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
