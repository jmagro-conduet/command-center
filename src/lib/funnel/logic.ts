// Sales Funnel -- pure logic. No React, no network, no imports, so it runs in the browser and under `node --test`.
//
// The data is a copy of Pipedrive (see supabase/functions/pipedrive-sync): deals with their stage history,
// next activities, owner names and the pipeline / stage mapping. Everything on the page is computed here.
//
// Definitions (also shown on the page):
//   * Funnel step      a named step made of one or more Pipedrive stages (config), e.g. Pilot = two stages.
//   * Reached          a deal has reached a step if it has ever sat in that step or a later one (all time).
//   * Entered          in a period view: a deal that moved into that step during the period.
//   * In stage now     open deals currently sitting in that step.
//   * Went Live        a deal that entered the pipeline's final "won" step (or whose Pipedrive status is won).
//   * Last 30 days     the last 30 calendar days including today. A lost deal counts in the period only if it
//                      became lost inside it, so long-cancelled deals drop out of the lists and the KPIs.
//   * Win / lost rate  went Live ÷ (went Live + lost) in the period; shown as a fraction when fewer than 5 closed.

export type StageHistory = [number, string][]
export interface Deal {
  id: number; pipeline: string; title: string; stage: number; status: string
  owner: number | null; value: number; cur: string; acv: number; prob: number | null
  added: string; changed: string | null; closed: string | null; exp: string | null; next: number | null; lost: string
  history: StageHistory; historyOk: boolean; deleted?: boolean
}
export interface Activity { id: number; type: string; subject: string; due: string | null }
export interface PipelineCfg {
  key: string; id: number; name: string; label: string
  pre: Record<string, string>; lostStage: number | null; wonStep: number | null
  steps: { name: string; stages: number[] }[]
}
export interface FunnelConfig { windowDays?: number; hiddenDeals?: number[]; pipelines: PipelineCfg[]; stageNames: Record<string, string> }
export interface SyncMeta { ok: boolean; syncedAt?: string; lastGoodAt?: string; attemptedAt?: string; error?: string; deals?: number; historyWaiting?: number }
export interface FunnelData {
  config: FunnelConfig | null; deals: Deal[]; activities: Record<number, Activity>; users: Record<number, string>; sync: SyncMeta | null
}
export const emptyFunnel = (): FunnelData => ({ config: null, deals: [], activities: {}, users: {}, sync: null })

/** Period in days; 0 = all time. */
export type Period = 30 | 90 | 0
export const MIN_CLOSED_FOR_RATE = 5

// ---------------------------------------------------------------- dates
const DAY = 864e5
export function pd(s: string | null | undefined): Date | null {
  if (!s) return null
  const p = String(s).slice(0, 10).split('-')
  const d = new Date(+p[0], +p[1] - 1, +p[2])
  return isNaN(d.getTime()) ? null : d
}
export const startOfDay = (now: Date) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d }
export function daysSince(s: string | null | undefined, now: Date): number | null {
  const d = pd(s); return d ? Math.round((startOfDay(now).getTime() - d.getTime()) / DAY) : null
}
/** In the last `period` days (including today). Always true for all time. Future dates are not "in the past period". */
export function inPeriod(s: string | null | undefined, period: Period, now: Date): boolean {
  if (!s) return false
  if (period === 0) return true
  const n = daysSince(s, now)
  return n !== null && n >= 0 && n < period
}

// ---------------------------------------------------------------- stage helpers
/** step index >= 0, -1 pre-funnel (e.g. Nurture), -2 the Lost stage, -3 a stage the mapping does not know. */
export function stepOf(p: PipelineCfg, stage: number): number {
  if (p.pre[String(stage)] !== undefined) return -1
  if (p.lostStage !== null && p.lostStage === stage) return -2
  const i = p.steps.findIndex(s => s.stages.includes(stage))
  return i >= 0 ? i : -3
}

// What we know about where a deal has been. Without stage history (not read yet, or Pipedrive returned none)
// we fall back to what the page could always know: the deal's current stage.
function trail(d: Deal): StageHistory {
  if (d.historyOk && d.history.length) return d.history
  return [[d.stage, d.changed || d.added]]
}
export function maxStep(p: PipelineCfg, d: Deal): number {
  let m = -1
  for (const [stage] of trail(d)) m = Math.max(m, stepOf(p, stage))
  if (!d.historyOk && d.status === 'lost' && m < 0 && (stepOf(p, d.stage) === -2 || stepOf(p, d.stage) === -1)) m = 0 // parked in Lost with no history: reached outreach only
  return m
}
const enteredStepDate = (p: PipelineCfg, d: Deal, step: number): string | null => {
  for (const [stage, at] of trail(d)) if (stepOf(p, stage) === step) return at
  return null
}
/** First time a deal reached `step` or any later one (a deal that skips a step still counts as having passed it). */
export function reachedDate(p: PipelineCfg, d: Deal, step: number): string | null {
  let best: string | null = null
  for (const [stage, at] of trail(d)) if (stepOf(p, stage) >= step && (best === null || at < best)) best = at
  return best
}
/** The step before Live (Pilot): where the contract is signed. Null when the pipeline has no Live step. */
export const pilotStepOf = (p: PipelineCfg): number | null => (p.wonStep !== null && p.wonStep > 0 ? p.wonStep - 1 : null)
/** When a deal went Live: the first time it entered the won step, or its close date if Pipedrive marked it won. */
export function liveDate(p: PipelineCfg, d: Deal): string | null {
  if (d.status === 'won') return d.closed || d.changed || d.added || null
  if (p.wonStep === null) return null
  return enteredStepDate(p, d, p.wonStep)
}
/** When a deal became lost: the day it entered the Lost stage, else its Pipedrive close date.
 *  Without stage history, a deal sitting in the Lost stage entered it at its last stage change. */
export function lostDate(p: PipelineCfg, d: Deal): string | null {
  if (d.status !== 'lost') return null
  if (d.historyOk) { for (let i = d.history.length - 1; i >= 0; i--) if (stepOf(p, d.history[i][0]) === -2) return d.history[i][1] }
  else if (stepOf(p, d.stage) === -2 && d.changed) return d.changed
  return d.closed || d.changed || null
}
/** The most recent stage move (not the creation), if any. */
export function lastMoveDate(d: Deal): string | null {
  if (d.historyOk && d.history.length > 1) return d.history[d.history.length - 1][1]
  if (d.historyOk) return null
  return d.changed && d.changed !== d.added ? d.changed : null
}

// ---------------------------------------------------------------- the view
export interface Rate { won: number; lost: number; closed: number; winRate: number | null; lostRate: number | null }
export interface Movement { deal: Deal; kind: 'new' | 'moved' | 'lost'; date: string; stageName: string }
export interface Row { deal: Deal; stepName: string; stageName: string; step: number; ownerName: string; next: Activity | null; nextOverdue: boolean; daysInStage: number | null; lostInPeriod: boolean }
export interface FunnelView {
  pipeline: PipelineCfg
  period: Period
  reach: number[]           // all time: reached this step or later
  entered: number[]         // in the period: moved into this step
  now: number[]             // open deals in this step right now
  conv: (number | null)[]   // all time only: % of those who reached this step that went on to the next tracked step
  preOpen: number; preName: string
  kpi: {
    open: number; openValue: number | null; noNext: number
    added: number; moved: number; wentLive: number | null; lost: number
    rate: Rate | null; avgDaysToLive: number | null; avgDaysToPilot: number | null; avgDaysToLost: number | null
  }
  movements: Movement[]
  rows: Row[]
  hidden: number
  historyMissing: number
}

const nameOf = (cfg: FunnelConfig, stage: number) => cfg.stageNames[String(stage)] || String(stage)

export function buildView(data: FunnelData, pipelineKey: string, period: Period, now: Date = new Date()): FunnelView | null {
  const cfg = data.config
  const p = cfg?.pipelines.find(x => x.key === pipelineKey)
  if (!cfg || !p) return null
  const hiddenIds = new Set(cfg.hiddenDeals || [])
  const all = data.deals.filter(d => d.pipeline === p.key && !d.deleted)
  const ds = all.filter(d => !hiddenIds.has(d.id))
  const n = p.steps.length
  const reach = Array(n).fill(0), entered = Array(n).fill(0), cur = Array(n).fill(0)

  for (const d of ds) {
    const m = maxStep(p, d)
    for (let k = 0; k <= m && k < n; k++) reach[k]++
    for (let k = 0; k < n; k++) {
      const hit = trail(d).some(([stage, at]) => stepOf(p, stage) === k && inPeriod(at, period, now))
      if (hit) entered[k]++
    }
    const s = stepOf(p, d.stage)
    if (d.status === 'open' && s >= 0) cur[s]++
  }
  const conv: (number | null)[] = p.steps.map((_, k) => {
    if (!p.steps[k].stages.length) return null    // always all time, whatever the period: a rate over a few weeks of a long sales cycle misleads
    let j = k + 1; while (j < n && !p.steps[j].stages.length) j++
    return j < n && reach[k] ? Math.round(reach[j] / reach[k] * 100) : null
  })

  const open = ds.filter(d => d.status === 'open')
  const preOpen = open.filter(d => stepOf(p, d.stage) === -1).length
  const wonSet = ds.filter(d => d.status !== 'lost' && inPeriod(liveDate(p, d), period, now))
  const lostSet = ds.filter(d => d.status === 'lost' && inPeriod(lostDate(p, d), period, now))
  const canWin = p.wonStep !== null || ds.some(d => d.status === 'won')
  const closed = wonSet.length + lostSet.length
  const rate: Rate | null = canWin ? {
    won: wonSet.length, lost: lostSet.length, closed,
    winRate: closed >= MIN_CLOSED_FOR_RATE ? Math.round(wonSet.length / closed * 100) : null,
    lostRate: closed >= MIN_CLOSED_FOR_RATE ? Math.round(lostSet.length / closed * 100) : null,
  } : null
  const avgSpan = (set: Deal[], at: (d: Deal) => string | null): number | null => {
    const s = set.map(d => { const a = daysSince(d.added, now), l = daysSince(at(d), now); return a !== null && l !== null ? a - l : null }).filter((x): x is number => x !== null && x >= 0)
    return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null
  }
  const ps = pilotStepOf(p)
  const pilotSet = ps === null ? [] : ds.filter(d => inPeriod(reachedDate(p, d, ps), period, now))
  const value = open.reduce((a, d) => a + d.value, 0)

  const movements: Movement[] = []
  for (const d of ds) {
    const ld = lostDate(p, d), mv = lastMoveDate(d)
    if (d.status === 'lost' && inPeriod(ld, period, now)) movements.push({ deal: d, kind: 'lost', date: ld as string, stageName: nameOf(cfg, d.stage) })
    else if (d.status !== 'lost' && inPeriod(mv, period, now)) movements.push({ deal: d, kind: 'moved', date: mv as string, stageName: nameOf(cfg, d.stage) })
    else if (d.status !== 'lost' && inPeriod(d.added, period, now)) movements.push({ deal: d, kind: 'new', date: d.added, stageName: nameOf(cfg, d.stage) })
  }
  movements.sort((a, b) => b.date.localeCompare(a.date))

  const rows: Row[] = ds.filter(d => d.status !== 'lost' || inPeriod(lostDate(p, d), period, now) || period === 0).map(d => {
    const step = stepOf(p, d.stage)
    const next = d.next ? data.activities[d.next] || null : null
    const overdue = !!next && next.due !== null && (daysSince(next.due, now) ?? 0) > 0
    const since = lastMoveDate(d) || d.added
    return {
      deal: d, step, stageName: nameOf(cfg, d.stage), ownerName: d.owner !== null ? data.users[d.owner] || `User ${d.owner}` : '',
      stepName: step === -1 ? (p.pre[String(d.stage)] as string) : step === -2 ? 'Lost' : step >= 0 ? p.steps[step].name : '?',
      next, nextOverdue: overdue, daysInStage: d.status === 'open' ? daysSince(since, now) : null,
      lostInPeriod: d.status === 'lost' && inPeriod(lostDate(p, d), period, now),
    }
  }).sort((a, b) => Math.max(maxStep(p, b.deal), -1) - Math.max(maxStep(p, a.deal), -1) || b.deal.value - a.deal.value)

  return {
    pipeline: p, period, reach, entered, now: cur, conv, preOpen, preName: Object.values(p.pre)[0] || '',
    kpi: {
      open: open.length, openValue: value > 0 ? value : null, noNext: open.filter(d => !d.next).length,
      added: ds.filter(d => inPeriod(d.added, period, now)).length,
      moved: ds.filter(d => d.status === 'open' && inPeriod(lastMoveDate(d), period, now)).length,
      wentLive: canWin ? wonSet.length : null, lost: lostSet.length, rate, avgDaysToLive: avgSpan(wonSet, d => liveDate(p, d)),
      avgDaysToPilot: ps === null ? null : avgSpan(pilotSet, d => reachedDate(p, d, ps)),
      avgDaysToLost: avgSpan(lostSet, d => lostDate(p, d)),
    },
    movements, rows, hidden: all.length - ds.length, historyMissing: ds.filter(d => !d.historyOk).length,
  }
}

/** Totals across every pipeline, for the Home card. */
export function summarize(data: FunnelData, period: Period, now: Date = new Date()) {
  const out = { open: 0, added: 0, lost: 0, wentLive: 0 }
  for (const p of data.config?.pipelines || []) {
    const v = buildView(data, p.key, period, now); if (!v) continue
    out.open += v.kpi.open; out.added += v.kpi.added; out.lost += v.kpi.lost; out.wentLive += v.kpi.wentLive ?? 0
  }
  return out
}

export const money = (v: number, cur = 'USD') => {
  if (!v) return '—'
  const sym = cur === 'USD' ? '$' : cur + ' '
  return sym + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(v))
}
export function toCsv(view: FunnelView, cfg: FunnelConfig): string {
  const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const head = ['Pipeline', 'Deal ID', 'Deal', 'Status', 'Owner', 'Pipedrive stage', 'Funnel step', 'Value', 'Currency', 'Next action', 'Next action due', 'Expected close', 'Probability', 'Added', 'Last stage change', 'Lost reason']
  const lines = view.rows.map(r => [view.pipeline.name, r.deal.id, r.deal.title, r.deal.status, r.ownerName, nameOf(cfg, r.deal.stage), r.stepName, r.deal.value, r.deal.cur,
    r.next ? `${r.next.type}: ${r.next.subject}` : '', r.next?.due || '', r.deal.exp, r.deal.prob, r.deal.added, r.deal.changed, r.deal.lost].map(q).join(','))
  return [head.join(','), ...lines].join('\n')
}
