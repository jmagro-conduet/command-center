// Run: node --test src/lib/funnel/logic.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as F from './logic.ts'

const NOW = new Date(2026, 10, 27, 12, 0)   // 27 Nov 2026
const cfg = {
  hiddenDeals: [],
  stageNames: { 45: 'Outreach', 38: 'First demo', 58: 'Operator demo', 75: 'Follow-up', 39: 'Qualified', 41: 'Pilot A', 42: 'Pilot B', 46: 'Live', 43: 'Lost', 76: 'Nurture', 70: 'Lead' },
  pipelines: [
    { key: 'aj', id: 3, name: 'AJ pipeline', label: 'AJ', pre: { 76: 'Nurture' }, lostStage: 43, wonStep: 6,
      steps: [{ name: 'Outreach', stages: [45] }, { name: 'First demo', stages: [38] }, { name: 'Operator demo', stages: [58] }, { name: 'Follow-up', stages: [75] }, { name: 'Qualified', stages: [39] }, { name: 'Pilot', stages: [41, 42] }, { name: 'Live', stages: [46] }] },
    { key: 'part', id: 6, name: 'Partnerships', label: 'Partners', pre: {}, lostStage: null, wonStep: null, steps: [{ name: 'Lead', stages: [70] }] },
  ],
}
let n = 0
const deal = (o) => ({ id: ++n, pipeline: 'aj', title: 'Deal ' + n, stage: 45, status: 'open', owner: 1, value: 1000, cur: 'USD', acv: 0, prob: null, added: '2026-10-01', changed: null, closed: null, exp: null, next: null, lost: '', history: [], historyOk: true, ...o })
const data = (deals, extra = {}) => ({ config: cfg, deals, activities: {}, users: { 1: 'Sam' }, sync: null, ...extra })

const A = deal({ stage: 58, history: [[45, '2026-10-01'], [38, '2026-11-10'], [58, '2026-11-20']] })
const B = deal({ stage: 45, added: '2026-11-20', history: [[45, '2026-11-20']] })
const C = deal({ stage: 46, added: '2026-08-01', value: 5000, history: [[45, '2026-08-01'], [38, '2026-08-10'], [58, '2026-08-20'], [75, '2026-09-01'], [39, '2026-09-15'], [41, '2026-10-10'], [46, '2026-11-15']] })
const D = deal({ stage: 43, status: 'lost', added: '2026-10-15', closed: '2026-11-18', lost: 'No budget', history: [[45, '2026-10-15'], [38, '2026-10-20'], [43, '2026-11-18']] })
const E = deal({ stage: 43, status: 'lost', added: '2026-06-01', closed: '2026-07-01', history: [[45, '2026-06-01'], [43, '2026-07-01']] })
const F_ = deal({ stage: 76, added: '2026-11-01', history: [[76, '2026-11-01']] })
const G = deal({ stage: 39, added: '2026-10-01', changed: '2026-11-05', historyOk: false })
const base = () => data([A, B, C, D, E, F_, G])

test('date helpers: period is the last N calendar days including today, never the future', () => {
  assert.equal(F.inPeriod('2026-11-27', 30, NOW), true); assert.equal(F.inPeriod('2026-10-29', 30, NOW), true)
  assert.equal(F.inPeriod('2026-10-28', 30, NOW), false); assert.equal(F.inPeriod('2026-12-01', 30, NOW), false)
  assert.equal(F.inPeriod('2020-01-01', 0, NOW), true); assert.equal(F.inPeriod(null, 0, NOW), false)
  assert.equal(F.daysSince('2026-11-17', NOW), 10)
})

test('funnel counts use real stage history: reached is cumulative, entered is windowed, in-stage is open now', () => {
  const v = F.buildView(base(), 'aj', 30, NOW)
  assert.deepEqual(v.reach, [6, 4, 3, 2, 2, 1, 1])
  assert.deepEqual(v.entered, [1, 1, 1, 0, 1, 0, 1])
  assert.deepEqual(v.now, [1, 0, 1, 0, 1, 0, 1])
  assert.equal(v.preOpen, 1)
  assert.equal(v.historyMissing, 1)                         // G has no history: counted by its current stage (Qualified)
})

test('onward conversion is always all time, whatever period is selected', () => {
  assert.deepEqual(F.buildView(base(), 'aj', 0, NOW).conv, [67, 75, 67, 100, 50, 100, null])
  assert.deepEqual(F.buildView(base(), 'aj', 30, NOW).conv, F.buildView(base(), 'aj', 0, NOW).conv)
})

test('KPIs for the last 30 days: open, added, moved, went Live, lost, with the long-cancelled deal excluded', () => {
  const k = F.buildView(base(), 'aj', 30, NOW).kpi
  assert.equal(k.open, 5); assert.equal(k.openValue, 5000 + 1000 * 4); assert.equal(k.noNext, 5)
  assert.equal(k.added, 2); assert.equal(k.moved, 3); assert.equal(k.wentLive, 1); assert.equal(k.lost, 1)
  assert.equal(k.avgDaysToLive, 106)
  // all time brings the old cancellation back
  assert.equal(F.buildView(base(), 'aj', 0, NOW).kpi.lost, 2)
})

test('win and lost rates need a minimum number of closed deals, then are plain percentages', () => {
  const v30 = F.buildView(base(), 'aj', 30, NOW)
  assert.deepEqual(v30.kpi.rate, { won: 1, lost: 1, closed: 2, winRate: null, lostRate: null })
  const live = (i) => deal({ stage: 46, history: [[45, '2026-11-01'], [46, '2026-11-0' + i]] })
  const lost = () => deal({ stage: 43, status: 'lost', closed: '2026-11-10', history: [[45, '2026-11-01'], [43, '2026-11-10']] })
  const r = F.buildView(data([live(2), live(3), live(4), lost(), lost()]), 'aj', 30, NOW).kpi.rate
  assert.deepEqual(r, { won: 3, lost: 2, closed: 5, winRate: 60, lostRate: 40 })
  assert.equal(F.buildView(data([]), 'aj', 30, NOW).kpi.rate.winRate, null)
})

test('a pipeline with no Live step has no win rate; a Pipedrive "won" status counts as Live', () => {
  const p = F.buildView(data([deal({ pipeline: 'part', stage: 70, history: [[70, '2026-11-01']] })]), 'part', 30, NOW)
  assert.equal(p.kpi.rate, null); assert.equal(p.kpi.wentLive, null)
  const won = deal({ stage: 41, status: 'won', closed: '2026-11-12', history: [[41, '2026-10-01']] })
  assert.equal(F.liveDate(cfg.pipelines[0], won), '2026-11-12')
  assert.equal(F.buildView(data([won]), 'aj', 30, NOW).kpi.wentLive, 1)
})

test('a lost deal counts in a period only if it became lost in it; without history the close date is used', () => {
  const P = cfg.pipelines[0]
  assert.equal(F.lostDate(P, D), '2026-11-18'); assert.equal(F.lostDate(P, E), '2026-07-01')
  const noHist = deal({ stage: 43, status: 'lost', closed: '2026-11-20', historyOk: false })
  assert.equal(F.lostDate(P, noHist), '2026-11-20'); assert.equal(F.lostDate(P, A), null)
  // no history, sitting in the Lost stage: the day it entered Lost (like 888 Africa), not a later Pipedrive close/clean-up date
  assert.equal(F.lostDate(P, deal({ stage: 43, status: 'lost', changed: '2026-10-28', closed: '2026-11-24', historyOk: false })), '2026-10-28')
  assert.equal(F.buildView(data([deal({ stage: 43, status: 'lost', changed: '2026-10-28', closed: '2026-11-24', historyOk: false })]), 'aj', 30, NOW).kpi.lost, 0)
  const v = F.buildView(base(), 'aj', 30, NOW)
  assert.equal(v.rows.some(r => r.deal.id === E.id), false); assert.equal(v.rows.some(r => r.deal.id === D.id), true)
  assert.equal(F.buildView(base(), 'aj', 0, NOW).rows.some(r => r.deal.id === E.id), true)
})

test('movements: newest first, new vs moved vs lost, lost-and-old excluded', () => {
  const m = F.buildView(base(), 'aj', 30, NOW).movements
  assert.deepEqual(m.map(x => [x.deal.id, x.kind]), [[A.id, 'moved'], [B.id, 'new'], [D.id, 'lost'], [C.id, 'moved'], [G.id, 'moved'], [F_.id, 'new']])
})

test('hidden deals are left out of everything and counted', () => {
  const d = base(); d.config = { ...cfg, hiddenDeals: [C.id] }
  const v = F.buildView(d, 'aj', 30, NOW)
  assert.equal(v.hidden, 1); assert.equal(v.kpi.wentLive, 0); assert.equal(v.reach[6], 0)
})

test('deleted deals are ignored; unknown pipeline or missing config gives no view', () => {
  assert.equal(F.buildView(data([{ ...A, deleted: true }]), 'aj', 30, NOW).kpi.open, 0)
  assert.equal(F.buildView(base(), 'zzz', 30, NOW), null); assert.equal(F.buildView(F.emptyFunnel(), 'aj', 30, NOW), null)
})

test('rows: owner names, next action and overdue flag, days in stage', () => {
  const x = deal({ next: 9, stage: 38, history: [[45, '2026-10-01'], [38, '2026-11-17']] })
  const d = data([x], { activities: { 9: { id: 9, type: 'call', subject: 'Ring them', due: '2026-11-20' } } })
  const r = F.buildView(d, 'aj', 30, NOW).rows[0]
  assert.equal(r.ownerName, 'Sam'); assert.equal(r.next.subject, 'Ring them'); assert.equal(r.nextOverdue, true); assert.equal(r.daysInStage, 10)
  assert.equal(F.buildView(data([deal({ owner: 77 })]), 'aj', 30, NOW).rows[0].ownerName, 'User 77')
})

test('summary across pipelines and CSV export (quotes escaped, one line per row)', () => {
  const s = F.summarize(base(), 30, NOW)
  assert.deepEqual(s, { open: 5, added: 2, lost: 1, wentLive: 1 })
  const v = F.buildView(data([deal({ title: 'Say "hi", ok' })]), 'aj', 30, NOW)
  const csv = F.toCsv(v, cfg).split('\n')
  assert.equal(csv.length, 2); assert.ok(csv[1].includes('"Say ""hi"", ok"'))
})

test('money formatting', () => {
  assert.equal(F.money(0), '—'); assert.equal(F.money(950), '$950'); assert.equal(F.money(60000), '$60k'); assert.equal(F.money(1250000), '$1.25M'); assert.equal(F.money(500, 'EUR'), 'EUR 500')
})
