// Service-role access to public.funnel_docs for the pipedrive-sync edge function.
// Same (collection, doc_id, data jsonb) store the Sales Funnel page reads (with row-level security).
// Server-side only: this uses the service-role key, which must never reach the browser.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const rest = `${SUPABASE_URL}/rest/v1/funnel_docs`
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function check(res: Response) {
  if (!res.ok) throw new Error(`Database error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

export interface Doc { id: string; data: Record<string, any> }

export const funnelDb = {
  async get(collection: string, id: string): Promise<Record<string, any> | null> {
    const res = await check(await fetch(`${rest}?collection=eq.${encodeURIComponent(collection)}&doc_id=eq.${encodeURIComponent(id)}&select=data`, { headers: hdr }))
    const rows = await res.json()
    return rows[0]?.data ?? null
  },
  async list(collection: string): Promise<Doc[]> {
    const out: Doc[] = []
    for (let offset = 0; ; offset += 500) {
      const res = await check(await fetch(`${rest}?collection=eq.${encodeURIComponent(collection)}&select=doc_id,data&order=doc_id&limit=500&offset=${offset}`, { headers: hdr }))
      const rows = await res.json()
      out.push(...rows.map((r: any) => ({ id: r.doc_id, data: r.data })))
      if (rows.length < 500) break
    }
    return out
  },
  async upsert(rows: { collection: string; doc_id: string; data: Record<string, any>; updated_by: string }[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 50) {
      const body = rows.slice(i, i + 50).map(r => ({ ...r, updated_at: new Date().toISOString() }))
      await check(await fetch(`${rest}?on_conflict=collection,doc_id`, {
        method: 'POST', headers: { ...hdr, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body),
      }))
    }
  },
}
