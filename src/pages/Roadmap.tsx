import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { pageAccessFor } from '../lib/pageAccess'
import { useRoadmap } from '../lib/roadmap/useRoadmap'
import type { Doc, SnapMeta } from '../lib/roadmap/logic'
import { allProj, buildChunks, candidates, fmt, fmtDT, makeQuarter, prevQid, qLabelOf, qidOf, snapshotQuarter, viewFromSnapshot } from '../lib/roadmap/logic'
import type { Ctx, DrawerState, TabKey } from './roadmap/ui'
import { saveErr, boardProjects } from './roadmap/helpers'
import OverviewTab from './roadmap/OverviewTab'
import BoardTab from './roadmap/BoardTab'
import FutureFocusTab from './roadmap/FutureFocusTab'
import NewsTab from './roadmap/NewsTab'
import DrawerHost from './roadmap/Drawers'
import About from './roadmap/About'
import './roadmap/roadmap.css'

const EDIT_KEY = 'rp-edit'
const tabKey = (email?: string) => `roadmap_tab_${email || ''}`
const readLS = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export default function Roadmap() {
  const { user } = useAuth()
  const access = pageAccessFor(user, 'roadmap')
  const { load, loadError, view: live, snapshots, writer, getSnapshot, refetch } = useRoadmap(access.allowed, user?.email)

  const [tab, setTab] = useState<TabKey>(() => {
    const t = readLS(tabKey(user?.email)) as TabKey | null
    return t && ['overview', 'board', 'next', 'news'].includes(t) ? t : 'overview'
  })
  const [editing, setEditing] = useState(() => readLS(EDIT_KEY) === '1')
  const [viewQ, setViewQ] = useState('live')
  const [snapDoc, setSnapDoc] = useState<Doc | null>(null)
  const [drawer, setDrawer] = useState<DrawerState>(null)
  const [boardChunk, setBoardChunk] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [aboutOpen, setAboutOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => { writeLS(tabKey(user?.email), tab) }, [tab, user?.email])
  useEffect(() => { writeLS(EDIT_KEY, editing ? '1' : '0') }, [editing])

  // Past quarters: load the full snapshot only when someone opens it.
  useEffect(() => {
    if (viewQ === 'live') return
    let off = false
    getSnapshot(viewQ).then(d => { if (off) return; if (d) setSnapDoc(d); else setViewQ('live') })
    return () => { off = true }
  }, [viewQ, getSnapshot, snapshots])

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg); window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2400)
  }, [])

  const liveQ = useMemo(() => makeQuarter(new Date()), [])
  const isLive = viewQ === 'live' || !snapDoc
  const v = useMemo(() => (isLive ? live : viewFromSnapshot(snapDoc as Doc, live.news)), [isLive, live, snapDoc])
  const q = useMemo(() => (isLive ? liveQ : snapshotQuarter(snapDoc as Doc)), [isLive, liveQ, snapDoc])
  const P = useMemo(() => allProj(v, q), [v, q])
  const C = useMemo(() => buildChunks(v, q, P), [v, q, P])

  const goTab = useCallback((t: TabKey) => {
    setTab(t); (document.querySelector('.app-main') as HTMLElement | null)?.scrollTo({ top: 0 })
  }, [])

  const ctx: Ctx = {
    v, q, P, C, isLive, editing, writer, toast, goTab, boardChunk, setBoardChunk,
    canEdit: isLive && access.canEdit, realCanEdit: access.canEdit,
    open: d => setDrawer(d), closeDrawer: () => setDrawer(null),
  }

  // ---------- states before there is anything to draw ----------
  if (!access.allowed) {
    return <div className="rm"><div className="rm-card"><h2>Product Roadmap</h2><p className="rm-sub" style={{ marginTop: 8 }}>You don't have access to this page. Ask a SuperAdmin to add you in Admin settings, Users.</p></div></div>
  }
  if (load === 'loading') return <div className="rm"><div className="rm-state">Loading the roadmap…</div></div>
  if (load === 'not_ready') {
    return <div className="rm"><div className="rm-card"><h2>Roadmap database isn't set up yet</h2>
      <p className="rm-sub" style={{ marginTop: 8 }}>The roadmap tables don't exist in Supabase yet. Run <b>supabase/migrations/20261104_roadmap.sql</b> in the SQL Editor, then reload this page.</p>{loadError && <p className="rm-sub" style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{loadError}</p>}</div></div>
  }
  if (load === 'denied') {
    return <div className="rm"><div className="rm-card"><h2>No access to the roadmap data</h2>
      <p className="rm-sub" style={{ marginTop: 8 }}>The database rejected this account. Page access is set per user in Admin settings, Users, and checked again in the database.</p>{loadError && <p className="rm-sub" style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{loadError}</p>}</div></div>
  }
  if (load === 'error') {
    return <div className="rm"><div className="rm-card"><h2>Couldn't load the roadmap</h2>
      <p className="rm-sub" style={{ marginTop: 8 }}>Something went wrong reading the roadmap data.</p>{loadError && <p className="rm-sub" style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{loadError}</p>}
      <div style={{ marginTop: 12 }}><button type="button" className="rm-btn" onClick={() => refetch()}>Try again</button></div></div></div>
  }

  // ---------- freshness pill + banners ----------
  const sync = v.sync
  let pill: { cls: string; text: string }
  let alert: React.ReactNode = null
  if (!isLive) {
    pill = { cls: '', text: 'Snapshot · ' + (snapDoc ? fmt(String(snapDoc.asOf || snapDoc.takenAt).slice(0, 10)) : '') }
  } else {
    const pq = prevQid(new Date())
    const hasPrev = snapshots.some(x => x.quarter === pq && x.kind === 'final')
    const now = new Date()
    if (access.canEdit && !hasPrev && now.getMonth() % 3 === 0 && now.getDate() <= 14 && v.linear.size) {
      alert = <div className="rm-alert stale"><b>{qLabelOf(pq)} has no final snapshot.</b> The quarter-close task should have saved one. Take one now from the quarter menu so there's a record of where it landed.</div>
    }
    if (!sync) {
      pill = { cls: 'fail', text: 'No Linear data' }
      alert = <div className="rm-alert fail"><b>No Linear data yet.</b> The roadmap fills in after the first daily sync runs.</div>
    } else {
      const age = (new Date().getTime() - new Date(sync.lastGoodAt || sync.syncedAt).getTime()) / 36e5
      if (sync.ok === false) {
        pill = { cls: 'fail', text: 'Linear sync failed' }
        alert = <div className="rm-alert fail"><b>The last Linear sync failed{sync.attemptedAt ? ` (${fmtDT(sync.attemptedAt)})` : ''}.</b> {sync.error || 'Linear could not be read.'} Everything below is from the last good sync on {fmtDT(sync.lastGoodAt)} and may be out of date.</div>
      } else if (age > 36) {
        pill = { cls: 'stale', text: 'Linear · ' + Math.round(age) + 'h old' }
        alert = <div className="rm-alert stale"><b>Linear data is {Math.round(age)} hours old.</b> The daily sync should have run since {fmtDT(sync.lastGoodAt || sync.syncedAt)}. Check the scheduled sync before relying on these statuses.</div>
      } else pill = { cls: '', text: 'Linear · synced ' + fmtDT(sync.syncedAt) }
    }
  }

  // ---------- quarter menu + snapshots ----------
  const liveQid = qidOf(new Date())
  const sortedSnaps = [...snapshots].sort((a, b) => String(b.quarter).localeCompare(String(a.quarter)) || String(b.takenAt).localeCompare(String(a.takenAt)))
  const hasFinalPrev = snapshots.some(x => x.quarter === prevQid(new Date()) && x.kind === 'final')
  const snapLabel = (s: SnapMeta) => s.label || qLabelOf(s.quarter)

  async function takeSnapshot(kind: 'checkpoint' | 'final-prev') {
    setMenuOpen(false)
    const now = new Date(), qid = kind === 'final-prev' ? prevQid(now) : qidOf(now)
    const id = kind === 'checkpoint' ? qid + '-cp-' + now.toISOString().slice(0, 16).replace(/[-:T]/g, '') : qid
    const vals = (m: Map<string, Doc>) => [...m.values()]
    const doc = {
      quarter: qid, label: qLabelOf(qid), kind: kind === 'checkpoint' ? 'checkpoint' : 'final', takenAt: now.toISOString(), note: '',
      data: { linear: vals(live.linear), initiatives: vals(live.initiatives), chunks: vals(live.chunkDocs), overrides: vals(live.overrides), rice: vals(live.rice), items: vals(live.items), meta: live.meta, planning: live.planning, sprint: live.sprint, sync: live.sync || null },
    }
    if (JSON.stringify(doc).length > 900000) { toast('This snapshot is too large to save.'); return }
    try { await writer.set('snapshots', id, doc); toast(kind === 'checkpoint' ? 'Checkpoint saved' : 'Final snapshot saved') } catch (e) { toast(saveErr(e, "Couldn't save the snapshot. Try again.")) }
  }

  const tabs: { id: TabKey; label: string; n?: number }[] = [
    { id: 'overview', label: 'Roadmap' },
    { id: 'board', label: 'Board', n: boardProjects(P, q).length },
    { id: 'next', label: 'Future Focus', n: candidates(v, P).length },
    { id: 'news', label: 'Industry news', n: v.news.size },
  ]

  const meta = v.meta
  return (
    <div className="rm">
      {/* Header */}
      <div className="rm-head">
        <div>
          <h1>Product Roadmap</h1>
          <p className="rm-sub">ELT view of what we're building, from Linear. Visible only to people you've given access.</p>
          <div className="rm-qpick" ref={menuRef}>
            <button type="button" className="rm-qbtn" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              {q.qLabel}{!isLive && ' · snapshot'} <ChevronDown size={14} strokeWidth={1.8} />
            </button>
            {menuOpen && (
              <div className="rm-qmenu">
                <button type="button" className="rm-qopt" aria-current={isLive} onClick={() => { setViewQ('live'); setMenuOpen(false); setDrawer(null) }}><span>{qLabelOf(liveQid)}</span><small>Live</small></button>
                {sortedSnaps.length > 0 && <div className="rm-qsep" />}
                {sortedSnaps.map(s => (
                  <button key={s.id} type="button" className="rm-qopt" aria-current={viewQ === s.id} onClick={() => { setSnapDoc(null); setViewQ(s.id); setMenuOpen(false); setDrawer(null) }}>
                    <span>{snapLabel(s)}</span>
                    <small>{s.kind === 'final' ? (s.reconstructed ? 'Final · rebuilt' : 'Final · ' + fmt(String(s.takenAt).slice(0, 10))) : 'Checkpoint · ' + fmt(String(s.takenAt).slice(0, 10))}</small>
                  </button>
                ))}
                {!sortedSnaps.length && <div className="rm-qnote">Past quarters appear here once they close. Each one is saved as a read-only snapshot on the last day of the quarter.</div>}
                {access.canEdit && isLive && <>
                  <div className="rm-qsep" />
                  <button type="button" className="rm-qact" onClick={() => takeSnapshot('checkpoint')}>Save a checkpoint of {qLabelOf(liveQid)} now</button>
                  {!hasFinalPrev && <button type="button" className="rm-qact" onClick={() => takeSnapshot('final-prev')}>Save the final {qLabelOf(prevQid(new Date()))} snapshot from current data</button>}
                </>}
              </div>
            )}
          </div>
        </div>
        <div className="rm-tools">
          <button type="button" className={`rm-fresh ${pill.cls}`} title="Where this data comes from" onClick={() => { setAboutOpen(true); setTimeout(() => document.getElementById('rm-about')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }}>
            <i />{pill.text}
          </button>
          {access.canEdit && <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm rm-btn--toggle" aria-pressed={editing} onClick={() => setEditing(e => !e)}>Edit</button>}
        </div>
      </div>

      {/* North Star */}
      {meta && (meta.northStar || meta.vision) && (
        <div className="rm-card rm-ns">
          <div><div className="rm-lbl">North Star</div><p>{meta.northStar}</p></div>
          <div><div className="rm-lbl">Product vision</div><p className="v">{meta.vision}</p></div>
        </div>
      )}

      {/* Tabs */}
      <div className="rm-tabs" role="tablist" aria-label="Roadmap sections">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" className="rm-tab" aria-selected={tab === t.id} onClick={() => goTab(t.id)}>
            {t.label}{t.n != null && <b>{t.n}</b>}
          </button>
        ))}
      </div>

      {!isLive && snapDoc && (
        <div className="rm-snapbar">
          <span>You're looking at <b>{snapLabel(snapDoc as unknown as SnapMeta)}</b> as it stood on {snapDoc.reconstructed ? fmt(String(snapDoc.asOf).slice(0, 10)) : fmtDT(snapDoc.takenAt)}{snapDoc.reconstructed ? ', rebuilt from Linear history on ' + fmt(String(snapDoc.takenAt).slice(0, 10)) : snapDoc.kind === 'final' ? ', the final snapshot' : ', a checkpoint'}. Read-only.</span>
          <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => setViewQ('live')}>Back to {qLabelOf(liveQid)}</button>
        </div>
      )}
      {viewQ !== 'live' && !snapDoc && <div className="rm-state">Loading {qLabelOf(snapshots.find(s => s.id === viewQ)?.quarter)}…</div>}
      {alert}

      {(viewQ === 'live' || snapDoc) && <>
        {tab === 'overview' && <OverviewTab ctx={ctx} snap={isLive ? null : snapDoc} />}
        {tab === 'board' && <BoardTab ctx={ctx} />}
        {tab === 'next' && <FutureFocusTab ctx={ctx} />}
        {tab === 'news' && <NewsTab ctx={ctx} />}
      </>}

      <About open={aboutOpen} onToggle={setAboutOpen} />
      <div className="rm-foot">
        <span>Sources: Linear (initiatives, projects, milestones, cycles, labels) · this dashboard (fallback groupings, goal links, RICE, key result status) · Miro Q4 board (ideas, parked items, customer stages)</span>
        <span>{sync && sync.syncedAt ? 'Linear synced ' + fmtDT(sync.syncedAt) : ''}</span>
      </div>

      <DrawerHost ctx={ctx} drawer={drawer} />
      {toastMsg && <div className="rm-toast" role="status">{toastMsg}</div>}
    </div>
  )
}
