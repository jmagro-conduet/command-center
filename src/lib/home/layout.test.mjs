// Run: node --test src/lib/home/layout.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { homeLayout, WIDGETS } from './layout.ts'
import * as A from '../access/core.ts'

const profiles = () => JSON.parse(JSON.stringify(A.BUILTIN_PAGES))
const home = (role, accessProfile = null, extra = {}) => {
  const p = extra.profiles || profiles()
  const access = A.computeAccess({ baseRole: role, accessProfile, profiles: p, overrides: extra.overrides || {} })
  return homeLayout({
    baseRole: role, accessProfile, access, pageLabel: k => A.pageDef(k)?.label || k,
    navOrder: A.navPages(access).map(x => x.key), hasAdminSettings: A.canOpen(access, 'admin-settings') || A.canOpen(access, 'users'),
  })
}
const ids = h => h.widgets.map(w => w.id)
const quick = h => h.quick.map(q => q.page)

test('support agent: today, bulletin, training, my week; quick links Log ticket, Learn, Bulletin', () => {
  const h = home('agent')
  assert.deepEqual(ids(h), ['today', 'bulletin-unread', 'training', 'my-week'])
  assert.deepEqual(quick(h), ['log-ticket', 'learn', 'bulletin']); assert.equal(h.quick[0].primary, true)
})

test('QA: quality first', () => {
  const h = home('qa')
  assert.deepEqual(ids(h), ['quality-week', 'accuracy-errors', 'needs-decision'])
  assert.deepEqual(quick(h), ['report-card', 'bug-tracker', 'log-ticket'])
})

test('Admin: operators at a glance (via Executive Summary), team today, waiting on you', () => {
  const h = home('admin')
  assert.deepEqual(ids(h), ['operators-glance', 'team-today', 'waiting-on-you'])
  assert.deepEqual(quick(h), ['analytics', 'submissions', 'bug-tracker'])
})

test('SuperAdmin: platform health, people and access, company, operators; quick link is Admin settings', () => {
  const h = home('superadmin')
  assert.deepEqual(ids(h), ['platform-health', 'people-access', 'kr-summary', 'actions-next', 'operators-glance', 'on-the-way'])
  assert.deepEqual(quick(h), ['settings', 'executive-summary', 'eval-reports']); assert.equal(h.quick[0].label, 'Admin settings')
})

test('custom ELT profile on an agent: company cards only, never the agent or admin cards', () => {
  const p = profiles(); p.elt = { strategy: 'view', roadmap: 'view', operators: 'view' }
  const h = home('agent', 'elt', { profiles: p })
  assert.deepEqual(ids(h), ['kr-summary', 'actions-next', 'roadmap-glance', 'operators-glance'])
  assert.deepEqual(quick(h), ['strategy', 'roadmap', 'operators'])
})

test('ELT sees what is on the way once the planned pages are granted; nobody else does', () => {
  const p = profiles(); p.elt = { strategy: 'view', roadmap: 'view', operators: 'view', 'customer-success': 'view', 'client-status': 'view' }
  assert.deepEqual(ids(home('agent', 'elt', { profiles: p })), ['kr-summary', 'actions-next', 'roadmap-glance', 'operators-glance', 'on-the-way'])
  for (const r of ['agent', 'qa', 'admin']) assert.ok(!ids(home(r)).includes('on-the-way'))
})

test('a card never appears for someone who cannot open its page', () => {
  for (const role of ['agent', 'qa', 'admin', 'superadmin']) {
    const p = profiles()
    const access = A.computeAccess({ baseRole: role, accessProfile: null, profiles: p, overrides: {} })
    const h = home(role)
    for (const w of h.widgets) assert.ok(w.requires.some(r => A.canOpen(access, r)), `${role} got ${w.id}`)
  }
  // an agent has no Strategy, so no company cards, even though they are in the general order
  assert.ok(!ids(home('agent')).includes('kr-summary'))
  // taking Log ticket away removes the agent cards that depend on it
  const h = home('agent', null, { overrides: { 'log-ticket': 'none' } })
  assert.ok(!ids(h).includes('today') && !ids(h).includes('my-week'))
})

test('a profile with no matching cards falls back to the general list, and never to an empty Home for an allowed page', () => {
  const p = profiles(); p.sales = { learn: 'view' }
  const h = home('agent', 'sales', { profiles: p })
  assert.deepEqual(ids(h), ['training']); assert.deepEqual(quick(h), ['learn'])
  const empty = home('agent', 'sales', { profiles: { ...profiles(), sales: {} } })
  assert.deepEqual(ids(empty), []); assert.deepEqual(quick(empty), [])
})

test('every widget id is unique and has a title', () => {
  assert.equal(new Set(WIDGETS.map(w => w.id)).size, WIDGETS.length)
  assert.ok(WIDGETS.every(w => w.title && w.requires.length))
})
