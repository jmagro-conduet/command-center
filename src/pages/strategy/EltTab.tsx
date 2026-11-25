import { useEffect, useMemo, useRef, useState } from 'react'
import { authClient } from '../../lib/supabase'
import type { Action, Proposal, PropAction, PropItem, Session, StatusCode } from '../../lib/strategy/logic'
import {
  STATUS_LABEL, STATUS_ORDER, actId, actionList, actionsDueBy, agendaFor, agendaText, allKrs, allSessions, baseFor, buildDraftRequest, buildProposal, buildReviewWrites,
  clock, codeOf, fmtDate, inPeriod, krById, ownerNames, proposalFromSaved, reviewProgress, savedSessions, suggestNextDate, uid,
} from '../../lib/strategy/logic'
import type { Ctx } from './ui'
import { Empty, StatusPill, StatusSelect } from './ui'
import { saveErr } from './helpers'

const sessionDoc = (s: Session, patch: Partial<Session>) => { const { id: _id, ...rest } = s; void _id; return { ...rest, ...patch } as Record<string, unknown> }

export default function EltTab({ ctx }: { ctx: Ctx }) {
  const { data, plan } = ctx
  const sessions = allSessions(data, plan)
  const upcoming = sessions.filter(s => s.state !== 'saved').sort((a, b) => (a.date < b.date ? -1 : 1))[0]
  const ses: Session | undefined = (ctx.eltId && data.sessions[ctx.eltId]) || upcoming || sessions[0]
  const [newDate, setNewDate] = useState(() => suggestNextDate(data, plan))

  async function addElt() {
    const d = newDate; if (!d) return
    if (!inPeriod(plan, d)) { ctx.toast(`That date is outside ${plan.period} (${fmtDate(plan.periodStart)} to ${fmtDate(plan.periodEnd)}).`); return }
    if (data.sessions[d]) { ctx.setEltId(d); return }
    try { await ctx.writer.set('sessions', d, { date: d, state: 'open', createdAt: new Date().toISOString() }); ctx.setEltId(d); ctx.setEltStage('before'); ctx.toast('ELT on ' + fmtDate(d, true) + ' added') }
    catch (e) { ctx.toast(saveErr(e)) }
  }

  const controls = (
    <div className="st-ctl">
      {sessions.length > 0 && (
        <select aria-label="ELT" value={ses?.id || ''} onChange={e => ctx.setEltId(e.target.value)}>
          {sessions.map(s => <option key={s.id} value={s.id}>{(s.baseline ? 'Baseline · ' : 'ELT · ') + fmtDate(s.date, true) + (s.baseline ? '' : s.state === 'saved' ? ' · saved' : data.proposals[s.id] ? ' · in review' : '')}</option>)}
        </select>
      )}
      {ctx.canEdit && <>
        <label htmlFor="st-newelt">New ELT</label>
        <input id="st-newelt" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
        <button type="button" className="rm-btn rm-btn--sm" onClick={addElt}>Add</button>
      </>}
    </div>
  )

  if (!ses) {
    return <>{controls}<Empty title="No ELT sessions yet">{ctx.canEdit ? 'Add your next ELT date above. Its agenda is built automatically from the latest status of every key result.' : 'The admin adds each ELT date here.'}</Empty></>
  }

  const stateTxt = ses.state === 'saved' ? 'Saved to history' + (ses.savedAt ? ' on ' + fmtDate(ses.savedAt.slice(0, 10)) : '') : data.proposals[ses.id] ? 'Updates drafted, waiting for review' : 'Agenda ready'
  return (
    <>
      {controls}
      <section className="rm-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div className="rm-lbl">Monthly ELT · 45 min</div>
          <h2 style={{ fontSize: 22, margin: '4px 0' }}>{fmtDate(ses.date, true)}</h2>
          <div className="st-sm-t" style={{ fontSize: 13 }}>{stateTxt}</div>
        </div>
        <div className="rm-seg" role="tablist" aria-label="ELT stage">
          <button type="button" role="tab" aria-pressed={ctx.eltStage === 'before'} onClick={() => ctx.setEltStage('before')}>Before · Agenda</button>
          <button type="button" role="tab" aria-pressed={ctx.eltStage === 'after'} onClick={() => ctx.setEltStage('after')}>{ses.state === 'saved' ? 'After · Saved updates' : 'After · Review updates'}</button>
        </div>
      </section>
      {ctx.eltStage === 'before' ? <Before ctx={ctx} ses={ses} /> : <After ctx={ctx} ses={ses} />}
    </>
  )
}

// ------------------------------------------------------------------ before: the agenda
function Before({ ctx, ses }: { ctx: Ctx; ses: Session }) {
  const { data, plan } = ctx
  const ag = useMemo(() => agendaFor(data, plan, ses), [data, plan, ses])
  const done = allKrs(plan).filter(x => codeOf(baseFor(data, x.k.id, ses)) === 'done')
  const due = actionsDueBy(data, ses)
  const overdue = due.filter(a => a.due < ses.date).length
  const closeLen = Math.max(5, 45 - ag.closeAt)
  const [copyText, setCopyText] = useState('')

  async function copy() {
    const t = agendaText(data, plan, ses)
    try { await navigator.clipboard.writeText(t); ctx.toast('Agenda copied') } catch { setCopyText(t); ctx.toast('Copy the agenda from the box below') }
  }
  return (
    <>
      {!savedSessions(data, plan).some(s => s.date < ses.date) && <div className="st-note"><b>First ELT:</b> set a starting status for each key result.</div>}
      <div className="st-split">
        <section className="rm-card" aria-label="Agenda">
          <div className="st-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ fontSize: 15 }}>Agenda · {ag.total} outstanding key results</h2>
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={copy}>Copy agenda</button>
          </div>
          <div className="st-sm-t" style={{ fontSize: 13, marginBottom: 6 }}>Off-track and at-risk first. Name the KR as you speak.</div>
          <div className="st-agrow">
            <div><div style={{ fontWeight: 500 }}>0:00</div><div className="st-sm-t">5 min</div></div>
            <div><div style={{ fontWeight: 500 }}>Actions and business priorities</div>
              <div className="st-sm-t" style={{ fontSize: 13, marginTop: 4 }}>{due.length ? `${due.length} action${due.length > 1 ? 's' : ''} due${overdue ? ', ' + overdue + ' overdue' : ''}. Confirm done, re-date or drop.` : 'No actions due. Raise any new business priorities.'}</div></div>
          </div>
          {ag.items.filter(it => it.krs.length).map(it => (
            <div className="st-agrow" key={it.p.id}>
              <div><div style={{ fontWeight: 500 }}>{clock(it.start)}</div><div className="st-sm-t">{it.mins} min</div></div>
              <div>
                <div className="st-row" style={{ justifyContent: 'space-between' }}><span style={{ fontWeight: 500 }}>{it.p.name}</span><span className="st-faint">{it.p.owner}</span></div>
                {it.krs.map(r => (
                  <div className="st-kline" key={r.k.id}>
                    <span className="st-ref">KR{r.n}</span>
                    <span>{r.k.text}{r.nh && <span className="st-bad" style={{ display: 'block', fontSize: 12 }}>Not discussed at the last ELT</span>}</span>
                    {ctx.canEdit ? (
                      <button type="button" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                        aria-label={`Update status of ${it.p.short} KR${r.n}, currently ${STATUS_LABEL[r.cc]}`} onClick={() => ctx.openKr(r.k.id, { session: ses.id, edit: true })}>
                        <StatusPill code={r.cc} />
                      </button>
                    ) : <StatusPill code={r.cc} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="st-agrow">
            <div><div style={{ fontWeight: 500 }}>{clock(ag.closeAt)}</div><div className="st-sm-t">{closeLen} min</div></div>
            <div><div style={{ fontWeight: 500 }}>New actions and priorities</div>
              <div className="st-sm-t" style={{ fontSize: 13, marginTop: 4 }}>Say each action with an owner and a date. If it does not belong to a key result, say so and it is tracked as a business priority.</div></div>
          </div>
          {done.length > 0 && (
            <details style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
              <summary style={{ fontWeight: 500, cursor: 'pointer' }}>Completed · off the agenda ({done.length})</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
                {done.map(x => <span key={x.k.id} className="st-sm-t" style={{ fontSize: 13 }}>{x.p.name} KR{x.n} · {x.k.text}</span>)}
              </div>
            </details>
          )}
          {copyText && <textarea aria-label="Agenda text" readOnly value={copyText} style={{ minHeight: 220, marginTop: 10 }} onFocus={e => e.currentTarget.select()} />}
        </section>

        <section className="rm-card" aria-label="Actions due">
          <div className="st-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ fontSize: 15 }}>Actions due by this ELT</h2>
            <button type="button" className="st-linkbtn" onClick={() => ctx.goTab('actions')}>All actions</button>
          </div>
          {due.length ? <div className="st-list">{due.map(a => {
            const lu = (a.updates || []).slice(-1)[0]
            return (
              <div className="st-li" key={a.id}>
                <div className="st-row" style={{ justifyContent: 'space-between' }}>
                  <span className="st-sm-t">{actId(a)} · {a.kr ? krLabel(ctx, a.kr) : 'Business priority'}</span>
                  <span className={a.due < ses.date ? 'st-bad' : 'st-sm-t'} style={{ fontSize: 12 }}>{(a.due < ses.date ? 'Overdue · ' : 'Due · ') + fmtDate(a.due)}</span>
                </div>
                <span>{a.text}</span><span className="st-faint">{a.owner || 'No owner'}</span>
                {lu && <span className="st-sm-t">{fmtDate(lu.date)}: {lu.text}</span>}
              </div>
            )
          })}</div> : <div className="st-sm-t" style={{ fontSize: 13 }}>Nothing due by this date.</div>}
        </section>
      </div>
    </>
  )
}
function krLabel(ctx: Ctx, id: string) { const x = krById(ctx.data, ctx.plan, id); return x ? x.p.short + ' KR' + x.n : id }

// ------------------------------------------------------------------ after: draft, review, saved
function After({ ctx, ses }: { ctx: Ctx; ses: Session }) {
  if (ses.state === 'saved') return <SavedView ctx={ctx} ses={ses} />
  if (!ctx.canEdit) return <Empty title="Updates not saved yet">The updates from this ELT appear here once the admin has reviewed and saved them after the meeting. Until then, Strategy on a Page shows the latest saved statuses.</Empty>
  const stored = ctx.data.proposals[ses.id]
  if (stored) return <ReviewView key={stored.createdAt} ctx={ctx} ses={ses} stored={stored} />
  return <DraftBox ctx={ctx} ses={ses} />
}

async function startReview(ctx: Ctx, ses: Session, prop: Proposal) {
  const { id: _id, ...doc } = prop; void _id
  await ctx.writer.batch({ sets: [{ collection: 'proposals', id: ses.id, data: doc as unknown as Record<string, unknown> }, { collection: 'sessions', id: ses.id, data: sessionDoc(ses, { state: 'review' }) }], deletes: [] })
}

async function functionError(error: { context?: { json?: () => Promise<{ error?: string }> } } | null, fallback: string): Promise<string> {
  try { const j = await error?.context?.json?.(); if (j?.error) return String(j.error) } catch { /* fall through */ }
  return fallback
}

function DraftBox({ ctx, ses }: { ctx: Ctx; ses: Session }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function draft() {
    if (notes.trim().length < 40) { setMsg('Paste the meeting notes first.'); return }
    setBusy(true); setMsg('')
    try {
      const { data: out, error } = await authClient.functions.invoke('strategy-draft-review', { body: buildDraftRequest(ctx.data, ctx.plan, ses, notes) })
      if (error || !out?.ok) throw new Error(error ? await functionError(error, "Couldn't draft updates.") : out?.error || "Couldn't draft updates.")
      await startReview(ctx, ses, buildProposal(ctx.data, ctx.plan, ses, out.draft, 'Drafted from pasted meeting notes', new Date().toISOString()))
      ctx.toast('Updates drafted, ready to review')
    } catch (e) { setMsg((e instanceof Error ? e.message : "Couldn't draft updates.") + ' Try again, or start a blank review.') }
    setBusy(false)
  }
  async function blank() {
    try { await startReview(ctx, ses, buildProposal(ctx.data, ctx.plan, ses, null, 'Entered by hand', new Date().toISOString())) } catch (e) { ctx.toast(saveErr(e)) }
  }
  return (
    <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="st-aibanner"><span><span className="st-ailbl">After the meeting</span>Bring in the ELT notes from Spinach. Claude drafts a check-in for every key result plus new and closed actions. Nothing is saved until you approve it.</span></div>
      <div>
        <label htmlFor="st-notes" style={{ fontWeight: 500, fontSize: 14 }}>Spinach notes for {fmtDate(ses.date, true)}</label>
        <div className="st-sm-t" style={{ fontSize: 13, margin: '2px 0 8px' }}>Paste the Spinach summary, action items and decisions, or the transcript.</div>
        <textarea id="st-notes" style={{ minHeight: 200 }} value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} />
      </div>
      <div className="st-row">
        <button type="button" className="rm-btn rm-btn--ai" disabled={busy} onClick={draft}>{busy ? 'Drafting…' : 'Draft updates with Claude'}</button>
        <button type="button" className="rm-btn rm-btn--ghost" disabled={busy} onClick={blank}>Start a blank review</button>
        <span className="st-sm-t" role="status" style={{ fontSize: 13 }}>{busy ? `Drafting updates for ${allKrs(ctx.plan).length} key results. This takes about a minute.` : msg}</span>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ review
function ReviewView({ ctx, ses, stored }: { ctx: Ctx; ses: Session; stored: Proposal }) {
  const { data, plan } = ctx
  const [prop, setProp] = useState<Proposal>(() => JSON.parse(JSON.stringify(stored)))
  const [armed, setArmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Edit a copy, show it now, and save the draft shortly after so work survives a reload.
  function mut(fn: (p: Proposal) => void) {
    const n: Proposal = JSON.parse(JSON.stringify(prop)); fn(n); setProp(n)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const { id: _id, ...doc } = n; void _id
      doc.items = doc.items.map(i => { const { editing: _e, ...r } = i; void _e; return r as PropItem })
      doc.newActions = doc.newActions.map(a => { const { editing: _e, ...r } = a; void _e; return r as PropAction })
      ctx.writer.set('proposals', ses.id, doc as unknown as Record<string, unknown>).catch(e => ctx.toast(saveErr(e, "Couldn't save the draft.")))
    }, 600)
  }

  const prog = reviewProgress(prop)
  const changes = prop.items.filter(i => i.kind === 'change')
  const owners = ownerNames(data)
  const byPillar = (pid: string) => prop.items.map(it => ({ it, x: krById(data, plan, it.kr) })).filter(r => r.x && r.x.p.id === pid)
    .sort((a, b) => { const k = { change: 0, same: 1, notheard: 2 }; return (k[a.it.kind] - k[b.it.kind]) || (STATUS_ORDER[a.it.status] - STATUS_ORDER[b.it.status]) || (a.x!.n - b.x!.n) })

  async function save() {
    setSaving(true)
    try {
      const w = buildReviewWrites(data, ses, prop, new Date().toISOString(), ctx.me)
      await ctx.writer.batch(w)
      ctx.toast('Saved to history'); ctx.setAsOf(''); ctx.goTab('home')
    } catch (e) { ctx.toast(saveErr(e, "Couldn't save the review. Nothing was changed. Try again.")) }
    setSaving(false)
  }
  async function discard() {
    if (!armed) { setArmed(true); return }
    window.clearTimeout(timer.current)
    try { await ctx.writer.remove('proposals', ses.id); await ctx.writer.update('sessions', ses.id, { state: 'open' }) } catch (e) { ctx.toast(saveErr(e)) }
  }
  const saveBtn = <button type="button" className="rm-btn" disabled={prog.left > 0 || saving} onClick={save}>{saving ? 'Saving…' : prog.left ? prog.left + ' left to review' : 'Save to history'}</button>

  return (
    <>
      <div className="st-aibanner">
        <span style={{ maxWidth: 820 }}><span className="st-ailbl">{prop.source || 'Drafted'}</span>Laid out in agenda order. Approve or change each status change, confirm the unchanged key results, then save.</span>
        <div className="st-row"><span style={{ fontWeight: 500 }}>{changes.length} to decide · {prop.items.filter(i => i.kind === 'same').length} to confirm · {prop.items.filter(i => i.kind === 'notheard').length} not heard</span>{saveBtn}</div>
      </div>

      <ActionsCard ctx={ctx} prop={prop} mut={mut} />

      {plan.pillars.map(p => {
        const rows = byPillar(p.id)
        if (!rows.length) return null
        const sameP = rows.filter(r => r.it.kind === 'same' && r.it.decision === 'pending')
        const chP = rows.filter(r => r.it.kind === 'change' && r.it.decision === 'pending' && !r.it.editing)
        const acts = prop.newActions.filter(a => { const x = a.kr && krById(data, plan, a.kr); return x && x.p.id === p.id })
        return (
          <section className="rm-card" key={p.id} style={{ padding: '18px 22px' }}>
            <div className="st-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ fontSize: 15 }}>{p.name}</h2>
              <div className="st-row">
                {chP.length > 1 && <button type="button" className="rm-btn rm-btn--sm" onClick={() => mut(n => chP.forEach(r => { const i = n.items.find(z => z.kr === r.it.kr); if (i) i.decision = 'approved' }))}>Approve {chP.length} changes</button>}
                {sameP.length > 0 && <button type="button" className="rm-btn rm-btn--sm" onClick={() => mut(n => sameP.forEach(r => { const i = n.items.find(z => z.kr === r.it.kr); if (i) i.decision = 'approved' }))}>Confirm {sameP.length} unchanged</button>}
                {!sameP.length && !rows.some(r => r.it.decision === 'pending') && <span className="st-sm-t">All reviewed</span>}
              </div>
            </div>
            {rows.map(r => <ReviewRow key={r.it.kr} it={r.it} n={r.x!.n} text={r.x!.k.text} unit={r.x!.k.target ? r.x!.k.unitLabel || 'Value' : ''} mut={mut} />)}
            {acts.map(a => <ActionProposalRow key={a.tid} ctx={ctx} a={a} mut={mut} owners={owners} />)}
          </section>
        )
      })}

      <section className="rm-card" style={{ padding: '18px 22px' }}>
        <div className="st-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ fontSize: 15 }}>New actions and priorities</h2>
          <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => mut(n => { n.newActions.push({ tid: uid(), text: '', owner: '', due: '', kr: null, confidence: null, decision: 'pending', editing: true }) })}>Add action</button>
        </div>
        {prop.newActions.filter(a => !a.kr).length
          ? prop.newActions.filter(a => !a.kr).map(a => <ActionProposalRow key={a.tid} ctx={ctx} a={a} mut={mut} owners={owners} />)
          : <span className="st-sm-t" style={{ fontSize: 13 }}>No business priorities raised. Actions linked to a key result appear in their pillar above.</span>}
      </section>

      <div className="st-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className={`rm-mbtn del${armed ? ' armed' : ''}`} onClick={discard}>{armed ? 'Click again to discard the draft' : 'Discard draft'}</button>
        {saveBtn}
      </div>
    </>
  )
}

type Mut = (fn: (p: Proposal) => void) => void

function ReviewRow({ it, n, text, unit, mut }: { it: PropItem; n: number; text: string; unit: string; mut: Mut }) {
  const upd = (fn: (i: PropItem) => void) => mut(p => { const i = p.items.find(z => z.kr === it.kr); if (i) fn(i) })
  const note = it.kind === 'notheard'
    ? (it.prev === 'none' ? 'Not discussed. No check-in recorded yet; it is flagged at the next ELT.' : 'Not discussed. Status carries forward and it is flagged at the next ELT.')
    : (it.note || (it.kind === 'same' ? 'No change.' : ''))
  return (
    <div className="st-rv">
      <div className="st-rv-top">
        <span className="st-ref">KR{n}</span>
        <div><div>{text}</div><div className="st-sm-t" style={{ fontSize: 13, marginTop: 3 }}>{note + (it.value ? ' · Value: ' + it.value : '')}</div></div>
        {it.kind === 'change' ? <div className="st-row" style={{ gap: 6 }}><StatusPill code={it.prev} /><span aria-hidden="true">→</span><StatusPill code={it.status} ai /></div>
          : it.kind === 'notheard' ? <span className="rm-st rm-st-none">Not heard</span>
          : <div className="st-row" style={{ gap: 6 }}><StatusPill code={it.status} />{it.decision === 'approved' && <span className="st-sm-t">Confirmed</span>}</div>}
      </div>
      {it.kind === 'change' && !it.editing && (
        <div className="st-rv-why">
          <span style={{ flex: '1 1 300px' }}>
            {it.quote ? <>{it.speaker && <b style={{ fontWeight: 500, color: '#000' }}>{it.speaker + (it.at ? ' · ' + it.at : '') + ': '}</b>}&ldquo;{it.quote}&rdquo;</> : it.live ? 'Status set live in the meeting.' : 'No supporting quote found in the notes.'}
            {it.confidence != null && it.confidence < 0.7 && <span className="st-aipill" style={{ marginLeft: 8 }}>Low confidence, check</span>}
          </span>
          <span className="st-row" style={{ gap: 6 }}>
            {it.decision === 'approved' ? <span className="st-approved">Approved</span> : <button type="button" className="rm-btn rm-btn--sm" onClick={() => upd(i => { i.decision = 'approved' })}>Approve</button>}
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => upd(i => { i.editing = true })}>Edit</button>
            <button type="button" className="rm-mbtn del" onClick={() => upd(i => { i.kind = 'same'; i.status = (i.prev === 'none' ? 'ns' : i.prev) as StatusCode; i.value = ''; i.decision = 'pending' })}>Reject</button>
          </span>
        </div>
      )}
      {it.editing && <EditBox it={it} unit={unit} upd={upd} />}
      {it.kind !== 'change' && !it.editing && <button type="button" className="st-linkbtn" style={{ marginLeft: 50, alignSelf: 'flex-start' }} onClick={() => upd(i => { i.editing = true })}>Edit</button>}
    </div>
  )
}

function EditBox({ it, unit, upd }: { it: PropItem; unit: string; upd: (fn: (i: PropItem) => void) => void }) {
  const [status, setStatus] = useState<StatusCode>(it.status)
  const [value, setValue] = useState(it.value)
  const [note, setNote] = useState(it.note)
  return (
    <div className="st-edit">
      <label>Status<StatusSelect value={status} onChange={setStatus} /></label>
      <label>{unit || 'Value (optional)'}<input type="text" value={value} style={{ maxWidth: 140 }} onChange={e => setValue(e.target.value)} /></label>
      <label className="st-fgrow">Note<input type="text" value={note} onChange={e => setNote(e.target.value)} /></label>
      <button type="button" className="rm-btn rm-btn--sm" onClick={() => upd(i => {
        i.status = status; i.value = value.trim(); i.note = note.trim(); i.editing = false
        const base = i.prev === 'none' ? 'ns' : i.prev
        i.kind = (i.prev === 'none' || i.status !== base || i.value) ? 'change' : 'same'; i.decision = 'approved'
      })}>Done</button>
    </div>
  )
}

function ActionProposalRow({ ctx, a, mut, owners }: { ctx: Ctx; a: PropAction; mut: Mut; owners: string[] }) {
  const upd = (fn: (x: PropAction) => void) => mut(p => { const x = p.newActions.find(z => z.tid === a.tid); if (x) fn(x) })
  const remove = () => mut(p => { p.newActions = p.newActions.filter(z => z.tid !== a.tid) })
  const [text, setText] = useState(a.text), [owner, setOwner] = useState(a.owner), [due, setDue] = useState(a.due), [kr, setKr] = useState(a.kr || '')
  if (a.editing) {
    return (
      <div className="st-rv">
        <div className="st-edit" style={{ marginLeft: 0 }}>
          <label className="st-fgrow">Action<input type="text" value={text} onChange={e => setText(e.target.value)} /></label>
          <label>Owner<input type="text" list="st-owners" value={owner} placeholder="Choose or type a name" style={{ maxWidth: 200 }} onChange={e => setOwner(e.target.value)} /></label>
          <label>Due<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
          <label>Key result<KrSelect ctx={ctx} value={kr} onChange={setKr} /></label>
          <button type="button" className="rm-btn rm-btn--sm" onClick={() => { if (!text.trim()) remove(); else upd(x => { x.text = text.trim(); x.owner = owner.trim(); x.due = due; x.kr = kr || null; x.editing = false; x.decision = 'approved' }) }}>Done</button>
        </div>
        <datalist id="st-owners">{owners.map(n => <option key={n} value={n} />)}</datalist>
      </div>
    )
  }
  const flags: string[] = []; if (!a.owner) flags.push('Add an owner'); if (!a.due) flags.push('Add a due date')
  return (
    <div className="st-rv" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      {a.kr ? <span className="st-aipill">New action</span> : <span className="st-tag">Business priority</span>}
      <span style={{ flex: '1 1 280px', fontSize: 13, lineHeight: 1.45 }}>{a.text}<span className="st-sm-t">{' · ' + (a.owner || 'owner not heard') + ' · ' + (a.due ? 'due ' + fmtDate(a.due) : 'no date')}</span></span>
      {flags.length ? <span className="st-bad" style={{ fontSize: 12 }}>{flags.join(' · ')}</span> : (a.confidence != null && a.decision === 'pending' ? <span className="st-aipill">confidence {a.confidence.toFixed(2)}</span> : null)}
      <span className="st-row" style={{ gap: 6 }}>
        {a.decision === 'approved' ? <span className="st-approved">Approved</span> : <button type="button" className="rm-btn rm-btn--sm" onClick={() => upd(x => { x.decision = 'approved' })}>Approve</button>}
        <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => upd(x => { x.editing = true })}>Edit</button>
        <button type="button" className="rm-mbtn del" onClick={remove}>Remove</button>
      </span>
    </div>
  )
}

export function KrSelect({ ctx, value, onChange, id }: { ctx: Ctx; value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Business priority (no key result)</option>
      {ctx.plan.pillars.map(p => <optgroup key={p.id} label={p.name}>{p.krs.map((k, i) => <option key={k.id} value={k.id}>{'KR' + (i + 1) + ' · ' + k.text.slice(0, 60) + (k.text.length > 60 ? '…' : '')}</option>)}</optgroup>)}
    </select>
  )
}

// Existing actions: progress comments the AI heard, and which open actions to close.
function ActionsCard({ ctx, prop, mut }: { ctx: Ctx; prop: Proposal; mut: Mut }) {
  const { data } = ctx
  const open = actionList(data).filter(a => a.status === 'open' && !prop.closed.some(c => c.id === a.id))
  const line = (a: Action, extra: string) => <><span style={{ lineHeight: 1.45 }}>{a.text}</span><span className="st-sm-t">{actId(a) + ' · ' + (a.owner || '') + extra}</span></>
  return (
    <section className="rm-card" style={{ padding: '18px 22px' }}>
      <div className="st-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ fontSize: 15 }}>Actions and business priorities</h2>
        <span className="st-sm-t">{prop.closed.length ? prop.closed.length + ' reported done' : 'None reported done'}</span>
      </div>
      {prop.actionNotes.map((c, i) => { const a = data.actions[c.id]; if (!a) return null
        return (
          <div className="st-li" key={'n' + c.id}>
            <div className="st-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>{line(a, ' · progress update')}</div>
              <label className="st-row" style={{ flexWrap: 'nowrap', fontSize: 13 }}><input type="checkbox" checked={c.keep} onChange={e => mut(p => { p.actionNotes[i].keep = e.target.checked })} />Add as comment</label>
            </div>
            <input type="text" aria-label={'Comment for ' + actId(a)} value={c.note} onChange={e => mut(p => { p.actionNotes[i].note = e.target.value })} />
          </div>
        ) })}
      {prop.closed.map((c, i) => { const a = data.actions[c.id]; if (!a) return null
        return (
          <div className="st-li" key={'c' + c.id}>
            <div className="st-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>{line(a, c.evidence ? ' · "' + c.evidence + '"' : '')}</div>
              <label className="st-row" style={{ flexWrap: 'nowrap', fontSize: 13 }}><input type="checkbox" checked={c.close} onChange={e => mut(p => { p.closed[i].close = e.target.checked })} />Close</label>
            </div>
          </div>
        ) })}
      <div className="st-row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
        <label htmlFor="st-closeother" style={{ fontSize: 12, color: 'var(--ink-2)' }}>Close another open action</label>
        <select id="st-closeother" value="" onChange={e => { const id = e.target.value; if (id) mut(p => { p.closed.push({ id, evidence: '', close: true }) }) }}>
          <option value="">{open.length ? 'Choose…' : 'No other open actions'}</option>
          {open.map(a => <option key={a.id} value={a.id}>{actId(a) + ' · ' + a.text}</option>)}
        </select>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ saved view
function SavedView({ ctx, ses }: { ctx: Ctx; ses: Session }) {
  const { data, plan } = ctx
  const agreed = actionList(data).filter(a => a.agreedAt === ses.id)
  const closed = actionList(data).filter(a => a.closedAt === ses.id)
  const decisions = (ses.decisions || []).map(d => (typeof d === 'string' ? d : (d as { text?: string })?.text || '')).filter(Boolean)
  const links = ses.notesSources && typeof ses.notesSources === 'object' ? Object.entries(ses.notesSources as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && /^https?:\/\//.test(v as string)) : []
  async function reopen() {
    try {
      const prop = data.proposals[ses.id] || proposalFromSaved(data, plan, ses, new Date().toISOString())
      const { id: _id, ...doc } = prop as Proposal; void _id
      await ctx.writer.batch({ sets: [{ collection: 'proposals', id: ses.id, data: doc as unknown as Record<string, unknown> }, { collection: 'sessions', id: ses.id, data: sessionDoc(ses, { state: 'review' }) }], deletes: [] })
      ctx.setEltStage('after')
    } catch (e) { ctx.toast(saveErr(e)) }
  }
  return (
    <>
      {ses.baseline && <div className="st-note">This is the baseline taken before tracking started. No statuses were set.</div>}
      {ctx.canEdit && !ses.baseline && (
        <div className="st-note">These updates were saved to history. To change them, reopen the review. The saved check-ins are replaced when you save again.
          <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" style={{ marginLeft: 'auto' }} onClick={reopen}>Reopen review</button></div>
      )}
      {decisions.length > 0 && (
        <section className="rm-card" style={{ padding: '18px 22px' }}>
          <h2 style={{ fontSize: 15, marginBottom: 8 }}>Decisions</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5 }}>{decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
          {links.length > 0 && <div className="st-row" style={{ marginTop: 10 }}>{links.map(([k, v]) => <a key={k} href={v as string} target="_blank" rel="noopener noreferrer" className="st-sm-t" style={{ color: 'var(--pd)' }}>{k[0].toUpperCase() + k.slice(1)} notes</a>)}</div>}
        </section>
      )}
      {!ses.baseline && plan.pillars.map(p => (
        <section className="rm-card" key={p.id} style={{ padding: '18px 22px' }}>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>{p.name}</h2>
          {p.krs.map((k, i) => {
            const c = data.checkins[ses.id + '__' + k.id]
            return (
              <div className="st-kline" key={k.id} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
                <span className="st-ref">KR{i + 1}</span>
                <span>{k.text}<span className="st-sm-t" style={{ display: 'block' }}>{c ? (c.kind === 'notheard' ? 'Not discussed' : c.note || 'No change') + (c.value ? ' · ' + c.value : '') : 'No check-in'}</span></span>
                <StatusPill code={c ? c.status : 'none'} />
              </div>
            )
          })}
        </section>
      ))}
      <section className="rm-card" style={{ padding: '18px 22px' }}>
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Actions</h2>
        <div className="st-sm-t" style={{ fontSize: 13 }}>{agreed.length} agreed · {closed.length} closed at this ELT</div>
        {agreed.map(a => <div key={a.id} className="st-li">{actId(a)} · {a.text} · {a.owner || 'no owner'}{a.due ? ' · due ' + fmtDate(a.due) : ''}</div>)}
      </section>
    </>
  )
}
