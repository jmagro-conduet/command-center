// Run: node --test supabase/functions/pipedrive-sync/logic.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as L from './logic.ts'

const api = (o = {}) => ({ id: 9, title: 'Acme  Corp', stage_id: 39, status: 'open', owner_id: 22, value: '60000', currency: 'USD', acv: { value: 1200 }, probability: 20, add_time: '2026-02-11T10:00:00Z', stage_change_time: '2026-06-02 08:00:00', close_time: null, expected_close_date: '2026-12-31', next_activity_id: 523, lost_reason: null, is_deleted: false, ...o })

test('normalizeDeal keeps only what the page needs, with capped strings and plain types', () => {
  const d = L.normalizeDeal(api(), 'aj')
  assert.equal(d.title, 'Acme Corp'); assert.equal(d.stage, 39); assert.equal(d.value, 60000); assert.equal(d.acv, 1200)
  assert.equal(d.added, '2026-02-11'); assert.equal(d.changed, '2026-06-02'); assert.equal(d.closed, null); assert.equal(d.next, 523)
  assert.equal(d.historyOk, false); assert.deepEqual(d.history, []); assert.equal(d.deleted, undefined)
  assert.equal(L.normalizeDeal(api({ owner_id: { id: 7, name: 'x' } }), 'aj').owner, 7)             // owner can arrive as an object
  assert.equal(L.normalizeDeal(api({ acv: 5 }), 'aj').acv, 5)
  assert.equal(L.normalizeDeal(api({ title: 'x'.repeat(500) }), 'aj').title.length, 200)
  assert.equal(L.normalizeDeal({ id: 'abc', stage_id: 1 }, 'aj'), null); assert.equal(L.normalizeDeal({ id: 1 }, 'aj'), null)
  assert.equal(L.normalizeDeal(api({ is_deleted: true }), 'aj').deleted, true)
})

test('parseFlow builds the stage history in order, starting from the first stage the deal sat in', () => {
  const flow = [
    { object: 'note', data: { id: 1 } },
    { object: 'dealChange', data: { field_key: 'stage_id', old_value: '45', new_value: '38', log_time: '2026-03-01 09:00:00' } },
    { object: 'dealChange', data: { field_key: 'value', old_value: '0', new_value: '5', log_time: '2026-03-02 09:00:00' } },
    { object: 'dealChange', data: { field_key: 'stage_id', old_value: '38', new_value: '58', log_time: '2026-04-10 09:00:00' } },
  ]
  const r = L.parseFlow(flow.slice().reverse(), { stage: 58, added: '2026-02-11' })   // newest-first input is sorted
  assert.equal(r.ok, true); assert.deepEqual(r.history, [[45, '2026-02-11'], [38, '2026-03-01'], [58, '2026-04-10']])
  assert.deepEqual(L.parseFlow([], { stage: 45, added: '2026-02-11' }), { history: [[45, '2026-02-11']], ok: true }) // never moved
  assert.equal(L.parseFlow(null, { stage: 1, added: '' }).ok, false)
  assert.equal(L.parseFlow([{ object: 'dealChange', data: { field_key: 'stage_id', old_value: '1', new_value: 'x', log_time: '2026-01-01' } }], { stage: 1, added: '' }).ok, false)
})

test('history is refetched only when a deal is new, failed before, or has moved', () => {
  const a = L.normalizeDeal(api(), 'aj'); const stored = { ...a, historyOk: true, history: [[39, a.added]] }
  assert.equal(L.needsHistory(a, stored), false)
  assert.equal(L.needsHistory(a, undefined), true)
  assert.equal(L.needsHistory(a, { ...stored, historyOk: false }), true)
  assert.equal(L.needsHistory({ ...a, stage: 41 }, stored), true); assert.equal(L.needsHistory({ ...a, status: 'lost' }, stored), true)
  assert.equal(L.needsHistory({ ...a, changed: '2026-11-01' }, stored), true)
})

test('planFlows: new deals first, then newest moves, never more than the cap', () => {
  const mk = (id, changed) => ({ ...L.normalizeDeal(api({ id, stage_change_time: changed }), 'aj') })
  const deals = [mk(1, '2026-01-01'), mk(2, '2026-02-01'), mk(3, '2026-03-01'), mk(4, '2026-04-01')]
  const stored = new Map([[1, { ...deals[0], historyOk: true }], [2, { ...deals[1], historyOk: true, stage: 1 }]])   // 1 unchanged, 2 moved, 3 and 4 new
  assert.deepEqual(L.planFlows(deals, stored, 10), [4, 3, 2])
  assert.deepEqual(L.planFlows(deals, stored, 2), [4, 3])
})

test('mergeDeal keeps good stored history when the history call fails, and marks it missing otherwise', () => {
  const a = L.normalizeDeal(api(), 'aj'); const stored = { ...a, historyOk: true, history: [[45, '2026-02-11'], [39, '2026-06-02']] }
  assert.deepEqual(L.mergeDeal(a, stored, null).history, stored.history)
  assert.equal(L.mergeDeal(a, undefined, null).historyOk, false)
  assert.deepEqual(L.mergeDeal(a, stored, { history: [[1, 'x']], ok: true }).history, [[1, 'x']])
  assert.equal(L.mergeDeal({ ...a, stage: 41 }, stored, null).historyOk, false)       // moved and could not re-read: do not keep stale history
})

test('safety: an obviously short list is not written; vanished deals are limited', () => {
  assert.match(L.listLooksWrong(10, 85), /Not writing/); assert.equal(L.listLooksWrong(80, 85), ''); assert.equal(L.listLooksWrong(0, 3), '')
  const stored = [1, 2, 3, 4, 5].map(id => ({ ...L.normalizeDeal(api({ id }), 'aj') }))
  assert.deepEqual(L.vanishedDeals(stored, new Set([1, 2, 3]), 10), { ids: [4, 5], tooMany: false })
  assert.deepEqual(L.vanishedDeals(stored, new Set(), 3), { ids: [], tooMany: true })
  assert.deepEqual(L.vanishedDeals([{ ...stored[0], deleted: true }], new Set(), 3).ids, [])
})

test('activities and config validation', () => {
  assert.deepEqual(L.normalizeActivity({ id: 5, type: 'call', subject: 'Follow up', due_date: '2026-12-02', note: 'secret' }), { id: 5, type: 'call', subject: 'Follow up', due: '2026-12-02' })
  assert.equal(L.normalizeActivity({ id: 'x' }), null)
  assert.match(L.validateConfig({ pipelines: [] }), /no pipelines/); assert.match(L.validateConfig({ pipelines: [{ key: 'a' }] }), /malformed/)
  assert.equal(L.validateConfig({ pipelines: [{ key: 'a', id: 3, steps: [] }] }), '')
})
