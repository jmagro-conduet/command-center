import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authClient } from '../supabase'
import type { Doc, SnapMeta, ViewData } from './logic'
import { emptyView } from './logic'

// Data layer for the Product Roadmap. Documents live in public.roadmap_docs
// as (collection, doc_id, data). All access goes through authClient (the
// signed-in user's JWT) so the RLS policies in 20261104_roadmap.sql decide who
// can read and who can edit. Don't swap this for the service-role client.

const POLL_MS = 60_000
const PAGE = 500

interface Row { collection: string; doc_id: string; data: any; updated_at: string }
export type RoadmapLoad = 'loading' | 'ready' | 'not_ready' | 'denied' | 'error'

export interface Writer {
  set(collection: string, id: string, data: Record<string, any>): Promise<void>
  update(collection: string, id: string, patch: Record<string, any>): Promise<void>
}

// "table doesn't exist yet" = the migration hasn't been run
const isMissingTable = (e: any) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))
const isDenied = (e: any) => e && (e.code === '42501' || /row-level security|permission denied/i.test(e.message || ''))

// The artifact runtime this page was written for reported lack of edit access
// as code "invalid_argument"; the UI keys its "no edit access" toast off it.
function toWriteError(e: any) {
  const err: any = new Error(e?.message || 'Write failed')
  err.code = isDenied(e) ? 'invalid_argument' : e?.code || 'error'
  return err
}

const strip = (data: any) => { const rest = { ...(data || {}) }; delete rest.id; return rest }

async function fetchDocs(): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await authClient.from('roadmap_docs')
      .select('collection, doc_id, data, updated_at').neq('collection', 'snapshots')
      .order('collection').order('doc_id').range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data as Row[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

// Snapshots can be large, so the quarter menu only loads their headline fields.
// The full document is fetched when someone opens that quarter.
async function fetchSnapshotMeta(): Promise<SnapMeta[]> {
  const { data, error } = await authClient.from('roadmap_docs')
    .select('doc_id, quarter:data->>quarter, label:data->>label, kind:data->>kind, takenAt:data->>takenAt, asOf:data->>asOf, reconstructed:data->>reconstructed, note:data->>note')
    .eq('collection', 'snapshots')
  if (error) throw error
  return (data as any[]).map(r => ({
    id: r.doc_id, quarter: r.quarter || '', label: r.label || '', kind: r.kind === 'checkpoint' ? 'checkpoint' : 'final',
    takenAt: r.takenAt || '', asOf: r.asOf || undefined, reconstructed: r.reconstructed === 'true', note: r.note || '',
  }))
}

function buildView(rows: Row[]): ViewData {
  const v = emptyView(); v.sync = null
  for (const r of rows) {
    const doc: Doc = { id: r.doc_id, ...(r.data || {}) }
    switch (r.collection) {
      case 'linear': v.linear.set(r.doc_id, doc); break
      case 'overrides': v.overrides.set(r.doc_id, doc); break
      case 'rice': v.rice.set(r.doc_id, doc); break
      case 'items': v.items.set(r.doc_id, doc); break
      case 'news': v.news.set(r.doc_id, doc); break
      case 'chunks': v.chunkDocs.set(r.doc_id, doc); break
      case 'initiatives': v.initiatives.set(r.doc_id, doc); break
      case 'meta':
        if (r.doc_id === 'overview') v.meta = strip(doc) as Doc
        if (r.doc_id === 'planning') v.planning = strip(doc) as Doc
        if (r.doc_id === 'sprint') v.sprint = strip(doc) as Doc
        break
      case 'sync': if (r.doc_id === 'linear') v.sync = strip(doc) as Doc; break
    }
  }
  return v
}

export function useRoadmap(enabled: boolean, email: string | undefined) {
  const [rows, setRows] = useState<Map<string, Row>>(new Map())
  const [snapshots, setSnapshots] = useState<SnapMeta[]>([])
  const [load, setLoad] = useState<RoadmapLoad>('loading')
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  const sigRef = useRef('')
  const snapCache = useRef(new Map<string, Doc>())

  const refetch = useCallback(async () => {
    try {
      const [docs, snaps] = await Promise.all([fetchDocs(), fetchSnapshotMeta()])
      const sig = docs.map(r => r.collection + '/' + r.doc_id + '@' + r.updated_at).join('|') + '#' + snaps.map(s => s.id + s.takenAt + s.note).join('|')
      if (sig !== sigRef.current) {
        sigRef.current = sig
        setRows(new Map(docs.map(r => [r.collection + '/' + r.doc_id, r])))
        setSnapshots(snaps)
      }
      setLoad('ready'); setLoadedAt(Date.now()); setLoadError('')
    } catch (e: any) {
      console.error('[roadmap] load failed', e)
      setLoadError([e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' | ') || String(e))
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

  const view = useMemo(() => buildView([...rows.values()]), [rows])

  const applyLocal = useCallback((collection: string, id: string, data: any, updated_at: string) => {
    setRows(prev => { const n = new Map(prev); n.set(collection + '/' + id, { collection, doc_id: id, data, updated_at }); return n })
    if (collection === 'snapshots') {
      snapCache.current.delete(id)
      setSnapshots(prev => {
        const meta: SnapMeta = { id, quarter: data.quarter || '', label: data.label || '', kind: data.kind === 'checkpoint' ? 'checkpoint' : 'final', takenAt: data.takenAt || '', asOf: data.asOf, reconstructed: !!data.reconstructed, note: data.note || '' }
        return prev.some(s => s.id === id) ? prev.map(s => (s.id === id ? meta : s)) : [...prev, meta]
      })
    }
  }, [])

  const writer = useMemo<Writer>(() => {
    const put = async (collection: string, id: string, data: any) => {
      const updated_at = new Date().toISOString()
      const { error } = await authClient.from('roadmap_docs').upsert(
        { collection, doc_id: id, data, updated_at, updated_by: email || null }, { onConflict: 'collection,doc_id' })
      if (error) throw toWriteError(error)
      applyLocal(collection, id, data, updated_at)
    }
    return {
      set: (collection, id, data) => put(collection, id, strip(data)),
      // Merge into the latest stored copy, not the cached one, so two people
      // editing different fields of the same doc don't clobber each other.
      update: async (collection, id, patch) => {
        const { data: row, error } = await authClient.from('roadmap_docs').select('data').eq('collection', collection).eq('doc_id', id).maybeSingle()
        if (error) throw toWriteError(error)
        await put(collection, id, { ...((row?.data as any) || {}), ...strip(patch) })
      },
    }
  }, [applyLocal, email])

  const getSnapshot = useCallback(async (id: string): Promise<Doc | null> => {
    const hit = snapCache.current.get(id); if (hit) return hit
    const { data, error } = await authClient.from('roadmap_docs').select('data').eq('collection', 'snapshots').eq('doc_id', id).maybeSingle()
    if (error || !data) return null
    const doc: Doc = { id, ...(data.data as any) }
    snapCache.current.set(id, doc)
    return doc
  }, [])

  return { load, loadError, view, snapshots, writer, getSnapshot, loadedAt, refetch }
}
