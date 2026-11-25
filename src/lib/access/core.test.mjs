// Run: node --test src/lib/access/core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from './core.ts'

const profiles = () => JSON.parse(JSON.stringify(A.BUILTIN_PAGES))
const nav = (role, extra = {}) => A.navPages(A.computeAccess({ baseRole: role, accessProfile: null, profiles: profiles(), overrides: {}, ...extra })).map(p => p.key)

test('built-in profiles reproduce exactly what each role saw before profiles existed', () => {
  // The old hard-coded sidebars (Sidebar.tsx AGENT_NAV / QA_NAV / ADMIN_NAV / OPERATOR_NAV, + extras).
  assert.deepEqual(nav('agent'), ['log-ticket', 'bulletin', 'leaderboard', 'bug-tracker', 'learn'])
  assert.deepEqual(nav('qa'), ['log-ticket', 'bulletin', 'leaderboard', 'report-card', 'bug-tracker', 'learn'])
  assert.deepEqual(nav('admin'), ['log-ticket', 'bulletin', 'leaderboard', 'submissions', 'executive-summary', 'analytics', 'report-card', 'bug-tracker', 'learn'])
  assert.deepEqual(nav('operator'), ['executive-summary'])
  // SuperAdmin: admin's list + Eval Reports after Report Card, Roadmap + Strategy after Bug Tracker
  assert.deepEqual(nav('superadmin'), ['log-ticket', 'bulletin', 'leaderboard', 'submissions', 'executive-summary', 'analytics', 'report-card', 'eval-reports', 'bug-tracker', 'roadmap', 'strategy', 'learn'])
})

test('built-in admin-area access: only SuperAdmin by default; Roadmap/Strategy are edit for SuperAdmin only', () => {
  const m = (role) => A.computeAccess({ baseRole: role, accessProfile: null, profiles: profiles(), overrides: {} })
  for (const r of ['agent', 'qa', 'admin', 'operator']) { assert.equal(m(r).users, 'none'); assert.equal(m(r)['admin-settings'], 'none'); assert.equal(m(r).roadmap, 'none'); assert.equal(m(r).strategy, 'none') }
  assert.equal(m('superadmin').users, 'view'); assert.equal(m('superadmin')['admin-settings'], 'view')
  assert.equal(m('superadmin').roadmap, 'edit'); assert.equal(m('superadmin').strategy, 'edit')
})

test('a custom ELT profile: Roadmap and Strategy only, on any data role', () => {
  const p = profiles(); p.elt = { roadmap: 'edit', strategy: 'view' }
  const m = A.computeAccess({ baseRole: 'agent', accessProfile: 'elt', profiles: p, overrides: {} })
  assert.deepEqual(A.navPages(m).map(x => x.key), ['roadmap', 'strategy'])
  assert.equal(A.canEditPage(m, 'roadmap'), true); assert.equal(A.canEditPage(m, 'strategy'), false)
  assert.equal(A.canOpen(m, 'log-ticket'), false)
  // a SuperAdmin on the same profile is narrowed too (SuperAdmin is only "full" by default)
  const sa = A.computeAccess({ baseRole: 'superadmin', accessProfile: 'elt', profiles: p, overrides: {} })
  assert.deepEqual(A.navPages(sa).map(x => x.key), ['roadmap', 'strategy']); assert.equal(sa.users, 'none')
})

test('per-user overrides beat the profile, both to add and to remove', () => {
  const m = A.computeAccess({ baseRole: 'agent', accessProfile: null, profiles: profiles(), overrides: { strategy: 'view', learn: 'none', roadmap: 'edit' } })
  assert.equal(m.strategy, 'view'); assert.equal(m.learn, 'none'); assert.equal(m.roadmap, 'edit'); assert.equal(m['bug-tracker'], 'view')
})

test('levels are clamped: pages without an edit level are never "edit"; unknown pages are none', () => {
  const p = profiles(); p.x = { 'log-ticket': 'edit', roadmap: 'edit' }
  const m = A.computeAccess({ baseRole: 'agent', accessProfile: 'x', profiles: p, overrides: {} })
  assert.equal(m['log-ticket'], 'view'); assert.equal(m.roadmap, 'edit')
  assert.equal(A.resolveLevel('nonsense', { baseRole: 'superadmin', accessProfile: null, profiles: p, overrides: {} }), 'none')
})

test('operators are locked: no custom profile and no overrides can widen them', () => {
  const m = A.computeAccess({ baseRole: 'operator', accessProfile: 'superadmin', profiles: profiles(), overrides: { roadmap: 'edit', users: 'edit' } })
  assert.deepEqual(A.navPages(m).map(p => p.key), ['executive-summary']); assert.equal(m.roadmap, 'none'); assert.equal(m.users, 'none')
})

test('a missing or empty profile means no pages (never accidental access)', () => {
  const m = A.computeAccess({ baseRole: 'agent', accessProfile: 'deleted-profile', profiles: profiles(), overrides: {} })
  assert.ok(Object.values(m).every(l => l === 'none'))
})

test('lockout guard: someone must always keep Users and access', () => {
  const users = [{ id: 'a', role: 'superadmin', accessProfile: null }, { id: 'b', role: 'superadmin', accessProfile: null }, { id: 'c', role: 'agent', accessProfile: null }]
  assert.equal(A.lockoutProblem(users, profiles(), {}), '')
  const p = profiles(); delete p.superadmin.users                       // remove it from the SuperAdmin profile
  assert.match(A.lockoutProblem(users, p, {}), /nobody with access/)
  assert.equal(A.lockoutProblem(users, p, { c: { users: 'view' } }), '')   // an override on someone else keeps it safe
  const p2 = profiles(); p2.elt = { roadmap: 'edit' }                    // moving both SuperAdmins to ELT removes it
  assert.match(A.lockoutProblem(users.map(u => u.role === 'superadmin' ? { ...u, accessProfile: 'elt' } : u), p2, {}), /nobody/)
  assert.equal(A.holders('users', users, profiles(), {}).length, 2)
  assert.equal(A.holders('users', [{ id: 'o', role: 'operator', accessProfile: null }], profiles(), { o: { users: 'edit' } }).length, 0)
})

test('slugify', () => { assert.equal(A.slugify('  ELT & Board!  '), 'elt-board'); assert.equal(A.slugify('Ünï'), 'n') })
