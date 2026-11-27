// Run: node --test src/lib/home/metrics.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from './metrics.ts'

test('perfect rate excludes "No response" and is null with nothing graded', () => {
  assert.equal(M.perfectRate(72, 16, 12), 0.72)
  assert.equal(M.perfectRate(0, 0, 0), null)
  assert.equal(M.pct(0.728), '72.8%'); assert.equal(M.pct(null), '—')
  assert.ok(Math.abs(M.editedRate(72, 16, 12) - 0.28) < 1e-9)
})

test('local day helpers', () => {
  const d = new Date(2026, 10, 27, 15, 42, 9)
  const s = M.startOfLocalDay(d)
  assert.equal(s.getHours(), 0); assert.equal(s.getDate(), 27)
  assert.equal(M.localDateString(d), '2026-11-27'); assert.equal(M.localDateString(new Date(2026, 0, 5)), '2026-01-05')
})

test('tickets are counted once each; QA-mode operators by row id', () => {
  const rows = [{ id: 'a', ticket_number: 10 }, { id: 'b', ticket_number: 10 }, { id: 'c', ticket_number: 11 }, { id: 'd', ticket_number: null }]
  assert.equal(M.distinctTickets(rows, false), 3)   // 10, 11, and d by id
  assert.equal(M.distinctTickets(rows, true), 4)
})

test('bulletins: unread are published and not yet viewed; "posted today" needs a published row for the date', () => {
  assert.deepEqual(M.unreadBulletins([{ id: '1' }, { id: '2' }, { id: '3' }], new Set(['2'])).map(b => b.id), ['1', '3'])
  assert.equal(M.bulletinPostedFor('2026-11-27', [{ bulletin_date: '2026-11-27', is_published: false }]), false)
  assert.equal(M.bulletinPostedFor('2026-11-27', [{ bulletin_date: '2026-11-27', is_published: true }]), true)
  assert.equal(M.bulletinPostedFor('2026-11-27', [{ bulletin_date: '2026-11-26', is_published: true }]), false)
})

test('training: not started, or latest attempt not passed; a later pass clears an earlier fail', () => {
  const qs = [{ id: 'q1', title: 'KYC', passing_score: 80 }, { id: 'q2', title: 'Limits', passing_score: 70 }, { id: 'q3', title: 'Done', passing_score: 70 }]
  const at = [
    { quiz_id: 'q2', score_pct: 50, passed: false, completed_at: '2026-11-01' },
    { quiz_id: 'q3', score_pct: 40, passed: false, completed_at: '2026-11-01' }, { quiz_id: 'q3', score_pct: 90, passed: true, completed_at: '2026-11-05' },
  ]
  assert.deepEqual(M.quizTodo(qs, at).map(x => [x.quiz.id, x.status]), [['q1', 'not_started'], ['q2', 'not_passed']])
  assert.deepEqual(M.quizTodo([qs[0]], [{ quiz_id: 'q1', score_pct: 85, passed: null, completed_at: 'x' }]), [])   // falls back to the pass mark
})

const row = (o) => ({ created_at: '2026-11-25T10:00:00Z', quality_score: null, quality_ran_at: null, quality_flag: null, accuracy_error_class: null, accuracy_ran_at: null, ...o })
test('quality average counts only scored responses; accuracy errors count only evaluated ones', () => {
  const rows = [row({ quality_score: 4, quality_ran_at: 'x' }), row({ quality_score: 3, quality_ran_at: 'x' }), row({ quality_score: 1 }), row({})]
  assert.equal(M.qualityAvg(rows), 3.5); assert.equal(M.qualityAvg([row({})]), null)
  const e = M.accuracyErrors([row({ accuracy_ran_at: 'x', accuracy_error_class: 'P1A' }), row({ accuracy_ran_at: 'x', accuracy_error_class: 'P2' }), row({ accuracy_ran_at: 'x', accuracy_error_class: 'P2' }), row({ accuracy_ran_at: 'x', accuracy_error_class: 'NONE' }), row({ accuracy_error_class: 'P1B' })])
  assert.deepEqual(e, { p1a: 1, p1b: 0, p2: 2, total: 3 })
})

test('periods split by created_at; accuracy review queue ignores resolved ones', () => {
  const now = new Date('2026-11-27T12:00:00Z')
  const rs = [{ created_at: '2026-11-26T00:00:00Z' }, { created_at: '2026-11-15T00:00:00Z' }, { created_at: '2026-11-01T00:00:00Z' }]
  const s = M.splitPeriods(rs, now, 7)
  assert.equal(s.current.length, 1); assert.equal(s.prior.length, 1)   // 20 Nov - 27 Nov, and 13 Nov - 20 Nov
  const issues = [{ id: 'a', accuracy_error_class: 'P1A' }, { id: 'b', accuracy_error_class: 'P2' }, { id: 'c', accuracy_error_class: 'NONE' }, { id: 'd', accuracy_error_class: 'P1B' }]
  const reviews = [{ ticket_issue_id: 'a', eval_type: 'accuracy', review_status: 'confirmed' }, { ticket_issue_id: 'b', eval_type: 'quality', review_status: 'confirmed' }, { ticket_issue_id: 'd', eval_type: 'accuracy', review_status: 'pending' }]
  assert.equal(M.pendingAccuracyReviews(issues, reviews), 2)           // b (only a quality review) and d (pending)
})

test('chunk and plural', () => {
  assert.deepEqual(M.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.equal(M.plural(1, 'agent'), '1 agent'); assert.equal(M.plural(3, 'agent'), '3 agents')
})
