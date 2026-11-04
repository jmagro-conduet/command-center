import { useState } from 'react'
import type { Proj } from '../../lib/roadmap/logic'
import { TEAMS, TEAM_ORDER, TRACKS, WORST, carried, fmt, prevQid, qLabelOf, stageOf, swatch } from '../../lib/roadmap/logic'
import type { Ctx } from './ui'
import { StatusChip } from './ui'
import { boardProjects } from './helpers'

type ColKey = 'now' | 'next' | 'planned' | 'done' | 'canceled'
const COLS: [ColKey, string][] = [['now', 'In progress'], ['next', 'Next'], ['planned', 'Planned'], ['done', 'Completed'], ['canceled', 'Cancelled (T3)']]
const CAP = 5

function NextMilestone({ p }: { p: Proj }) {
  const ms = p.milestones || []; if (!ms.length) return null
  const n = ms.find((m: any) => (+m.progress || 0) < 100), done = ms.filter((m: any) => (+m.progress || 0) >= 100).length
  return <span className="rm-kc-ms">{n ? <>Next milestone: <b>{n.name}</b>{n.target ? ' · ' + fmt(n.target) : ''}</> : 'All milestones done'} · {done} of {ms.length}</span>
}

export default function BoardTab({ ctx }: { ctx: Ctx }) {
  const { C, q, boardChunk: cur } = ctx
  const [shutOpen, setShutOpen] = useState<{ done: boolean; canceled: boolean }>({ done: false, canceled: false })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expand = (k: string) => setExpanded(s => new Set(s).add(k))
  const cname = Object.fromEntries(C.map(c => [c.id, c.name]))
  let ps = boardProjects(ctx.P, q)
  if (cur) ps = ps.filter(p => p.chunk === cur)
  const isShut = (k: ColKey) => (k === 'done' || k === 'canceled') && !shutOpen[k]
  const inCol = (k: ColKey, p: Proj) => stageOf(p) === k
  const lanes = TEAM_ORDER.filter(t => t !== 'none' || ps.some(p => p.team === t))
  const widths = COLS.map(([k]) => isShut(k) ? 88 : 272)
  const prev = qLabelOf(prevQid(q.today))

  const card = (p: Proj) => {
    const tot = (+p.done || 0) + (+p.open || 0), pct = tot ? Math.round((+p.done || 0) / tot * 100) : 0
    const closedOut = p.status === 'done' || p.status === 'canceled'
    const dates = p.status === 'canceled' ? 'Cancelled ' + fmt(p.canceledAt) : p.status === 'done' ? 'Closed ' + fmt(p.completedAt)
      : p.target ? 'Target ' + fmt(p.target) : p.start ? 'Started ' + fmt(p.start) + ' · no target' : 'Not dated'
    const faded = ['close', 'stale'].includes(p.status) && stageOf(p) === 'now'
    return (
      <button key={p.id} type="button" className={`rm-kc ${closedOut ? 'done' : ''} ${faded ? 'faded' : ''}`} onClick={() => ctx.open({ kind: 'project', id: p.id })}>
        <span className="rm-kc-c"><i className={p.trackFrom !== 'linear' ? 'sug' : ''} style={{ background: swatch(p.track) }} />
          {p.status === 'canceled' && TRACKS[p.track] ? TRACKS[p.track].t + ' ' + TRACKS[p.track].n : cname[p.chunk] || 'Other work'}</span>
        <span className="rm-kc-t">{p.name}</span>
        {!closedOut ? <>
          <span className="rm-kc-r">
            <StatusChip s={p.status} />
            {+p.blocked ? <span className="rm-chip blk">{+p.blocked} blocked</span> : null}
            {carried(p, q) ? <span className="rm-chip plain">From {prev}</span> : null}
            <span>{dates}</span>
          </span>
          {tot && p.kind !== 'bucket' ? <div className="rm-kbar" aria-label={`${pct}% of issues closed`}><i style={{ width: pct + '%' }} /><span>{+p.done || 0} of {tot} issues closed</span></div> : null}
          <NextMilestone p={p} />
        </> : <span className="rm-kc-r">{dates}</span>}
      </button>
    )
  }

  return (
    <div className="rm-sec">
      <div className="rm-sec-head">
        <div><h2>Board</h2><p>Every Linear project this quarter, by delivery team and stage. Next is Planned in Linear; Planned is the Linear backlog. Cancelled shows Gaming Ops (T3) projects only, since POCs are the main goal. Each card shows which piece of work it belongs to.</p></div>
        <label className="rm-bfilter">Show
          <select value={cur} onChange={e => ctx.setBoardChunk(e.target.value)}>
            <option value="">All work</option>
            {C.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="rm-legend">
        {Object.values(TRACKS).map(t => <span key={t.t}><i style={{ background: t.c }} />{t.t} {t.n}</span>)}
        <span><i style={{ background: TRACKS.core.c, opacity: 0.5 }} />Lighter dot: track not labelled in Linear yet</span>
      </div>
      <div className="rm-scroll">
        <div className="rm-kb" style={{ gridTemplateColumns: '120px ' + widths.map(w => w === 88 ? '88px' : 'minmax(272px, 1fr)').join(' '), minWidth: 120 + widths.reduce((a, b) => a + b, 0) }}>
          <div className="rm-h">Team</div>
          {COLS.map(([k, l]) => {
            const n = ps.filter(p => inCol(k, p)).length
            if (k === 'done' || k === 'canceled') {
              const shut = isShut(k)
              return <div key={k} className="rm-h"><button type="button" className="rm-colt" aria-expanded={!shut} title={`${shut ? 'Show' : 'Hide'} ${l}`}
                onClick={() => setShutOpen(s => ({ ...s, [k]: !s[k] }))}><span>{shut ? (k === 'done' ? 'Done' : 'Cancelled') : l}</span><span>{n} {shut ? '›' : '‹'}</span></button></div>
            }
            return <div key={k} className="rm-h"><span>{l}</span><span>{n}</span></div>
          })}
          {lanes.map(team => {
            const mine = ps.filter(p => p.team === team)
            return [
              <div key={team + 'l'} className="rm-lane"><b>{TEAMS[team]}</b><span>{mine.filter(p => stageOf(p) === 'now').length} in progress</span></div>,
              ...COLS.map(([k]) => {
                const list = mine.filter(p => inCol(k, p)).sort((a, b) =>
                  k === 'done' ? String(b.completedAt).localeCompare(String(a.completedAt))
                    : k === 'canceled' ? String(b.canceledAt).localeCompare(String(a.canceledAt))
                      : WORST.indexOf(a.status) - WORST.indexOf(b.status) || String(a.target || '9').localeCompare(String(b.target || '9')))
                if (isShut(k)) {
                  return <div key={team + k} className="rm-kcol shut" data-col={k}>
                    {list.length
                      ? <button type="button" className="rm-kcount" title={`Show ${list.length}`} onClick={() => setShutOpen(s => ({ ...s, [k]: true }))}>{list.length}</button>
                      : <span className="rm-kempty">–</span>}
                  </div>
                }
                let main = list, tidy: Proj[] = []
                if (k === 'now') { tidy = list.filter(p => ['close', 'stale'].includes(p.status)); main = list.filter(p => !tidy.includes(p)) }
                const moreKey = `${team}-${k}`, tidyKey = `${team}-${k}-tidy`
                const showAll = expanded.has(moreKey), showTidy = expanded.has(tidyKey)
                return (
                  <div key={team + k} className="rm-kcol" data-col={k}>
                    {(showAll ? main : main.slice(0, CAP)).map(card)}
                    {!showAll && main.length > CAP && <button type="button" className="rm-kmore" onClick={() => expand(moreKey)}>+{main.length - CAP} more</button>}
                    {tidy.length > 0 && (showTidy
                      ? <><button type="button" className="rm-kgrp" disabled>{tidy.length} to wrap up in Linear</button>{tidy.map(card)}</>
                      : <button type="button" className="rm-kgrp" aria-expanded="false" onClick={() => expand(tidyKey)}>{tidy.length} to wrap up in Linear ›</button>)}
                    {!list.length && <span className="rm-kempty">–</span>}
                  </div>
                )
              }),
            ]
          })}
          {!lanes.length && <div className="rm-state" style={{ gridColumn: '1/-1' }}>No projects for this piece of work this quarter.</div>}
        </div>
      </div>
    </div>
  )
}
