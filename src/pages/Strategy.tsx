import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { pageAccessFor } from '../lib/pageAccess'
import { useStrategy } from '../lib/strategy/useStrategy'
import type { Plan } from '../lib/strategy/logic'
import { actionList, allSessions, planList, pickPlan } from '../lib/strategy/logic'
import type { ActionFilter, Ctx, EltStage, TabKey } from './strategy/ui'
import { Empty } from './strategy/ui'
import OverviewTab from './strategy/OverviewTab'
import EltTab from './strategy/EltTab'
import ActionsTab from './strategy/ActionsTab'
import AdminTab from './strategy/AdminTab'
import GuideTab from './strategy/GuideTab'
import KrDrawer from './strategy/KrDrawer'
import './roadmap/roadmap.css'
import './strategy/strategy.css'

const readLS = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const tabKey = (email?: string) => `strategy_tab_${email || ''}`
const VIEW_AS = 'strategy_view_as'
const TABS: TabKey[] = ['home', 'elt', 'actions', 'admin', 'guide']

// Used only so the Admin tab can set up the very first period when none exists yet.
const NO_PLAN: Plan = { id: '', period: '', periodStart: '', periodEnd: '', state: 'draft', northStar: '', vision: '', pillars: [] }

export default function Strategy() {
  const { user } = useAuth()
  const access = pageAccessFor(user, 'strategy')
  const { load, loadError, data, writer, refetch } = useStrategy(access.allowed, user?.email)

  const [tab, setTab] = useState<TabKey>(() => { const t = readLS(tabKey(user?.email)) as TabKey | null; return t && TABS.includes(t) ? t : 'home' })
  const [viewPeriod, setViewPeriod] = useState('')
  const [asOf, setAsOf] = useState('')
  const [eltId, setEltId] = useState('')
  const [eltStage, setEltStage] = useState<EltStage>('before')
  const [af, setAf] = useState<ActionFilter>({ status: 'open', owner: '', scope: '' })
  const [drawer, setDrawer] = useState<{ krId: string; session?: string; edit?: boolean } | null>(null)
  const [previewViewer, setPreviewViewerState] = useState(() => readLS(VIEW_AS) === 'viewer')
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => { writeLS(tabKey(user?.email), tab) }, [tab, user?.email])
  const toast = useCallback((msg: string) => {
    setToastMsg(msg); window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const plan = useMemo(() => pickPlan(data, viewPeriod), [data, viewPeriod])
  const realCanEdit = access.canEdit
  const canEdit = realCanEdit && !previewViewer

  const goTab = useCallback((t: TabKey) => { setTab(t); setDrawer(null); (document.querySelector('.app-main') as HTMLElement | null)?.scrollTo({ top: 0 }) }, [])
  const setPreviewViewer = useCallback((v: boolean) => { setPreviewViewerState(v); writeLS(VIEW_AS, v ? 'viewer' : 'admin') }, [])

  // ---------- states before there is anything to draw ----------
  if (!access.allowed) {
    return <div className="rm st"><div className="rm-card"><h2>Strategy</h2><p className="rm-sub" style={{ marginTop: 8 }}>You don't have access to this page. Ask a SuperAdmin to add you in Admin settings, Users.</p></div></div>
  }
  if (load === 'loading') return <div className="rm st"><div className="rm-state">Loading Strategy…</div></div>
  if (load === 'not_ready') {
    return <div className="rm st"><div className="rm-card"><h2>Strategy database isn't set up yet</h2>
      <p className="rm-sub" style={{ marginTop: 8 }}>The Strategy table doesn't exist in Supabase yet. Run <b>supabase/migrations/20261124_strategy.sql</b> in the SQL Editor, then reload this page.</p>{loadError && <p className="rm-sub" style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-word' }}>{loadError}</p>}</div></div>
  }
  if (load === 'denied') {
    return <div className="rm st"><div className="rm-card"><h2>No access to the Strategy data</h2>
      <p className="rm-sub" style={{ marginTop: 8 }}>The database rejected this account. Page access is set per user in Admin settings, Users, and checked again in the database.</p>{loadError && <p className="rm-sub" style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-word' }}>{loadError}</p>}</div></div>
  }
  if (load === 'error') {
    return <div className="rm st"><div className="rm-card"><h2>Couldn't load Strategy</h2>
      <p className="rm-sub" style={{ marginTop: 8 }}>Something went wrong reading the Strategy data.</p>{loadError && <p className="rm-sub" style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-word' }}>{loadError}</p>}
      <div style={{ marginTop: 12 }}><button type="button" className="rm-btn" onClick={() => refetch()}>Try again</button></div></div></div>
  }

  const effectivePlan = plan || NO_PLAN
  const ctx: Ctx = {
    data, plan: effectivePlan, writer, me: user?.email || null, canEdit, realCanEdit, currentId: data.currentId, toast, goTab,
    openKr: (krId, o) => setDrawer({ krId, session: o?.session, edit: o?.edit }),
    asOf, setAsOf, eltId, setEltId, eltStage, setEltStage, af, setAf, viewPeriod, setViewPeriod, previewViewer, setPreviewViewer,
  }

  const periods = planList(data)
  const inReview = plan ? allSessions(data, plan).filter(s => s.state !== 'saved' && data.proposals[s.id]).length : 0
  const openActs = actionList(data).filter(a => a.status === 'open').length
  const tabs: { id: TabKey; label: string; n?: number | string }[] = [
    { id: 'home', label: 'Strategy on a Page' },
    { id: 'elt', label: 'ELT', n: inReview ? 'Review' : undefined },
    { id: 'actions', label: 'Actions', n: openActs },
    ...(realCanEdit ? [{ id: 'admin' as TabKey, label: 'Admin' }] : []),
    { id: 'guide', label: 'Guide' },
  ]
  // With no period yet, only the admin tab (to set one up) and the guide make sense.
  const active: TabKey = !plan ? (tab === 'guide' ? 'guide' : realCanEdit ? 'admin' : 'guide') : (tab === 'admin' && !realCanEdit ? 'home' : tab)

  return (
    <div className="rm st">
      <div className="rm-head">
        <div>
          <h1>Strategy</h1>
          <p className="rm-sub">Strategy on a Page, the monthly ELT and its actions. Visible only to people you've given access.</p>
        </div>
        <div className="rm-tools">
          {previewViewer && realCanEdit && <span className="st-aipill" style={{ background: 'var(--wash)', color: 'var(--ink-2)' }}>Previewing as viewer</span>}
          {!canEdit && !previewViewer && <span className="st-viewonly"><Lock size={12} strokeWidth={1.5} />View only</span>}
          {periods.length > 0 && (
            <select aria-label="OKR period" value={plan ? plan.id : ''} onChange={e => { setViewPeriod(e.target.value === data.currentId ? '' : e.target.value); setAsOf(''); setEltId(''); setDrawer(null) }}>
              {periods.map(p => <option key={p.id} value={p.id}>{(p.period || p.id) + (p.id === data.currentId ? ' · current' : p.state === 'draft' ? ' · draft' : '')}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="rm-tabs" role="tablist" aria-label="Strategy sections">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" className="rm-tab" aria-selected={active === t.id} onClick={() => goTab(t.id)}>
            {t.label}{t.n != null && <b>{t.n}</b>}
          </button>
        ))}
      </div>

      {previewViewer && realCanEdit && (
        <div className="st-note" role="status"><b>Previewing the viewer view.</b>
          <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => setPreviewViewer(false)}>Back to admin view</button></div>
      )}

      {!plan && active !== 'guide' && active !== 'admin'
        ? <Empty title="No Strategy on a Page yet">No OKR period has been set up in Strategy.</Empty>
        : !plan && active === 'admin'
          ? <><Empty title="No Strategy on a Page yet">Set up the first OKR period below.</Empty><AdminTab ctx={ctx} /></>
          : <>
            {active === 'home' && <OverviewTab ctx={ctx} />}
            {active === 'elt' && <EltTab ctx={ctx} />}
            {active === 'actions' && <ActionsTab ctx={ctx} />}
            {active === 'admin' && <AdminTab ctx={ctx} />}
            {active === 'guide' && <GuideTab />}
          </>}

      {drawer && plan && <KrDrawer ctx={ctx} krId={drawer.krId} session={drawer.session} startEdit={drawer.edit} onClose={() => setDrawer(null)} />}
      {toastMsg && <div className="rm-toast" role="status">{toastMsg}</div>}
    </div>
  )
}
