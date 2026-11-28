import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'
import { canOpen, pageDef, navPages } from '../lib/access/core'
import type { AccessMap } from '../lib/access/core'
import { homeLayout } from '../lib/home/layout'
import type { WidgetDef } from '../lib/home/layout'
import * as D from '../lib/home/data'
import { pct, plural } from '../lib/home/metrics'
import { QUALITY_TARGET } from '../lib/home/metrics'
import { getDailyTarget } from '../lib/settings'
import { actionList, allSessions, isOverdue, pickPlan, statusCounts, allKrs, fmtDate } from '../lib/strategy/logic'
import { loadFunnelData } from '../lib/funnel/useFunnel'
import { summarize as summarizeFunnel } from '../lib/funnel/logic'
import PageHeader from '../components/PageHeader'
import { OPEN_SEARCH_EVENT } from '../components/CommandPalette'
import type { Page } from '../components/layout/Sidebar'
import './home.css'

// Home: the page everyone lands on. A few quick links, then small cards chosen for the person's role.
// Every card belongs to a page and appears only if the person can open that page (lib/home/layout.ts).
// A card that cannot load shows a quiet message and nothing else on the page is affected.

type Nav = (p: Page) => void

// Load once per mount. Cards remount (by key) when the operator changes, so this never needs to reset.
function useLoad<T>(fn: () => Promise<T>): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({ data: null, failed: false })
  const [load] = useState(() => fn) // one load per mount; cards remount when the operator changes
  useEffect(() => {
    let off = false
    load().then(d => { if (!off) setState({ data: d, failed: false }) }).catch(e => { console.error('[home] card failed', e); if (!off) setState({ data: null, failed: true }) })
    return () => { off = true }
  }, [load])
  return state
}

function Card({ title, sub, wide, openLabel, onOpen, children }: { title: string; sub?: string; wide?: boolean; openLabel?: string; onOpen?: () => void; children: ReactNode }) {
  return (
    <section className={`hub-card${wide ? ' hub-card--wide' : ''}`} aria-label={title}>
      <div className="hub-card-head">
        <div><h2>{title}</h2>{sub && <div className="hub-sub">{sub}</div>}</div>
        {onOpen && <button type="button" className="hub-link" onClick={onOpen}>{openLabel || 'Open'}</button>}
      </div>
      {children}
    </section>
  )
}
const Loading = () => <div className="hub-muted">Loading…</div>
const Failed = () => <div className="hub-muted">Couldn't load this card. The rest of Home is unaffected.</div>
function Body<T>({ s, children }: { s: { data: T | null; failed: boolean }; children: (d: T) => ReactNode }) {
  return s.failed ? <Failed /> : s.data === null ? <Loading /> : <>{children(s.data)}</>
}

interface Ctx { email: string; userId: string; role: string; opId: string | null; opName: string | null; isQa: boolean; multiOp: boolean; operatorIds: string[]; access: AccessMap; go: Nav }
const sub = (c: Ctx) => (c.multiOp && c.opName ? c.opName : undefined)
const needOp = (c: Ctx, f: (opId: string) => ReactNode) => (c.opId ? f(c.opId) : <div className="hub-muted">Choose an operator in the sidebar to see this.</div>)

// ------------------------------------------------------------------ cards
function TodayCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchTicketsToday(c.email, c.opId))
  const t = getDailyTarget()
  return (
    <Card title="Today" sub={sub(c)} wide onOpen={() => c.go('log-ticket')} openLabel="Log a ticket">
      <Body s={s}>{n => (<>
        <div className="hub-big">{n}<small>of {t.min} to {t.max} tickets</small></div>
        <div className="hub-bar" aria-hidden="true"><span style={{ width: Math.min(100, Math.round(n / Math.max(t.min, 1) * 100)) + '%' }} /></div>
        <div className="hub-muted">{n >= t.min ? 'You have reached your minimum for today.' : `${plural(t.min - n, 'more ticket')} to reach your minimum.`}</div>
      </>)}</Body>
    </Card>
  )
}
function BulletinUnreadCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchUnreadBulletins(c.email))
  return (
    <Card title="Unread bulletin" onOpen={() => c.go('bulletin')} openLabel="Read">
      <Body s={s}>{list => list.length === 0
        ? <div className="hub-muted">You are up to date.</div>
        : <><div className="hub-big">{list.length}<small>unread</small></div><div className="hub-muted">Latest is for {fmtDate(list[0].bulletin_date)}.</div></>}</Body>
    </Card>
  )
}
function TrainingCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchTrainingTodo(c.userId, c.opId, false))
  return (
    <Card title="Training to complete" onOpen={() => c.go('learn')} openLabel="Open Learn">
      <Body s={s}>{list => list.length === 0
        ? <div className="hub-muted">Nothing to complete right now.</div>
        : <>{list.slice(0, 3).map(x => <div className="hub-row" key={x.quiz.id}><span>{x.quiz.title}</span><span className="hub-muted">{x.status === 'not_started' ? 'Not started' : 'Not passed'}</span></div>)}
            {list.length > 3 && <div className="hub-sub">and {list.length - 3} more</div>}</>}</Body>
    </Card>
  )
}
function MyWeekCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchMyWeek(c.email, c.opId, c.isQa))
  return (
    <Card title="My last 7 days" sub={sub(c)} wide>
      <Body s={s}>{d => (
        <div className="hub-stats">
          <div><div className="n">{d.tickets}</div><div className="hub-sub">tickets</div></div>
          <div><div className="n">{pct(d.perfectRate, 0)}</div><div className="hub-sub">perfect, no edits</div></div>
        </div>)}</Body>
    </Card>
  )
}
function QaCards({ c, which }: { c: Ctx; which: 'quality' | 'errors' | 'decide' }) {
  const s = useLoad(() => (c.opId ? D.fetchQaWeek(c.opId) : Promise.resolve(null as never)))
  const bugs = useLoad(() => (c.opId && canOpen(c.access, 'bug-tracker') && which === 'decide' ? D.fetchOpenBugs(c.opId) : Promise.resolve(-1)))
  if (!c.opId) return <Card title={which === 'quality' ? 'Quality this week' : which === 'errors' ? 'Accuracy errors' : 'Needs a decision'}>{needOp(c, () => null)}</Card>
  if (which === 'quality') return (
    <Card title="Quality this week" sub={sub(c)} onOpen={() => c.go('report-card')} openLabel="Report Card">
      <Body s={s}>{d => (<>
        <div className="hub-big">{d.quality == null ? '—' : d.quality.toFixed(1)}<small>average, target {QUALITY_TARGET}</small></div>
        {d.quality != null && d.qualityPrior != null && <div className={d.quality >= d.qualityPrior ? 'hub-ok' : 'hub-warn'} style={{ fontSize: 13 }}>{d.quality >= d.qualityPrior ? 'Up' : 'Down'} {Math.abs(d.quality - d.qualityPrior).toFixed(1)} on the week before</div>}
      </>)}</Body>
    </Card>)
  if (which === 'errors') return (
    <Card title="Accuracy errors" sub={sub(c)} onOpen={() => c.go('report-card')} openLabel="Report Card">
      <Body s={s}>{d => (<>
        <div className="hub-stats">
          <div><div className="n">{d.errors.p1a}</div><div className="hub-sub">P1A</div></div>
          <div><div className="n">{d.errors.p1b}</div><div className="hub-sub">P1B</div></div>
          <div><div className="n">{d.errors.p2}</div><div className="hub-sub">P2</div></div>
        </div>
        <div className="hub-muted">{d.errors.total} this week, {d.errorsPrior.total} the week before</div>
      </>)}</Body>
    </Card>)
  return (
    <Card title="Needs a decision" sub={sub(c)} wide>
      <Body s={s}>{d => (<>
        <div className="hub-row"><span>Accuracy errors awaiting review</span><b>{d.pendingReviews}</b></div>
        <div className="hub-row"><span>Quality flags this week</span><b>{d.qualityFlags}</b></div>
        {bugs.data != null && bugs.data >= 0 && <div className="hub-row"><span>Open bug reports</span><b>{bugs.data}</b></div>}
      </>)}</Body>
    </Card>)
}
function OperatorsGlanceCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchOperatorPerf(c.operatorIds, 30))
  const { operators } = useOperator()
  const target: Page = canOpen(c.access, 'operators') ? 'operators' : canOpen(c.access, 'executive-summary') ? 'executive-summary' : 'analytics'
  return (
    <Card title="Operators at a glance" sub="Last 30 days" wide onOpen={() => c.go(target)} openLabel={target === 'operators' ? 'See all operators' : 'Open'}>
      <Body s={s}>{perf => {
        const rows = operators.map(o => ({ o, p: perf[o.id] })).filter(r => r.p).sort((a, b) => (b.p.tickets + b.p.fullAuto) - (a.p.tickets + a.p.fullAuto)).slice(0, 5)
        if (!rows.length) return <div className="hub-muted">No operators to show.</div>
        return (<>
          <div className="hub-row" style={{ color: '#323232', fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase' }}><span style={{ flex: 2 }}>Operator</span><span style={{ flex: 1 }}>Perfect</span><span style={{ flex: 1, textAlign: 'right' }}>Tickets</span></div>
          {rows.map(({ o, p }) => (
            <div className="hub-row" key={o.id}>
              <span style={{ flex: 2, fontWeight: 500 }}>{o.name}</span>
              <span style={{ flex: 1 }}>{p.perfectRate != null ? pct(p.perfectRate) : o.fullAutoEnabled ? 'Full Auto' : '—'}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{p.tickets + p.fullAuto}</span>
            </div>))}
        </>)
      }}</Body>
    </Card>
  )
}
function TeamTodayCard({ c }: { c: Ctx }) {
  const s = useLoad(() => (c.opId ? D.fetchTeamToday(c.opId) : Promise.resolve(null as never)))
  return (
    <Card title="Team today" sub={sub(c)} onOpen={() => c.go('submissions')} openLabel="Submissions">
      {!c.opId ? needOp(c, () => null) : <Body s={s}>{d => (<>
        <div className="hub-big">{d.tickets}<small>tickets</small></div>
        <div className="hub-muted">Logged by {plural(d.agents, 'agent')} so far today.</div>
      </>)}</Body>}
    </Card>
  )
}
function WaitingCard({ c }: { c: Ctx }) {
  const bugs = useLoad(() => (c.opId && canOpen(c.access, 'bug-tracker') ? D.fetchOpenBugs(c.opId) : Promise.resolve(-1)))
  const bul = useLoad(() => (c.role === 'admin' && canOpen(c.access, 'bulletin') ? D.fetchBulletinPostedToday() : Promise.resolve(null as unknown as boolean)))
  return (
    <Card title="Waiting on you" sub={sub(c)}>
      <Body s={{ data: bugs.data, failed: bugs.failed }}>{n => (<>
        {n >= 0 && <div className="hub-row"><span>Open bug reports</span><b>{n}</b></div>}
        {bul.data !== null && <div className="hub-row"><span>Bulletin posted today</span><b className={bul.data ? 'hub-ok' : 'hub-warn'}>{bul.data ? 'Yes' : 'Not yet'}</b></div>}
        {n < 0 && bul.data === null && <div className="hub-muted">Nothing waiting.</div>}
      </>)}</Body>
    </Card>
  )
}
function PlatformHealthCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchPlatformHealth())
  return (
    <Card title="Platform health" wide onOpen={() => c.go('settings')} openLabel="Admin settings">
      <Body s={s}>{d => (<>
        <div className="hub-row"><span>Data Health</span><span>{d.red === 0 && d.orange === 0 ? <b className="hub-ok">No issues</b> : <><b className="hub-bad">{d.red} red</b>{' '}<b className="hub-warn">{d.orange} orange</b></>}</span></div>
        <div className="hub-row"><span>Last eval run</span><span>{d.lastEval ? `${d.lastEval.pass_rate}% pass, ${fmtDate(d.lastEval.run_at.slice(0, 10))}` : 'No runs yet'}</span></div>
      </>)}</Body>
    </Card>
  )
}
function PeopleCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchPeopleSummary())
  return (
    <Card title="People and access" onOpen={() => c.go('users')} openLabel="Manage">
      <Body s={s}>{d => (<>
        <div className="hub-big">{d.users}<small>users</small></div>
        <div className="hub-muted">{plural(d.superadmins, 'SuperAdmin')}{d.customProfiles != null ? `, ${plural(d.customProfiles, 'custom profile')}` : ''}</div>
      </>)}</Body>
    </Card>
  )
}
function StrategyCards({ c, which }: { c: Ctx; which: 'kr' | 'actions' }) {
  const s = useLoad(() => D.fetchStrategy())
  return (
    <Card title={which === 'kr' ? 'Key results' : 'Actions and next ELT'} onOpen={() => c.go('strategy')} openLabel="Strategy">
      <Body s={s}>{data => {
        const plan = pickPlan(data, '')
        if (!plan) return <div className="hub-muted">No OKR period has been set up yet.</div>
        if (which === 'kr') {
          const counts = statusCounts(data, plan, null), total = allKrs(plan).length
          return (<><div className="hub-big">{counts.on + counts.done}<small>of {total} on track or done</small></div>
            <div className={counts.risk ? 'hub-warn' : 'hub-muted'} style={{ fontSize: 13 }}>{counts.risk} at risk{counts.off ? `, ${counts.off} off track` : ''}</div></>)
        }
        const open = actionList(data).filter(a => a.status === 'open')
        const next = allSessions(data, plan).filter(x => x.state !== 'saved').sort((a, b) => (a.date < b.date ? -1 : 1))[0]
        const overdue = open.filter(a => isOverdue(a)).length
        return (<><div className="hub-big">{open.length}<small>open</small></div>
          <div className={overdue ? 'hub-bad' : 'hub-muted'} style={{ fontSize: 13 }}>{overdue ? `${overdue} overdue` : 'None overdue'}</div>
          <div className="hub-muted">{next ? `Next ELT ${fmtDate(next.date)}` : 'No ELT scheduled'}</div></>)
      }}</Body>
    </Card>
  )
}
function RoadmapCard({ c }: { c: Ctx }) {
  const s = useLoad(() => D.fetchRoadmapGlance())
  return (
    <Card title="Roadmap" onOpen={() => c.go('roadmap')} openLabel="Roadmap">
      <Body s={s}>{d => (<>
        {d.sprintSummary ? <div className="hub-muted"><b style={{ color: '#000', fontWeight: 500 }}>Status this sprint. </b>{d.sprintSummary.length > 170 ? d.sprintSummary.slice(0, 167) + '…' : d.sprintSummary}</div> : <div className="hub-muted">No sprint status written yet.</div>}
        <div className="hub-row"><span>News items to discuss</span><b>{d.newsToDiscuss}</b></div>
      </>)}</Body>
    </Card>
  )
}

function FunnelCard({ c }: { c: Ctx }) {
  const s = useLoad(() => loadFunnelData())
  return (
    <Card title="Sales Funnel" sub="Last 30 days" onOpen={() => c.go('sales-funnel')} openLabel="Sales Funnel">
      <Body s={s}>{d => {
        if (!d.deals.length) return <div className="hub-muted">No deals synced yet.</div>
        const t = summarizeFunnel(d, 30)
        return (<>
          <div className="hub-big">{t.open}<small>open deals</small></div>
          <div className="hub-row"><span>Added</span><b>{t.added}</b></div>
          <div className="hub-row"><span>Went Live</span><b>{t.wentLive}</b></div>
          <div className="hub-row"><span>Lost</span><b>{t.lost}</b></div>
        </>)
      }}</Body>
    </Card>
  )
}

function renderWidget(w: WidgetDef, c: Ctx): ReactNode {
  switch (w.id) {
    case 'today': return <TodayCard c={c} />
    case 'bulletin-unread': return <BulletinUnreadCard c={c} />
    case 'training': return <TrainingCard c={c} />
    case 'my-week': return <MyWeekCard c={c} />
    case 'quality-week': return <QaCards c={c} which="quality" />
    case 'accuracy-errors': return <QaCards c={c} which="errors" />
    case 'needs-decision': return <QaCards c={c} which="decide" />
    case 'operators-glance': return <OperatorsGlanceCard c={c} />
    case 'team-today': return <TeamTodayCard c={c} />
    case 'waiting-on-you': return <WaitingCard c={c} />
    case 'platform-health': return <PlatformHealthCard c={c} />
    case 'people-access': return <PeopleCard c={c} />
    case 'kr-summary': return <StrategyCards c={c} which="kr" />
    case 'actions-next': return <StrategyCards c={c} which="actions" />
    case 'roadmap-glance': return <RoadmapCard c={c} />
    case 'funnel-glance': return <FunnelCard c={c} />
    default: return null
  }
}

export default function Home({ onNavigate }: { onNavigate: Nav }) {
  const { user } = useAuth()
  const { selectedOperator, operators } = useOperator()
  const layout = useMemo(() => user ? homeLayout({
    baseRole: user.baseRole, accessProfile: user.accessProfile, access: user.access, pageLabel: k => pageDef(k)?.label || k,
    navOrder: navPages(user.access).map(p => p.key), hasAdminSettings: canOpen(user.access, 'users') || canOpen(user.access, 'admin-settings'),
  }) : { widgets: [], quick: [] }, [user])
  if (!user) return null
  const first = (user.name || '').trim().split(/\s+/)[0]
  const ctx: Ctx = {
    email: user.email, userId: user.id, role: user.role, opId: selectedOperator?.id ?? null, opName: selectedOperator?.name ?? null, isQa: !!selectedOperator?.isQaMode,
    multiOp: operators.length > 1, operatorIds: operators.map(o => o.id), access: user.access, go: onNavigate,
  }
  return (
    <div className="hub-page">
      <PageHeader title="Home" subtitle={first ? `Welcome back, ${first}.` : undefined}
        actions={<button type="button" className="hub-btn hub-btn--sm" onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}>Search, Ctrl K</button>} />
      {layout.quick.length > 0 && (
        <div className="hub-quick" aria-label="Quick links">
          {layout.quick.map(q => <button key={q.page} type="button" className={`hub-btn${q.primary ? ' hub-btn--primary' : ''}`} onClick={() => onNavigate(q.page as Page)}>{q.label}</button>)}
        </div>
      )}
      {layout.widgets.length === 0
        ? <div className="hub-empty">Nothing to summarise here yet. Use the quick links or the menu to open a page.</div>
        : <div className="hub-grid">{layout.widgets.map(w => <div key={w.id + ':' + (selectedOperator?.id ?? '')} style={{ display: 'contents' }}>{renderWidget(w, ctx)}</div>)}</div>}
    </div>
  )
}
