import { ListChecks } from 'lucide-react'
import type { Code } from '../../lib/strategy/logic'
import {
  STATUS_CODES, STATUS_LABEL, actId, actionList, allKrs, allSessions, codeOf, dodFor, dodProg, fmtDate, isOverdue, savedSessions, statusAt, statusCounts,
} from '../../lib/strategy/logic'
import type { Ctx } from './ui'
import { StatusPill } from './ui'

const DOT: Record<Code, string> = { on: 'var(--ok)', risk: 'var(--warn)', off: 'var(--bad)', done: '#000', ns: 'rgba(0,0,0,0.25)', none: 'rgba(0,0,0,0.12)' }

export default function OverviewTab({ ctx }: { ctx: Ctx }) {
  const { data, plan, asOf } = ctx
  const saved = savedSessions(data, plan)
  const asOfSes = asOf && data.sessions[asOf] ? data.sessions[asOf] : null
  const refDate = asOfSes ? asOfSes.date : null
  const idx = saved.findIndex(s => s.date === (refDate || (saved.length ? saved[saved.length - 1].date : '')))
  const prevSes = idx > 0 ? saved[idx - 1] : null
  const counts = statusCounts(data, plan, refDate)
  const prevCounts = prevSes ? statusCounts(data, plan, prevSes.date) : null
  const total = allKrs(plan).length
  const acts = actionList(data), open = acts.filter(a => a.status === 'open'), overdue = open.filter(a => isOverdue(a))
  const prios = open.filter(a => !a.kr)
  const next = allSessions(data, plan).filter(s => s.state !== 'saved').sort((a, b) => (a.date < b.date ? -1 : 1))[0]

  const delta = (a: number, b: number | null) => {
    if (b == null || !prevSes) return saved.length ? 'First tracked ELT' : 'Updated after each ELT'
    const d = a - b
    return (d === 0 ? 'Same as ' : d > 0 ? `Up ${d} vs ` : `Down ${-d} vs `) + (prevSes.baseline ? 'baseline' : fmtDate(prevSes.date) + ' ELT')
  }
  const good = counts.on + counts.done

  return (
    <>
      <div className="st-ctl">
        <label htmlFor="st-asof">As of</label>
        <select id="st-asof" value={asOf} onChange={e => ctx.setAsOf(e.target.value)}>
          {!saved.length && <option value="">No ELTs saved yet</option>}
          {[...saved].reverse().map((s, i) => (
            <option key={s.id} value={i === 0 ? '' : s.id}>
              {(s.baseline ? 'Baseline · ' + fmtDate(s.date, true) + ' (before tracking)' : 'ELT · ' + fmtDate(s.date, true)) + (i === 0 ? ' (latest)' : '')}
            </option>
          ))}
        </select>
        <button type="button" className="rm-btn rm-btn--sm" onClick={() => { if (next) { ctx.setEltId(next.id); ctx.setEltStage('before') } ctx.goTab('elt') }}>
          {next ? 'Next ELT · ' + fmtDate(next.date) : 'Go to ELT'}
        </button>
      </div>

      {plan.state === 'draft' && (
        <div className="st-aibanner" style={{ background: 'var(--wash)', borderColor: 'var(--line-2)' }}>
          <span><b>Draft period.</b> This Strategy on a Page is not current yet. Edit it, then make it current when the OKRs are agreed.</span>
          {ctx.realCanEdit && <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => ctx.goTab('admin')}>Edit draft</button>}
        </div>
      )}
      {ctx.currentId && plan.id !== ctx.currentId && plan.state !== 'draft' && (
        <div className="st-note" role="status">You are viewing an earlier OKR period ({plan.period}).
          <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => ctx.setViewPeriod('')}>Back to current period</button></div>
      )}
      {asOfSes && (
        <div className="st-note" role="status">
          {asOfSes.baseline ? `You are looking at the baseline from ${fmtDate(asOfSes.date, true)}, before tracking started. No statuses had been set.` : `You are looking at the dashboard as it was after the ELT on ${fmtDate(asOfSes.date, true)}.`}
          <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => ctx.setAsOf('')}>Back to latest</button>
        </div>
      )}

      <div className="rm-card rm-ns">
        <div><div className="rm-lbl">North Star</div><p>{plan.northStar}</p></div>
        <div><div className="rm-lbl">Product vision</div><p className="v">{plan.vision}</p></div>
      </div>

      <div className="st-tiles">
        <Tile label={'Key results · ' + (plan.period || '')} n={total} sub={(plan.state === 'draft' ? 'Draft' : 'Locked') + ' · ' + plan.pillars.length + ' pillars'} />
        <Tile label="On track or done" n={good} sub={delta(good, prevCounts && prevCounts.on + prevCounts.done)} />
        <Tile label="At risk" n={counts.risk} sub={delta(counts.risk, prevCounts && prevCounts.risk)} />
        <Tile label="Off track · not started" n={counts.off + ' · ' + counts.ns} sub={counts.none ? counts.none + ' with no check-in yet' : 'Discussed first at each ELT'} />
        <Tile label="Open actions" n={open.length} sub={overdue.length ? <span className="st-bad">{overdue.length} overdue</span> : 'None overdue'} />
      </div>

      <div className="st-legend">
        <span className="rm-lbl">Pillars, objectives, key results</span>
        <span>{ctx.canEdit ? 'Click a key result to see its history or update its status' : 'Click a key result to see its history'}</span>
        {STATUS_CODES.map(k => <span className="k" key={k}><i className={`st-sw st-sw-${k}`} aria-hidden="true" />{STATUS_LABEL[k]}</span>)}
      </div>

      <div className="st-pgrid">
        {plan.pillars.map(p => {
          const c = { on: 0, done: 0, risk: 0, off: 0 } as Record<string, number>
          const rows = p.krs.map((k, i) => {
            const cur = statusAt(data, k.id, refDate), cc = codeOf(cur)
            if (c[cc] != null) c[cc]++
            const prev = prevSes ? statusAt(data, k.id, prevSes.date) : null
            let chg = ''
            if (cur && cur.kind === 'adhoc') chg = 'Updated between ELTs · ' + fmtDate(cur.sessionDate)
            else if (cur && prev && prev.status !== cur.status) chg = 'was ' + STATUS_LABEL[prev.status]
            else if (cur && cur.status === 'done' && cur.kind !== 'notheard' && (!prev || prev.status !== 'done')) chg = 'Done ' + fmtDate(cur.sessionDate)
            return { k, i, cc, chg }
          })
          const parts: string[] = []
          if (c.on + c.done) parts.push(c.on + c.done + ' on track')
          if (c.risk) parts.push(c.risk + ' at risk')
          if (c.off) parts.push(c.off + ' off track')
          return (
            <section className="st-pcard" key={p.id}>
              <div>
                <div className="st-phead"><h2>{p.name}</h2><span className="st-psum">{parts.join(' · ')}</span></div>
                <p className="st-obj">{p.objective}</p>
                <div className="st-owner">Owner: {p.owner}</div>
                <div className="st-bar" aria-hidden="true">{rows.map(r => <span key={r.k.id} style={{ background: DOT[r.cc] }} />)}</div>
              </div>
              <div>
                {rows.map(r => {
                  const d = dodFor(data, r.k.id), pr = d ? dodProg(d) : null
                  return (
                    <button type="button" key={r.k.id} className="st-krrow" onClick={() => ctx.openKr(r.k.id)}
                      aria-label={`${p.short} KR${r.i + 1}: ${r.k.text}. ${STATUS_LABEL[r.cc]}. Open check-in history`}>
                      <span className="n">{r.i + 1}.</span>
                      <span>{r.k.text}{r.chg && <span className="st-chg">{r.chg}</span>}
                        {d && pr && <span className={`st-dod${d.state === 'agreed' ? ' agreed' : ''}`}><ListChecks size={12} strokeWidth={1.5} />Done when · {pr.done}/{pr.total}{d.state === 'agreed' ? '' : ' · draft'}</span>}
                      </span>
                      <StatusPill code={r.cc} />
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <section className="rm-card" aria-label="Business priorities outside the OKRs" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 24px' }}>
        <div className="st-row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 15 }}>Business priorities outside the OKRs</h2>
          <button type="button" className="st-linkbtn" onClick={() => { ctx.setAf({ status: 'open', owner: '', scope: 'prio' }); ctx.goTab('actions') }}>{prios.length} open · view in Actions</button>
        </div>
        {prios.length ? (
          <div className="st-prio">
            {prios.map(a => {
              const ag = data.sessions[a.agreedAt], lu = (a.updates || []).slice(-1)[0]
              return (
                <div key={a.id}>
                  <span className={isOverdue(a) ? 'st-bad' : 'st-sm-t'} style={{ fontSize: 12 }}>{actId(a)}{isOverdue(a) ? ' · Overdue · ' + fmtDate(a.due) : ag ? ' · raised at ELT ' + fmtDate(ag.date) : ''}</span>
                  <span>{a.text}</span>
                  <span className="st-faint">{(a.owner || 'No owner') + (a.due ? ' · due ' + fmtDate(a.due) : '')}</span>
                  {lu && <span className="st-sm-t">{fmtDate(lu.date)}: {lu.text}</span>}
                </div>
              )
            })}
          </div>
        ) : <span className="st-sm-t" style={{ fontSize: 13 }}>None open. Actions agreed at an ELT that do not belong to a key result appear here.</span>}
      </section>
    </>
  )
}

const Tile = ({ label, n, sub }: { label: string; n: React.ReactNode; sub: React.ReactNode }) =>
  <div className="st-tile"><div className="rm-lbl">{label}</div><div className="n">{n}</div><div className="s">{sub}</div></div>
