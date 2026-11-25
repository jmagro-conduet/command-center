import { Fragment, useState } from 'react'
import type { Action } from '../../lib/strategy/logic'
import { actId, actionList, carriedOver, fmtDate, isOverdue, krById, maxActionNum, nameFromEmail, ownerNames, savedSessions, today, uid } from '../../lib/strategy/logic'
import type { Ctx } from './ui'
import { Field } from './ui'
import { saveErr } from './helpers'
import { KrSelect } from './EltTab'

export default function ActionsTab({ ctx }: { ctx: Ctx }) {
  const { data, plan, af } = ctx
  const all = actionList(data), open = all.filter(a => a.status === 'open')
  const overdue = open.filter(a => isOverdue(a))
  const owners = ownerNames(data)
  const [adding, setAdding] = useState(false)
  const [openAct, setOpenAct] = useState('')
  const carried = open.filter(a => carriedOver(data, plan, a) >= 2).length

  const rows = all.filter(a => {
    if (af.status === 'open' && a.status !== 'open') return false
    if (af.status === 'done' && a.status === 'open') return false
    if (af.owner && a.owner !== af.owner) return false
    if (af.scope === 'prio' && a.kr) return false
    if (af.scope && af.scope !== 'prio') { const x = a.kr ? krById(data, plan, a.kr) : null; if (!x || x.p.id !== af.scope) return false }
    return true
  }).sort((a, b) => ((isOverdue(a) ? 0 : 1) - (isOverdue(b) ? 0 : 1)) || ((a.due || '9') < (b.due || '9') ? -1 : 1))

  const chip = (val: 'open' | 'done' | 'all', label: string) =>
    <button type="button" className="st-chip" aria-pressed={af.status === val} onClick={() => ctx.setAf({ ...af, status: val })}>{label}</button>

  return (
    <>
      <div className="st-row" style={{ justifyContent: 'space-between' }}>
        <div className="st-row" style={{ gap: '6px 24px', fontSize: 14 }}>
          <span className="st-sm-t" style={{ fontSize: 14 }}><b style={{ color: '#000' }}>{open.length}</b> open</span>
          <span className="st-sm-t" style={{ fontSize: 14 }}><b className="st-bad">{overdue.length}</b> overdue</span>
          <span className="st-sm-t" style={{ fontSize: 14 }}><b style={{ color: '#000' }}>{open.filter(a => !a.kr).length}</b> business priorities outside the OKRs</span>
          <span className="st-sm-t" style={{ fontSize: 14 }}><b style={{ color: '#000' }}>{carried}</b> carried over 2+ ELTs</span>
        </div>
        {ctx.canEdit && <button type="button" className="rm-btn" onClick={() => setAdding(true)}>Add action</button>}
      </div>

      {adding && ctx.canEdit && <AddAction ctx={ctx} owners={owners} onClose={() => setAdding(false)} />}

      <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
        <div className="st-row">
          <span className="st-chips">{chip('open', 'Open')}{chip('done', 'Done and dropped')}{chip('all', 'All')}</span>
          <label htmlFor="st-f-owner" className="st-sm-t" style={{ marginLeft: 8 }}>Owner</label>
          <select id="st-f-owner" value={af.owner} onChange={e => ctx.setAf({ ...af, owner: e.target.value })}>
            <option value="">Everyone</option>{owners.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <label htmlFor="st-f-scope" className="st-sm-t" style={{ marginLeft: 8 }}>Pillar</label>
          <select id="st-f-scope" value={af.scope} onChange={e => ctx.setAf({ ...af, scope: e.target.value })}>
            <option value="">All</option><option value="prio">Business priorities (no key result)</option>
            {plan.pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="st-tablewrap">
          <table className="st-table">
            <thead><tr>{['ID', 'Action', 'Owner', 'Key result or priority', 'Agreed', 'Due', 'Status'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rows.length ? rows.map(a => <Row key={a.id} ctx={ctx} a={a} open={openAct === a.id} toggle={() => setOpenAct(openAct === a.id ? '' : a.id)} />)
                : <tr><td colSpan={7} className="st-sm-t" style={{ padding: '20px 12px' }}>{all.length ? 'No actions match these filters.' : 'No actions yet. Actions agreed at each ELT appear here once the review is saved.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function AddAction({ ctx, owners, onClose }: { ctx: Ctx; owners: string[]; onClose: () => void }) {
  const [text, setText] = useState(''), [owner, setOwner] = useState(''), [due, setDue] = useState(''), [kr, setKr] = useState('')
  const [busy, setBusy] = useState(false)
  async function add() {
    if (!text.trim()) return
    setBusy(true)
    const last = savedSessions(ctx.data, ctx.plan).slice(-1)[0]
    try {
      await ctx.writer.set('actions', uid(), { num: maxActionNum(ctx.data) + 1, text: text.trim(), owner: owner.trim(), due, kr: kr || null, status: 'open', agreedAt: last ? last.id : '', createdAt: new Date().toISOString() })
      ctx.toast('Action added'); onClose()
    } catch (e) { ctx.toast(saveErr(e)) }
    setBusy(false)
  }
  return (
    <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 15 }}>Add an action</h2>
      <div className="st-row" style={{ alignItems: 'flex-end' }}>
        <Field label="Action"><input type="text" value={text} placeholder="What needs to happen" onChange={e => setText(e.target.value)} /></Field>
        <Field label="Owner"><input type="text" list="st-owners-a" value={owner} placeholder="Choose or type a name" onChange={e => setOwner(e.target.value)} /></Field>
        <Field label="Due"><input type="date" value={due} onChange={e => setDue(e.target.value)} /></Field>
        <Field label="Key result"><KrSelect ctx={ctx} value={kr} onChange={setKr} /></Field>
      </div>
      <datalist id="st-owners-a">{owners.map(n => <option key={n} value={n} />)}</datalist>
      <div className="st-row">
        <button type="button" className="rm-btn" disabled={busy || !text.trim()} onClick={add}>Add action</button>
        <button type="button" className="rm-btn rm-btn--ghost" onClick={onClose}>Cancel</button>
      </div>
    </section>
  )
}

function Row({ ctx, a, open, toggle }: { ctx: Ctx; a: Action; open: boolean; toggle: () => void }) {
  const { data, plan } = ctx
  const ag = data.sessions[a.agreedAt]
  const n = carriedOver(data, plan, a)
  const lu = (a.updates || []).slice(-1)[0]
  const nUp = (a.updates || []).length
  const [comment, setComment] = useState('')
  const [armed, setArmed] = useState(-1)

  const save = (patch: Partial<Action>) => ctx.writer.update('actions', a.id, patch as Record<string, unknown>).catch(e => ctx.toast(saveErr(e)))
  async function addComment() {
    const t = comment.trim(); if (!t) return
    const ups = [...(data.actions[a.id]?.updates || []), { date: today(), at: new Date().toISOString(), by: ctx.me, text: t }]
    try { await ctx.writer.update('actions', a.id, { updates: ups }); setComment(''); ctx.toast('Comment added') } catch (e) { ctx.toast(saveErr(e)) }
  }
  function delComment(idx: number) {
    if (armed !== idx) { setArmed(idx); return }
    setArmed(-1)
    const ups = [...(data.actions[a.id]?.updates || [])]; ups.splice(idx, 1)
    ctx.writer.update('actions', a.id, { updates: ups }).catch(e => ctx.toast(saveErr(e)))
  }
  const x = a.kr ? krById(data, plan, a.kr) : null

  return (
    <Fragment>
      <tr>
        <td className="st-sm-t" style={{ whiteSpace: 'nowrap' }}>{actId(a)}</td>
        <td>
          {a.text}
          {a.status === 'open' && n >= 2 && <span className="st-sm-t" style={{ display: 'block' }}>Carried over {n} ELTs</span>}
          {!open && lu && <span className="st-sm-t" style={{ display: 'block', marginTop: 2 }}>{fmtDate(lu.date)}: {lu.text}</span>}
          <button type="button" className="st-linkbtn" aria-expanded={open} onClick={toggle}>{open ? 'Hide comments' : nUp ? `Comments (${nUp})` : ctx.canEdit ? 'Add comment' : 'No comments'}</button>
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>{a.owner || <span className="st-faint">None</span>}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{a.kr ? <button type="button" className="st-linkbtn" onClick={() => ctx.openKr(a.kr as string)}>{x ? x.p.short + ' KR' + x.n : a.kr}</button> : <span className="st-tag">Business priority</span>}</td>
        <td className="st-sm-t" style={{ whiteSpace: 'nowrap' }}>{ag ? fmtDate(ag.date) : '—'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {ctx.canEdit ? <input type="date" aria-label={'Due date of ' + actId(a)} value={a.due || ''} onChange={e => save({ due: e.target.value })} style={{ padding: '4px 8px' }} /> : (a.due ? fmtDate(a.due) : '—')}
          {isOverdue(a) && <span className="st-bad" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>Overdue</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {ctx.canEdit ? (
            <select aria-label={'Status of ' + actId(a)} value={a.status} onChange={e => save({ status: e.target.value as Action['status'], closedOn: e.target.value === 'open' ? '' : today() })} style={{ padding: '4px 8px' }}>
              <option value="open">Open</option><option value="done">Done</option><option value="dropped">Dropped</option>
            </select>
          ) : a.status === 'open' ? 'Open' : a.status === 'done' ? 'Done' : 'Dropped'}
        </td>
      </tr>
      {open && (
        <tr className="st-hist"><td colSpan={7}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 900 }}>
            {nUp ? (a.updates || []).map((u, i) => ({ u, i })).reverse().map(({ u, i }) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                <div className="st-row">
                  <b style={{ fontWeight: 500, fontSize: 12 }}>{fmtDate(u.date, true)}</b>
                  <span className="st-sm-t">{[u.by ? nameFromEmail(u.by) : '', u.session ? 'from ELT ' + fmtDate(u.session) : ''].filter(Boolean).join(' · ')}</span>
                  {ctx.canEdit && <button type="button" className={`rm-mbtn del${armed === i ? ' armed' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => delComment(i)}>{armed === i ? 'Click again to delete' : 'Delete'}</button>}
                </div>
                <span style={{ fontSize: 13, lineHeight: 1.5 }}>{u.text}</span>
              </div>
            )) : <span className="st-sm-t" style={{ fontSize: 13 }}>No comments yet.</span>}
            {ctx.canEdit && (
              <div className="st-row">
                <input type="text" aria-label="New comment" value={comment} placeholder="e.g. Almost complete, final report to do, on track for December" style={{ flex: '1 1 360px' }}
                  onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addComment() }} />
                <button type="button" className="rm-btn rm-btn--sm" onClick={addComment}>Add comment</button>
              </div>
            )}
          </div>
        </td></tr>
      )}
    </Fragment>
  )
}

