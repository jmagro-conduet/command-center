import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'
import type { Operator } from '../context/OperatorContext'
import { canOpen } from '../lib/access/core'
import { fetchOperatorPerf } from '../lib/home/data'
import type { OpPerf } from '../lib/home/data'
import { pct } from '../lib/home/metrics'
import PageHeader from '../components/PageHeader'
import type { Page } from '../components/layout/Sidebar'
import './home.css'

// Operators: performance across every operator the person can already access, at a glance.
// It does not widen anyone's access: the list is exactly the operators the sidebar switcher offers
// (an agent on BetSaracen sees BetSaracen only, unless an admin has granted more). Picking a row
// selects that operator, then opens its detailed pages. This page is off by default and is turned on
// per access profile in Admin settings, Roles & access.

const LANDING: Page[] = ['analytics', 'executive-summary', 'report-card', 'submissions']
const modeOf = (o: Operator) => (o.fullAutoEnabled && o.copilotEnabled ? 'CoPilot and Full Auto' : o.fullAutoEnabled ? 'Full Auto' : 'CoPilot')

function Table({ days, onOpen }: { days: number; onOpen: (o: Operator) => void }) {
  const { operators } = useOperator()
  const [state, setState] = useState<{ perf: Record<string, OpPerf> | null; failed: boolean }>({ perf: null, failed: false })
  const ids = operators.map(o => o.id).join(',')
  useEffect(() => {
    let off = false
    fetchOperatorPerf(ids ? ids.split(',') : [], days)
      .then(p => { if (!off) setState({ perf: p, failed: false }) })
      .catch(e => { console.error('[operators] load failed', e); if (!off) setState({ perf: null, failed: true }) })
    return () => { off = true }
  }, [ids, days])

  if (state.failed) return <div className="hub-empty">Couldn't load operator performance. Try again in a moment.</div>
  if (!state.perf) return <div className="hub-empty">Loading…</div>
  const perf = state.perf
  const rows = [...operators].map(o => ({ o, p: perf[o.id] })).sort((a, b) => ((b.p?.tickets ?? 0) + (b.p?.fullAuto ?? 0)) - ((a.p?.tickets ?? 0) + (a.p?.fullAuto ?? 0)))
  if (!rows.length) return <div className="hub-empty">You don't have access to any operators yet.</div>
  return (
    <div className="hub-card" style={{ padding: 8 }}>
      <div className="hub-tablewrap">
        <table className="hub-table">
          <thead><tr><th scope="col">Operator</th><th scope="col">Mode</th><th scope="col">Tickets</th><th scope="col">Perfect</th><th scope="col">Edited</th><th scope="col">Quality</th></tr></thead>
          <tbody>
            {rows.map(({ o, p }) => {
              const total = (p?.tickets ?? 0) + (p?.fullAuto ?? 0)
              return (
                <tr key={o.id} tabIndex={0} onClick={() => onOpen(o)} onKeyDown={e => { if (e.key === 'Enter') onOpen(o) }} aria-label={`Open ${o.name}`}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td>{total === 0 ? <span className="hub-pill hub-pill--grey">No tickets</span> : <span className="hub-pill">{modeOf(o)}</span>}</td>
                  <td>{total || '—'}</td>
                  <td>{p && p.perfectRate != null ? pct(p.perfectRate) : o.fullAutoEnabled && !o.copilotEnabled ? <span className="hub-sub">n/a</span> : '—'}</td>
                  <td>{p && p.editedRate != null ? pct(p.editedRate) : '—'}</td>
                  <td>{p && p.avgQuality != null ? p.avgQuality.toFixed(1) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Operators({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { user } = useAuth()
  const { setSelectedOperator } = useOperator()
  const [days, setDays] = useState(30)
  const open = (o: Operator) => {
    setSelectedOperator(o)
    const target = LANDING.find(p => canOpen(user?.access, p))
    if (target) onNavigate(target)
  }
  return (
    <div className="hub-page">
      <PageHeader crumb="Dashboards" title="Operators" subtitle="Performance across the operators you can access. Select one to open its detailed pages."
        actions={<div className="hub-seg" role="group" aria-label="Period">
          <button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>Last 30 days</button>
          <button type="button" aria-pressed={days === 7} onClick={() => setDays(7)}>Last 7 days</button>
        </div>} />
      <Table key={days} days={days} onOpen={open} />
      <p className="hub-sub" style={{ margin: '0 4px' }}>Perfect is the share of graded responses sent with no edits, the same measure as Analytics. Full Auto operators are counted by tickets only. Quality is the average quality score on evaluated responses.</p>
    </div>
  )
}
