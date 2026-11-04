import { useState } from 'react'
import { authClient } from '../../lib/supabase'
import type { Doc } from '../../lib/roadmap/logic'
import {
  ALIGN, CONF, D, DAY, HOR, IMPACT, STATUS, TEAMS, TRACKS, WORST, candidates, chunkList, fmt, riceScore, safeUrl,
} from '../../lib/roadmap/logic'
import type { Ctx, DrawerState } from './ui'
import { ExtLink, Modal, StatusChip } from './ui'
import { saveErr, newsWrite } from './helpers'
import { ActChip, CatChip } from './NewsTab'

const nowIso = () => new Date().toISOString()
const krAll = (ctx: Ctx): Doc[] => ((ctx.v.meta && ctx.v.meta.objectives) || []).flatMap((o: Doc) => (o.krs || []).map((k: Doc) => Object.assign({ obj: o.name }, k)))

// ---------- piece of work ----------
function ChunkDrawer({ ctx, id }: { ctx: Ctx; id: string }) {
  const c = ctx.C.find(x => x.id === id)
  const [name, setName] = useState(c?.name || '')
  const [plain, setPlain] = useState(c?.plain || '')
  const [ms, setMs] = useState<string>(c?.manualStatus || '')
  const [why, setWhy] = useState(c?.manualWhy || '')
  const [krs, setKrs] = useState<string[]>(c?.krs || [])
  if (!c) return null
  const { v } = ctx
  const isI = c.kind === 'initiative'
  const tot = c.done + c.open, pct = tot ? Math.round(c.done / tot * 100) : 0
  const all = krAll(ctx)
  const lo = v.sync && v.sync.lightsOn
  const editable = ctx.canEdit && c.id !== 'c-other'

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const mAt = ms ? (ms === c!.manualStatus ? (c!.manualAt || nowIso()) : nowIso()) : ''
    try {
      if (isI) {
        await ctx.writer.set('overrides', 'init-' + c!.lid, { plain: plain.trim(), krs, manualStatus: ms, manualWhy: ms ? why.trim() : '', manualAt: mAt, updatedAt: nowIso() })
      } else {
        if (!name.trim()) return
        await ctx.writer.update('chunks', c!.id, { name: name.trim(), plain: plain.trim(), krs, manualStatus: ms, manualWhy: ms ? why.trim() : '', manualAt: mAt, updatedAt: nowIso() })
      }
      ctx.closeDrawer(); ctx.toast('Saved')
    } catch (err) { ctx.toast(saveErr(err)) }
  }

  return (
    <Modal eyebrow={(isI ? (c.depth ? 'Sub-initiative' : 'Initiative') + ' in Linear' : 'Piece of work') + (TRACKS[c.track] ? ' · mostly ' + TRACKS[c.track].t + ' ' + TRACKS[c.track].n : '')} title={c.name} onClose={ctx.closeDrawer}>
      {c.plain && <p style={{ margin: '10px 0 0', color: '#323232', fontSize: 14 }}>{c.plain}</p>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}><StatusChip s={c.status} /></div>
      <div className="rm-why"><small>Why this status</small>{c.why}
        {tot > 0 && c.status !== 'ongoing' && <>
          <div className="rm-prog" aria-label={`${pct}% of issues closed`}><i style={{ width: pct + '%' }} /></div>
          <div style={{ fontSize: 12, color: '#323232', marginTop: 4 }}>{c.done} closed · {c.inProgress} in progress{c.blocked ? ` · ${c.blocked} blocked` : ''} · {c.open - c.inProgress - c.blocked} to do, across its open projects</div>
        </>}
      </div>
      <dl className="rm-facts">
        <dt>Who</dt><dd>{c.teams.map(t => TEAMS[t]).join(' + ') || 'No team yet'}</dd>
        <dt>Dates</dt><dd>{c.start ? 'From ' + fmt(c.start) : 'No start date'} · {c.target ? 'target ' + fmt(c.target) : 'no target date'}</dd>
        <dt>Goals</dt><dd>{c.krs.length
          ? c.krs.map(kid => { const k = all.find(x => x.id === kid); return k ? <span key={kid} className="rm-chip plain" style={{ marginRight: 4 }}>{kid} · {k.text}</span> : null })
          : <span style={{ color: '#b45309' }}>Not linked to a key result</span>}</dd>
        {isI && c.owner && <><dt>Owner</dt><dd>{c.owner}</dd></>}
        <dt>Source</dt><dd>{isI ? <>Linear initiative{safeUrl(c.url) && <> · <ExtLink href={c.url}>Open in Linear ↗</ExtLink></>}</>
          : c.id === 'c-klo' && lo ? 'Bug and Tech Debt labels in Linear, plus any running-log projects' : 'Grouped in this dashboard until this work has a goal initiative in Linear'}</dd>
      </dl>
      {c.milestones.length > 0 && <ul className="rm-kids">{c.milestones.map((m, i) =>
        <li key={i}><span>{(+(m.progress || 0)) >= 100 ? '✓' : '◇'} {m.name} <span style={{ color: '#323232' }}>· {m.project}</span></span>
          <span style={{ color: '#323232' }}>{m.target ? fmt(m.target) + ' · ' : ''}{+(m.progress || 0)}%</span></li>)}</ul>}
      <ul className="rm-kids">
        {c.kids.slice().sort((a, b) => WORST.indexOf(a.status) - WORST.indexOf(b.status)).map(p =>
          <li key={p.id}><button type="button" onClick={() => ctx.open({ kind: 'project', id: p.id })}>{p.name}</button><StatusChip s={p.status} /></li>)}
        {!c.kids.length && <li style={{ color: '#323232' }}>No Linear projects yet</li>}
      </ul>
      <div className="rm-actions" style={{ marginTop: 14 }}>
        <button type="button" className="rm-btn rm-btn--ghost" onClick={() => { ctx.setBoardChunk(c.id); ctx.closeDrawer(); ctx.goTab('board') }}>See these projects on the Board</button>
      </div>
      {editable && (
        <form className="rm-form" onSubmit={save} noValidate>
          {isI
            ? <p className="full" style={{ margin: 0, fontSize: 12, color: '#323232' }}>The name, owner and projects come from Linear. The plain-language line, goal links and status set by hand are kept here.</p>
            : <label className="full">Name<input value={name} onChange={e => setName(e.target.value)} /></label>}
          <label className="full">In plain terms<textarea style={{ minHeight: 60 }} value={plain} onChange={e => setPlain(e.target.value)} /></label>
          <label>Status<select value={ms} onChange={e => setMs(e.target.value)}>
            <option value="">From Linear ({STATUS[c.auto] || ''})</option>
            {['on', 'risk', 'off'].map(k => <option key={k} value={k}>{STATUS[k]} (set by hand)</option>)}
          </select></label>
          <label>Why, if set by hand<input value={why} onChange={e => setWhy(e.target.value)} placeholder="One line the ELT will read" /></label>
          <div className="full"><span style={{ fontSize: 12, color: '#323232' }}>Key results this work moves</span>
            <div className="rm-checks">{all.map(k => <label key={k.id}><input type="checkbox" checked={krs.includes(k.id)}
              onChange={e => setKrs(s => e.target.checked ? [...s, k.id] : s.filter(x => x !== k.id))} />{k.id}</label>)}</div></div>
          <div className="full rm-actions"><button type="button" className="rm-btn rm-btn--ghost" onClick={ctx.closeDrawer}>Cancel</button><button type="submit" className="rm-btn">Save</button></div>
        </form>
      )}
    </Modal>
  )
}

// ---------- Linear project ----------
function ProjectDrawer({ ctx, id }: { ctx: Ctx; id: string }) {
  const r = ctx.P.find(x => x.id === id)
  const [team, setTeam] = useState(r?.team || 'none')
  const [to, setTo] = useState(r?.chunk || '')
  if (!r) return null
  const t = TRACKS[r.track], ch = ctx.C.find(c => c.id === r.chunk)
  const total = (+r.done || 0) + (+r.open || 0), pct = total ? Math.round((+r.done || 0) / total * 100) : 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (team !== r!.team) await ctx.writer.set('overrides', r!.id, { team, updatedAt: nowIso() })
      if (to !== r!.chunk && to !== 'c-other' && /^c-/.test(to)) {
        for (const c of chunkList(ctx.v)) {
          const has = (c.projects || []).includes(r!.id)
          if (c.id === to && !has) await ctx.writer.update('chunks', c.id, { projects: (c.projects || []).concat(r!.id) })
          if (c.id !== to && has) await ctx.writer.update('chunks', c.id, { projects: c.projects.filter((x: string) => x !== r!.id) })
        }
      }
      ctx.closeDrawer(); ctx.toast('Saved')
    } catch (err) { ctx.toast(saveErr(err)) }
  }

  return (
    <Modal eyebrow={r.id + (t ? ' · ' + t.t + ' ' + t.n : '')} title={r.name} onClose={ctx.closeDrawer}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <StatusChip s={r.status} />
        {r.trackFrom !== 'linear' && r.kind !== 'bucket' && <span className="rm-chip sug">Track suggested: add the {t ? t.t + ' ' + t.n : 'track'} label in Linear</span>}
      </div>
      <div className="rm-why"><small>Why this status</small>{r.why}
        {total > 0 && <>
          <div className="rm-prog" aria-label={`${pct}% of issues closed`}><i style={{ width: pct + '%' }} /></div>
          <div style={{ fontSize: 12, color: '#323232', marginTop: 4 }}>{+r.done || 0} closed · {+r.inProgress || 0} in progress{+r.blocked ? ` · ${+r.blocked} blocked` : ''} · {(+r.open || 0) - (+r.inProgress || 0) - (+r.blocked || 0)} to do</div>
        </>}
      </div>
      <dl className="rm-facts">
        <dt>Part of</dt><dd>{ch ? <button type="button" className="rm-lk" onClick={() => ctx.open({ kind: 'chunk', id: ch.id })}>{ch.name}</button> : 'Other work'}</dd>
        <dt>Team</dt><dd>{TEAMS[r.team] || 'Not assigned'} <span style={{ color: '#323232' }}>· {r.teamFrom === 'set' ? 'set in this dashboard' : r.teamFrom === 'assignees' ? 'from issue assignees' : r.teamFrom === 'lead' ? 'from project lead' : 'no one assigned'}</span></dd>
        {r.lead && <><dt>Lead in Linear</dt><dd>{r.lead}</dd></>}
        <dt>Dates</dt><dd>{r.start ? 'Start ' + fmt(r.start) : 'No start date'} · {r.target ? 'target ' + fmt(r.target) : 'no target date'}{r.completedAt ? ' · closed ' + fmt(r.completedAt) : ''}{r.canceledAt ? ' · cancelled ' + fmt(r.canceledAt) : ''}</dd>
        {r.initiatives && r.initiatives.length > 0 && <><dt>Initiatives</dt><dd>{r.initiatives.join(', ')}</dd></>}
        {safeUrl(r.url) && <><dt>Linear</dt><dd><ExtLink href={r.url}>Open the project in Linear ↗</ExtLink></dd></>}
      </dl>
      {(r.milestones || []).length > 0 && <ul className="rm-kids">{r.milestones.map((m: Doc, i: number) =>
        <li key={i}><span>{(+m.progress || 0) >= 100 ? '✓' : '◇'} {m.name}</span><span style={{ color: '#323232' }}>{m.target ? fmt(m.target) + ' · ' : ''}{+m.progress || 0}%</span></li>)}</ul>}
      {!r.target && !['done', 'canceled'].includes(r.status) && <p style={{ fontSize: 12, color: '#323232', margin: '12px 0 0' }}>Projects should have an end date. If this is ongoing work, it's better as a label or a saved view in Linear.</p>}
      {ctx.canEdit && (
        <form className="rm-form" onSubmit={save} noValidate>
          <label>Delivery team<select value={team} onChange={e => setTeam(e.target.value)}>{Object.entries(TEAMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {r.initiative
            ? <p style={{ margin: 0, fontSize: 12, color: '#323232', alignSelf: 'end' }}>Its goal is set by its initiative in Linear.</p>
            : <label>Piece of work<select value={to} onChange={e => setTo(e.target.value)}>
              {ctx.C.filter(c => c.id !== 'c-other' && c.kind === 'chunk').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              {r.chunk === 'c-other' && <option value="c-other">Other work</option>}
            </select></label>}
          <p className="full" style={{ margin: 0, fontSize: 12, color: '#323232' }}>Dates, status and track come from Linear. Change them there and the next daily sync picks them up.</p>
          <div className="full rm-actions"><button type="button" className="rm-btn rm-btn--ghost" onClick={ctx.closeDrawer}>Cancel</button><button type="submit" className="rm-btn">Save</button></div>
        </form>
      )}
    </Modal>
  )
}

// ---------- Future Focus candidate ----------
function CandidateDrawer({ ctx, id }: { ctx: Ctx; id: string }) {
  const c = candidates(ctx.v, ctx.P).find(x => x.key === id)
  const r: Doc = (c?.r as Doc) || ({} as Doc)
  const it = c && c.ref.type === 'item' ? ctx.v.items.get(c.ref.id) : null
  const lp = c && c.ref.type === 'linear' ? ctx.P.find(p => p.id === c.ref.id) : null
  const s = (k: string) => (r[k] != null ? String(r[k]) : '')
  const [f, setF] = useState({
    reach: s('reach'), impact: s('impact'), conf: s('conf'), effort: s('effort'),
    reachNote: r.reachNote || '', impactNote: r.impactNote || '', confNote: r.confNote || '', effortNote: r.effortNote || '',
    must: !!r.mustHave, mustReason: r.mustReason || '', mustAlign: r.mustAlign || '', mustAlignDetail: r.mustAlignDetail || '',
  })
  const [item, setItem] = useState({ title: it?.title || '', story: it?.story || '', owner: it?.owner || '', hor: it?.horizon || 'idea', note: it?.note || '' })
  const [err, setErr] = useState('')
  if (!c) return null
  const numv = (x: string) => (x.trim() === '' ? null : Number(x))
  const pv = riceScore({ reach: numv(f.reach), impact: numv(f.impact), conf: numv(f.conf), effort: numv(f.effort) })
  const krs = krAll(ctx)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  async function saveScore(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    const data: Record<string, any> = { reach: numv(f.reach), impact: numv(f.impact), conf: numv(f.conf), effort: numv(f.effort), reachNote: f.reachNote.trim(), impactNote: f.impactNote.trim(), confNote: f.confNote.trim(), effortNote: f.effortNote.trim() }
    if (['reach', 'effort'].some(k => data[k] != null && (isNaN(data[k]) || data[k] < 0))) { setErr('Reach and effort need to be numbers of 0 or more.'); return }
    if (data.reach != null && data.reach > 10) { setErr('Reach is the number of operators, from 0 to 10.'); return }
    if (f.must) {
      if (f.mustReason.trim().length < 15) { setErr('Give a reason for the must have, at least a full sentence.'); return }
      if (!f.mustAlign) { setErr('Choose what the must have aligns to.'); return }
      Object.assign(data, { mustHave: true, mustReason: f.mustReason.trim(), mustAlign: f.mustAlign, mustAlignDetail: f.mustAlignDetail.trim(), mustAt: r.mustHave ? (r.mustAt || nowIso()) : nowIso() })
    } else Object.assign(data, { mustHave: false, mustReason: '', mustAlign: '', mustAlignDetail: '', mustAt: '' })
    data.scoredAt = nowIso(); data.updatedAt = data.scoredAt
    try { await ctx.writer.set('rice', c!.key, data); ctx.closeDrawer(); ctx.toast(f.must ? 'Saved as a must have' : 'Score saved') } catch (er) { ctx.toast(saveErr(er, "Couldn't save the score. Try again.")) }
  }
  async function saveItem(e: React.FormEvent) {
    e.preventDefault()
    if (!item.title.trim() || !it) return
    try { await ctx.writer.update('items', it.id, { title: item.title.trim(), story: item.story.trim(), owner: item.owner.trim(), horizon: item.hor, note: item.note.trim(), updatedAt: nowIso() }); ctx.closeDrawer(); ctx.toast('Saved') } catch { ctx.toast("Couldn't save. Try again.") }
  }

  return (
    <Modal eyebrow={c.src + (c.added ? ' · added ' + fmt(c.added.slice(0, 10)) : '')} title={c.title} onClose={ctx.closeDrawer}>
      {c.must && <div style={{ marginTop: 10 }}><span className="rm-chip dark">Must have</span></div>}
      {it && <div className="rm-why"><small>Customer story</small>{it.story || <span style={{ color: '#b45309' }}>No story yet. Add one before scoring.</span>}</div>}
      <dl className="rm-facts">
        <dt>Lead</dt><dd>{c.lead || 'Not set'}</dd>
        {it && it.note && <><dt>Notes</dt><dd>{it.note}</dd></>}
        {it && it.reason && <><dt>Why parked</dt><dd>{it.reason}</dd></>}
        {it && safeUrl(it.docUrl) && <><dt>Document</dt><dd><ExtLink href={it.docUrl}>Open the full doc ↗</ExtLink></dd></>}
        {lp && safeUrl(lp.url) && <><dt>Linear</dt><dd><ExtLink href={lp.url}>Open the project in Linear ↗</ExtLink></dd></>}
        <dt>RICE</dt><dd>{c.score != null ? `Score ${c.score.toFixed(1)} (R ${r.reach} · I ${r.impact} · C ${r.conf}% · E ${r.effort})` : 'Not scored'}{r.scoredAt && <span style={{ color: '#323232' }}> · updated {fmt(String(r.scoredAt).slice(0, 10))}</span>}</dd>
        {c.must && <><dt>Must have because</dt><dd>{r.mustReason || ''}</dd><dt>Aligned to</dt><dd>{ALIGN[r.mustAlign] || ''}{r.mustAlignDetail ? ': ' + r.mustAlignDetail : ''}{r.mustAt && <span style={{ color: '#323232' }}> · set {fmt(String(r.mustAt).slice(0, 10))}</span>}</dd></>}
      </dl>
      {ctx.canEdit && <>
        <form className="rm-form" onSubmit={saveScore} noValidate>
          <div className="full rm-eyebrow" style={{ marginBottom: 0 }}>RICE score</div>
          <label>Reach · operators next quarter (0 to 10)<input type="number" min="0" step="1" inputMode="decimal" value={f.reach} onChange={set('reach')} placeholder="e.g. 3" /></label>
          <label>Who, specifically<input value={f.reachNote} onChange={set('reachNote')} placeholder="e.g. MODO, Soaring Eagle, BetSaracen" /></label>
          <label>Impact per operator<select value={f.impact} onChange={set('impact')}><option value="">Not set</option>{IMPACT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>What changes for them<input value={f.impactNote} onChange={set('impactNote')} placeholder="e.g. cuts escalations on deposits" /></label>
          <label>Confidence<select value={f.conf} onChange={set('conf')}><option value="">Not set</option>{CONF.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Evidence<input value={f.confNote} onChange={set('confNote')} placeholder="e.g. 3 operator asks, QA data" /></label>
          <label>Effort · person-weeks<input type="number" min="0" step="0.5" inputMode="decimal" value={f.effort} onChange={set('effort')} placeholder="e.g. 4" /></label>
          <label>Who does the work<input value={f.effortNote} onChange={set('effortNote')} placeholder="e.g. 2 Pixie devs, 2 sprints" /></label>
          <p className="full" style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{pv != null ? `Score ${pv.toFixed(1)}` : 'Fill in all four to get a score.'}</p>
          <div className="full rm-eyebrow" style={{ marginTop: 6, marginBottom: 0 }}>Must have</div>
          <label className="full rm-mustbox"><input type="checkbox" checked={f.must} onChange={e => setF(p => ({ ...p, must: e.target.checked }))} /><span>Mark as a must have. It goes above every RICE score and above the capacity line.</span></label>
          {f.must && <div className="full" style={{ display: 'grid', gap: 10 }}>
            <label>Why it's a must have (required)<textarea value={f.mustReason} onChange={set('mustReason')} placeholder="What happens if we don't do it, and who asked for it" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>Aligned to (required)<select value={f.mustAlign} onChange={set('mustAlign')}><option value="">Choose one</option>{Object.entries(ALIGN).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Which one<input list="rm-krlist" value={f.mustAlignDetail} onChange={set('mustAlignDetail')} placeholder="e.g. RG-1, MODO contract clause 4" />
                <datalist id="rm-krlist">{krs.map(k => <option key={k.id} value={k.id + ' · ' + k.text} />)}</datalist></label>
            </div>
          </div>}
          {err && <p className="full rm-err">{err}</p>}
          <div className="full rm-actions"><button type="button" className="rm-btn rm-btn--ghost" onClick={ctx.closeDrawer}>Cancel</button><button type="submit" className="rm-btn">Save score</button></div>
        </form>
        {it && <details style={{ marginTop: 16 }}><summary className="rm-eyebrow" style={{ cursor: 'pointer' }}>Edit the item</summary>
          <form className="rm-form" onSubmit={saveItem} noValidate>
            <label className="full">Name<input value={item.title} onChange={e => setItem({ ...item, title: e.target.value })} /></label>
            <label className="full">Customer story<textarea value={item.story} onChange={e => setItem({ ...item, story: e.target.value })} placeholder="Who uses it, what Raphie does, and what changes for them" /></label>
            <label>Lead<input value={item.owner} onChange={e => setItem({ ...item, owner: e.target.value })} /></label>
            <label>List<select value={item.hor} onChange={e => setItem({ ...item, hor: e.target.value })}>{['idea', 'next', 'later', 'parked'].map(k => <option key={k} value={k}>{HOR[k].replace(' (Miro)', '')}</option>)}</select></label>
            <label className="full">Notes<textarea style={{ minHeight: 60 }} value={item.note} onChange={e => setItem({ ...item, note: e.target.value })} /></label>
            <div className="full rm-actions"><button type="submit" className="rm-btn rm-btn--ghost">Save item</button></div>
          </form></details>}
      </>}
    </Modal>
  )
}

// ---------- industry news ----------
function NewsDrawer({ ctx, id }: { ctx: Ctx; id: string }) {
  const n = ctx.v.news.get(id)
  const [f, setF] = useState({ title: n?.title || '', source: n?.source || '', date: n?.date || '', url: n?.url || '', aowner: n?.actionOwner || '', anote: n?.actionNote || '', summary: n?.summary || '', rel: n?.relevance || '', disc: n?.discussion || '' })
  if (!n) return null
  const url = safeUrl(n.url)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f.title.trim()) return
    ctx.closeDrawer()
    await newsWrite(ctx, n!.id, { title: f.title.trim(), source: f.source.trim(), date: f.date, url: f.url.trim(), actionOwner: f.aowner.trim(), actionNote: f.anote.trim(), summary: f.summary.trim(), relevance: f.rel.trim(), discussion: f.disc.trim() }, 'Saved')
  }
  return (
    <Modal eyebrow={'Industry news' + (n.date ? ' · ' + fmt(n.date) : '')} title={n.title} onClose={ctx.closeDrawer}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}><CatChip n={n} /><ActChip n={n} /></div>
      {n.summary && <div className="rm-why"><small>What happened</small>{n.summary}</div>}
      <dl className="rm-facts">
        <dt>Source</dt><dd>{n.source || ''}{url && <> · <ExtLink href={url}>Open link ↗</ExtLink></>}</dd>
        {n.relevance && <><dt>Why it might matter</dt><dd>{n.relevance}</dd></>}
        <dt>Team notes</dt><dd>{n.discussion || <span style={{ color: '#323232' }}>Not discussed yet</span>}</dd>
      </dl>
      {ctx.canEdit && (
        <form className="rm-form" onSubmit={save} noValidate>
          <label className="full">Headline<input value={f.title} onChange={set('title')} /></label>
          <label>Source<input value={f.source} onChange={set('source')} /></label>
          <label>Date<input type="date" value={f.date} onChange={set('date')} /></label>
          <label className="full">Link<input type="url" value={f.url} onChange={set('url')} /></label>
          <label>Action owner<input value={f.aowner} onChange={set('aowner')} /></label>
          <label>What needs doing<input value={f.anote} onChange={set('anote')} /></label>
          <label className="full">What happened<textarea style={{ minHeight: 60 }} value={f.summary} onChange={set('summary')} /></label>
          <label className="full">Why it might matter<textarea style={{ minHeight: 60 }} value={f.rel} onChange={set('rel')} /></label>
          <label className="full">Team notes<textarea style={{ minHeight: 60 }} value={f.disc} onChange={set('disc')} /></label>
          <div className="full rm-actions"><button type="submit" className="rm-btn">Save</button></div>
        </form>
      )}
    </Modal>
  )
}

// ---------- sprint status ----------
function SprintDrawer({ ctx }: { ctx: Ctx }) {
  const { v } = ctx
  const sd = v.sprint || ({} as Doc), sp = v.sync && v.sync.spinach
  const defStart: string = sd.start || (sp && sp.date) || ''
  const ds = D(defStart)
  const defEnd: string = sd.end || (ds && !isNaN(ds.getTime()) ? new Date(ds.getTime() + 13 * DAY).toISOString().slice(0, 10) : '')
  const [start, setStart] = useState(defStart)
  const [end, setEnd] = useState(defEnd)
  const [summary, setSummary] = useState<string>(sd.summary || '')
  const [focus, setFocus] = useState<string[]>(sd.focus || [])
  const [drafting, setDrafting] = useState(false)
  const [draftErr, setDraftErr] = useState('')
  if (!ctx.canEdit) return null
  const C = ctx.C.filter(c => c.status !== 'done')

  // Ask Claude (via the roadmap-sprint-draft function) for a first draft from the live
  // Linear-derived data. It only fills the form; nothing is saved until you press Save.
  async function draft() {
    setDrafting(true); setDraftErr('')
    try {
      const pieces = C.map(c => ({
        name: c.name, status: STATUS[c.status], plain: c.plain, closedIssues: c.done, openIssues: c.open, inProgress: c.inProgress, blocked: c.blocked, target: c.target,
        projects: c.kids.filter(p => p.status !== 'done').slice(0, 6).map(p => ({ name: p.name, status: STATUS[p.status], target: p.target })),
      }))
      const { data, error } = await authClient.functions.invoke('roadmap-sprint-draft', { body: { pieces, cycle: ctx.v.sync?.cycle ?? null } })
      if (error || !data?.ok) throw new Error(data?.error || "Couldn't draft a summary. Try again.")
      setSummary(data.summary)
      setFocus(C.filter(c => (data.focus as string[]).includes(c.name)).map(c => c.id))
    } catch (e) { setDraftErr(e instanceof Error ? e.message : "Couldn't draft a summary. Try again.") }
    setDrafting(false)
  }
  async function save(data: Record<string, any>) {
    try { await ctx.writer.set('meta', 'sprint', { ...data, updatedAt: nowIso() }); ctx.closeDrawer(); ctx.toast('Sprint status saved') } catch (e) { ctx.toast(saveErr(e)) }
  }
  return (
    <Modal eyebrow="Status this sprint" title="Edit sprint status" onClose={ctx.closeDrawer}>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: '#323232' }}>Write what the kickoff call agreed. Leave focus unticked to rank by Linear activity. To change a status by hand, open the piece of work on the Roadmap.</p>
      <form className="rm-form" onSubmit={e => { e.preventDefault(); save({ start, end, summary: summary.trim(), focus }) }} noValidate>
        <label>Sprint starts<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>Sprint ends<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="rm-btn rm-btn--ghost" onClick={draft} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft with Claude'}</button>
          <span style={{ fontSize: 12, color: '#323232' }}>Fills the summary and focus from the live Linear data. Edit it, then Save.</span>
          {draftErr && <span className="rm-err">{draftErr}</span>}
        </div>
        <label className="full">Sprint summary<textarea value={summary} onChange={e => setSummary(e.target.value)} placeholder="Two or three lines: what we're shipping this sprint and anything the ELT should know" /></label>
        <div className="full"><span style={{ fontSize: 12, color: '#323232' }}>Focus this sprint</span>
          <div className="rm-checks col">{C.map(c => <label key={c.id}><input type="checkbox" checked={focus.includes(c.id)}
            onChange={e => setFocus(s => e.target.checked ? [...s, c.id] : s.filter(x => x !== c.id))} />{c.name}</label>)}</div></div>
        <div className="full rm-actions">
          <button type="button" className="rm-btn rm-btn--ghost" onClick={() => save({ summary: '', focus: [], start: '', end: '' })}>Clear and use Linear</button>
          <button type="submit" className="rm-btn">Save</button>
        </div>
      </form>
    </Modal>
  )
}

export default function DrawerHost({ ctx, drawer }: { ctx: Ctx; drawer: DrawerState }) {
  if (!drawer) return null
  // key on kind+id so form state resets when one drawer swaps to another
  const k = drawer.kind + ('id' in drawer ? drawer.id : '')
  switch (drawer.kind) {
    case 'chunk': return <ChunkDrawer key={k} ctx={ctx} id={drawer.id} />
    case 'project': return <ProjectDrawer key={k} ctx={ctx} id={drawer.id} />
    case 'cand': return <CandidateDrawer key={k} ctx={ctx} id={drawer.id} />
    case 'news': return <NewsDrawer key={k} ctx={ctx} id={drawer.id} />
    case 'sprint': return <SprintDrawer key={k} ctx={ctx} />
  }
}

