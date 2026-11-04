// Product Roadmap -- pure derivations (status rules, grouping, RICE candidates).
//
// Ported 1:1 from the original roadmap artifact so the ELT sees the same
// numbers. Everything here is a pure function of the loaded documents plus a
// Quarter, so the page can swap live data for a past-quarter snapshot without
// any of this code knowing which one it has.

export interface Doc { id: string; [k: string]: any }
export type DocMap = Map<string, Doc>

export interface ViewData {
  linear: DocMap
  overrides: DocMap
  rice: DocMap
  items: DocMap
  news: DocMap
  chunkDocs: DocMap
  initiatives: DocMap
  meta: Doc | null
  planning: Doc | null
  sprint: Doc | null
  // undefined = not loaded yet, null = loaded but no sync doc exists
  sync: Doc | null | undefined
}

export const emptyView = (): ViewData => ({
  linear: new Map(), overrides: new Map(), rice: new Map(), items: new Map(), news: new Map(),
  chunkDocs: new Map(), initiatives: new Map(), meta: null, planning: null, sprint: null, sync: undefined,
})

export type StatusKey = 'off' | 'risk' | 'on' | 'nodate' | 'stale' | 'close' | 'planned' | 'done' | 'ongoing' | 'canceled'

// Track colours are Linear's T1-T5 label colours. They encode data, not brand,
// and John confirmed they stay exactly as they are.
export const TRACKS: Record<string, { n: string; t: string; c: string; ink: string }> = {
  inbound:   { n: 'Inbound CS',       t: 'T1', c: '#26B5CE', ink: '#141414' },
  core:      { n: 'Core',             t: 'T2', c: '#F2994A', ink: '#141414' },
  ops:       { n: 'Gaming Ops',       t: 'T3', c: '#4CB782', ink: '#141414' },
  growth:    { n: 'GameLM Growth',    t: 'T4', c: '#5E6AD2', ink: '#FFFFFF' },
  expansion: { n: 'GameLM Expansion', t: 'T5', c: '#F2C94C', ink: '#141414' },
}
export const NO_TRACK = '#CDCCC6'
export const TEAMS: Record<string, string> = { raphie: 'Raphie team', pixie: 'PixieLabs', everyday: 'Everyday AI', none: 'Not assigned' }
export const TEAM_ORDER = ['raphie', 'pixie', 'everyday', 'none']
export const STATUS: Record<string, string> = {
  off: 'Off track', risk: 'At risk', on: 'On track', nodate: 'No target date', stale: 'Stale in Linear',
  close: 'Ready to close', planned: 'Not started', done: 'Done', ongoing: 'Ongoing', canceled: 'Cancelled',
}
export const KRSTATUS: Record<string, string> = { done: 'Done', in_progress: 'In progress', at_risk: 'At risk', off_track: 'Off track' }
export const WORST: StatusKey[] = ['off', 'risk', 'on', 'nodate', 'close', 'stale', 'planned', 'done', 'ongoing', 'canceled']
export const CATS: Record<string, string> = { opportunity: 'Opportunity', threat: 'Threat', competitive: 'Competitive threat', note: 'Note' }
export const ACTIONS: Record<string, string> = { required: 'Action required', none: 'No action required' }
export const HOR: Record<string, string> = { idea: 'Idea', next: 'Next (Miro)', later: 'Later (Miro)', parked: 'Parked', now: 'Now', shipped: 'Shipped' }
export const IMPACT: [string, string][] = [['3', '3 · Massive'], ['2', '2 · High'], ['1', '1 · Medium'], ['0.5', '0.5 · Low'], ['0.25', '0.25 · Minimal']]
export const CONF: [string, string][] = [['100', '100%'], ['80', '80%'], ['50', '50%']]
export const ALIGN: Record<string, string> = {
  kr: 'Key result', customer: 'Customer commitment', compliance: 'Compliance or security', contract: 'Contract or MSA', other: 'Other',
}
export const DAY = 864e5

// ---------- dates ----------
export const D = (s?: string | null): Date | null => (s ? new Date(s.length === 10 ? s + 'T00:00:00' : s) : null)
const ms = (d: Date | null) => (d ? d.getTime() : NaN)
export const fmt = (s?: string | null): string => {
  if (!s) return ''
  const d = D(s.length > 10 ? s.slice(0, 10) : s)
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
}
export const fmtDT = (s?: string | null): string => {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
export const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const safeUrl = (u?: string | null) => (/^https?:\/\//i.test(u || '') ? (u as string) : '')
export const newId = (prefix: string) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

// ---------- quarters ----------
export interface Quarter { today: Date; qStart: Date; qEnd: Date; qIdx: number; qLabel: string; qName: string }
export function makeQuarter(d: Date): Quarter {
  const today = new Date(d); today.setHours(0, 0, 0, 0)
  const qIdx = Math.floor(today.getMonth() / 3)
  return {
    today, qIdx,
    qStart: new Date(today.getFullYear(), qIdx * 3, 1),
    qEnd: new Date(today.getFullYear(), qIdx * 3 + 3, 1),
    qLabel: 'Q' + (qIdx + 1) + ' ' + today.getFullYear(),
    qName: today.getFullYear() + ' Q' + (qIdx + 1),
  }
}
export const qidOf = (d: Date) => d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1)
export const qLabelOf = (qid?: string) => { const m = /^(\d{4})-Q(\d)$/.exec(qid || ''); return m ? 'Q' + m[2] + ' ' + m[1] : qid || '' }
export const prevQid = (d: Date) => qidOf(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 - 1, 15))
export const xPct = (q: Quarter, d: Date) => Math.max(0, Math.min(100, (d.getTime() - q.qStart.getTime()) / (q.qEnd.getTime() - q.qStart.getTime()) * 100))
export const doneThisQ = (p: Doc, q: Quarter) => p.status === 'done' && !!p.completedAt && ms(D(String(p.completedAt).slice(0, 10))) >= q.qStart.getTime()
export const worst = (list: StatusKey[]) => list.slice().sort((a, b) => WORST.indexOf(a) - WORST.indexOf(b))[0]
export const swatch = (track?: string) => (track && TRACKS[track] ? TRACKS[track].c : NO_TRACK)

// ---------- projects ----------
export interface Proj extends Doc { status: StatusKey; why: string; team: string; chunk: string; initiative: string }

export function projectStatus(p: Doc, q: Quarter): [StatusKey, string] {
  const { today, qStart } = q
  const done = +p.done || 0, open = +p.open || 0, wip = +p.inProgress || 0
  if (p.state === 'completed') return ['done', 'Closed in Linear ' + fmt(p.completedAt) + '.']
  if (p.state === 'canceled') return ['canceled', 'Cancelled in Linear' + (p.canceledAt ? ' ' + fmt(p.canceledAt) : '') + '.']
  if (p.kind === 'bucket') return ['ongoing', open + ' open issues. A running log, not a deliverable.']
  const active = p.state === 'started' || wip > 0 || done > 0
  if (!active) {
    const t0 = D(p.target), dl = t0 ? Math.round((t0.getTime() - today.getTime()) / DAY) : null
    if (t0 && dl! < 0) return ['stale', `Target was ${fmt(p.target)} and nothing has moved this quarter. Close it or set a new date.`]
    if (t0 && dl! <= 21) return ['risk', `Due ${fmt(p.target)}, ${dl} days away, and not started in Linear.`]
    return ['planned', p.state === 'planned' ? 'Planned in Linear, not started.' : 'In the Linear backlog, not started.']
  }
  const tgt = D(p.target), st = D(p.start)
  if (open === 0 && done > 0) return ['close', `All ${done} issues are done but the project is still open in Linear.`]
  if (tgt && tgt.getTime() < today.getTime()) {
    return (wip > 0 || done > 0)
      ? ['off', `Target was ${fmt(p.target)}. ${open} issues still open.`]
      : ['stale', `Target was ${fmt(p.target)} and nothing has moved this quarter. Close it or set a new date.`]
  }
  if (!tgt) return ['nodate', `In progress with no target date. ${done} of ${done + open} issues closed.`]
  const prog = done + open ? done / (done + open) : 0
  const start = st || qStart, span = Math.max(DAY, tgt.getTime() - start.getTime())
  const el = Math.max(0, Math.min(1, (today.getTime() - start.getTime()) / span))
  const left = Math.round((tgt.getTime() - today.getTime()) / DAY), p100 = Math.round(prog * 100), e100 = Math.round(el * 100)
  if (done + open === 0) return ['risk', `Due ${fmt(p.target)} with no issues logged in Linear.`]
  if (left <= 14 && prog < 0.6) return ['risk', `${left} days to target and ${p100}% of issues closed.`]
  if (prog < el - 0.3) return ['risk', `${p100}% of issues closed with ${e100}% of the time gone.`]
  if (+p.blocked > 0) return ['risk', `${p.blocked} issue${+p.blocked === 1 ? ' is' : 's are'} blocked on someone outside the team. ${p100}% closed, target ${fmt(p.target)}.`]
  return ['on', `${p100}% of issues closed with ${e100}% of the time gone. Target ${fmt(p.target)}.`]
}

export const chunkList = (v: ViewData) => [...v.chunkDocs.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

function chunkOf(v: ViewData, p: Doc): string {
  const cs = chunkList(v)
  const byId = cs.find(c => (c.projects || []).includes(p.id)); if (byId) return byId.id
  const n = String(p.name || '').toLowerCase()
  const byMatch = cs.find(c => (c.match || []).some((m: string) => m && n.includes(String(m).toLowerCase())))
  return byMatch ? byMatch.id : 'c-other'
}

const QRX = /^\d{4}\s*(Q[1-4]|Backlog)$/i
const HEALTH: Record<string, StatusKey> = { onTrack: 'on', atRisk: 'risk', offTrack: 'off' }
export const goalInits = (v: ViewData) => [...v.initiatives.values()].filter(i => i.name && !QRX.test(i.name) && i.status !== 'Completed')

export const stageOf = (p: Doc): 'canceled' | 'done' | 'now' | 'next' | 'planned' =>
  p.state === 'canceled' ? 'canceled'
    : p.state === 'completed' ? 'done'
      : (p.state === 'started' || p.kind === 'bucket' || (+p.inProgress || 0) + (+p.blocked || 0) + (+p.done || 0) > 0) ? 'now'
        : p.state === 'planned' ? 'next' : 'planned'

export function allProj(v: ViewData, q: Quarter): Proj[] {
  const gi = goalInits(v)
  return [...v.linear.values()].map(p => {
    const o = v.overrides.get(p.id) || ({} as Doc)
    const r: any = Object.assign({}, p, { team: o.team || p.team || 'none', teamFrom: o.team ? 'set' : p.teamFrom })
    const [s, why] = projectStatus(r, q); r.status = s; r.why = why
    const hits = (r.initiatives || []).map((n: string) => gi.find(i => i.name === n)).filter(Boolean)
      .sort((a: Doc, b: Doc) => (b.parent ? 1 : 0) - (a.parent ? 1 : 0))
    r.initiative = hits[0] ? hits[0].id : ''
    r.chunk = hits[0] ? 'i-' + hits[0].id : chunkOf(v, r)
    return r as Proj
  })
}

// ---------- pieces of work ----------
export interface Chunk extends Doc {
  key: string; kind: 'initiative' | 'chunk'; depth: number; name: string; plain: string; krs: string[]
  parentId?: string; kids: Proj[]; live: Proj[]; real: Proj[]; status: StatusKey; why: string
  start: string; target: string; openEnded: boolean; done: number; open: number; inProgress: number; blocked: number
  teams: string[]; track: string; trackFrom: string; doneQ: number; manual: boolean; auto: StatusKey
  milestones: { project: string; name: string; target?: string; progress?: number }[]
}

function groupDefs(v: ViewData): Doc[] {
  const gi = goalInits(v)
  const byName: Record<string, Doc> = Object.fromEntries(gi.map(i => [i.name, i]))
  const mk = (i: Doc, depth: number): Doc => {
    const ov = v.overrides.get('init-' + i.id) || ({} as Doc)
    const par = i.parent && byName[i.parent]
    return {
      id: 'i-' + i.id, lid: i.id, kind: 'initiative', depth, name: i.name, plain: ov.plain || i.summary || '',
      krs: Array.isArray(ov.krs) ? ov.krs : [], manualStatus: ov.manualStatus || '', manualWhy: ov.manualWhy || '', manualAt: ov.manualAt || '',
      health: i.health || '', url: i.url || '', owner: i.owner || '', targetDate: i.targetDate || '', parentId: par ? 'i-' + par.id : '',
    }
  }
  const top = gi.filter(i => !i.parent || !byName[i.parent])
    .sort((a, b) => String(a.targetDate || '9').localeCompare(String(b.targetDate || '9')) || a.name.localeCompare(b.name))
  const out: Doc[] = []
  top.forEach(i => {
    out.push(mk(i, 0))
    gi.filter(x => x.parent === i.name).sort((a, b) => a.name.localeCompare(b.name)).forEach(x => out.push(mk(x, 1)))
  })
  return out.concat(chunkList(v).map(c => Object.assign({ kind: 'chunk', depth: 0 }, c)))
}

export function buildChunks(v: ViewData, q: Quarter, P: Proj[]): Chunk[] {
  const { today } = q
  const ps = P.filter(p => p.status !== 'canceled'), cs = groupDefs(v)
  if (ps.some(p => p.chunk === 'c-other')) {
    cs.push({ id: 'c-other', kind: 'chunk', depth: 0, name: 'Other work', plain: 'Linear projects not yet placed in a piece of work or a Linear initiative. Assign them in Edit.', krs: [], order: 999 })
  }
  const lo = v.sync && v.sync.lightsOn
  return cs.map(c => {
    const subIds = cs.filter(x => x.parentId === c.id).map(x => x.id)
    const kids = ps.filter(p => p.chunk === c.id || subIds.includes(p.chunk))
    const live = kids.filter(p => p.status !== 'done')
    const real = live.filter(p => p.kind !== 'bucket')
    let st: StatusKey, why: string
    if (!kids.length) { st = 'planned'; why = 'No Linear projects in this piece of work yet.' }
    else if (!live.length) { st = 'done'; why = `All ${kids.length} projects are closed in Linear.` }
    else if (!real.length || (live.some(p => p.kind === 'bucket') && real.every(p => p.status === 'planned'))) {
      st = 'ongoing'; why = live.reduce((t, p) => t + (+p.open || 0), 0) + ' open issues across ' + live.length + ' running logs.'
    }
    else if (real.every(p => p.status === 'planned')) { st = 'planned'; why = `${real.length} project${real.length === 1 ? '' : 's'} in Linear, none started and none dated yet.` }
    else {
      const dated = real.filter(p => ['on', 'risk', 'off'].includes(p.status))
      const moving = real.filter(p => !['planned', 'stale'].includes(p.status))
      st = dated.length ? worst(dated.map(p => p.status)) : moving.length ? worst(moving.map(p => p.status)) : real.some(p => p.status === 'planned') ? 'planned' : 'stale'
      const k = real.find(p => p.status === st)
      why = k ? `${STATUS[st]} because of ${k.name}: ${k.why}` : ''
    }
    if (c.id === 'c-klo' && lo) {
      st = 'ongoing'
      why = `${lo.bugOpen || 0} open bugs and ${lo.techDebtOpen || 0} open tech debt issues across Linear, by label. ${lo.bugDoneQ || 0} bugs fixed this quarter.`
    }
    let manual = false; const auto = st
    if (c.kind === 'initiative' && HEALTH[c.health] && !c.manualStatus) {
      st = HEALTH[c.health]; why = `Health set in Linear${c.owner ? ' by ' + c.owner : ''}. Its projects on their own say ${STATUS[auto]}.`
    }
    if (c.manualStatus && STATUS[c.manualStatus]) {
      manual = true; st = c.manualStatus
      why = (c.manualWhy ? c.manualWhy + ' ' : '') + `Set by hand${c.manualAt ? ' on ' + fmt(c.manualAt) : ''}. Linear on its own says ${STATUS[auto]}.`
    }
    let span = real.filter(p => !['stale', 'planned', 'close'].includes(p.status))
    if (!span.length) span = real.filter(p => p.status === 'close')
    if (!span.length) span = real.filter(p => p.status === 'planned' && p.target && ms(D(p.target)) >= today.getTime())
    const starts = span.map(p => p.start).filter(Boolean).sort(), targets = span.map(p => p.target).filter(Boolean).sort()
    const sum = (f: string) => real.reduce((t, p) => t + (+p[f] || 0), 0)
    const teams = TEAM_ORDER.filter(t => t !== 'none' && live.some(p => p.team === t))
    const tc: Record<string, number> = {}
    real.concat(kids).forEach(p => { if (p.track) tc[p.track] = (tc[p.track] || 0) + 1 + (+p.done || 0) + (+p.open || 0) })
    const track = Object.keys(tc).sort((a, b) => tc[b] - tc[a])[0] || ''
    return Object.assign({}, c, {
      key: c.id, kids, live, real, status: st, why, start: starts[0] || '', target: targets[targets.length - 1] || '',
      openEnded: span.length > 0 && span.some(p => !p.target),
      done: sum('done'), open: sum('open'), inProgress: sum('inProgress'), blocked: sum('blocked'), teams, track,
      trackFrom: kids.every(p => p.trackFrom === 'linear') ? 'linear' : 'suggested',
      doneQ: kids.filter(p => doneThisQ(p, q)).length, krs: c.krs || [], manual, auto,
      milestones: kids.flatMap(p => (p.milestones || []).map((m: any) => Object.assign({ project: p.name }, m))),
    }) as Chunk
  }).filter(c => c.kids.length || (c.id === 'c-klo' && lo) || (c.kind === 'initiative' && cs.some(x => x.parentId === c.id)))
}

export function carried(p: Doc, q: Quarter): boolean {
  if (p.kind === 'bucket' || !['now', 'next'].includes(stageOf(p))) return false
  const pl = qLabelOf(prevQid(q.today)).split(' '), pn = pl[1] + ' ' + pl[0]
  return (!!p.start && ms(D(p.start)) < q.qStart.getTime()) || (p.initiatives || []).includes(pn)
}

// ---------- Future Focus (RICE) ----------
export function riceScore(r: Doc | Record<string, any>): number | null {
  const ok = [r.reach, r.impact, r.conf, r.effort].every(x => typeof x === 'number' && !isNaN(x)) && r.effort > 0
  return ok ? r.reach * r.impact * (r.conf / 100) / r.effort : null
}
const addedOf = (it: Doc) => it.createdAt || (it.source === 'board' || it.source === 'legacy' ? '2026-09-14' : it.updatedAt || '')

export interface Candidate {
  key: string; title: string; src: string; parked: boolean; lead: string; added: string
  ref: { type: 'linear' | 'item'; id: string }; r: Doc | Record<string, any>; score: number | null; must: boolean
}
export function candidates(v: ViewData, P: Proj[]): Candidate[] {
  const lin = P.filter(p => p.status === 'planned' && p.kind !== 'bucket')
  const names = new Set(P.map(p => norm(p.name)))
  const mi = [...v.items.values()].filter(it => ['idea', 'next', 'later', 'parked'].includes(it.horizon) && it.theme !== 'customers' && !names.has(norm(it.title)))
  const fromLinear: Candidate[] = lin.map(p => ({
    key: 'lin-' + p.id, title: p.name, src: 'Linear · ' + (p.initiatives && p.initiatives.length ? p.initiatives.join(', ') : p.state),
    parked: false, lead: p.lead || '', added: p.createdAt || '', ref: { type: 'linear' as const, id: p.id }, r: {}, score: null, must: false,
  }))
  const fromItems: Candidate[] = mi.map(it => ({
    key: it.id, title: it.title,
    src: (it.horizon === 'parked' ? 'Parked' : HOR[it.horizon]) + (it.source === 'deck' ? ' · ELT proposal' : it.source === 'meeting' ? ' · added in a meeting' : it.source === 'news' ? ' · from industry news' : ' · Miro'),
    parked: it.horizon === 'parked', lead: it.owner && it.owner !== 'Owner TBC' ? it.owner : '', added: addedOf(it),
    ref: { type: 'item' as const, id: it.id }, r: {}, score: null, must: false,
  }))
  const C = fromLinear.concat(fromItems)
  C.forEach(c => { const r = v.rice.get(c.key) || {}; c.r = r; c.score = riceScore(r); c.must = !!(r as Doc).mustHave })
  return C.sort((a, b) => (Number(b.must) - Number(a.must)) || (b.score ?? -1) - (a.score ?? -1) || (Number(a.parked) - Number(b.parked)) || a.title.localeCompare(b.title))
}

// ---------- quarter-close helpers ----------
export interface SnapMeta {
  id: string; quarter: string; label: string; kind: 'final' | 'checkpoint'; takenAt: string
  asOf?: string; reconstructed?: boolean; note?: string
}
export function viewFromSnapshot(sn: Doc, news: DocMap): ViewData {
  const toMap = (arr: any[]) => { const m: DocMap = new Map(); (arr || []).forEach(x => { if (x && x.id != null) m.set(x.id, x) }); return m }
  const d = sn.data || {}
  return {
    linear: toMap(d.linear), overrides: toMap(d.overrides), rice: toMap(d.rice), items: toMap(d.items), chunkDocs: toMap(d.chunks),
    initiatives: toMap(d.initiatives), news, meta: d.meta || null, planning: d.planning || null, sprint: d.sprint || null, sync: d.sync || null,
  }
}
export function snapshotQuarter(sn: Doc): Quarter {
  const m = /^(\d{4})-Q(\d)$/.exec(sn.quarter)
  const qe = m ? new Date(+m[1], (+m[2]) * 3, 0) : new Date(sn.takenAt)
  return makeQuarter(new Date(Math.min(new Date(sn.asOf || sn.takenAt).getTime(), qe.getTime())))
}
