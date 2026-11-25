import { supabase } from './supabase'
import type { AccessMap, Level, PageLevels, ProfileDef, ProfilePages } from './access/core'
import { BUILTIN_PAGES, BUILTIN_PROFILES, canEditPage, canOpen, computeAccess, effectiveProfileKey } from './access/core'

// Who can open which page. Resolution lives in lib/access/core.ts (pure and tested):
// a user's page level = their per-page override, else their access profile's level
// (default profile = the one named after their role). This file loads the inputs.
//
// Everything here is fallback-safe: if the access tables are not there yet (migration
// not run) the built-in profiles are used, which reproduce the old role behaviour.
//
// Enforcement of the *data* behind gated pages (Roadmap, Strategy) is RLS in the
// database through has_page_access(); this module drives the UI.

export type { AccessMap, Level } from './access/core'

interface AccessUser { role?: string; access?: AccessMap }

export function pageAccessFor(user: AccessUser | null | undefined, pageKey: string): { allowed: boolean; canEdit: boolean } {
  if (!user || !user.access) return { allowed: false, canEdit: false }
  return { allowed: canOpen(user.access, pageKey), canEdit: canEditPage(user.access, pageKey) }
}

const asLevel = (x: unknown): Level => (x === 'view' || x === 'edit' || x === 'none' ? x : 'none')

// Per-user overrides. level may not exist yet on old databases: fall back to can_edit.
async function loadOverrides(userId: string): Promise<PageLevels> {
  const out: PageLevels = {}
  try {
    const r = await supabase.from('page_access').select('page_key, level, can_edit').eq('user_id', userId)
    if (!r.error && r.data) { for (const row of r.data) out[row.page_key as string] = row.level ? asLevel(row.level) : (row.can_edit ? 'edit' : 'view'); return out }
    const old = await supabase.from('page_access').select('page_key, can_edit').eq('user_id', userId)
    if (!old.error && old.data) for (const row of old.data) out[row.page_key as string] = row.can_edit ? 'edit' : 'view'
  } catch { /* none */ }
  return out
}

// The signed-in user's effective access for every page.
export async function fetchUserAccess(userId: string, baseRole: string): Promise<AccessMap> {
  let accessProfile: string | null = null
  try {
    const r = await supabase.from('users').select('access_profile').eq('id', userId).maybeSingle()
    if (!r.error && r.data) accessProfile = (r.data.access_profile as string | null) ?? null
  } catch { /* column not there yet */ }

  const key = effectiveProfileKey(baseRole, accessProfile)
  let pages: PageLevels | null = null
  try {
    const r = await supabase.from('access_profile_pages').select('page_key, level').eq('profile_key', key)
    if (!r.error && r.data) pages = Object.fromEntries(r.data.map(x => [x.page_key as string, asLevel(x.level)]))
  } catch { /* tables not there yet */ }
  if (pages === null) pages = { ...(BUILTIN_PAGES[key] || {}) }

  return computeAccess({ baseRole, accessProfile, profiles: { [key]: pages }, overrides: await loadOverrides(userId) })
}

// ---- everything the admin screens need (profiles, their pages, every user's overrides)
export interface AccessAdminData {
  ready: boolean                       // false = tables missing (migration not run)
  profiles: (ProfileDef & { createdBy?: string | null })[]
  pages: ProfilePages
  overrides: Record<string, PageLevels> // user id -> overrides
}

export async function loadAccessAdmin(): Promise<AccessAdminData> {
  const fallback: AccessAdminData = { ready: false, profiles: BUILTIN_PROFILES, pages: JSON.parse(JSON.stringify(BUILTIN_PAGES)), overrides: {} }
  try {
    const [p, pp, ov] = await Promise.all([
      supabase.from('access_profiles').select('key, name, description, built_in, locked, created_by').order('built_in', { ascending: false }).order('name'),
      supabase.from('access_profile_pages').select('profile_key, page_key, level'),
      supabase.from('page_access').select('user_id, page_key, level, can_edit'),
    ])
    if (p.error || pp.error || !p.data || !pp.data) return fallback
    const pages: ProfilePages = {}
    for (const pr of p.data) pages[pr.key as string] = {}
    for (const r of pp.data) (pages[r.profile_key as string] ||= {})[r.page_key as string] = asLevel(r.level)
    const overrides: Record<string, PageLevels> = {}
    for (const r of ov.data || []) (overrides[r.user_id as string] ||= {})[r.page_key as string] = r.level ? asLevel(r.level) : (r.can_edit ? 'edit' : 'view')
    return {
      ready: true, pages, overrides,
      profiles: p.data.map(r => ({ key: r.key as string, name: r.name as string, description: (r.description as string) || '', builtIn: !!r.built_in, locked: !!r.locked, createdBy: r.created_by as string | null })),
    }
  } catch { return fallback }
}
