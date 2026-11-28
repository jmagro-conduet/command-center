// Run: node --test src/lib/access/core.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from './core.ts'

const profiles = () => JSON.parse(JSON.stringify(A.BUILTIN_PAGES))
const nav = (role, extra = {}) => A.navPages(A.computeAccess({ baseRole: role, accessProfile: null, profiles: profiles(), overrides: {}, ...extra })).map(p => p.key)

test('built-in profiles give each role exactly the pages it could always open, now grouped in the sidebar', () => {
  // Same pages as the old hard-coded sidebars; only the ORDER changed (sections: Company, Dashboards, Client operations).
  assert.deepEqual(nav('agent'), ['log-ticket', 'bug-tracker', 'bulletin', 'leaderboard', 'learn'])
  assert.deepEqual(nav('qa'), ['report-card', 'log-ticket', 'bug-tracker', 'bulletin', 'leaderboard', 'learn'])
  assert.deepEqual(nav('admin'), ['executive-summary', 'analytics', 'report-card', 'log-ticket', 'submissions', 'bug-tracker', 'bulletin', 'leaderboard', 'learn'])
  assert.deepEqual(nav('operator'), ['executive-summary'])
  assert.deepEqual(nav('superadmin'), ['strategy', 'roadmap', 'executive-summary', 'analytics', 'report-card', 'operators', 'customer-success', 'sales-funnel', 'eval-reports', 'log-ticket', 'submissions', 'bug-tracker', 'bulletin', 'leaderboard', 'learn'])
  // the same page SETS as before the regrouping (nothing gained or lost)
  const OLD = { agent: ['log-ticket', 'bulletin', 'leaderboard', 'bug-tracker', 'learn'], qa: ['log-ticket', 'bulletin', 'leaderboard', 'report-card', 'bug-tracker', 'learn'], admin: ['log-ticket', 'bulletin', 'leaderboard', 'submissions', 'executive-summary', 'analytics', 'report-card', 'bug-tracker', 'learn'] }
  for (const [r, list] of Object.entries(OLD)) assert.deepEqual([...nav(r)].sort(), [...list].sort())
})

test('sidebar groups: sections with nothing to open are left out', () => {
  const g = (role, extra = {}) => A.navGroups(A.computeAccess({ baseRole: role, accessProfile: null, profiles: profiles(), overrides: {}, ...extra })).map(x => x.label)
  assert.deepEqual(g('agent'), ['Client operations'])
  assert.deepEqual(g('qa'), ['Dashboards', 'Client operations'])
  assert.deepEqual(g('superadmin'), ['Company', 'Dashboards', 'Client operations'])
})

test('Operators is optional: off for everyone but SuperAdmin until a profile or override turns it on', () => {
  for (const r of ['agent', 'qa', 'admin']) assert.equal(nav(r).includes('operators'), false)
  assert.equal(nav('superadmin').includes('operators'), true)
  assert.equal(nav('agent', { overrides: { operators: 'view' } }).includes('operators'), true)
  const p = profiles(); p.elt = { roadmap: 'edit', strategy: 'view', operators: 'view' }
  assert.deepEqual(A.navPages(A.computeAccess({ baseRole: 'agent', accessProfile: 'elt', profiles: p, overrides: {} })).map(x => x.key), ['strategy', 'roadmap', 'operators'])
})

test('planned pages: off for everyone but SuperAdmin until a profile grants them, and flagged as soon', () => {
  const soon = A.PAGES.filter(p => p.soon).map(p => p.key)
  assert.deepEqual(soon, ['customer-success'])
  for (const r of ['agent', 'qa', 'admin']) for (const k of soon) assert.equal(nav(r).includes(k), false)
  for (const k of soon) assert.equal(nav('superadmin').includes(k), true)
  const p = profiles(); p.elt = { strategy: 'view', roadmap: 'view', operators: 'view', 'customer-success': 'view' }
  const m = A.computeAccess({ baseRole: 'agent', accessProfile: 'elt', profiles: p, overrides: {} })
  assert.deepEqual(A.navPages(m).map(x => x.key), ['strategy', 'roadmap', 'operators', 'customer-success'])
})

test('Sales Funnel is off by default: SuperAdmin only until a profile or override grants it; view only', () => {
  for (const r of ['agent', 'qa', 'admin']) assert.equal(nav(r).includes('sales-funnel'), false)
  assert.equal(nav('superadmin').includes('sales-funnel'), true)
  assert.equal(nav('admin', { overrides: { 'sales-funnel': 'view' } }).includes('sales-funnel'), true)
  const p = profiles(); p.elt = { 'sales-funnel': 'edit', roadmap: 'view' }
  const m = A.computeAccess({ baseRole: 'admin', accessProfile: 'elt', profiles: p, overrides: {} })
  assert.equal(m['sales-funnel'], 'view')                 // there is no edit level on this page
  assert.equal(A.computeAccess({ baseRole: 'operator', accessProfile: null, profiles: profiles(), overrides: { 'sales-funnel': 'view' } })['sales-funnel'], 'none')
})

test('Users and Admin settings are SuperAdmin-only: no profile or override can grant them to anyone else', () => {
  const p = profiles(); p.custom = { users: 'view', 'admin-settings': 'view', roadmap: 'view' }
  for (const role of ['agent', 'qa', 'admin']) {
    const m = A.computeAccess({ baseRole: role, accessProfile: 'custom', profiles: p, overrides: { users: 'edit' } })
    assert.equal(m.users, 'none'); assert.equal(m['admin-settings'], 'none'); assert.equal(m.roadmap, 'view')
  }
  const sa = A.computeAccess({ baseRole: 'superadmin', accessProfile: 'custom', profiles: p, overrides: {} })
  assert.equal(sa.users, 'view')                                   // a SuperAdmin on a profile that includes it keeps it
  assert.equal(A.computeAccess({ baseRole: 'superadmin', accessProfile: 'elt', profiles: { ...p, elt: { roadmap: 'edit' } }, overrides: {} }).users, 'none') // and can still be narrowed
})

test('built-in admin-area access: only SuperAdmin by default; Roadmap/Strategy are edit for SuperAdmin only', () => {
  const m = (role) => A.computeAccess({ baseRole: role, accessProfile: null, profiles: profiles(), overrides: {} })
  for (const r of ['agent', 'qa', 'admin', 'operator']) { assert.equal(m(r).users, 'none'); assert.equal(m(r)['admin-settings'], 'none'); assert.equal(m(r).roadmap, 'none'); assert.equal(m(r).strategy, 'none'); assert.equal(m(r).operators, 'none') }
  assert.equal(m('superadmin').users, 'view'); assert.equal(m('superadmin')['admin-settings'], 'view')
  assert.equal(m('superadmin').roadmap, 'edit'); assert.equal(m('superadmin').strategy, 'edit')
})

test('a custom ELT profile: Roadmap and Strategy only, on any data role', () => {
  const p = profiles(); p.elt = { roadmap: 'edit', strategy: 'view' }
  const m = A.computeAccess({ baseRole: 'agent', accessProfile: 'elt', profiles: p, overrides: {} })
  assert.deepEqual(A.navPages(m).map(x => x.key), ['strategy', 'roadmap'])
  assert.equal(A.canEditPage(m, 'roadmap'), true); assert.equal(A.canEditPage(m, 'strategy'), false)
  assert.equal(A.canOpen(m, 'log-ticket'), false)
  // a SuperAdmin on the same profile is narrowed too (SuperAdmin is only "full" by default)
  const sa = A.computeAccess({ baseRole: 'superadmin', accessProfile: 'elt', profiles: p, overrides: {} })
  assert.deepEqual(A.navPages(sa).map(x => x.key), ['strategy', 'roadmap']); assert.equal(sa.users, 'none')
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
  assert.match(A.lockoutProblem(users, p, { c: { users: 'view' } }), /nobody/)  // an agent can never hold it, so this does not help
  assert.equal(A.lockoutProblem(users, p, { a: { users: 'view' } }), '')       // an override on a SuperAdmin does
  const p2 = profiles(); p2.elt = { roadmap: 'edit' }                    // moving both SuperAdmins to ELT removes it
  assert.match(A.lockoutProblem(users.map(u => u.role === 'superadmin' ? { ...u, accessProfile: 'elt' } : u), p2, {}), /nobody/)
  assert.equal(A.holders('users', users, profiles(), {}).length, 2)
  assert.equal(A.holders('users', [{ id: 'o', role: 'operator', accessProfile: null }], profiles(), { o: { users: 'edit' } }).length, 0)
})

test('slugify', () => { assert.equal(A.slugify('  ELT & Board!  '), 'elt-board'); assert.equal(A.slugify('Ünï'), 'n') })
