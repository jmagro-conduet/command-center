import { useState } from 'react'
import { actId, actionList, checkinsFor, codeOf, dodFor, dodProg, fmtDate, isOverdue, krById, nameFromEmail, numericValue, pd, today, uid } from '../../lib/strategy/logic'
import type { Checkin, Dod, KrRef, StatusCode } from '../../lib/strategy/logic'
import { Modal } from '../roadmap/ui'
import type { Ctx } from './ui'
import { Field, StatusPill, StatusSelect } from './ui'
import { saveErr } from './helpers'

export default function KrDrawer({ ctx, krId, session, startEdit, onClose }: { ctx: Ctx; krId: string; session?: string; startEdit?: boolean; onClose: () => void }) {
  const x = krById(ctx.data, ctx.plan, krId)
  if (!x) return null
  return <Inner ctx={ctx} x={x} session={session} startEdit={startEdit} onClose={onClose} />
}

function Inner({ ctx, x, session, startEdit, onClose }: { ctx: Ctx; x: KrRef & { plan: { periodStart: string; periodEnd: string } }; session?: string; startEdit?: boolean; onClose: () => void }) {
  const { data, writer } = ctx
  const list = checkinsFor(data, x.k.id).slice().reverse()
  const cur = list[0]
  const code = codeOf(cur)
  const [editing, setEditing] = useState(!!startEdit && ctx.canEdit)
  const [status, setStatus] = useState<StatusCode>(code === 'none' || code === undefined ? 'ns' : code)
  const [value, setValue] = useState(cur?.value || '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState('')
  const acts = actionList(data).filter(a => a.kr === x.k.id)
  const dod = dodFor(data, x.k.id)

  async function saveStatus() {
    setSaving(true)
    const live = session && data.sessions[session] && data.sessions[session].state !== 'saved' ? data.sessions[session] : null
    const c: Omit<Checkin, 'id'> = {
      kr: x.k.id, status, value: value.trim(), note: note.trim(), quote: '', speaker: '', at: '', kind: live ? 'live' : 'adhoc',
      session: live ? live.id : '', sessionDate: live ? live.date : today(), savedAt: new Date().toISOString(), savedBy: ctx.me,
    }
    try { await writer.set('checkins', (live ? 'live-' : 'adhoc-') + uid(), c); setEditing(false); setNote(''); ctx.toast('Status updated') }
    catch (e) { ctx.toast(saveErr(e)) }
    setSaving(false)
  }
  async function removeUpdate(id: string) {
    if (armed !== id) { setArmed(id); return }
    setArmed('')
    try { await writer.remove('checkins', id); ctx.toast('Update removed') } catch (e) { ctx.toast(saveErr(e)) }
  }

  return (
    <Modal eyebrow={`${x.p.name} · KR${x.n} · ${x.p.owner}`} title={x.k.text} onClose={onClose}>
      <div className="st-row" style={{ marginTop: 12 }}>
        <StatusPill code={code} />
        {cur?.value && <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 }}>{cur.value}</span>}
      </div>

      <DodSection ctx={ctx} krId={x.k.id} dod={dod} />

      {ctx.canEdit && (editing ? (
        <div className="st-box" style={{ marginTop: 16 }}>
          <div className="rm-eyebrow">Update status</div>
          <Field label="Status"><StatusSelect value={status} onChange={setStatus} /></Field>
          <Field label={x.k.target ? x.k.unitLabel || 'Value' : 'Value (optional)'}><input type="text" value={value} onChange={e => setValue(e.target.value)} /></Field>
          <Field label="Note"><input type="text" value={note} placeholder="What changed?" onChange={e => setNote(e.target.value)} /></Field>
          {dod && dodProg(dod).done < dodProg(dod).total && <span className="st-sm-t">Definition of done: {dodProg(dod).done} of {dodProg(dod).total} ticked. Check it before marking this key result Done.</span>}
          <div className="st-row">
            <button type="button" className="rm-btn rm-btn--sm" disabled={saving} onClick={saveStatus}>Save update</button>
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : <div style={{ marginTop: 16 }}><button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => setEditing(true)}>Update status</button></div>)}
      {!ctx.canEdit && <p className="st-sm-t" style={{ marginTop: 14, fontSize: 13 }}>View only. Updates are made after each ELT.</p>}

      {x.k.target != null && <TargetChart ctx={ctx} x={x} />}

      <div style={{ marginTop: 18 }}>
        <div className="rm-eyebrow">Check-ins</div>
        {list.length ? list.map(c => (
          <div className="st-li" key={c.id}>
            <div className="st-row">
              <b style={{ fontWeight: 500 }}>{fmtDate(c.sessionDate)}</b><StatusPill code={c.status} />
              {c.value && <span className="st-sm-t">{c.value}</span>}
              {c.kind === 'notheard' && <span className="st-faint">not discussed, carried forward</span>}
              {c.kind === 'adhoc' && <span className="st-faint">updated between ELTs{c.savedBy ? ' by ' + nameFromEmail(c.savedBy) : ''}</span>}
              {c.kind === 'live' && <span className="st-faint">set live in the ELT, review not saved yet</span>}
              {c.kind === 'adhoc' && ctx.canEdit && (
                <button type="button" className={`rm-mbtn del${armed === c.id ? ' armed' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => removeUpdate(c.id)}>
                  {armed === c.id ? 'Click again to remove' : 'Remove'}
                </button>
              )}
            </div>
            {c.note && <span>{c.note}</span>}
            {c.quote && <span className="st-sm-t">{c.speaker ? c.speaker + (c.at ? ' · ' + c.at : '') + ': ' : ''}&ldquo;{c.quote}&rdquo;</span>}
          </div>
        )) : <div className="st-li st-sm-t">No check-ins yet. The first one is recorded at the next ELT.</div>}
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="rm-eyebrow">Actions</div>
        {acts.length ? acts.map(a => {
          const lu = (a.updates || []).slice(-1)[0]
          return (
            <div className="st-li" key={a.id}>
              <span className={isOverdue(a) ? 'st-bad' : 'st-sm-t'} style={{ fontSize: 12 }}>{actId(a)} · {a.status === 'open' ? (a.due ? (isOverdue(a) ? 'Overdue · ' : 'Due ') + fmtDate(a.due) : 'No due date') : a.status === 'done' ? 'Done' : 'Dropped'}</span>
              <span>{a.text}</span><span className="st-faint">{a.owner}</span>
              {lu && <span className="st-sm-t">{fmtDate(lu.date)}: {lu.text}</span>}
            </div>
          )
        }) : <div className="st-li st-sm-t">No actions linked to this key result.</div>}
      </div>
    </Modal>
  )
}

function DodSection({ ctx, krId, dod }: { ctx: Ctx; krId: string; dod: Dod | null }) {
  const src = ctx.data.dods[krId]
  const [edit, setEdit] = useState(false)
  const [items, setItems] = useState('')
  const [evidence, setEvidence] = useState('')
  const [signoff, setSignoff] = useState('')
  const [question, setQuestion] = useState('')

  async function save(patch: Partial<Dod>) {
    const cur = src || ({} as Partial<Dod>)
    const data = { kr: krId, state: cur.state || 'draft', items: cur.items || [], evidence: cur.evidence || '', signoff: cur.signoff || '', question: cur.question || '', ...patch, updatedAt: new Date().toISOString(), updatedBy: ctx.me }
    delete (data as Partial<Dod>).id
    try { await ctx.writer.set('dods', krId, data) } catch (e) { ctx.toast(saveErr(e)); throw e }
  }
  function open() {
    setItems((src?.items || []).map(i => i.text).join('\n')); setEvidence(src?.evidence || ''); setSignoff(src?.signoff || ''); setQuestion(src?.question || ''); setEdit(true)
  }
  async function commit() {
    const lines = items.split('\n').map(l => l.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean)
    if (!lines.length) { ctx.toast('Add at least one "done when" item, one per line.'); return }
    const old = src?.items || []
    const merged = lines.map(t => old.find(o => o.text === t) || { id: uid(), text: t, done: false })
    try { await save({ items: merged, evidence: evidence.trim(), signoff: signoff.trim(), question: question.trim() }); setEdit(false); ctx.toast('Definition of done saved') } catch { /* toast shown */ }
  }

  if (edit && ctx.canEdit) {
    return (
      <div className="st-box" style={{ marginTop: 16 }}>
        <div className="rm-eyebrow">Definition of done</div>
        <Field label="Done when (one item per line, five at most works best)"><textarea style={{ minHeight: 120 }} value={items} onChange={e => setItems(e.target.value)} /></Field>
        <Field label="Evidence"><input type="text" value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>
        <Field label="Signed off by"><input type="text" value={signoff} onChange={e => setSignoff(e.target.value)} /></Field>
        <Field label="Open question (optional)"><input type="text" value={question} onChange={e => setQuestion(e.target.value)} /></Field>
        <div className="st-row"><button type="button" className="rm-btn rm-btn--sm" onClick={commit}>Save</button><button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => setEdit(false)}>Cancel</button></div>
      </div>
    )
  }
  if (!dod) return ctx.canEdit ? <button type="button" className="st-linkbtn" style={{ marginTop: 14 }} onClick={open}>+ Add a definition of done</button> : null
  const p = dodProg(dod), agreed = dod.state === 'agreed'
  return (
    <div className="st-box" style={{ marginTop: 16 }} aria-label="Definition of done">
      <div className="st-row" style={{ justifyContent: 'space-between' }}>
        <div className="st-row"><span className="rm-eyebrow" style={{ margin: 0 }}>Definition of done</span>
          <span className={`st-dod${agreed ? ' agreed' : ''}`} style={{ margin: 0 }}>{agreed ? 'Agreed' + (dod.agreedAt ? ' ' + fmtDate(dod.agreedAt) : '') : 'Draft, for ELT review'}</span></div>
        <span className="st-sm-t">{p.done} of {p.total} done</span>
      </div>
      <div className="st-meter" aria-hidden="true"><span style={{ width: Math.round(p.done / p.total * 100) + '%' }} /></div>
      <div>
        {dod.items.map((it, i) => (
          <label className={`st-check${it.done ? ' done' : ''}`} key={it.id}>
            <input type="checkbox" checked={!!it.done} disabled={!ctx.canEdit} onChange={e => {
              const items = (ctx.data.dods[krId]?.items || []).map((o, j) => j === i ? { ...o, done: e.target.checked, doneAt: e.target.checked ? today() : '', doneBy: e.target.checked ? ctx.me : '' } : o)
              save({ items }).catch(() => { /* toast shown */ })
            }} />
            <span>{it.text}{it.done && it.doneAt ? <span className="st-faint" style={{ textDecoration: 'none' }}> · {fmtDate(it.doneAt)}</span> : null}</span>
          </label>
        ))}
      </div>
      {dod.evidence && <div style={{ fontSize: 13 }}><b style={{ fontWeight: 500 }}>Evidence: </b><span className="st-sm-t">{dod.evidence}</span></div>}
      {dod.signoff && <div style={{ fontSize: 13 }}><b style={{ fontWeight: 500 }}>Signed off by: </b><span className="st-sm-t">{dod.signoff}</span></div>}
      {dod.question && <div style={{ fontSize: 13 }}><b style={{ fontWeight: 500 }}>Open question: </b>{dod.question}</div>}
      {ctx.canEdit && (
        <div className="st-row">
          <button type="button" className="rm-mbtn" onClick={open}>Edit</button>
          <button type="button" className="rm-mbtn" onClick={() => save(agreed ? { state: 'draft', agreedAt: '' } : { state: 'agreed', agreedAt: today() }).then(() => ctx.toast(agreed ? 'Moved back to draft' : 'Marked as agreed')).catch(() => { /* toast shown */ })}>
            {agreed ? 'Move back to draft' : 'Mark as agreed'}
          </button>
        </div>
      )}
    </div>
  )
}

// Value at each ELT against a straight pace line from base to target across the period.
function TargetChart({ ctx, x }: { ctx: Ctx; x: KrRef & { plan: { periodStart: string; periodEnd: string } } }) {
  const k = x.k
  const pts = checkinsFor(ctx.data, k.id).map(c => ({ d: c.sessionDate, v: numericValue(c.value) })).filter((p): p is { d: string; v: number } => p.v != null)
  const start = pd(x.plan.periodStart), end = pd(x.plan.periodEnd)
  if (!pts.length || !start || !end || end <= start) return null
  const W = 320, H = 110, span = end.getTime() - start.getTime(), base = k.base || 0, target = k.target as number
  if (target === base) return null
  const X = (d: string) => 8 + ((pd(d) as Date).getTime() - start.getTime()) / span * (W - 16)
  const Y = (v: number) => H - 10 - (v - base) / (target - base) * (H - 24)
  return (
    <div style={{ marginTop: 18 }} className="st-chart">
      <div className="rm-eyebrow">{k.unitLabel || 'Value'} at each ELT</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`${k.unitLabel || 'Value'} at each ELT: ${pts.map(p => fmtDate(p.d) + ' ' + p.v).join(', ')}. Target ${target} by ${fmtDate(x.plan.periodEnd, true)}.`}>
        <line x1={8} y1={Y(base)} x2={W - 8} y2={Y(target)} stroke="rgba(0,0,0,0.35)" strokeDasharray="4 4" />
        <polyline points={pts.map(p => X(p.d) + ',' + Y(p.v)).join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" />
        {pts.map(p => <circle key={p.d + p.v} cx={X(p.d)} cy={Y(p.v)} r={3.5} fill="var(--primary)" />)}
      </svg>
      <div className="st-sm-t">Dashed line is the pace to {target.toLocaleString()} by {fmtDate(x.plan.periodEnd)}</div>
    </div>
  )
}
