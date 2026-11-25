// Run: node --test supabase/functions/strategy-draft-review/logic.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt, parseDraft, parseRequest } from './logic.ts'

const notes = 'Revenue KR1: we are behind on ARR, Mike will call Betmakers by 10 Dec. '.repeat(3)
const body = {
  date: '2026-12-02', team: ['Mike McHugh'], notes,
  krs: [{ id: 'rev-1', ref: 'Revenue KR1', text: 'ARR', current: 'on', value: '' }, { id: 'rev-2', ref: 'Revenue KR2', text: 'Pipeline', current: 'weird', value: '5' }],
  actions: [{ id: 'a1', ref: 'ACT-001', text: 'Do it', owner: 'X', linked: 'business priority' }],
}

test('parseRequest accepts a good request and scrubs fields', () => {
  const r = parseRequest(body)
  assert.equal(typeof r, 'object'); assert.equal(r.krs[1].current, 'none'); assert.equal(r.krs.length, 2)
})
test('parseRequest rejects bad input', () => {
  assert.equal(typeof parseRequest(null), 'string')
  assert.equal(typeof parseRequest({ ...body, date: 'tomorrow' }), 'string')
  assert.equal(typeof parseRequest({ ...body, notes: 'short' }), 'string')
  assert.equal(typeof parseRequest({ ...body, krs: [] }), 'string')
  assert.equal(typeof parseRequest({ ...body, krs: Array(101).fill(body.krs[0]) }), 'string')
})
test('buildPrompt includes the data and the JSON contract', () => {
  const p = buildPrompt(parseRequest(body))
  assert.match(p, /rev-1 \| Revenue KR1 \| ARR \| current: on/); assert.match(p, /Reply with only JSON/); assert.match(p, /ACT-001/)
})

test('parseDraft keeps only valid, known, capped data', () => {
  const req = parseRequest(body)
  const raw = 'Here you go:\n```json\n' + JSON.stringify({
    krs: [
      { kr: 'rev-1', heard: true, status: 'risk', value: '12', note: 'behind', quote: 'we are behind', confidence: 7 },
      { kr: 'rev-1', heard: true, status: 'on' },                      // duplicate ignored
      { kr: 'evil', heard: true, status: 'on' },                       // unknown id ignored
      { kr: 'rev-2', heard: 'yes', status: 'DROP TABLE' },             // heard must be literally true; bad status blanked
    ],
    newActions: [
      { text: 'Call Betmakers', owner: 'Mike McHugh', due: '2026-12-10', kr: 'rev-1', confidence: 0.8 },
      { text: 'x'.repeat(900), due: '10 Dec', kr: 'not-a-kr' },
      { text: '   ' }, { owner: 'no text' },
    ],
    closedActions: [{ id: 'a1', evidence: 'done' }, { id: 'zz', evidence: 'nope' }],
    actionUpdates: [{ id: 'a1', note: 'progress' }, { id: 'a1', note: '' }, { id: 'zz', note: 'nope' }],
  }) + '\n```'
  const d = parseDraft(raw, req)
  assert.equal(d.krs.length, 2)
  assert.equal(d.krs[0].confidence, 1)                                 // clamped
  assert.equal(d.krs[1].heard, false); assert.equal(d.krs[1].status, '')
  assert.equal(d.newActions.length, 2); assert.equal(d.newActions[1].text.length, 300)
  assert.equal(d.newActions[1].due, ''); assert.equal(d.newActions[1].kr, null)
  assert.deepEqual(d.closedActions, [{ id: 'a1', evidence: 'done' }])
  assert.deepEqual(d.actionUpdates, [{ id: 'a1', note: 'progress' }])
})
test('parseDraft returns null for unreadable replies', () => {
  const req = parseRequest(body)
  assert.equal(parseDraft('no json here', req), null)
  assert.equal(parseDraft('{"krs": "nope"}', req), null)
  assert.equal(parseDraft('{broken', req), null)
})
