import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authClient } from '../supabase'
import type { Action, Checkin, Data, Dod, DocWrite, Plan, Proposal, ReviewWrites, Session } from './logic'
import { emptyData } from './logic'

// Data layer for the Strategy (OKR) page. Documents live in public.strategy_docs
// as (collection, doc_id, data). All access goes through authClient (the signed-in
// user's JWT) so the RLS policies in 20261124_strategy.sql decide who can read and
// who can edit. Don't swap this for the service-role client.

const POLL_MS = 30_000
const PAGE = 500

type Json = Record<string, unknown>
interface Row { collection: string; doc_id: string; data: Json; updated_at: string }
interface DbError { code?: string; message?: string; details?: string; hint?: string }
export type StrategyLoad = 'loading' | 'ready' | 'not_ready' | 'denied' | 'error'

export interface StrategyWriter {
  set(collection: string, id: string, data: Json): Promise<void>
  update(collection: string, id: string, patch: Json): Promise<void>
  remove(collection: string, id: string): Promise<void>
  /** Upserts every doc in one request (one transaction), then deletes. */
  batch(w: ReviewWrites): Promise<void>
}

const isMissingTable = (e: DbError | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))
const isDenied = (e: DbError | null) => !!e && (e.code === '42501' || /row-level security|permission denied/i.test(e.message || ''))

export class WriteError extends Error { denied: boolean; constructor(m: string, denied: boolean) { super(m); this.denied = denied } }
const toWriteError = (e: DbError) => new WriteError(isDenied(e) ? 'You have view-only access to Strategy.' : (e?.message || 'Write failed'), isDenied(e))

const strip = (data: Json | undefined | null): Json => { const rest = { ...(data || {}) }; delete rest.id; return rest }

async function fetchDocs(): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await authClient.from('strategy_docs')
      .select('collection, doc_id, data, updated_at').order('collection').order('doc_id').range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data as Row[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export function buildData(rows: Row[]): Data {
  const d = emptyData()
  for (const r of rows) {
    const doc: unknown = { id: r.doc_id, ...(r.data || {}) }
    switch (r.collection) {
      case 'plans': d.plans[r.doc_id] = doc as Plan; break
      case 'sessions': d.sessions[r.doc_id] = doc as Session; break
      case 'checkins': d.checkins[r.doc_id] = doc as Checkin; break
      case 'actions': d.actions[r.doc_id] = doc as Action; break
      case 'proposals': d.proposals[r.doc_id] = doc as Proposal; break
      case 'dods': d.dods[r.doc_id] = doc as Dod; break
      case 'config': if (r.doc_id === 'current') d.currentId = (r.data && typeof r.data.period === 'string' && r.data.period) || null; break
    }
  }
  return d
}

export function useStrategy(enabled: boolean, email: string | undefined) {
  const [rows, setRows] = useState<Map<string, Row>>(new Map())
  const [load, setLoad] = useState<StrategyLoad>('loading')
  const [loadError, setLoadError] = useState('')
  const sigRef = useRef('')

  const refetch = useCallback(async () => {
    try {
      const docs = await fetchDocs()
      const sig = docs.map(r => r.collection + '/' + r.doc_id + '@' + r.updated_at).join('|')
      if (sig !== sigRef.current) { sigRef.current = sig; setRows(new Map(docs.map(r => [r.collection + '/' + r.doc_id, r]))) }
      setLoad('ready'); setLoadError('')
    } catch (err) {
      const e = err as DbError
      console.error('[strategy] load failed', err)
      setLoadError([e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ') || String(err))
      if (isMissingTable(e)) setLoad('not_ready')
      else if (isDenied(e)) setLoad('denied')
      else setLoad(prev => (prev === 'ready' ? prev : 'error')) // keep showing data if a background poll fails
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const first = setTimeout(refetch, 0)
    const t = setInterval(() => { if (document.visibilityState === 'visible') refetch() }, POLL_MS)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [enabled, refetch])

  const data = useMemo(() => buildData([...rows.values()]), [rows])

  const applyLocal = useCallback((sets: DocWrite[], deletes: { collection: string; id: string }[], updated_at: string) => {
    sigRef.current = '' // the next poll replaces local state with the stored truth
    setRows(prev => {
      const n = new Map(prev)
      for (const s of sets) n.set(s.collection + '/' + s.id, { collection: s.collection, doc_id: s.id, data: s.data, updated_at })
      for (const x of deletes) n.delete(x.collection + '/' + x.id)
      return n
    })
  }, [])

  const writer = useMemo<StrategyWriter>(() => {
    const upsert = async (docs: DocWrite[]) => {
      const updated_at = new Date().toISOString()
      const { error } = await authClient.from('strategy_docs').upsert(
        docs.map(d => ({ collection: d.collection, doc_id: d.id, data: strip(d.data), updated_at, updated_by: email || null })),
        { onConflict: 'collection,doc_id' })
      if (error) throw toWriteError(error)
      applyLocal(docs.map(d => ({ ...d, data: strip(d.data) })), [], updated_at)
    }
    const del = async (items: { collection: string; id: string }[]) => {
      for (const x of items) {
        const { error } = await authClient.from('strategy_docs').delete().eq('collection', x.collection).eq('doc_id', x.id)
        if (error) throw toWriteError(error)
      }
      applyLocal([], items, new Date().toISOString())
    }
    return {
      set: (collection, id, data) => upsert([{ collection, id, data }]),
      // Merge into the latest stored copy, not the cached one, so two people
      // editing different fields of the same doc don't clobber each other.
      update: async (collection, id, patch) => {
        const { data: row, error } = await authClient.from('strategy_docs').select('data').eq('collection', collection).eq('doc_id', id).maybeSingle()
        if (error) throw toWriteError(error)
        await upsert([{ collection, id, data: { ...((row?.data as Json) || {}), ...strip(patch) } }])
      },
      remove: (collection, id) => del([{ collection, id }]),
      batch: async w => { if (w.sets.length) await upsert(w.sets); if (w.deletes.length) await del(w.deletes) },
    }
  }, [applyLocal, email])

  return { load, loadError, data, writer, refetch }
}
