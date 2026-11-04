// roadmap-ingest -- core logic (no Deno / network APIs, so it can be tested in Node).
//
// The Roadmap page's data is fed by three Claude scheduled tasks (Linear sync,
// Slack #ai-newsletter news, sprint recap) plus the quarter-close task. They
// used to write to the old Claude artifact database; they now call this
// function instead. It is a deliberately narrow door into public.roadmap_docs:
//   * only these collections/docs can be written, and only with these ops
//   * the hand-edited layers (chunks, overrides, rice, items, meta/overview,
//     meta/planning) are NOT writable from here -- people edit those in the app
//   * a batch is validated in full before anything is written
//   * deleting many Linear projects in one go needs an explicit flag, so a
//     bad Linear read can't wipe the board

export type Op = 'set' | 'update' | 'delete'
export interface WriteReq { op: Op; collection: string; id: string; data?: Record<string, any> }
export interface ReadReq { collection: string; id?: string }
export interface SprintReq { summary?: string; focus?: string[]; start?: string; end?: string }
export interface IngestBody {
  source?: string
  dryRun?: boolean
  allowBulkDelete?: boolean
  reads?: ReadReq[]
  writes?: WriteReq[]
  sprint?: SprintReq
}

export interface Db {
  get(collection: string, id: string): Promise<Record<string, any> | null>
  list(collection: string): Promise<{ id: string; data: Record<string, any> }[]>
  upsert(rows: { collection: string; doc_id: string; data: Record<string, any>; updated_by: string }[]): Promise<void>
  remove(collection: string, ids: string[]): Promise<void>
}

const WRITABLE: Record<string, { ids?: string[]; ops: Op[] }> = {
  linear: { ops: ['set', 'update', 'delete'] },
  initiatives: { ops: ['set', 'update', 'delete'] },
  news: { ops: ['set', 'update'] },
  snapshots: { ops: ['set'] },
  sync: { ids: ['linear'], ops: ['set', 'update'] },
  meta: { ids: ['sprint'], ops: ['set', 'update'] },
}
const READABLE = ['linear', 'initiatives', 'chunks', 'overrides', 'rice', 'items', 'news', 'snapshots', 'meta', 'sync']
const ID_RX = /^[A-Za-z0-9_.:-]{1,120}$/
const MAX_WRITES = 100
const MAX_DOC_BYTES = 1_500_000
const BULK_DELETE_LIMIT = 10

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const strip = (d: Record<string, any>) => { const r = { ...d }; delete r.id; return r }
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export interface IngestResult {
  ok: boolean
  status: number
  applied?: number
  dryRun?: boolean
  plan?: { op: string; collection: string; id: string }[]
  reads?: Record<string, any>
  sprint?: { focus: string[]; unmatched: string[] }
  errors?: string[]
}

export async function handleIngest(body: IngestBody, db: Db): Promise<IngestResult> {
  if (!isObj(body)) return { ok: false, status: 400, errors: ['Body must be a JSON object.'] }
  const source = String(body.source || 'ingest').slice(0, 60)
  const errors: string[] = []
  const writes: WriteReq[] = Array.isArray(body.writes) ? body.writes.slice() : []
  const reads: ReadReq[] = Array.isArray(body.reads) ? body.reads : []
  let sprintOut: IngestResult['sprint']

  // ---- sprint shortcut: resolve focus names to chunk / initiative ids ----
  if (body.sprint !== undefined) {
    const sp = body.sprint
    if (!isObj(sp)) errors.push('sprint must be an object.')
    else {
      const names = Array.isArray(sp.focus) ? sp.focus.map(String) : []
      const [chunks, inits] = names.length ? await Promise.all([db.list('chunks'), db.list('initiatives')]) : [[], []]
      const cands = [
        ...chunks.map(c => ({ id: c.id, name: String(c.data.name || '') })),
        ...inits.map(i => ({ id: 'i-' + i.id, name: String(i.data.name || '') })),
      ]
      const focus: string[] = [], unmatched: string[] = []
      for (const n of names) {
        const hit = cands.find(c => c.id === n) || cands.find(c => norm(c.name) === norm(n)) || cands.find(c => norm(n).length > 3 && (norm(c.name).includes(norm(n)) || norm(n).includes(norm(c.name))))
        if (hit) { if (!focus.includes(hit.id)) focus.push(hit.id) } else unmatched.push(n)
      }
      sprintOut = { focus, unmatched }
      writes.push({
        op: 'set', collection: 'meta', id: 'sprint',
        data: { summary: String(sp.summary ?? ''), focus, start: String(sp.start ?? ''), end: String(sp.end ?? ''), updatedAt: new Date().toISOString(), updatedBy: source },
      })
    }
  }

  // ---- validate every write before touching anything ----
  if (writes.length > MAX_WRITES) errors.push(`At most ${MAX_WRITES} writes per request (got ${writes.length}). Split into batches.`)
  let deletesInLists = 0
  writes.forEach((w, i) => {
    const at = `writes[${i}]`
    if (!isObj(w)) { errors.push(`${at} must be an object.`); return }
    const rule = WRITABLE[w.collection]
    if (!rule) { errors.push(`${at}: collection "${w.collection}" is not writable here.`); return }
    if (!rule.ops.includes(w.op)) { errors.push(`${at}: op "${w.op}" is not allowed on "${w.collection}".`); return }
    if (typeof w.id !== 'string' || !ID_RX.test(w.id)) { errors.push(`${at}: invalid id.`); return }
    if (rule.ids && !rule.ids.includes(w.id)) { errors.push(`${at}: only ${rule.ids.join(', ')} can be written in "${w.collection}".`); return }
    if (w.op !== 'delete') {
      if (!isObj(w.data)) { errors.push(`${at}: data must be an object.`); return }
      if (JSON.stringify(w.data).length > MAX_DOC_BYTES) errors.push(`${at}: document is larger than ${MAX_DOC_BYTES} bytes.`)
    } else if (w.collection === 'linear' || w.collection === 'initiatives') deletesInLists++
  })
  if (deletesInLists > BULK_DELETE_LIMIT && !body.allowBulkDelete) {
    errors.push(`${deletesInLists} deletes from linear/initiatives in one request. If that is really intended, resend with allowBulkDelete: true.`)
  }
  for (const [i, r] of reads.entries()) {
    if (!isObj(r) || !READABLE.includes(r.collection) || (r.id !== undefined && (typeof r.id !== 'string' || !ID_RX.test(r.id)))) errors.push(`reads[${i}] is invalid.`)
  }
  if (errors.length) return { ok: false, status: 400, errors }

  // ---- reads ----
  const out: Record<string, any> = {}
  for (const r of reads) {
    if (r.id) { const d = await db.get(r.collection, r.id); out[`${r.collection}/${r.id}`] = d ? { id: r.id, ...d } : null }
    else out[r.collection] = (await db.list(r.collection)).map(x => ({ id: x.id, ...x.data }))
  }

  const plan = writes.map(w => ({ op: w.op, collection: w.collection, id: w.id }))
  if (body.dryRun) return { ok: true, status: 200, dryRun: true, plan, reads: out, sprint: sprintOut }

  // ---- writes: merge for `update`, then one upsert, then deletes ----
  const rows: { collection: string; doc_id: string; data: Record<string, any>; updated_by: string }[] = []
  const deletes = new Map<string, string[]>()
  for (const w of writes) {
    if (w.op === 'delete') { deletes.set(w.collection, [...(deletes.get(w.collection) || []), w.id]); continue }
    const incoming = strip(w.data as Record<string, any>)
    const data = w.op === 'update' ? { ...((await db.get(w.collection, w.id)) || {}), ...incoming } : incoming
    rows.push({ collection: w.collection, doc_id: w.id, data, updated_by: 'ingest:' + source })
  }
  if (rows.length) await db.upsert(rows)
  for (const [c, ids] of deletes) await db.remove(c, ids)
  return { ok: true, status: 200, applied: writes.length, reads: out, sprint: sprintOut }
}
