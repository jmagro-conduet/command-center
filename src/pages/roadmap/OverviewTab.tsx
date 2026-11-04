import { useState } from 'react'
import type { Chunk, Doc, Quarter } from '../../lib/roadmap/logic'
import {
  D, DAY, KRSTATUS, STATUS, TRACKS, NO_TRACK, doneThisQ, fmt, fmtDT, safeUrl, stageOf, swatch, xPct, qLabelOf,
} from '../../lib/roadmap/logic'
import type { Ctx } from './ui'
import { StatusChip } from './ui'
import { saveErr } from './helpers'

const FLIGHT = ['on', 'risk', 'off', 'nodate', 'close', 'stale']
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function TimeGrid({ q }: { q: Quarter }) {
  const months: Date[] = []
  for (let m = new Date(q.qStart); m < q.qEnd; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(new Date(m))
  return <>
    {months.map(m => <span key={m.getTime()} className="gl" style={{ left: xPct(q, m) + '%' }} />)}
    <span className="nowl" style={{ left: xPct(q, q.today) + '%' }} />
  </>
}

function TimeHead({ q }: { q: Quarter }) {
  const months: Date[] = []
  for (let m = new Date(q.qStart); m < q.qEnd; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(new Date(m))
  return <>
    {months.map(m => <span key={m.getTime()} className="rm-mon" style={{ left: xPct(q, m) + '%' }}>{m.toLocaleDateString(undefined, { month: 'long' })}</span>)}
    <span className="rm-todaytag" style={{ left: xPct(q, q.today) + '%' }}>Today</span>
  </>
}

function ChunkBar({ c, ctx }: { c: Chunk; ctx: Ctx }) {
  const { q, v } = ctx
  const open = () => ctx.open({ kind: 'chunk', id: c.id })
  const tx = xPct(q, q.today)
  if (c.status === 'planned') {
    const e = c.target ? Math.min(100, xPct(q, new Date(D(c.target)!.getTime() + DAY))) : 99
    return <button type="button" className="rm-gbar next" onClick={open} style={{ left: tx + '%', width: Math.max(8, e - tx) + '%' }}>
      <span className="bl">{c.target ? 'Not started · target ' + fmt(c.target) : 'Up next · not scheduled yet'}</span>
    </button>
  }
  if (c.status === 'ongoing') {
    const lo = v.sync && v.sync.lightsOn
    return <button type="button" className="rm-gbar ongoing" onClick={open} style={{ left: 0, width: '100%' }}>
      <span className="bl">Ongoing all quarter · {c.id === 'c-klo' && lo ? `${lo.bugOpen || 0} open bugs · ${lo.techDebtOpen || 0} tech debt` : c.live.reduce((t, p) => t + (+p.open || 0), 0) + ' open issues'}</span>
    </button>
  }
  if (!c.start && !c.target) {
    const k = c.real.find(p => p.status === c.status)
    return <span className="rm-gnote">{c.status === 'stale' && k ? `Target was ${fmt(k.target)}. Needs a new date in Linear.` : 'No dates in Linear yet.'}</span>
  }
  const s = D(c.start) || q.qStart, isOpen = !c.target
  const e = c.target ? new Date(D(c.target)!.getTime() + DAY) : new Date(Math.max(q.today.getTime() + 3 * DAY, s.getTime() + 7 * DAY))
  const l = xPct(q, s), w = Math.max(1.5, xPct(q, e) - l), t = TRACKS[c.track] || { c: NO_TRACK, ink: '#141414' }
  const tot = c.done + c.open, prog = tot ? c.done / tot * 100 : 0
  const txt = `${c.target ? 'Target ' + fmt(c.target) : 'No target date'}${tot ? ' · ' + Math.round(prog) + '% of issues closed' : ''}`
  return <button type="button" className={`rm-gbar ${isOpen ? 'open' : ''} ${w < 26 ? 'narrow' : ''}`} onClick={open}
    title={`${c.name}: ${STATUS[c.status]}. ${txt}. The darker part of the bar shows issues closed.`} aria-label={`${c.name}: ${STATUS[c.status]}. ${txt}`}
    style={{ left: l + '%', width: w + '%', backgroundColor: t.c, color: t.ink }}>
    <span className="pg" style={{ width: prog + '%' }} />
    <span className={`rm-mk ${c.status}`} style={t.ink === '#FFFFFF' ? { filter: 'invert(1)' } : undefined} />
    <span className="bl">{txt}</span>
  </button>
}

function Effort({ ctx }: { ctx: Ctx }) {
  const { P, q, v } = ctx
  const tot: Record<string, number> = {}; let sum = 0, sugN = 0
  P.forEach(p => { const k = +p.done || 0; if (!k) return; const t = p.track || 'none'; tot[t] = (tot[t] || 0) + k; sum += k; if (p.trackFrom !== 'linear') sugN += k })
  const np = (v.sync && +v.sync.noProjectDoneQ4) || 0
  if (np) { tot.none = (tot.none || 0) + np; sum += np }
  const keys = [...Object.keys(TRACKS), 'none'].filter(k => tot[k])
  const nm = (k: string) => k === 'none' ? 'Not in a project' : TRACKS[k].n
  const col = (k: string) => k === 'none' ? NO_TRACK : TRACKS[k].c
  return (
    <div className="rm-card rm-card--tight">
      <div className="rm-lbl">Where the effort went this quarter</div>
      <div className="rm-ebar" role="img" aria-label="Share of issues closed this quarter by track">
        {keys.map(k => <span key={k} style={{ width: tot[k] / sum * 100 + '%', background: col(k) }} title={`${nm(k)}: ${tot[k]}`} />)}
      </div>
      <div className="rm-elegend">{keys.map(k => <span key={k}><i style={{ background: col(k) }} />{nm(k)} <b>{Math.round(tot[k] / sum * 100)}%</b></span>)}</div>
      <div className="rm-src">{sum ? `Share of the ${sum} Linear issues closed since ${shortDate(q.qStart)}. ${Math.round(sugN / sum * 100)}% of them sit in projects with a suggested track, so this shifts as projects get labelled.` : ''}</div>
    </div>
  )
}

function Gantt({ ctx }: { ctx: Ctx }) {
  const { C, q } = ctx
  const show = C.filter(c => c.status !== 'done')
  const fin = C.filter(c => c.status === 'done' && c.kids.some(p => doneThisQ(p, q)))
  const finProj = C.reduce((t, c) => t + c.doneQ, 0)
  return (
    <div className="rm-sec">
      <div className="rm-sec-head">
        <div><h2>What we're working on</h2><p>The big pieces of work this quarter. Select one to see what it means, its status and the projects inside it, or open the Board for every project by team.</p></div>
        <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => ctx.goTab('board')}>Open the Board</button>
      </div>
      <div className="rm-legend">
        {Object.values(TRACKS).map(t => <span key={t.t}><i style={{ background: t.c }} />{t.t} {t.n}</span>)}
        <span><i style={{ background: '#fff', border: '1.5px dashed rgba(0,0,0,0.25)' }} />Up next, not dated</span>
        <span><i style={{ background: '#000', width: 2, height: 14, opacity: 0.4 }} />Today</span>
        <span><i className="msl" />Milestone</span>
      </div>
      <div className="rm-scroll">
        <div className="rm-gantt">
          <div className="rm-h">Goal</div>
          <div className="rm-h tl"><TimeHead q={q} /></div>
          {show.length === 0 && <div className="rm-state" style={{ gridColumn: '1/-1' }}>Nothing in flight this quarter.</div>}
          {show.map(c => {
            const msl = (c.milestones || []).filter(m => m.target && D(m.target)! >= q.qStart && D(m.target)! < q.qEnd)
            return [
              <button key={c.id + 'k'} type="button" className={`rm-ck ${c.depth ? 'sub' : ''}`} onClick={() => ctx.open({ kind: 'chunk', id: c.id })}>
                <span className="rm-ck-n"><i style={{ background: swatch(c.track) }} /><span className="rm-ck-t">{c.name}</span>
                  <span className={`rm-sdot rm-sd-${c.status}`} title={STATUS[c.status]} aria-label={STATUS[c.status]} /></span>
              </button>,
              <div key={c.id + 'g'} className="rm-gcell">
                <TimeGrid q={q} />
                <ChunkBar c={c} ctx={ctx} />
                {msl.map((m, i) => <span key={i} className={`rm-msd ${(+(m.progress || 0)) >= 100 ? 'done' : ''}`} style={{ left: xPct(q, D(m.target)!) + '%' }}
                  title={`${m.name} · ${fmt(m.target)} · ${+(m.progress || 0)}%`} />)}
              </div>,
            ]
          })}
        </div>
      </div>
      <div className="rm-finished">
        <span className="rm-lbl">Finished this quarter</span>
        {fin.map(c => <button key={c.id} type="button" className="rm-lk" onClick={() => ctx.open({ kind: 'chunk', id: c.id })}>{c.name}</button>)}
        <span>{finProj} Linear projects closed since {shortDate(q.qStart)}, listed on the Board.</span>
      </div>
    </div>
  )
}

function SprintStatus({ ctx }: { ctx: Ctx }) {
  const { C, v } = ctx
  const live = C.filter(c => FLIGHT.includes(c.status))
  const n = (k: string) => live.filter(c => c.status === k).length
  const unclear = n('nodate') + n('close') + n('stale')
  const parts: React.ReactNode[] = []
  if (n('on')) parts.push(<b key="on">{n('on')} on track</b>)
  if (n('risk')) parts.push(<b key="risk">{n('risk')} at risk</b>)
  if (n('off')) parts.push(<b key="off">{n('off')} off track</b>)
  if (unclear) parts.push(<span key="u">{unclear} can't be judged until Linear is updated</span>)
  const sd = v.sprint || ({} as Doc)
  const pick = ((sd.focus || []) as string[]).map(id => C.find(c => c.id === id)).filter(Boolean) as Chunk[]
  const act = pick.length ? pick : live.slice().sort((a, b) => (b.inProgress * 3 + b.done) - (a.inProgress * 3 + a.done)).slice(0, 3)
  const sp = v.sync && v.sync.spinach, cy = v.sync && v.sync.cycle
  const ks = sp && D(sp.date)
  const dates = sd.start
    ? `Sprint ${fmt(sd.start)} to ${fmt(sd.end) || '?'}.` + (cy ? ` Cycle ${cy.number} in Linear: ${cy.done} of ${cy.issues} issues done.` : '')
    : cy ? `Cycle ${cy.number}, ${fmt(cy.start)} to ${fmt(cy.end)}. ${cy.done} of ${cy.issues} issues done so far.`
      : ks && !isNaN(ks.getTime()) ? `Sprint kicked off ${fmt(sp.date)}, runs to ${shortDate(new Date(ks.getTime() + 13 * DAY))}.` : ''
  const src = (pick.length || sd.summary)
    ? `Focus and summary set by hand${sd.updatedAt ? ' on ' + fmt(sd.updatedAt) : ''}. Statuses still come from Linear unless a piece of work is set by hand.`
    : sp
      ? (sp.hasSummary && sp.tldr
        ? `From the ${fmt(sp.date)} sprint planning (Spinach): ${sp.tldr}`
        : <>Ranked by Linear activity. Spinach recorded the {fmt(sp.date)} sprint planning but has no summary for it{safeUrl(sp.url) ? <>, <a href={sp.url} target="_blank" rel="noopener noreferrer">open the recording ↗</a></> : null}.</>)
      : 'Ranked by Linear activity.'
  return (
    <div className="rm-card">
      <div className="rm-sec-head">
        <div><h2>Status this sprint</h2><p>{dates}</p></div>
        {ctx.canEdit && ctx.editing && <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => ctx.open({ kind: 'sprint' })}>Edit sprint status</button>}
      </div>
      <p className="rm-headline">
        {live.length
          ? <>{live.length} pieces of work in flight: {parts.map((p, i) => <span key={i}>{i ? ', ' : ''}{p}</span>)}.</>
          : 'Nothing is in flight in Linear right now.'}
      </p>
      {sd.summary && <p className="rm-sprint-sum">{sd.summary}</p>}
      <div className="rm-lbl">Current focus</div>
      <div className="rm-focus">
        {act.map(c => (
          <button key={c.id} type="button" className="rm-frow" onClick={() => ctx.open({ kind: 'chunk', id: c.id })}>
            <span className="sw" style={{ background: swatch(c.track) }} />
            <span className="fname">{c.name}<small>{c.plain || ''}</small></span>
            <StatusChip s={c.status} />
          </button>
        ))}
        {!act.length && <div className="rm-muted" style={{ fontSize: 13 }}>No active work.</div>}
      </div>
      <div className="rm-src">{src}</div>
    </div>
  )
}

function Landed({ ctx, snap }: { ctx: Ctx; snap: Doc }) {
  const { v, q, P } = ctx
  const [note, setNote] = useState<string>(snap.note || '')
  const krs = ((v.meta && v.meta.objectives) || []).flatMap((o: Doc) => (o.krs || []).map((k: Doc) => Object.assign({ objName: o.name }, k)))
  const scored = krs.filter((k: Doc) => !k.offRoadmap), hit = scored.filter((k: Doc) => k.status === 'done'), miss = scored.filter((k: Doc) => k.status !== 'done')
  const doneP = P.filter(p => doneThisQ(p, q)).length
  const open = P.filter(p => ['now', 'next'].includes(stageOf(p)) && p.kind !== 'bucket').length
  const canc = P.filter(p => p.status === 'canceled' && p.canceledAt && D(String(p.canceledAt).slice(0, 10))! >= q.qStart).length
  const label = snap.label || qLabelOf(snap.quarter)
  const noteEd = ctx.realCanEdit && ctx.editing
  const save = async () => {
    try { await ctx.writer.update('snapshots', snap.id, { note: note.trim() }); ctx.toast('Note saved') } catch (e) { ctx.toast(saveErr(e, "Couldn't save the note. Try again.")) }
  }
  return (
    <div className="rm-card">
      <div className="rm-sec-head"><div>
        <h2>Where we landed in {label}</h2>
        <p>{snap.kind === 'final' ? 'Final position at quarter close.' : 'Checkpoint, not the final position.'} {snap.reconstructed ? 'Rebuilt from Linear history on ' + fmt(String(snap.takenAt).slice(0, 10)) + ', so it is an approximation.' : 'Taken ' + fmtDT(snap.takenAt) + '.'}</p>
      </div></div>
      <div className="rm-landed">
        <div className="rm-lstat"><b>{hit.length} of {scored.length}</b><span>Key results hit</span></div>
        <div className="rm-lstat"><b>{miss.length}</b><span>Key results missed</span></div>
        <div className="rm-lstat"><b>{doneP}</b><span>Projects completed</span></div>
        <div className="rm-lstat"><b>{open}</b><span>Projects still open{snap.kind === 'final' ? ', carried into the next quarter' : ''}{canc ? ` · ${canc} cancelled` : ''}</span></div>
      </div>
      {miss.length > 0 && <div className="rm-lmiss">{miss.map((k: Doc) => (
        <div key={k.id}><span className="rm-kid">{k.id}</span><span>{k.text} <span className="rm-muted">· {k.objName}</span></span>
          <span className={`rm-chip rm-kst-${k.status}`}>{KRSTATUS[k.status] || k.status}</span></div>))}</div>}
      <div className="rm-lnote">
        {noteEd ? <>
          <label className="rm-lbl" htmlFor="rm-snap-note">Closing note</label>
          <textarea id="rm-snap-note" value={note} onChange={e => setNote(e.target.value)} placeholder="What we learned and what changes next quarter" style={{ marginTop: 6 }} />
          <div className="rm-actions" style={{ marginTop: 8 }}><button type="button" className="rm-btn rm-btn--sm" onClick={save}>Save note</button></div>
        </> : snap.note ? <><div className="rm-lbl" style={{ marginBottom: 4 }}>Closing note</div>{snap.note}</>
          : ctx.realCanEdit ? <span className="rm-muted" style={{ fontSize: 13 }}>No closing note yet. Turn on Edit to add one.</span> : null}
      </div>
    </div>
  )
}

export default function OverviewTab({ ctx, snap }: { ctx: Ctx; snap: Doc | null }) {
  return (
    <>
      {!ctx.isLive && snap && <Landed ctx={ctx} snap={snap} />}
      <Effort ctx={ctx} />
      <Gantt ctx={ctx} />
      <SprintStatus ctx={ctx} />
    </>
  )
}

