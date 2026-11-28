import { useCallback, useEffect, useRef, useState } from 'react'
import { authClient } from '../supabase'
import type { Activity, Deal, FunnelConfig, FunnelData, SyncMeta } from './logic'
import { emptyFunnel } from './logic'

// Data layer for the Sales Funnel page. The data is a copy of Pipedrive kept in public.funnel_docs by the
// pipedrive-sync edge function. Reads go through authClient (the signed-in user's JWT) so the RLS policy in
// 20261128_sales_funnel.sql decides who can read it. Don't swap this for the service-role client.

const POLL_MS = 60_000
const PAGE = 1000

interface Row { collection: string; doc_id: string; data: Record<string, unknown>; updated_at: string }
interface DbError { code?: string; message?: string; details?: string; hint?: string }
export type FunnelLoad = 'loading' | 'ready' | 'not_ready' | 'denied' | 'error'

const isMissingTable = (e: DbError | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))
const isDenied = (e: DbError | null) => !!e && (e.code === '42501' || /row-level security|permission denied/i.test(e.message || ''))

async function fetchDocs(): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await authClient.from('funnel_docs')
      .select('collection, doc_id, data, updated_at').order('collection').order('doc_id').range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data || []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export function buildFunnel(rows: Row[]): FunnelData {
  const d = emptyFunnel()
  for (const r of rows) {
    const x = r.data as unknown
    switch (r.collection) {
      case 'config': if (r.doc_id === 'funnel') d.config = x as FunnelConfig; break
      case 'deals': d.deals.push(x as Deal); break
      case 'activities': { const a = x as Activity; d.activities[a.id] = a; break }
      case 'users': { const u = x as { id: number; name: string }; d.users[u.id] = u.name; break }
      case 'meta': if (r.doc_id === 'sync') d.sync = x as SyncMeta; break
    }
  }
  return d
}

// One-off read for places that only need a summary (Home): same RLS-protected client, no polling.
let snap: { at: number; p: Promise<FunnelData> } | null = null
export function loadFunnelData(): Promise<FunnelData> {
  if (snap && Date.now() - snap.at < 30_000) return snap.p
  const p = fetchDocs().then(buildFunnel)
  snap = { at: Date.now(), p }
  p.catch(() => { if (snap && snap.p === p) snap = null })
  return p
}

export function useFunnel() {
  const [data, setData] = useState<FunnelData>(emptyFunnel())
  const [load, setLoad] = useState<FunnelLoad>('loading')
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => new Date())  // refreshed on every successful read, so ages and periods never go stale
  const sigRef = useRef('')

  const refetch = useCallback(async () => {
    try {
      const rows = await fetchDocs()
      const sig = rows.map(r => r.collection + '/' + r.doc_id + '@' + r.updated_at).join('|')
      if (sig !== sigRef.current) { sigRef.current = sig; setData(buildFunnel(rows)) }
      setNow(new Date()); setLoad('ready'); setLoadError('')
    } catch (err) {
      const e = err as DbError
      console.error('[funnel] load failed', err)
      setLoadError([e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ') || String(err))
      if (isMissingTable(e)) setLoad('not_ready')
      else if (isDenied(e)) setLoad('denied')
      else setLoad(prev => (prev === 'ready' ? prev : 'error')) // keep showing data if a background poll fails
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(refetch, 0)
    const t = setInterval(() => { if (document.visibilityState === 'visible') refetch() }, POLL_MS)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [refetch])

  return { load, loadError, data, now, refetch }
}
