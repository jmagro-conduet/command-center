// backfill-evals
// Queries ticket_issues for rows needing edit / accuracy / quality evaluation.
// Callers can request any combination of the three eval types.
//
// POST body:
//   operator_id?:      string   — scope to one operator
//   since?:            string   — ISO date, only issues created on/after this date
//   force?:            boolean  — re-score all issues (not just unscored ones)
//   includeEdit?:      boolean  — include edit eval IDs  (default true)
//   includeAccuracy?:  boolean  — include accuracy eval IDs (default true)
//   includeQuality?:   boolean  — include quality eval IDs  (default true)
//
// Returns:
//   editIds:      string[]
//   accuracyIds:  string[]
//   qualityIds:   string[]
//   totalUnique:  number
//   force:        boolean

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

async function paginate(baseUrl: string): Promise<string[]> {
  const PAGE   = 1000
  const ids: string[] = []
  let   offset = 0

  while (true) {
    const url  = `${baseUrl}&limit=${PAGE}&offset=${offset}`
    const res  = await fetch(url, { headers: sbHeaders })
    const data = await res.json() as { id: string }[] | { message: string }

    if (!Array.isArray(data) || data.length === 0) break
    ids.push(...data.map(r => r.id))
    if (data.length < PAGE) break
    offset += PAGE
  }

  return ids
}

function buildBase(operatorId?: string, since?: string): string {
  let q = `${SUPABASE_URL}/rest/v1/ticket_issues?select=id`
  if (operatorId) q += `&operator_id=eq.${encodeURIComponent(operatorId)}`
  if (since)      q += `&created_at=gte.${encodeURIComponent(since)}`
  return q
}

// Edit evals — only Majority/Partial edits that have final_edits present
async function queryEditIds(force: boolean, operatorId?: string, since?: string): Promise<string[]> {
  let url = buildBase(operatorId, since) +
    `&issue_type=in.(Majority%20edit,Partial%20edit)` +
    `&final_edits=not.is.null` +
    `&suggested_response=not.is.null`
  if (!force) url += `&eval_verdict=is.null`
  return paginate(url)
}

// Accuracy / quality evals — all non-"No response" issues with a suggested response
async function queryEvalIds(missingField: string, force: boolean, operatorId?: string, since?: string): Promise<string[]> {
  let url = buildBase(operatorId, since) +
    `&suggested_response=not.is.null` +
    `&issue_type=neq.No%20response`
  if (!force) url += `&${missingField}=is.null`
  return paginate(url)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      operator_id?:     string
      since?:           string
      force?:           boolean
      includeEdit?:     boolean
      includeAccuracy?: boolean
      includeQuality?:  boolean
    }

    const opId           = body.operator_id
    const since          = body.since
    const force          = body.force          ?? false
    const includeEdit    = body.includeEdit    ?? true
    const includeAccuracy = body.includeAccuracy ?? true
    const includeQuality = body.includeQuality  ?? true

    const [editIds, accuracyIds, qualityIds] = await Promise.all([
      includeEdit     ? queryEditIds(force, opId, since)                 : Promise.resolve([]),
      includeAccuracy ? queryEvalIds('accuracy_ran_at', force, opId, since) : Promise.resolve([]),
      includeQuality  ? queryEvalIds('quality_ran_at',  force, opId, since) : Promise.resolve([]),
    ])

    const totalUnique = new Set([...editIds, ...accuracyIds, ...qualityIds]).size

    return new Response(
      JSON.stringify({ editIds, accuracyIds, qualityIds, totalUnique, force }),
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
