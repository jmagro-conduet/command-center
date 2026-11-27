// Home page layout -- pure logic (no React, no network, no imports of app code), testable in Node.
//
// Home is a set of small cards. Every card belongs to the page(s) it summarises and is shown ONLY
// if the person can open one of them, so Home can never reveal data from a page they cannot see.
// Each role has a preferred order; people on a custom access profile (ELT, Sales, ...) get the
// general order filtered by what their profile allows.

export interface WidgetDef {
  id: string
  title: string
  /** Shown only if the person can open at least one of these pages. */
  requires: string[]
  /** Width in the two-column grid. */
  span: 1 | 2
}

export const WIDGETS: WidgetDef[] = [
  // support agents
  { id: 'today', title: 'Today', requires: ['log-ticket'], span: 2 },
  { id: 'bulletin-unread', title: 'Unread bulletin', requires: ['bulletin'], span: 1 },
  { id: 'training', title: 'Training to complete', requires: ['learn'], span: 1 },
  { id: 'my-week', title: 'My last 7 days', requires: ['log-ticket'], span: 2 },
  // QA
  { id: 'quality-week', title: 'Quality this week', requires: ['report-card'], span: 1 },
  { id: 'accuracy-errors', title: 'Accuracy errors', requires: ['report-card'], span: 1 },
  { id: 'needs-decision', title: 'Needs a decision', requires: ['report-card', 'bug-tracker'], span: 2 },
  // admins
  { id: 'operators-glance', title: 'Operators at a glance', requires: ['operators', 'executive-summary', 'analytics'], span: 2 },
  { id: 'team-today', title: 'Team today', requires: ['submissions'], span: 1 },
  { id: 'waiting-on-you', title: 'Waiting on you', requires: ['bug-tracker', 'bulletin'], span: 1 },
  // SuperAdmin
  { id: 'platform-health', title: 'Platform health', requires: ['admin-settings'], span: 2 },
  { id: 'people-access', title: 'People and access', requires: ['users'], span: 1 },
  // planned pages (ELT and SuperAdmin see what is being built)
  { id: 'on-the-way', title: 'On the way', requires: ['customer-success', 'client-status'], span: 2 },
  // company (ELT and SuperAdmin)
  { id: 'kr-summary', title: 'Key results', requires: ['strategy'], span: 1 },
  { id: 'actions-next', title: 'Actions and next ELT', requires: ['strategy'], span: 1 },
  { id: 'roadmap-glance', title: 'Roadmap', requires: ['roadmap'], span: 1 },
]

// Preferred order per data role. Custom profiles use GENERAL.
const ROLE_ORDER: Record<string, string[]> = {
  agent: ['today', 'bulletin-unread', 'training', 'my-week'],
  qa: ['quality-week', 'accuracy-errors', 'needs-decision'],
  admin: ['operators-glance', 'team-today', 'waiting-on-you'],
  superadmin: ['platform-health', 'people-access', 'kr-summary', 'actions-next', 'operators-glance', 'on-the-way'],
}
const GENERAL = ['kr-summary', 'actions-next', 'roadmap-glance', 'operators-glance', 'on-the-way', 'platform-health', 'people-access',
  'quality-week', 'accuracy-errors', 'needs-decision', 'team-today', 'waiting-on-you', 'today', 'bulletin-unread', 'training', 'my-week']

export interface QuickLink { page: string; label: string; primary: boolean }
const QUICK: Record<string, string[]> = {
  agent: ['log-ticket', 'learn', 'bulletin'],
  qa: ['report-card', 'bug-tracker', 'log-ticket'],
  admin: ['analytics', 'submissions', 'bug-tracker'],
  superadmin: ['settings', 'executive-summary', 'eval-reports'],
}

export interface HomeInput {
  baseRole: string
  accessProfile: string | null
  access: Record<string, string>                 // page key -> none | view | edit
  pageLabel: (key: string) => string
  navOrder: string[]                              // pages in sidebar order, already filtered by access
  hasAdminSettings: boolean                       // may open Settings' admin tabs (changes its label)
}

const can = (a: Record<string, string>, k: string) => !!a[k] && a[k] !== 'none'

export function homeLayout(i: HomeInput): { widgets: WidgetDef[]; quick: QuickLink[] } {
  const custom = !!i.accessProfile && i.accessProfile !== i.baseRole
  const order = custom ? GENERAL : (ROLE_ORDER[i.baseRole] || GENERAL)
  const pick = (ids: string[]) => ids.map(id => WIDGETS.find(w => w.id === id)).filter((w): w is WidgetDef => !!w && w.requires.some(r => can(i.access, r)))
  let widgets = pick(order)
  if (!widgets.length) widgets = pick(GENERAL)

  const prefs = custom ? [] : (QUICK[i.baseRole] || [])
  const quick: QuickLink[] = []
  for (const p of prefs) {
    if (p === 'settings') quick.push({ page: 'settings', label: i.hasAdminSettings ? 'Admin settings' : 'Settings', primary: false })
    else if (can(i.access, p)) quick.push({ page: p, label: i.pageLabel(p), primary: false })
  }
  for (const p of i.navOrder) { if (quick.length >= 3) break; if (!quick.some(q => q.page === p)) quick.push({ page: p, label: i.pageLabel(p), primary: false }) }
  if (quick[0]) quick[0].primary = true
  return { widgets, quick: quick.slice(0, 3) }
}
