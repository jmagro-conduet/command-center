import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFunnel } from '../lib/funnel/useFunnel'
import { buildView, money, toCsv, MIN_CLOSED_FOR_RATE } from '../lib/funnel/logic'
import type { FunnelView, Period } from '../lib/funnel/logic'
import { pageAccessFor } from '../lib/pageAccess'
import PageHeader, { Tag } from '../components/PageHeader'
import type { Page } from '../components/layout/Sidebar'
import './home.css'
import './funnel.css'

// Sales Funnel: Pipedrive deals by funnel step. The data is a copy kept fresh by the pipedrive-sync edge
// function; every number here is computed in lib/funnel/logic.ts (pure, tested). Deal values are shown to
// everyone who can open this page, so access to the page is access to the values.

const PERIODS: { p: Period; label: string; long: string }[] = [
  { p: 30, label: '30 days', long: 'the last 30 days' },
  { p: 90, label: '90 days', long: 'the last 90 days' },
  { p: 0, label: 'All time', long: 'all time' },
]
const STALE_HOURS = 30

const fmtDay = (s: string | null | undefined) => {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (y !== new Date().getFullYear() ? ' ' + y : '')
}
const ago = (iso: string | undefined, now: Date) => {
  if (!iso) return 'never'
  const h = Math.round((now.getTime() - new Date(iso).getTime()) / 36e5)
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} days ago`
}
const pct = (n: number | null) => (n === null ? '—' : n + '%')

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="fn-kpi"><span className="l">{label}</span><span className="v">{value}</span>{sub && <span className="s">{sub}</span>}</div>
}

function Kpis({ v, plabel }: { v: FunnelView; plabel: string }) {
  const k = v.kpi, r = k.rate
  const small = r && r.winRate === null ? `${r.won} of ${r.closed} closed (needs ${MIN_CLOSED_FOR_RATE}+)` : undefined
  return (
    <div className="fn-kpis">
      <Kpi label="Open deals" value={k.open} sub={v.preOpen ? `${v.preOpen} still in ${v.preName}` : undefined} />
      <Kpi label="Open value" value={k.openValue === null ? '—' : money(k.openValue)} />
      <Kpi label="No next action" value={k.noNext} sub="open deals with nothing scheduled" />
      <Kpi label="Added" value={k.added} sub={plabel} />
      <Kpi label="Moved stage" value={k.moved} sub={plabel} />
      <Kpi label="Went Live" value={k.wentLive === null ? '—' : k.wentLive} sub={plabel} />
      <Kpi label="Lost" value={k.lost} sub={plabel} />
      <Kpi label="Win rate" value={r ? pct(r.winRate) : '—'} sub={r ? small || `${r.won} Live, ${r.lost} lost` : 'no Live step'} />
      <Kpi label="Lost rate" value={r ? pct(r.lostRate) : '—'} sub={r ? small || `${r.lost} of ${r.closed} closed` : undefined} />
      <Kpi label="Avg days to Live" value={k.avgDaysToLive === null ? '—' : k.avgDaysToLive} sub="from added to Live" />
    </div>
  )
}

export default function SalesFunnel({ onNavigate }: { onNavigate?: (p: Page) => void }) {
  void onNavigate
  const { user } = useAuth()
  const access = pageAccessFor(user, 'sales-funnel')
  const { load, loadError, data, now } = useFunnel()
  const [pipe, setPipe] = useState('')
  const [period, setPeriod] = useState<Period>(30)
  const [showAll, setShowAll] = useState(false)

  const pipelines = data.config?.pipelines || []
  const key = pipelines.some(p => p.key === pipe) ? pipe : pipelines[0]?.key || ''
  const v = useMemo(() => (key ? buildView(data, key, period, now) : null), [data, key, period, now])
  const plabel = PERIODS.find(x => x.p === period)?.long || ''

  if (!access.allowed) return <div className="hub-page"><PageHeader title="Sales Funnel" /><div className="hub-empty">You do not have access to this page.</div></div>
  if (load === 'loading') return <div className="hub-page"><PageHeader title="Sales Funnel" /><div className="hub-muted">Loading…</div></div>
  if (load === 'not_ready') return <div className="hub-page"><PageHeader title="Sales Funnel" /><div className="hub-empty">The Sales Funnel has not been set up in the database yet.</div></div>
  if (load === 'denied') return <div className="hub-page"><PageHeader title="Sales Funnel" /><div className="hub-empty">The database did not allow access to the Sales Funnel for your account.</div></div>
  if (load === 'error') return <div className="hub-page"><PageHeader title="Sales Funnel" /><div className="hub-empty">Could not load the Sales Funnel. {loadError}</div></div>

  const sync = data.sync
  const hours = sync?.lastGoodAt ? (now.getTime() - new Date(sync.lastGoodAt).getTime()) / 36e5 : Infinity
  const empty = !data.deals.length

  function download() {
    if (!v || !data.config) return
    const blob = new Blob([toCsv(v, data.config)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `sales-funnel-${v.pipeline.key}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const rows = v ? (showAll ? v.rows : v.rows.slice(0, 25)) : []
  const maxReach = v ? Math.max(1, ...v.reach) : 1

  return (
    <div className="hub-page">
      <PageHeader title="Sales Funnel" tags={<Tag>Pipedrive</Tag>}
        subtitle={sync?.lastGoodAt ? `Updated ${ago(sync.lastGoodAt, now)}.` : 'Not synced yet.'}
        actions={<>
          <div className="hub-seg" role="group" aria-label="Period">
            {PERIODS.map(x => <button key={x.p} type="button" aria-pressed={period === x.p} onClick={() => setPeriod(x.p)}>{x.label}</button>)}
          </div>
          <button type="button" className="hub-btn hub-btn--sm" onClick={download} disabled={!v}>Export CSV</button>
        </>} />

      {sync && !sync.ok && <div className="fn-banner fn-banner--warn" role="alert">The last sync failed{sync.error ? `: ${sync.error}` : ''}. These figures are from {ago(sync.lastGoodAt, now)}.</div>}
      {sync && sync.ok && hours > STALE_HOURS && <div className="fn-banner fn-banner--warn" role="alert">This data has not refreshed for {Math.round(hours)} hours. Check that the Pipedrive sync is still scheduled.</div>}
      {!!v && v.historyMissing > 0 && <div className="fn-banner">Stage history is still loading for {v.historyMissing} deal{v.historyMissing === 1 ? '' : 's'}. Their funnel steps are estimated from the current stage until it arrives.</div>}

      {empty
        ? <div className="hub-empty">No deals yet. Once Pipedrive has synced, they appear here.</div>
        : <>
          {pipelines.length > 1 && (
            <div className="hub-seg" role="group" aria-label="Pipeline" style={{ alignSelf: 'flex-start' }}>
              {pipelines.map(p => <button key={p.key} type="button" aria-pressed={key === p.key} onClick={() => setPipe(p.key)}>{p.label || p.name}</button>)}
            </div>
          )}
          {v && <Kpis v={v} plabel={plabel} />}

          {v && (
            <section className="hub-card" aria-label="Funnel">
              <div className="hub-card-head"><div><h2>Funnel</h2><div className="hub-sub">{v.pipeline.name}</div></div></div>
              <div className="fn-steps">
                <div className="fn-step head"><span>Step</span><span /><span className="n">Reached</span><span className="n">Entered</span><span className="n">In stage</span><span className="n">Onward</span></div>
                {v.pipeline.steps.map((s, i) => (
                  <div className="fn-step" key={s.name}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                    <div className="fn-track" aria-hidden="true"><span style={{ width: Math.round(v.reach[i] / maxReach * 100) + '%' }} /></div>
                    <span className="n">{s.stages.length ? v.reach[i] : '—'}</span>
                    <span className="n">{s.stages.length ? v.entered[i] : '—'}</span>
                    <span className="n">{s.stages.length ? v.now[i] : '—'}</span>
                    <span className="n">{pct(v.conv[i])}</span>
                  </div>
                ))}
              </div>
              <div className="fn-note"><b>Reached</b> counts every deal that has ever got to that step or beyond. <b>Entered</b> is the deals that moved into the step during {plabel}. <b>In stage</b> is open deals sitting there now. <b>Onward</b> is, of the deals that reached the step (all time), how many went on to the next one.</div>
            </section>
          )}

          {v && (
            <section className="hub-card" aria-label="Movements">
              <div className="hub-card-head"><div><h2>Movements</h2><div className="hub-sub">{v.movements.length} in {plabel}</div></div></div>
              {v.movements.length === 0
                ? <div className="hub-muted">Nothing moved in {plabel}.</div>
                : v.movements.slice(0, 15).map(m => (
                  <div className="fn-mv" key={m.deal.id + m.kind}>
                    <span className="d">{fmtDay(m.date)}</span>
                    <span><b style={{ fontWeight: 500 }}>{m.deal.title}</b> <span className="hub-muted">{m.kind === 'lost' ? (m.deal.lost ? `lost: ${m.deal.lost}` : 'lost') : `now ${m.stageName}`}</span></span>
                    <span className={`fn-tag fn-tag--${m.kind}`}>{m.kind === 'new' ? 'New' : m.kind === 'moved' ? 'Moved' : 'Lost'}</span>
                  </div>))}
              {v.movements.length > 15 && <div className="hub-sub">and {v.movements.length - 15} more in the CSV export.</div>}
            </section>
          )}

          {v && (
            <section className="hub-card" aria-label="Deals">
              <div className="hub-card-head"><div><h2>Deals</h2><div className="hub-sub">{v.rows.length} shown{v.hidden ? `, ${v.hidden} hidden by configuration` : ''}</div></div></div>
              <div className="hub-tablewrap">
                <table className="hub-table fn-table">
                  <thead><tr><th>Deal</th><th>Owner</th><th>Step</th><th className="num">Value</th><th className="num">Days in stage</th><th>Next action</th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.deal.id}>
                        <td style={{ fontWeight: 500 }}>{r.deal.title}</td>
                        <td>{r.ownerName || '—'}</td>
                        <td><span className={`hub-pill${r.deal.status === 'lost' ? ' hub-pill--grey' : ''}`}>{r.stepName}</span></td>
                        <td className="num">{money(r.deal.value, r.deal.cur)}</td>
                        <td className="num">{r.daysInStage ?? '—'}</td>
                        <td>{r.deal.status === 'lost' ? <span className="hub-muted">{r.deal.lost || 'Lost'}</span>
                          : r.next ? <span className={r.nextOverdue ? 'fn-over' : undefined}>{r.next.subject || r.next.type}{r.next.due ? `, ${fmtDay(r.next.due)}` : ''}{r.nextOverdue ? ' (overdue)' : ''}</span>
                          : <span className="hub-warn">None scheduled</span>}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              {v.rows.length > 25 && <button type="button" className="hub-link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(s => !s)}>{showAll ? 'Show fewer' : `Show all ${v.rows.length}`}</button>}
            </section>
          )}

          <div className="fn-note">
            Win rate is deals that went Live divided by deals that went Live or were lost in the period; it is shown once at least {MIN_CLOSED_FOR_RATE} deals have closed. Pipedrive keeps Live deals open, so "went Live" means the deal reached the final step, not a Pipedrive "won" status. A lost deal appears only if it became lost within the period, so long-cancelled deals drop out of the 30 day view.
          </div>
        </>}
    </div>
  )
}
