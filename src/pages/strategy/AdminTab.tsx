import { useState } from 'react'
import type { Plan } from '../../lib/strategy/logic'
import { fmtDate, newDraftFrom, planList, planProblem, today, uid } from '../../lib/strategy/logic'
import type { Ctx } from './ui'
import { Empty, Field } from './ui'
import { saveErr } from './helpers'

type Draft = Plan & { _new?: boolean }

export default function AdminTab({ ctx }: { ctx: Ctx }) {
  const { data } = ctx
  const [draft, setDraft] = useState<Draft | null>(null)
  if (!ctx.realCanEdit) return <Empty>Only admins can see this page.</Empty>
  if (draft) return <Setup ctx={ctx} initial={draft} onClose={() => setDraft(null)} />

  const plans = planList(data)
  const existingDraft = plans.find(p => p.state === 'draft')
  const open = (p?: Plan) => setDraft(p ? JSON.parse(JSON.stringify(p)) : newDraftFrom(data.plans[data.currentId || ''] || ctx.plan))
  return (
    <>
      <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 15 }}>OKR periods</h2>
        <div className="st-list">
          {plans.map(p => (
            <div className="st-li" key={p.id}>
              <div className="st-row" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>{(p.period || p.id) + (p.id === data.currentId ? ' · current' : p.state === 'draft' ? ' · draft' : '')}</span>
                  <span className="st-sm-t">{fmtDate(p.periodStart, true)} to {fmtDate(p.periodEnd, true)}</span>
                </div>
                {p.state === 'draft' && <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => open(p)}>Edit draft</button>}
              </div>
            </div>
          ))}
          {!plans.length && <div className="st-li st-sm-t">No OKR period has been set up yet.</div>}
        </div>
        <div><button type="button" className="rm-btn" onClick={() => open(existingDraft)}>{existingDraft ? 'Edit draft for next period' : 'Set up next period'}</button></div>
      </section>

      <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 15 }}>View as</h2>
        <p className="st-sm-t" style={{ fontSize: 13 }}>Preview Strategy as view-only colleagues see it. This does not change anyone&rsquo;s access.</p>
        <div className="rm-seg" role="group" aria-label="View as" style={{ alignSelf: 'flex-start' }}>
          <button type="button" aria-pressed={!ctx.previewViewer} onClick={() => ctx.setPreviewViewer(false)}>Admin</button>
          <button type="button" aria-pressed={ctx.previewViewer} onClick={() => ctx.setPreviewViewer(true)}>Viewer</button>
        </div>
      </section>

      <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ fontSize: 15 }}>Access</h2>
        <p className="st-sm-t" style={{ fontSize: 13, lineHeight: 1.55 }}>Strategy is visible to SuperAdmins and to anyone you give the page in Admin settings, Users, under Pages. Give edit access only to people who should act as a second admin. Everyone else sees everything but can change nothing.</p>
      </section>
    </>
  )
}

function Setup({ ctx, initial, onClose }: { ctx: Ctx; initial: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const edit = (fn: (x: Draft) => void) => setD(prev => { const n: Draft = JSON.parse(JSON.stringify(prev)); fn(n); return n })

  async function save(makeCurrent: boolean) {
    if (d._new && ctx.data.plans[d.id]) { ctx.toast(`A period with the id ${d.id} already exists.`); return }
    const out: Draft = JSON.parse(JSON.stringify(d)); delete out._new
    out.pillars.forEach(p => { p.krs = p.krs.filter(k => k.text.trim()) })
    if (makeCurrent) { const bad = planProblem(out); if (bad) { ctx.toast(bad); return } out.state = 'locked'; out.lockedAt = today() }
    const { id, ...doc } = out
    setBusy(true)
    try {
      const sets = [{ collection: 'plans', id, data: doc as unknown as Record<string, unknown> }]
      if (makeCurrent) sets.push({ collection: 'config', id: 'current', data: { period: id, setAt: new Date().toISOString() } })
      await ctx.writer.batch({ sets, deletes: [] })
      ctx.setViewPeriod(makeCurrent ? '' : id); ctx.setAsOf(''); ctx.setEltId('')
      ctx.toast(makeCurrent ? out.period + ' is now the current OKR period' : 'Draft saved'); onClose(); ctx.goTab('home')
    } catch (e) { ctx.toast(saveErr(e)) }
    setBusy(false)
  }

  return (
    <>
      <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>{d._new ? 'New Strategy on a Page' : 'Edit draft · ' + d.period}</h2>
        <p className="st-sm-t" style={{ fontSize: 13, lineHeight: 1.55 }}>OKRs are set every half-year. This starts as a copy of the current Strategy on a Page. Change the pillars, objectives and key results to match the new one. It stays a draft, visible from the period menu, until you make it current. The current period&rsquo;s history is kept and stays viewable.</p>
        <div className="st-row" style={{ alignItems: 'flex-end' }}>
          <Field label="Period name"><input type="text" value={d.period} onChange={e => edit(x => { x.period = e.target.value })} /></Field>
          <Field label="Starts"><input type="date" value={d.periodStart} onChange={e => edit(x => { x.periodStart = e.target.value })} /></Field>
          <Field label="Ends"><input type="date" value={d.periodEnd} onChange={e => edit(x => { x.periodEnd = e.target.value })} /></Field>
        </div>
        <Field label="North Star" grow><textarea value={d.northStar} onChange={e => edit(x => { x.northStar = e.target.value })} /></Field>
        <Field label="Product vision" grow><textarea value={d.vision} onChange={e => edit(x => { x.vision = e.target.value })} /></Field>
      </section>

      {d.pillars.map((p, pi) => (
        <section className="rm-card" key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="st-row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15 }}>Pillar {pi + 1}</h2>
            <button type="button" className="rm-mbtn del" onClick={() => edit(x => { x.pillars.splice(pi, 1) })}>Remove pillar</button>
          </div>
          <div className="st-row" style={{ alignItems: 'flex-end' }}>
            <Field label="Pillar name"><input type="text" value={p.name} onChange={e => edit(x => { x.pillars[pi].name = e.target.value })} /></Field>
            <Field label={'Short name (used in "Revenue KR3")'}><input type="text" value={p.short} onChange={e => edit(x => { x.pillars[pi].short = e.target.value })} /></Field>
            <Field label="Owner"><input type="text" value={p.owner} onChange={e => edit(x => { x.pillars[pi].owner = e.target.value })} /></Field>
          </div>
          <Field label="Objective" grow><textarea value={p.objective} onChange={e => edit(x => { x.pillars[pi].objective = e.target.value })} /></Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="rm-eyebrow">Key results</div>
            {p.krs.map((k, ki) => (
              <div className="st-row" key={k.id} style={{ flexWrap: 'nowrap' }}>
                <span className="st-ref" style={{ width: 40, flex: 'none' }}>KR{ki + 1}</span>
                <input type="text" aria-label={'Key result ' + (ki + 1)} value={k.text} style={{ flex: 1 }} onChange={e => edit(x => { x.pillars[pi].krs[ki].text = e.target.value })} />
                <button type="button" className="rm-mbtn del" aria-label={'Remove KR' + (ki + 1)} onClick={() => edit(x => { x.pillars[pi].krs.splice(ki, 1) })}>Remove</button>
              </div>
            ))}
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => edit(x => { x.pillars[pi].krs.push({ id: x.id + '-' + x.pillars[pi].id + '-' + uid(), text: '' }) })}>Add key result</button>
          </div>
        </section>
      ))}
      <button type="button" className="rm-btn rm-btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => edit(x => { x.pillars.push({ id: uid(), name: '', short: '', objective: '', owner: '', krs: [{ id: x.id + '-' + uid(), text: '' }] }) })}>Add pillar</button>

      <div className="st-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="rm-btn rm-btn--ghost" onClick={onClose}>Cancel</button>
        <div className="st-row">
          <button type="button" className="rm-btn rm-btn--ghost" disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button type="button" className="rm-btn" disabled={busy} onClick={() => save(true)}>Make current</button>
        </div>
      </div>
    </>
  )
}
