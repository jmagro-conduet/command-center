// roadmap-linear-sync -- pure logic (no network, no Deno), so it can be tested in Node.
//
// Turns raw Linear data (projects, issues, initiatives, cycle) into the
// documents the Roadmap page reads. This is the same rule set the Claude
// "Raphie roadmap Linear sync" task used, ported 1:1 so the board doesn't
// change meaning:
//   * which projects belong on the roadmap this quarter
//   * issue status name -> To do / In progress / Blocked / Done / ignored
//   * track from the project label, team from assignees, kind/theme from name
//   * hand-maintained fields (krs, krFrom, theme, track when unlabeled) are
//     carried over from the existing doc

export interface LProject {
  id: string; identifier?: string; slugId: string; name: string; url: string
  statusName: string; statusType: string
  startDate: string | null; targetDate: string | null
  createdAt: string | null; completedAt: string | null; canceledAt: string | null
  lead: { name?: string | null; email?: string | null } | null
  labels: string[]; initiatives: { id: string; name: string }[]
  milestones: { name: string; targetDate: string | null; progress: number | null }[]
}
export interface LIssue {
  projectId: string | null; statusName: string; statusType: string
  assignee: { name?: string | null; email?: string | null } | null
  completedAt: string | null; labels: string[]
}
export interface LInitiative {
  id: string; identifier?: string; slugId: string; name: string; status: string; health: string | null
  targetDate: string | null; description: string | null; url: string
  owner: { name?: string | null; email?: string | null } | null; parentName: string | null
}
export interface LCycle { number: number; startsAt: string; endsAt: string; issueCountHistory: number[]; completedIssueCountHistory: number[] }
export interface ExistingDoc { id: string; data: Record<string, any> }

// ---------- dates ----------
export interface QuarterInfo { qStart: string; prevQStart: string; windowName: string }
// `now` is interpreted in America/New_York, matching how the team reads "this quarter".
export function quarterInfo(now: Date): QuarterInfo {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const y = +f.find(p => p.type === 'year')!.value, m = +f.find(p => p.type === 'month')!.value
  const q = Math.floor((m - 1) / 3)
  const pad = (n: number) => String(n).padStart(2, '0')
  const qStart = `${y}-${pad(q * 3 + 1)}-01`
  const py = q === 0 ? y - 1 : y, pq = q === 0 ? 3 : q - 1
  return { qStart, prevQStart: `${py}-${pad(pq * 3 + 1)}-01`, windowName: `${y} Q${q + 1}` }
}
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

// ---------- issue buckets ----------
export type Bucket = 'todo' | 'wip' | 'blocked' | 'done' | 'ignore'
const TODO = ['triage', 'backlog', 'spec required', 'ready to start']
const WIP = ['in progress', 'in code review', 'changes requested', 'ready to merge', 'ready for sign off', 'signed off']
const BLOCKED = ['blocked external']
const DONE = ['deployed', 'done']
const IGNORE = ['canceled', 'cancelled', 'duplicate']
export function bucketIssue(statusName: string, statusType: string): { bucket: Bucket; unlisted: boolean } {
  const n = statusName.trim().toLowerCase()
  if (TODO.includes(n)) return { bucket: 'todo', unlisted: false }
  if (WIP.includes(n)) return { bucket: 'wip', unlisted: false }
  if (BLOCKED.includes(n)) return { bucket: 'blocked', unlisted: false }
  if (DONE.includes(n)) return { bucket: 'done', unlisted: false }
  if (IGNORE.includes(n)) return { bucket: 'ignore', unlisted: false }
  // not in the list: fall back to the status type and report it
  const t = statusType.toLowerCase()
  const bucket: Bucket = t === 'completed' ? 'done' : t === 'started' ? 'wip' : t === 'canceled' ? 'ignore' : 'todo'
  return { bucket, unlisted: true }
}

// ---------- names ----------
export const isBucketProject = (name: string) => /bug ?log|tech debt|improvement log/i.test(name)
const QRX = /^\d{4}\s*(Q[1-4]|Backlog)$/i
export const isWindowInitiative = (name: string) => QRX.test(name.trim())
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const TRACK_LABELS: [string, string][] = [
  ['inbound cs', 'inbound'], ['core', 'core'], ['gaming ops', 'ops'], ['gamelm growth', 'growth'], ['gamelm expansion', 'expansion'],
]
export function trackFromLabels(labels: string[]): string {
  for (const l of labels) {
    const n = l.toLowerCase().replace(/^t[1-5]\s*[-:.]?\s*/, '')
    const hit = TRACK_LABELS.find(([k]) => n === k || n.includes(k))
    if (hit) return hit[1]
  }
  return ''
}
export function suggestTrack(name: string): string {
  const n = name.toLowerCase()
  if (/modo|betsaracen|rsi|poc|entain|soaring|888/.test(n)) return 'ops'
  if (/voice|outbound|social|channel|service expansion|chargeback/.test(n)) return 'expansion'
  if (/platform|eval|infra|bug|tech debt|prompt|multilingual|toolchain|cost|snowflake/.test(n)) return 'core'
  return 'core'
}

// ---------- teams ----------
type Person = { name?: string | null; email?: string | null } | null
export function teamOfPerson(p: Person): 'pixie' | 'everyday' | 'raphie' {
  const email = (p?.email || p?.name || '').toLowerCase()
  const name = (p?.name || '').toLowerCase()
  if (email.endsWith('@pixielabs.io')) return 'pixie'
  if (name.includes('gould') || email.includes('gould')) return 'everyday'
  return 'raphie'
}
export function teamOfProject(lead: Person, assignees: Person[]): { team: string; teamFrom: string } {
  if (assignees.length) {
    const c: Record<string, number> = { raphie: 0, pixie: 0, everyday: 0 }
    assignees.forEach(a => { c[teamOfPerson(a)]++ })
    const ranked = Object.entries(c).sort((a, b) => b[1] - a[1])
    const [top, second] = ranked
    const clear = top[1] > second[1] && top[1] > assignees.length / 2
    if (lead && teamOfPerson(lead) === 'everyday' && !clear) return { team: 'everyday', teamFrom: 'assignees' }
    return { team: top[0], teamFrom: 'assignees' }
  }
  if (lead) return { team: teamOfPerson(lead), teamFrom: 'lead' }
  return { team: 'none', teamFrom: 'none' }
}

// ---------- matching Linear projects to existing doc ids ----------
// Existing docs are keyed by Linear's project identifier (P-RAPH-210). Linear's API exposes
// that identifier, so use it. If it is ever missing, fall back to the project's slug
// (the last 12 hex chars of its URL), so match on that, then on exact name, and
// only mint a new id when neither matches.
export interface IdMatch { id: string; how: 'identifier' | 'slug' | 'name' | 'new' }
export function resolveProjectIds(projects: LProject[], existing: ExistingDoc[]): Map<string, IdMatch> {
  const bySlug = new Map<string, string>(), byName = new Map<string, string[]>()
  for (const d of existing) {
    const m = /-([0-9a-f]{12})$/.exec(String(d.data.url || ''))
    if (m) bySlug.set(m[1], d.id)
    const k = norm(String(d.data.name || ''))
    byName.set(k, [...(byName.get(k) || []), d.id])
  }
  const claimed = new Set<string>(), out = new Map<string, IdMatch>()
  const claim = (pid: string, id: string, how: IdMatch['how']) => { claimed.add(id); out.set(pid, { id, how }) }
  for (const p of projects) if (p.identifier && !claimed.has(p.identifier)) claim(p.id, p.identifier, 'identifier')
  for (const p of projects) { if (out.has(p.id)) continue; const id = bySlug.get(p.slugId); if (id && !claimed.has(id)) claim(p.id, id, 'slug') }
  for (const p of projects) {
    if (out.has(p.id)) continue
    const ids = (byName.get(norm(p.name)) || []).filter(i => !claimed.has(i))
    if (ids.length === 1) claim(p.id, ids[0], 'name')
  }
  for (const p of projects) if (!out.has(p.id)) claim(p.id, `P-${p.slugId}`, 'new')
  return out
}

// ---------- which projects belong on the roadmap ----------
export interface IssueStats { done: number; open: number; inProgress: number; blocked: number; assignees: Person[] }
export function countIssues(issues: LIssue[], qStart: string) {
  const per = new Map<string, IssueStats>(), unlisted = new Set<string>()
  let noProjectDone = 0
  const lights = { bugOpen: 0, bugDoneQ: 0, techDebtOpen: 0, techDebtDoneQ: 0 }
  for (const i of issues) {
    const { bucket, unlisted: u } = bucketIssue(i.statusName, i.statusType)
    if (u) unlisted.add(i.statusName)
    if (bucket === 'ignore') continue
    const doneThisQ = bucket === 'done' && !!i.completedAt && day(i.completedAt) >= qStart
    const isOpen = bucket === 'todo' || bucket === 'wip' || bucket === 'blocked'
    const lab = i.labels.map(l => l.toLowerCase())
    if (lab.includes('bug')) { if (isOpen) lights.bugOpen++; if (doneThisQ) lights.bugDoneQ++ }
    if (lab.includes('tech debt')) { if (isOpen) lights.techDebtOpen++; if (doneThisQ) lights.techDebtDoneQ++ }
    if (!i.projectId) { if (doneThisQ) noProjectDone++; continue }
    const s = per.get(i.projectId) || { done: 0, open: 0, inProgress: 0, blocked: 0, assignees: [] }
    if (doneThisQ) s.done++
    if (isOpen) { s.open++; if (bucket === 'wip') s.inProgress++; if (bucket === 'blocked') s.blocked++ }
    if ((doneThisQ || isOpen) && i.assignee) s.assignees.push(i.assignee)
    per.set(i.projectId, s)
  }
  return { per, noProjectDone, lights, unlisted: [...unlisted] }
}

export function selectProjects(
  all: LProject[], stats: Map<string, IssueStats>, goalInitNames: Set<string>, existingIds: Set<string>,
  idOf: (p: LProject) => string, q: QuarterInfo,
): LProject[] {
  const qLabel = q.windowName.split(' ')[1] // "Q4"
  return all.filter(p => {
    const t = p.statusType
    if (t === 'started' || t === 'planned') return true
    if (t === 'completed') {
      if (!p.completedAt || day(p.completedAt) < q.qStart) return false
      // running logs from earlier quarters (e.g. "Q3 Bug Log") stay out
      if (isBucketProject(p.name) && /Q[1-4]/i.test(p.name) && !new RegExp(qLabel, 'i').test(p.name)) return false
      return true
    }
    if (t === 'backlog') {
      if (p.initiatives.some(i => i.name === q.windowName || goalInitNames.has(i.name))) return true
      if ((stats.get(p.id)?.inProgress || 0) > 0) return true
      return existingIds.has(idOf(p))
    }
    if (t === 'canceled') {
      if (p.statusName.trim().toLowerCase() !== 'canceled') return false // not "Duplicate"
      const gaming = p.labels.some(l => l.toLowerCase().includes('gaming ops'))
      return gaming && !!p.canceledAt && day(p.canceledAt) >= q.prevQStart
    }
    return false
  })
}

// ---------- documents ----------
export function buildProjectDoc(p: LProject, id: string, stats: IssueStats | undefined, existing: Record<string, any> | undefined): Record<string, any> {
  const ex = existing || {}
  const canceled = p.statusType === 'canceled'
  const s = canceled || !stats ? { done: 0, open: 0, inProgress: 0, blocked: 0, assignees: [] as Person[] } : stats
  const labelTrack = trackFromLabels(p.labels)
  const track = labelTrack || ex.track || suggestTrack(p.name)
  const trackFrom = labelTrack ? 'linear' : ex.track ? (ex.trackFrom || 'suggested') : 'suggested'
  const { team, teamFrom } = teamOfProject(p.lead, s.assignees)
  const leadName = p.lead?.name || p.lead?.email || ''
  return {
    name: p.name, state: p.statusType, start: p.startDate || '', target: p.targetDate || '',
    createdAt: p.createdAt || '', completedAt: p.completedAt || '', canceledAt: p.canceledAt || '',
    lead: leadName, initiatives: p.initiatives.map(i => i.name), url: p.url,
    done: s.done, open: s.open, inProgress: s.inProgress, blocked: s.blocked,
    milestones: p.milestones.map(m => ({ name: m.name, target: m.targetDate || '', progress: Math.max(0, Math.min(100, Math.round(m.progress ?? 0))) })),
    track, trackFrom, team, teamFrom,
    theme: /modo/i.test(p.name) ? 'modo' : ex.theme || '',
    kind: isBucketProject(p.name) ? 'bucket' : 'project',
    krs: Array.isArray(ex.krs) ? ex.krs : [], krFrom: ex.krFrom || 'suggested',
  }
}

export function buildInitiativeDoc(i: LInitiative): Record<string, any> {
  const health = i.health === 'onTrack' || i.health === 'atRisk' || i.health === 'offTrack' ? i.health : ''
  return {
    name: i.name, status: i.status, health, targetDate: i.targetDate || '', owner: i.owner?.name || i.owner?.email || '',
    summary: i.description || '', url: i.url, parent: i.parentName || '',
  }
}

export function cycleDoc(c: LCycle | null) {
  if (!c) return null
  const last = (a: number[]) => (a && a.length ? a[a.length - 1] : 0)
  // Linear's endsAt is the start of the next day; show the last day of the cycle
  const end = new Date(new Date(c.endsAt).getTime() - 864e5).toISOString().slice(0, 10)
  return { number: c.number, start: day(c.startsAt), end, issues: last(c.issueCountHistory), done: last(c.completedIssueCountHistory) }
}

// small diff helper used by the dry run
export function changedFields(before: Record<string, any> | undefined, after: Record<string, any>): string[] {
  if (!before) return ['(new)']
  return Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
}
