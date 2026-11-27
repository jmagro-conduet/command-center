// Access profiles -- pure logic. No React, no network, no imports, so it runs in the
// browser and under `node --test`.
//
// Model
//   * A PAGE is something you can open (Log ticket, Roadmap, Strategy, ...). Each page's
//     level is none | view | edit. Pages with `hasEdit: false` only distinguish none/view
//     (a user either has the page or does not; what they can do inside it is still
//     governed by their data role, as before).
//   * An ACCESS PROFILE is a named bundle of page levels. The five built-in profiles
//     (agent, qa, admin, superadmin, operator) reproduce exactly what those roles could
//     see before profiles existed. Admins can edit them and add their own (e.g. "ELT").
//   * Each user has a data ROLE (users.role: drives data scope and in-page behaviour),
//     an optional ACCESS PROFILE (defaults to the one named after their role), and
//     optional per-page OVERRIDES (none/view/edit) that beat the profile.
//   * Operators (customer logins) are locked to the operator profile: never customised.

export type Level = 'none' | 'view' | 'edit'
export const LEVELS: Level[] = ['none', 'view', 'edit']

export type PageGroup = 'Company' | 'Dashboards' | 'Client operations' | 'Admin'
export interface PageDef {
  key: string
  label: string
  description: string
  /** Sidebar section (and the grouping in the access grids). */
  group: PageGroup
  /** true: none / view / edit are meaningful. false: just on or off. */
  hasEdit: boolean
  /** true: shown as an item in the sidebar's main list. */
  nav: boolean
  /** true: only people whose data role is SuperAdmin can ever have it. A profile or
   *  override that grants it to anyone else is ignored. */
  superadminOnly?: boolean
  /** true: planned, not built yet. Shown with a "Soon" tag and a short plan page. */
  soon?: boolean
  /** One line shown on the Coming soon page for context. */
  blurb?: string
}

// Sidebar sections, in order. 'Admin' pages are not part of the main list.
export const NAV_GROUPS: PageGroup[] = ['Company', 'Dashboards', 'Client operations']

// Order here is the order within each sidebar section.
export const PAGES: PageDef[] = [
  { key: 'strategy', label: 'Strategy', description: 'OKRs: Strategy on a Page, the monthly ELT review and its actions.', group: 'Company', hasEdit: true, nav: true },
  { key: 'roadmap', label: 'Roadmap', description: 'ELT view of the product roadmap, fed from Linear.', group: 'Company', hasEdit: true, nav: true },
  { key: 'executive-summary', label: 'Executive Summary', description: 'Operator performance summary.', group: 'Dashboards', hasEdit: false, nav: true },
  { key: 'analytics', label: 'Analytics', description: 'Ticket and adoption analytics.', group: 'Dashboards', hasEdit: false, nav: true },
  { key: 'report-card', label: 'Report Card', description: 'AI quality report card.', group: 'Dashboards', hasEdit: false, nav: true },
  { key: 'operators', label: 'Operators', description: 'Performance across every operator you can access, at a glance. Off by default.', group: 'Dashboards', hasEdit: false, nav: true },
  { key: 'customer-success', label: 'Customer Success', description: "Every client's stage, mode and next step in one view. Coming soon, off by default.", group: 'Dashboards', hasEdit: false, nav: true, soon: true, blurb: "Every client's stage, mode and next step in one view." },
  { key: 'client-status', label: 'Client Status', description: 'Where each client is in its journey, and the sales funnel behind it. Coming soon, off by default.', group: 'Dashboards', hasEdit: false, nav: true, soon: true, blurb: 'Where each client is in its journey, and the sales funnel behind it.' },
  { key: 'eval-reports', label: 'Eval Reports', description: 'Engineering triage report from eval findings.', group: 'Dashboards', hasEdit: false, nav: true },
  { key: 'log-ticket', label: 'Log ticket', description: 'Log a support ticket.', group: 'Client operations', hasEdit: false, nav: true },
  { key: 'submissions', label: 'Submissions', description: 'Review submitted tickets.', group: 'Client operations', hasEdit: false, nav: true },
  { key: 'bug-tracker', label: 'Bug Tracker', description: 'Bug reports and triage.', group: 'Client operations', hasEdit: false, nav: true },
  { key: 'bulletin', label: 'Bulletin', description: 'Team announcements.', group: 'Client operations', hasEdit: false, nav: true },
  { key: 'leaderboard', label: 'Leaderboard', description: 'Team leaderboard.', group: 'Client operations', hasEdit: false, nav: true },
  { key: 'learn', label: 'Learn', description: 'Learning centre.', group: 'Client operations', hasEdit: false, nav: true },
  { key: 'users', label: 'Users and access', description: 'Add users, set roles, reset passwords, manage access profiles. SuperAdmin only.', group: 'Admin', hasEdit: false, nav: false, superadminOnly: true },
  { key: 'admin-settings', label: 'Admin settings', description: 'Evals and Config tabs in Settings. SuperAdmin only.', group: 'Admin', hasEdit: false, nav: false, superadminOnly: true },
]
export const PAGE_KEYS = PAGES.map(p => p.key)
export const pageDef = (key: string): PageDef | undefined => PAGES.find(p => p.key === key)

// ---------------------------------------------------------------- profiles
export interface ProfileDef { key: string; name: string; description: string; builtIn: boolean; locked: boolean }
export type PageLevels = Record<string, Level>             // page key -> level (absent = none)
export type ProfilePages = Record<string, PageLevels>      // profile key -> its page levels

export const BUILTIN_PROFILES: ProfileDef[] = [
  { key: 'agent', name: 'Agent', description: 'Support agents.', builtIn: true, locked: false },
  { key: 'qa', name: 'QA', description: 'Quality reviewers.', builtIn: true, locked: false },
  { key: 'admin', name: 'Admin', description: 'Team admins.', builtIn: true, locked: false },
  { key: 'superadmin', name: 'SuperAdmin', description: 'Owners. Everything by default.', builtIn: true, locked: false },
  { key: 'operator', name: 'Operator', description: 'Customer logins. Fixed.', builtIn: true, locked: true },
]
const v = (...keys: string[]): PageLevels => Object.fromEntries(keys.map(k => [k, 'view' as Level]))
const AGENT = ['log-ticket', 'bulletin', 'leaderboard', 'bug-tracker', 'learn']
const QA = ['log-ticket', 'bulletin', 'leaderboard', 'report-card', 'bug-tracker', 'learn']
const ADMIN = ['log-ticket', 'bulletin', 'leaderboard', 'submissions', 'executive-summary', 'analytics', 'report-card', 'bug-tracker', 'learn']
// What each built-in role could open before profiles existed. The database seeds these same
// values; the app also falls back to them when the tables are not there yet.
export const BUILTIN_PAGES: ProfilePages = {
  agent: v(...AGENT),
  qa: v(...QA),
  admin: v(...ADMIN),
  superadmin: Object.fromEntries(PAGES.map(p => [p.key, p.hasEdit ? 'edit' : 'view'])) as PageLevels,
  operator: v('executive-summary'),
}

// ---------------------------------------------------------------- resolving
export interface AccessInputs {
  /** users.role as stored: agent | qa | admin | superadmin | operator */
  baseRole: string
  /** users.access_profile, or null for "the profile named after my role" */
  accessProfile: string | null
  profiles: ProfilePages
  /** this user's per-page overrides */
  overrides: PageLevels
}
export type AccessMap = Record<string, Level>

export const effectiveProfileKey = (baseRole: string, accessProfile: string | null) =>
  baseRole === 'operator' ? 'operator' : (accessProfile || baseRole)

// A page without an edit level can only be none or view.
const clamp = (page: string, l: Level | undefined): Level => {
  if (!l || l === 'none') return 'none'
  return pageDef(page)?.hasEdit ? l : 'view'
}

export function resolveLevel(page: string, a: AccessInputs): Level {
  const def = pageDef(page)
  if (!def) return 'none'
  // Managing people and access is for SuperAdmins only, whatever a profile or override says.
  if (def.superadminOnly && a.baseRole !== 'superadmin') return 'none'
  const profile = a.profiles[effectiveProfileKey(a.baseRole, a.accessProfile)] || {}
  if (a.baseRole === 'operator') return clamp(page, profile[page]) // operators: fixed, no overrides
  const ov = a.overrides[page]
  return clamp(page, ov !== undefined ? ov : profile[page])
}
export function computeAccess(a: AccessInputs): AccessMap {
  return Object.fromEntries(PAGES.map(p => [p.key, resolveLevel(p.key, a)]))
}
export const canOpen = (m: AccessMap | undefined, page: string) => !!m && !!m[page] && m[page] !== 'none'
export const canEditPage = (m: AccessMap | undefined, page: string) => !!m && m[page] === 'edit'
// Pages in the sidebar, grouped by section (sections with nothing to open are left out).
export const navGroups = (m: AccessMap): { label: PageGroup; pages: PageDef[] }[] =>
  NAV_GROUPS.map(label => ({ label, pages: PAGES.filter(p => p.nav && p.group === label && canOpen(m, p.key)) })).filter(g => g.pages.length > 0)
export const navPages = (m: AccessMap): PageDef[] => navGroups(m).flatMap(g => g.pages)

// ---------------------------------------------------------------- lockout guard
export interface UserLike { id: string; role: string; accessProfile: string | null }
// Users who can open `page` given a full picture of profiles and overrides.
export function holders(page: string, users: UserLike[], profiles: ProfilePages, overridesByUser: Record<string, PageLevels>): UserLike[] {
  return users.filter(u => u.role !== 'operator' &&
    resolveLevel(page, { baseRole: u.role, accessProfile: u.accessProfile, profiles, overrides: overridesByUser[u.id] || {} }) !== 'none')
}
// Someone must always be able to manage access, or nobody could ever fix it. Returns a
// problem to show, or '' when the configuration is safe.
export function lockoutProblem(users: UserLike[], profiles: ProfilePages, overridesByUser: Record<string, PageLevels>): string {
  if (!holders('users', users, profiles, overridesByUser).length)
    return 'This would leave nobody with access to Users and access, so nobody could change access again. Keep that page for at least one person.'
  return ''
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}
