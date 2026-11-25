// Strategy (OKR tracker) -- pure logic. No React, no network, no imports, so it
// runs unchanged in the browser and under `node --test`.
//
// The model is the one the original OKR tracker used (and its live data was
// copied across in that shape): an OKR period has pillars -> key results (KRs).
// Every monthly ELT records one check-in per KR; nothing is overwritten, the
// latest check-in on or before a date is "the status as of that date".

export type StatusCode = 'on' | 'risk' | 'off' | 'done' | 'ns'
export type Code = StatusCode | 'none'
export const STATUS_CODES: StatusCode[] = ['on', 'risk', 'off', 'done', 'ns']

export const STATUS_LABEL: Record<Code, string> = {
  on: 'On track', risk: 'At risk', off: 'Off track', done: 'Done', ns: 'Not started', none: 'No check-in yet',
}
// Order used to put the worst news first on an agenda.
export const STATUS_ORDER: Record<Code, number> = { off: 0, risk: 1, ns: 2, on: 3, none: 4, done: 5 }
export const STATUS_DEF: Record<StatusCode, string> = {
  on: 'Expected to be achieved by the end of the period with the current plan.',
  risk: 'Could still be achieved, but something needs to change: more pace, a decision or support from the ELT.',
  off: "Won't be achieved without a significant change in plan, scope or resourcing.",
  done: 'Clearly met. The key result leaves the ELT agenda and stays in the history.',
  ns: "Work hasn't begun yet. Still discussed at each ELT so a start date is agreed.",
}

// People whose names the AI should use for action owners, and the owner picker's defaults.
export const ELT_TEAM = ['Alex Gould', 'Alex Jones', 'Coleby Alldis', 'Georgina Mauger', 'John Magro', 'Justin Heath', 'Mike McHugh', 'Simon Doukas']

// ---------------------------------------------------------------- types
export interface Kr { id: string; text: string; base?: number; target?: number; unitLabel?: string }
export interface Pillar { id: string; name: string; short: string; objective: string; owner: string; krs: Kr[] }
export interface Plan {
  id: string; period: string; periodStart: string; periodEnd: string; state: 'draft' | 'locked'
  northStar: string; vision: string; pillars: Pillar[]; version?: number; lockedAt?: string; source?: string
}
export interface Decision { text?: string; [k: string]: unknown }
export interface Session {
  id: string; date: string; state: 'open' | 'review' | 'saved'; baseline?: boolean
  createdAt?: string; savedAt?: string; savedBy?: string | null; decisions?: unknown[]; notesSources?: unknown
}
export type CheckinKind = 'change' | 'same' | 'notheard' | 'live' | 'adhoc'
export interface Checkin {
  id: string; kr: string; status: Code; value: string; note: string; quote: string; speaker: string; at: string
  kind: CheckinKind; session: string; sessionDate: string; savedAt: string; savedBy?: string | null
}
export interface ActionUpdate { date: string; at?: string; by?: string | null; text: string; session?: string }
export interface Action {
  id: string; num: number; text: string; owner: string; due: string; kr: string | null
  status: 'open' | 'done' | 'dropped'; agreedAt: string; createdAt?: string; closedAt?: string; closedOn?: string
  updates?: ActionUpdate[]
}
export interface DodItem { id: string; text: string; done: boolean; doneAt?: string; doneBy?: string | null }
export interface Dod {
  id: string; kr: string; state: 'draft' | 'agreed'; items: DodItem[]; evidence: string; signoff: string; question: string
  agreedAt?: string; updatedAt?: string; updatedBy?: string | null
}
export interface PropItem {
  kr: string; prev: Code; kind: 'change' | 'same' | 'notheard'; status: StatusCode; value: string; note: string
  quote: string; speaker: string; at: string; confidence: number | null; decision: 'pending' | 'approved'
  live?: boolean; editing?: boolean
}
export interface PropAction {
  tid: string; text: string; owner: string; due: string; kr: string | null; confidence: number | null
  decision: 'pending' | 'approved'; editing?: boolean
}
export interface PropClosed { id: string; evidence: string; close: boolean }
export interface PropNote { id: string; note: string; keep: boolean }
export interface Proposal {
  id?: string; session: string; source: string; createdAt: string
  items: PropItem[]; newActions: PropAction[]; closed: PropClosed[]; actionNotes: PropNote[]
}

export interface Data {
  plans: Record<string, Plan>
  currentId: string | null
  sessions: Record<string, Session>
  checkins: Record<string, Checkin>
  actions: Record<string, Action>
  proposals: Record<string, Proposal>
  dods: Record<string, Dod>
}
export const emptyData = (): Data => ({ plans: {}, currentId: null, sessions: {}, checkins: {}, actions: {}, proposals: {}, dods: {} })

// ---------------------------------------------------------------- dates
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function pd(s?: string | null): Date | null {
  if (!s) return null
  const p = String(s).slice(0, 10).split('-')
  const d = new Date(+p[0], +p[1] - 1, +p[2])
  return isNaN(d.getTime()) ? null : d
}
export function fmtDate(s?: string | null, long = false): string {
  const d = pd(s)
  if (!d) return s || ''
  return (long ? DAY[d.getDay()] + ' ' : '') + d.getDate() + ' ' + MON[d.getMonth()] + (long ? ' ' + d.getFullYear() : '')
}
export function isoDate(d: Date): string {
  const m = d.getMonth() + 1, dd = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd
}
export const today = () => isoDate(new Date())
export const addDays = (s: string, n: number) => { const d = pd(s) as Date; d.setDate(d.getDate() + n); return isoDate(d) }

let idSeq = 0
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + (idSeq++ % 36).toString(36)

// "simon.doukas@raphie.com" -> "Simon Doukas". People are stored by email.
export function nameFromEmail(e?: string | null): string {
  if (!e) return ''
  const local = String(e).split('@')[0]
  if (!/[._-]/.test(local) && !/@/.test(String(e))) return String(e)
  return local.split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// ---------------------------------------------------------------- plan lookups
export interface KrRef { p: Pillar; k: Kr; n: number }
export function allKrs(plan: Plan | null | undefined): KrRef[] {
  const out: KrRef[] = []
  if (!plan) return out
  plan.pillars.forEach(p => p.krs.forEach((k, i) => out.push({ p, k, n: i + 1 })))
  return out
}
// Looks in the viewed plan first, then in every other period (old actions point at old KRs).
export function krById(data: Data, plan: Plan | null | undefined, id: string): (KrRef & { plan: Plan }) | null {
  const find = (pl: Plan) => allKrs(pl).find(x => x.k.id === id)
  if (plan) { const r = find(plan); if (r) return { ...r, plan } }
  for (const pl of Object.values(data.plans)) { const r = find(pl); if (r) return { ...r, plan: pl } }
  return null
}
export function krLabel(data: Data, plan: Plan | null | undefined, id: string): string {
  const x = krById(data, plan, id)
  return x ? x.p.short + ' KR' + x.n : id
}
export const inPeriod = (plan: Plan | null | undefined, d: string) =>
  !plan || ((!plan.periodStart || d >= plan.periodStart) && (!plan.periodEnd || d <= plan.periodEnd))

export function planList(data: Data): Plan[] {
  return Object.values(data.plans).sort((a, b) => ((a.periodStart || '') < (b.periodStart || '') ? 1 : -1))
}
// The plan to show: the one asked for, else the current one, else the newest locked one.
export function pickPlan(data: Data, viewId: string): Plan | null {
  const id = viewId && data.plans[viewId] ? viewId : data.currentId
  if (id && data.plans[id]) return data.plans[id]
  const locked = planList(data).filter(p => p.state !== 'draft')
  return locked[0] || null
}

export function sessionsIn(data: Data, plan: Plan | null | undefined): Session[] {
  return Object.values(data.sessions).filter(s => inPeriod(plan, s.date))
}
export const savedSessions = (data: Data, plan: Plan | null | undefined) =>
  sessionsIn(data, plan).filter(s => s.state === 'saved').sort((a, b) => (a.date < b.date ? -1 : 1))
export const allSessions = (data: Data, plan: Plan | null | undefined) =>
  sessionsIn(data, plan).sort((a, b) => (a.date < b.date ? 1 : -1))

// ---------------------------------------------------------------- check-ins and statuses
// Saved ELT check-ins count once their ELT is saved; "live" ones (set during the
// meeting from the agenda) count only until it is; between-ELT updates always count.
export function checkinsFor(data: Data, krId: string): Checkin[] {
  return Object.values(data.checkins).filter(c => {
    if (c.kr !== krId) return false
    const ss = data.sessions[c.session]
    if (c.kind === 'adhoc') return true
    if (c.kind === 'live') return !!ss && ss.state !== 'saved'
    return !!ss && ss.state === 'saved'
  }).sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : ((a.savedAt || '') < (b.savedAt || '') ? -1 : 1)))
}
// The latest status set live during an ELT, before its review is saved.
export function liveFor(data: Data, krId: string, ses: Session): Checkin | null {
  let r: Checkin | null = null
  for (const c of Object.values(data.checkins)) {
    if (c.kr === krId && c.kind === 'live' && c.session === ses.id && (!r || (c.savedAt || '') > (r.savedAt || ''))) r = c
  }
  return r
}
// Latest check-in on or before `date` (inclusive); with before=true, strictly before. No date = latest.
export function statusAt(data: Data, krId: string, date?: string | null, before = false): Checkin | null {
  let r: Checkin | null = null
  for (const c of checkinsFor(data, krId)) if (!date || (before ? c.sessionDate < date : c.sessionDate <= date)) r = c
  return r
}
// Status going into an ELT: latest check-in up to and including its date (so same-day manual
// updates count), excluding that ELT's own saved check-ins.
export function baseFor(data: Data, krId: string, ses: Session): Checkin | null {
  let r: Checkin | null = null
  for (const c of checkinsFor(data, krId)) if (c.sessionDate <= ses.date && c.session !== ses.id) r = c
  return r
}
export const codeOf = (c: Checkin | null | undefined): Code => (c ? c.status : 'none')

export function statusCounts(data: Data, plan: Plan | null | undefined, date?: string | null): Record<Code, number> {
  const out: Record<Code, number> = { on: 0, risk: 0, off: 0, done: 0, ns: 0, none: 0 }
  for (const x of allKrs(plan)) out[codeOf(statusAt(data, x.k.id, date))]++
  return out
}

// ---------------------------------------------------------------- definition of done
export function dodFor(data: Data, krId: string): Dod | null {
  const d = data.dods[krId]
  return d && d.items && d.items.length ? d : null
}
export const dodProg = (d: Dod) => ({ done: d.items.filter(i => i.done).length, total: d.items.length })

// ---------------------------------------------------------------- actions
export const actionList = (data: Data): Action[] => Object.values(data.actions).sort((a, b) => (a.num || 0) - (b.num || 0))
export const actId = (a: Action) => 'ACT-' + String(a.num || 0).padStart(3, '0')
export const lastUpdate = (a: Action) => { const u = a.updates || []; return u.length ? u[u.length - 1] : null }
export const isOverdue = (a: Action, ref?: string) => a.status === 'open' && !!a.due && a.due < (ref || today())
export const maxActionNum = (data: Data) => actionList(data).reduce((m, a) => Math.max(m, a.num || 0), 0)
export function ownerNames(data: Data): string[] {
  const set = new Set<string>(ELT_TEAM)
  for (const a of actionList(data)) if (a.owner) set.add(a.owner)
  return [...set].sort()
}
// How many saved ELTs have passed since an action was agreed.
export function carriedOver(data: Data, plan: Plan | null | undefined, a: Action): number {
  const ag = data.sessions[a.agreedAt]
  return ag ? savedSessions(data, plan).filter(s => s.date > ag.date).length : 0
}

// ---------------------------------------------------------------- ELT agenda
export interface AgendaItem { p: Pillar; krs: { k: Kr; n: number; cc: Code; nh: boolean }[]; mins: number; start: number }
export function agendaFor(data: Data, plan: Plan, ses: Session) {
  const items: AgendaItem[] = plan.pillars.map(p => {
    const krs: AgendaItem['krs'] = []
    p.krs.forEach((k, i) => {
      const c = baseFor(data, k.id, ses), cc = codeOf(c)
      if (cc === 'done') return // done KRs leave the agenda
      krs.push({ k, n: i + 1, cc, nh: !!c && c.kind === 'notheard' })
    })
    // not-heard-last-time first, then worst status first, then plan order
    krs.sort((a, b) => (+b.nh - +a.nh) || (STATUS_ORDER[a.cc] - STATUS_ORDER[b.cc]) || (a.n - b.n))
    return { p, krs, mins: 0, start: 0 }
  })
  const total = items.reduce((s, i) => s + i.krs.length, 0) || 1
  let t = 5 // first 5 minutes: actions and business priorities
  for (const it of items) { it.mins = it.krs.length ? Math.max(3, Math.round(it.krs.length / total * 35)) : 0; it.start = t; t += it.mins }
  return { items, closeAt: t, total }
}
export const clock = (n: number) => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
export function agendaText(data: Data, plan: Plan, ses: Session): string {
  const ag = agendaFor(data, plan, ses)
  const closeLen = Math.max(5, 45 - ag.closeAt)
  const lines = ['ELT · ' + fmtDate(ses.date, true), '', '0:00  Actions and business priorities (5 min)']
  for (const it of ag.items) {
    if (!it.krs.length) continue
    lines.push(clock(it.start) + '  ' + it.p.name + ' (' + it.mins + ' min)')
    for (const r of it.krs) lines.push('      KR' + r.n + ' ' + r.k.text + ' — ' + STATUS_LABEL[r.cc])
  }
  lines.push(clock(ag.closeAt) + '  New actions and priorities (' + closeLen + ' min)')
  return lines.join('\n')
}
export function actionsDueBy(data: Data, ses: Session): Action[] {
  return actionList(data).filter(a => a.status === 'open' && a.due && a.due <= ses.date).sort((a, b) => (a.due < b.due ? -1 : 1))
}
export function suggestNextDate(data: Data, plan: Plan | null | undefined): string {
  const all = allSessions(data, plan)
  return all.length ? addDays(all[0].date, 28) : today()
}

// ---------------------------------------------------------------- the review (proposal)
const isStatus = (s: unknown): s is StatusCode => typeof s === 'string' && (STATUS_CODES as string[]).includes(s)
const str = (x: unknown) => (x == null ? '' : String(x))

// What the AI drafting function returns (already validated there; tolerated loosely here).
export interface DraftResult {
  krs?: { kr: string; heard?: boolean; status?: string; value?: string; note?: string; quote?: string; speaker?: string; at?: string; confidence?: number }[]
  newActions?: { text: string; owner?: string; due?: string; kr?: string | null; confidence?: number }[]
  closedActions?: { id: string; evidence?: string }[]
  actionUpdates?: { id: string; note: string }[]
}

// Build the review for an ELT. `res` is the AI draft, or null for a blank review in which
// every key result starts as "unchanged" for the admin to confirm or change.
export function buildProposal(data: Data, plan: Plan, ses: Session, res: DraftResult | null, source: string, now: string, makeId: () => string = uid): Proposal {
  const byKr: Record<string, NonNullable<DraftResult['krs']>[number]> = {}
  for (const r of res?.krs || []) if (r && r.kr) byKr[r.kr] = r
  const items: PropItem[] = allKrs(plan).map(x => {
    const prev = baseFor(data, x.k.id, ses), pc = codeOf(prev)
    let r: Partial<NonNullable<DraftResult['krs']>[number]> | undefined = byKr[x.k.id]
    const lv = liveFor(data, x.k.id, ses)
    // A status set live during the meeting beats what the AI read from the notes.
    if (lv) r = { ...(r || {}), heard: true, status: lv.status, value: (r && r.value) || lv.value || '', note: (r && r.note) || lv.note || '' }
    const heard = res ? !!(r && r.heard) : true
    let st: StatusCode = r && isStatus(r.status) ? r.status : (pc === 'none' ? 'ns' : pc)
    const val = r && r.value ? str(r.value) : ''
    let kind: PropItem['kind'] = !heard ? 'notheard' : ((st !== pc || (val && (!prev || val !== str(prev.value)))) ? 'change' : 'same')
    if (!res && !lv) kind = 'same'
    if (!heard) st = pc === 'none' ? 'ns' : pc
    return {
      kr: x.k.id, prev: pc, kind, status: st, value: val, note: r && r.note ? str(r.note) : '', quote: r && r.quote ? str(r.quote) : '',
      speaker: r && r.speaker ? str(r.speaker) : '', at: r && r.at ? str(r.at) : '',
      confidence: r && typeof r.confidence === 'number' ? r.confidence : null,
      decision: kind === 'notheard' ? 'approved' : 'pending', live: !!lv,
    }
  })
  const krIds = new Set(allKrs(plan).map(x => x.k.id))
  const newActions: PropAction[] = (res?.newActions || []).filter(a => a && a.text).map(a => ({
    tid: makeId(), text: str(a.text), owner: str(a.owner), due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? (a.due as string) : '',
    kr: a.kr && krIds.has(a.kr) ? a.kr : null, confidence: typeof a.confidence === 'number' ? a.confidence : null, decision: 'pending' as const,
  }))
  const open = (id: string) => data.actions[id] && data.actions[id].status === 'open'
  const closed: PropClosed[] = (res?.closedActions || []).filter(c => c && open(c.id)).map(c => ({ id: c.id, evidence: str(c.evidence), close: true }))
  const actionNotes: PropNote[] = (res?.actionUpdates || [])
    .filter(u => u && u.note && open(u.id) && !closed.some(c => c.id === u.id)).map(u => ({ id: u.id, note: str(u.note), keep: true }))
  return { session: ses.id, source, createdAt: now, items, newActions, closed, actionNotes }
}

// Reopening a saved ELT: start the review from what was saved, already approved.
export function proposalFromSaved(data: Data, plan: Plan, ses: Session, now: string): Proposal {
  const base = buildProposal(data, plan, ses, null, 'Reopened', now)
  base.items = base.items.map(it => {
    const c = data.checkins[ses.id + '__' + it.kr]
    if (!c) return { ...it, kind: 'notheard', status: it.prev === 'none' ? 'ns' : it.prev, decision: 'approved', live: false }
    return { ...it, kind: c.kind === 'notheard' ? 'notheard' : c.kind === 'change' ? 'change' : 'same', status: (isStatus(c.status) ? c.status : 'ns'), value: c.value || '', note: c.note || '', quote: c.quote || '', speaker: c.speaker || '', at: c.at || '', decision: 'approved', live: false }
  })
  return base
}

export function reviewProgress(prop: Proposal) {
  const pendingChanges = prop.items.filter(i => i.kind === 'change' && i.decision === 'pending').length
  const pendingSame = prop.items.filter(i => i.kind === 'same' && i.decision === 'pending').length
  const pendingActs = prop.newActions.filter(a => a.decision === 'pending').length
  return { pendingChanges, pendingSame, pendingActs, left: pendingChanges + pendingSame + pendingActs }
}

// ---------------------------------------------------------------- saving a review
export interface DocWrite { collection: string; id: string; data: Record<string, unknown> }
export interface ReviewWrites { sets: DocWrite[]; deletes: { collection: string; id: string }[] }

// Turns an approved review into the exact documents to store. The caller writes `sets`
// in one transaction, then `deletes`. Pure so it can be tested without a database.
export function buildReviewWrites(data: Data, ses: Session, prop: Proposal, now: string, me: string | null): ReviewWrites {
  const sets: DocWrite[] = []
  const deletes: ReviewWrites['deletes'] = []
  for (const it of prop.items) {
    const id = ses.id + '__' + it.kr
    // not discussed and never had a status: nothing to carry forward, and no stale row either
    if (it.kind === 'notheard' && it.prev === 'none') { deletes.push({ collection: 'checkins', id }); continue }
    sets.push({ collection: 'checkins', id, data: {
      session: ses.id, sessionDate: ses.date, kr: it.kr, status: it.status, value: it.value || '', note: it.note || '',
      quote: it.quote || '', speaker: it.speaker || '', at: it.at || '', kind: it.kind, savedAt: now, savedBy: me,
    } })
  }
  // Work on copies so several changes to one action (comment + close) merge into one write.
  const touched: Record<string, Action> = {}
  const act = (id: string): Action | null => touched[id] || (data.actions[id] ? (touched[id] = { ...data.actions[id], updates: [...(data.actions[id].updates || [])] }) : null)

  let num = maxActionNum(data)
  for (const a of prop.newActions.filter(x => x.decision === 'approved' && x.text)) {
    num++
    sets.push({ collection: 'actions', id: a.tid, data: { num, text: a.text, owner: a.owner || '', due: a.due || '', kr: a.kr || null, status: 'open', agreedAt: ses.id, createdAt: now } })
  }
  for (const c of prop.actionNotes.filter(x => x.keep && x.note)) {
    const a = act(c.id); if (!a) continue
    a.updates = [...(a.updates || []), { date: today(), at: now, by: me, text: c.note, session: ses.date }]
  }
  for (const c of prop.closed.filter(x => x.close)) {
    const a = act(c.id); if (!a) continue
    a.status = 'done'; a.closedAt = ses.id; a.closedOn = ses.date
  }
  for (const [id, a] of Object.entries(touched)) { const { id: _drop, ...rest } = a; void _drop; sets.push({ collection: 'actions', id, data: rest as unknown as Record<string, unknown> }) }

  const { id: _sid, ...sesRest } = ses; void _sid
  sets.push({ collection: 'sessions', id: ses.id, data: { ...sesRest, state: 'saved', savedAt: now, savedBy: me } })
  // the unsaved draft is no longer needed once it is saved
  if (data.proposals[ses.id]) deletes.push({ collection: 'proposals', id: ses.id })
  return { sets, deletes }
}

// ---------------------------------------------------------------- AI drafting request
export interface DraftRequest {
  date: string; team: string[]; notes: string
  krs: { id: string; ref: string; text: string; current: Code; value: string }[]
  actions: { id: string; ref: string; text: string; owner: string; linked: string }[]
}
export function buildDraftRequest(data: Data, plan: Plan, ses: Session, notes: string): DraftRequest {
  return {
    date: ses.date, team: ELT_TEAM, notes: notes.slice(0, 60000),
    krs: allKrs(plan).map(x => { const c = baseFor(data, x.k.id, ses); return { id: x.k.id, ref: x.p.short + ' KR' + x.n, text: x.k.text, current: codeOf(c), value: c?.value || '' } }),
    actions: actionList(data).filter(a => a.status === 'open').map(a => ({ id: a.id, ref: actId(a), text: a.text, owner: a.owner || '', linked: a.kr ? krLabel(data, plan, a.kr) : 'business priority' })),
  }
}

// ---------------------------------------------------------------- OKR period setup
export function periodFor(start: string): { id: string; label: string } {
  const d = pd(start) as Date
  const h = d.getMonth() < 6 ? 1 : 2
  return { id: d.getFullYear() + '-H' + h, label: 'H' + h + ' ' + d.getFullYear() }
}
// A new draft period starts as a copy of the previous one with fresh KR ids.
export function newDraftFrom(base: Plan | null | undefined, now: Date = new Date(), makeId: () => string = uid): Plan & { _new?: boolean } {
  const c: Plan = JSON.parse(JSON.stringify(base || { pillars: [], northStar: '', vision: '' }))
  const st = base && base.periodEnd ? (pd(base.periodEnd) as Date) : new Date(now)
  st.setDate(st.getDate() + 1)
  const en = new Date(st.getFullYear(), st.getMonth() + 6, 0)
  const per = periodFor(isoDate(st))
  c.id = per.id; c.period = per.label; c.periodStart = isoDate(st); c.periodEnd = isoDate(en); c.state = 'draft'; c.version = 1; c.lockedAt = ''; c.source = ''
  for (const p of c.pillars) for (const k of p.krs) k.id = per.id + '-' + p.id + '-' + makeId()
  return Object.assign(c, { _new: true })
}
// Returns a problem to show the user, or '' if the plan can be made current.
export function planProblem(d: Plan): string {
  if (!d.pillars.length) return 'Add at least one pillar.'
  if (!d.period || !d.periodStart || !d.periodEnd) return 'Give the period a name, a start and an end date.'
  if (d.periodEnd < d.periodStart) return 'The period ends before it starts.'
  if (d.pillars.some(p => !p.name || !p.short || p.krs.some(k => !k.text))) return 'Every pillar needs a name, a short name and key results with text.'
  return ''
}

// ---------------------------------------------------------------- charts
export function numericValue(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : n
}
