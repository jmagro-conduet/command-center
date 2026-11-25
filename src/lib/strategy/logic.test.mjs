// Run: node --test src/lib/strategy/logic.test.mjs   (Node 22.6+ strips the types itself)
import test from 'node:test'
import assert from 'node:assert/strict'
import * as L from './logic.ts'

// ---- a small plan: two pillars, three KRs
const plan = {
  id: '2026-H2', period: 'H2 2026', periodStart: '2026-07-01', periodEnd: '2026-12-31', state: 'locked', northStar: 'ns', vision: 'v',
  pillars: [
    { id: 'rev', name: 'Revenue', short: 'Revenue', objective: 'o', owner: 'A', krs: [{ id: 'rev-1', text: 'ARR' }, { id: 'rev-2', text: 'Pipeline' }] },
    { id: 'prod', name: 'Product', short: 'Product', objective: 'o', owner: 'B', krs: [{ id: 'prod-1', text: 'Ship' }] },
  ],
}
const ck = (id, kr, status, sessionDate, session, kind = 'change', extra = {}) =>
  ({ id, kr, status, value: '', note: '', quote: '', speaker: '', at: '', kind, session, sessionDate, savedAt: sessionDate + 'T10:00:00Z', ...extra })
const base = () => {
  const d = L.emptyData()
  d.plans[plan.id] = plan; d.currentId = plan.id
  d.sessions['2026-10-01'] = { id: '2026-10-01', date: '2026-10-01', state: 'saved', baseline: true }
  d.sessions['2026-11-04'] = { id: '2026-11-04', date: '2026-11-04', state: 'saved', savedAt: '2026-11-05T00:00:00Z' }
  d.sessions['2026-12-02'] = { id: '2026-12-02', date: '2026-12-02', state: 'open' }
  const put = c => { d.checkins[c.id] = c }
  put(ck('2026-11-04__rev-1', 'rev-1', 'risk', '2026-11-04', '2026-11-04'))
  put(ck('2026-11-04__rev-2', 'rev-2', 'on', '2026-11-04', '2026-11-04'))
  put(ck('2026-11-04__prod-1', 'prod-1', 'done', '2026-11-04', '2026-11-04'))
  return d
}

test('statusAt: latest check-in on or before a date; before=true is strict', () => {
  const d = base()
  d.checkins['adhoc-1'] = ck('adhoc-1', 'rev-1', 'off', '2026-11-10', '2026-11-04', 'adhoc')
  assert.equal(L.statusAt(d, 'rev-1').status, 'off')                      // latest
  assert.equal(L.statusAt(d, 'rev-1', '2026-11-04').status, 'risk')       // as of the ELT
  assert.equal(L.statusAt(d, 'rev-1', '2026-11-04', true), null)          // strictly before the first check-in
  assert.equal(L.codeOf(L.statusAt(d, 'nope')), 'none')
})

test('check-ins of an unsaved ELT do not count; live ones count only until it is saved', () => {
  const d = base()
  d.checkins['2026-12-02__rev-2'] = ck('2026-12-02__rev-2', 'rev-2', 'off', '2026-12-02', '2026-12-02')
  assert.equal(L.statusAt(d, 'rev-2').status, 'on')          // open session's saved-kind row is ignored
  d.checkins['live-1'] = ck('live-1', 'rev-2', 'risk', '2026-12-02', '2026-12-02', 'live')
  assert.equal(L.statusAt(d, 'rev-2').status, 'risk')        // live counts while the ELT is not saved
  d.sessions['2026-12-02'].state = 'saved'
  assert.equal(L.statusAt(d, 'rev-2').status, 'off')         // once saved, the saved row wins and live is ignored
})

test('baseFor excludes the ELT being reviewed but includes same-day manual updates', () => {
  const d = base()
  const ses = d.sessions['2026-11-04']
  assert.equal(L.baseFor(d, 'rev-1', ses), null)             // its own check-in is excluded
  d.checkins['adhoc-2'] = ck('adhoc-2', 'rev-1', 'ns', '2026-11-04', '', 'adhoc')
  assert.equal(L.baseFor(d, 'rev-1', ses).status, 'ns')
})

test('agenda: done KRs drop off, worst first, not-heard-last-time first, minutes allocated', () => {
  const d = base()
  d.checkins['2026-11-04__rev-2'] = ck('2026-11-04__rev-2', 'rev-2', 'on', '2026-11-04', '2026-11-04', 'notheard')
  const ag = L.agendaFor(d, plan, d.sessions['2026-12-02'])
  const rev = ag.items.find(i => i.p.id === 'rev'), prod = ag.items.find(i => i.p.id === 'prod')
  assert.deepEqual(rev.krs.map(k => k.k.id), ['rev-2', 'rev-1'])   // not-heard (rev-2) before at-risk (rev-1)
  assert.equal(prod.krs.length, 0)                                   // product KR is done
  assert.equal(prod.mins, 0)
  assert.equal(ag.total, 2)
  assert.ok(ag.closeAt >= 5)
  assert.match(L.agendaText(d, plan, d.sessions['2026-12-02']), /KR1 ARR — At risk/)
})

test('buildProposal (blank): every KR present once, unchanged and pending', () => {
  const d = base()
  const p = L.buildProposal(d, plan, d.sessions['2026-12-02'], null, 'Entered by hand', 'now', () => 't')
  assert.equal(p.items.length, 3)
  assert.ok(p.items.every(i => i.kind === 'same' && i.decision === 'pending'))
  assert.equal(p.items.find(i => i.kr === 'rev-1').status, 'risk')
})

test('buildProposal (AI): change / same / notheard are classified and live statuses win', () => {
  const d = base()
  d.checkins['live-1'] = ck('live-1', 'prod-1', 'risk', '2026-12-02', '2026-12-02', 'live')
  const res = {
    krs: [
      { kr: 'rev-1', heard: true, status: 'on', note: 'recovered', quote: 'q', confidence: 0.9 },
      { kr: 'rev-2', heard: true, status: 'on', note: 'same' },
      { kr: 'prod-1', heard: false },
    ],
    newActions: [{ text: 'Call Betmakers', owner: 'Mike McHugh', due: '2026-12-10', kr: 'rev-2' }, { text: 'Bad refs', due: 'soon', kr: 'zzz' }, { text: '' }],
    closedActions: [{ id: 'a1', evidence: 'done' }, { id: 'missing' }],
    actionUpdates: [{ id: 'a1', note: 'ignored, closed' }, { id: 'a2', note: 'progressing' }, { id: 'gone', note: 'x' }],
  }
  d.actions.a1 = { id: 'a1', num: 1, text: 'One', owner: 'X', due: '', kr: null, status: 'open', agreedAt: '2026-11-04' }
  d.actions.a2 = { id: 'a2', num: 2, text: 'Two', owner: 'Y', due: '', kr: null, status: 'open', agreedAt: '2026-11-04' }
  let n = 0
  const p = L.buildProposal(d, plan, d.sessions['2026-12-02'], res, 'src', 'now', () => 't' + ++n)
  const by = Object.fromEntries(p.items.map(i => [i.kr, i]))
  assert.equal(by['rev-1'].kind, 'change'); assert.equal(by['rev-1'].prev, 'risk'); assert.equal(by['rev-1'].status, 'on')
  assert.equal(by['rev-2'].kind, 'same')
  assert.equal(by['prod-1'].kind, 'change')            // live status (risk) beat "not heard"; prev was done
  assert.equal(by['prod-1'].status, 'risk'); assert.equal(by['prod-1'].live, true)
  assert.equal(p.newActions.length, 2)                 // blank text dropped
  assert.equal(p.newActions[1].kr, null); assert.equal(p.newActions[1].due, '')   // invalid kr / date scrubbed
  assert.deepEqual(p.closed.map(c => c.id), ['a1'])    // unknown id dropped
  assert.deepEqual(p.actionNotes.map(c => c.id), ['a2']) // not for closed or unknown actions
})

test('buildProposal (AI): a KR with no prior status that was not heard stays not-started and is approved', () => {
  const d = L.emptyData(); d.plans[plan.id] = plan; d.currentId = plan.id
  d.sessions['2026-11-04'] = { id: '2026-11-04', date: '2026-11-04', state: 'open' }
  const p = L.buildProposal(d, plan, d.sessions['2026-11-04'], { krs: [] }, 's', 'now')
  assert.ok(p.items.every(i => i.kind === 'notheard' && i.status === 'ns' && i.decision === 'approved' && i.prev === 'none'))
})

test('buildReviewWrites: check-ins, numbered actions, comments, closes and the saved session', () => {
  const d = base()
  d.actions.a1 = { id: 'a1', num: 7, text: 'One', owner: 'X', due: '', kr: null, status: 'open', agreedAt: '2026-11-04', updates: [{ date: '2026-11-05', text: 'first' }] }
  d.proposals['2026-12-02'] = { session: '2026-12-02' }
  const ses = d.sessions['2026-12-02']
  const prop = {
    session: ses.id, source: 's', createdAt: 'c',
    items: [
      { kr: 'rev-1', prev: 'risk', kind: 'change', status: 'on', value: '5', note: 'n', quote: 'q', speaker: 's', at: '1:00', confidence: 1, decision: 'approved' },
      { kr: 'rev-2', prev: 'on', kind: 'notheard', status: 'on', value: '', note: '', quote: '', speaker: '', at: '', confidence: null, decision: 'approved' },
      { kr: 'prod-1', prev: 'none', kind: 'notheard', status: 'ns', value: '', note: '', quote: '', speaker: '', at: '', confidence: null, decision: 'approved' },
    ],
    newActions: [
      { tid: 'n1', text: 'New one', owner: 'Z', due: '2026-12-09', kr: 'rev-1', confidence: null, decision: 'approved' },
      { tid: 'n2', text: 'Rejected pending', owner: '', due: '', kr: null, confidence: null, decision: 'pending' },
      { tid: 'n3', text: 'Priority', owner: '', due: '', kr: null, confidence: null, decision: 'approved' },
    ],
    closed: [{ id: 'a1', evidence: 'e', close: true }], actionNotes: [{ id: 'a1', note: 'wrapping up', keep: true }],
  }
  const w = L.buildReviewWrites(d, ses, prop, '2026-12-03T01:00:00Z', 'simon@x.com')
  const get = (c, id) => w.sets.find(s => s.collection === c && s.id === id)?.data
  assert.equal(get('checkins', '2026-12-02__rev-1').status, 'on')
  assert.equal(get('checkins', '2026-12-02__rev-1').savedBy, 'simon@x.com')
  assert.equal(get('checkins', '2026-12-02__rev-2').kind, 'notheard')
  assert.equal(get('checkins', '2026-12-02__prod-1'), undefined)                      // never-set + not heard: no row
  assert.ok(w.deletes.some(x => x.collection === 'checkins' && x.id === '2026-12-02__prod-1'))
  assert.equal(get('actions', 'n1').num, 8); assert.equal(get('actions', 'n3').num, 9) // sequential after the max (7)
  assert.equal(get('actions', 'n2'), undefined)                                        // pending is not saved
  const a1 = get('actions', 'a1')                                                      // comment + close merged in ONE write
  assert.equal(a1.status, 'done'); assert.equal(a1.closedAt, '2026-12-02'); assert.equal(a1.updates.length, 2)
  assert.equal(a1.updates[1].text, 'wrapping up'); assert.equal(a1.updates[1].session, '2026-12-02')
  assert.equal(w.sets.filter(s => s.collection === 'actions' && s.id === 'a1').length, 1)
  assert.equal(get('sessions', '2026-12-02').state, 'saved'); assert.equal(get('sessions', '2026-12-02').savedBy, 'simon@x.com')
  assert.ok(w.deletes.some(x => x.collection === 'proposals' && x.id === '2026-12-02'))
  assert.equal('id' in get('sessions', '2026-12-02'), false)                           // ids are not stored inside the doc
  assert.equal(d.actions.a1.status, 'open')                                            // input data not mutated
})

test('proposalFromSaved reopens a saved ELT from its stored check-ins', () => {
  const d = base()
  const p = L.proposalFromSaved(d, plan, d.sessions['2026-11-04'], 'now')
  const by = Object.fromEntries(p.items.map(i => [i.kr, i]))
  assert.equal(by['rev-1'].status, 'risk'); assert.equal(by['rev-1'].decision, 'approved')
  assert.equal(L.reviewProgress(p).left, 0)
})

test('plan setup: next period is a fresh H1 copy with new KR ids; problems are reported', () => {
  const d = L.newDraftFrom(plan, new Date('2026-12-01T00:00:00'), () => 'x')
  assert.equal(d.id, '2027-H1'); assert.equal(d.period, 'H1 2027'); assert.equal(d.periodStart, '2027-01-01'); assert.equal(d.periodEnd, '2027-06-30')
  assert.equal(d.state, 'draft'); assert.equal(d.pillars[0].krs[0].id, '2027-H1-rev-x')
  assert.equal(plan.pillars[0].krs[0].id, 'rev-1')   // original untouched
  assert.equal(L.planProblem(d), '')
  d.pillars[0].krs[0].text = ''
  assert.match(L.planProblem(d), /key results with text/)
  assert.equal(L.periodFor('2026-07-01').id, '2026-H2')
  assert.equal(L.pickPlan({ ...base(), currentId: null }, '').id, '2026-H2')   // falls back to newest locked
})

test('helpers: dates, owners, overdue, names', () => {
  assert.equal(L.fmtDate('2026-11-04'), '4 Nov'); assert.equal(L.fmtDate('2026-11-04', true), 'Wed 4 Nov 2026')
  assert.equal(L.addDays('2026-11-04', 28), '2026-12-02')
  assert.equal(L.nameFromEmail('simon.doukas@raphie.com'), 'Simon Doukas'); assert.equal(L.nameFromEmail(''), '')
  assert.equal(L.numericValue('$1,200.5k'), 1200.5); assert.equal(L.numericValue('n/a'), null)
  const a = { id: 'a', num: 3, text: 't', owner: '', due: '2026-01-01', kr: null, status: 'open', agreedAt: '' }
  assert.equal(L.isOverdue(a, '2026-02-01'), true); assert.equal(L.isOverdue({ ...a, status: 'done' }, '2026-02-01'), false)
  assert.equal(L.actId(a), 'ACT-003')
})
