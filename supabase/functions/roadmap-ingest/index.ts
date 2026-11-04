// roadmap-ingest
//
// The door the Claude scheduled tasks use to read and write the Product
// Roadmap's data (public.roadmap_docs). Rules live in ./core.ts.
//
// Auth: a shared secret in the `x-roadmap-secret` header, compared against the
// ROADMAP_INGEST_SECRET function secret. Deploy WITHOUT gateway JWT checking so
// the secret is the only credential the tasks need:
//   supabase functions deploy roadmap-ingest --no-verify-jwt
import { corsHeaders } from '../_shared/cors.ts'
import { handleIngest } from './core.ts'
import type { Db } from './core.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SECRET       = Deno.env.get('ROADMAP_INGEST_SECRET')

const rest = `${SUPABASE_URL}/rest/v1/roadmap_docs`
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function check(res: Response) {
  if (!res.ok) throw new Error(`Database error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

const db: Db = {
  async get(collection, id) {
    const res = await check(await fetch(`${rest}?collection=eq.${encodeURIComponent(collection)}&doc_id=eq.${encodeURIComponent(id)}&select=data`, { headers: hdr }))
    const rows = await res.json()
    return rows[0]?.data ?? null
  },
  async list(collection) {
    const out: { id: string; data: Record<string, any> }[] = []
    for (let offset = 0; ; offset += 500) {
      const res = await check(await fetch(`${rest}?collection=eq.${encodeURIComponent(collection)}&select=doc_id,data&order=doc_id&limit=500&offset=${offset}`, { headers: hdr }))
      const rows = await res.json()
      out.push(...rows.map((r: any) => ({ id: r.doc_id, data: r.data })))
      if (rows.length < 500) break
    }
    return out
  },
  async upsert(rows) {
    const body = rows.map(r => ({ ...r, updated_at: new Date().toISOString() }))
    await check(await fetch(`${rest}?on_conflict=collection,doc_id`, {
      method: 'POST', headers: { ...hdr, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body),
    }))
  },
  async remove(collection, ids) {
    const list = ids.map(i => `"${i.replace(/"/g, '')}"`).join(',')
    await check(await fetch(`${rest}?collection=eq.${encodeURIComponent(collection)}&doc_id=in.(${encodeURIComponent(list)})`, { method: 'DELETE', headers: hdr }))
  },
}

// constant-time-ish comparison so the secret can't be probed by response timing
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ ok: false, errors: ['POST only.'] }, 405)
  if (!SECRET) return json({ ok: false, errors: ['ROADMAP_INGEST_SECRET is not configured on this function.'] }, 500)
  if (!same(req.headers.get('x-roadmap-secret') || '', SECRET)) return json({ ok: false, errors: ['Unauthorized.'] }, 401)
  try {
    const body = await req.json().catch(() => null)
    const result = await handleIngest(body, db)
    return json(result, result.status)
  } catch (e) {
    return json({ ok: false, errors: [e instanceof Error ? e.message : String(e)] }, 500)
  }
})
