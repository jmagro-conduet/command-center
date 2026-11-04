import { supabase } from './supabase'

// Per-user access to gated pages (e.g. the ELT-only Product Roadmap).
// SuperAdmins always have access; everyone else needs a row in public.page_access.
// Operators (customer logins) can never be granted a gated page.
//
// Enforcement of the *data* is RLS on the tables behind each page (see
// supabase/migrations/20261104_roadmap.sql). This module only drives the UI.

export interface PageGrant { canEdit: boolean }
export type PageAccessMap = Record<string, PageGrant>

export interface GatedPage { key: string; label: string; description: string }
export const GATED_PAGES: GatedPage[] = [
  { key: 'roadmap', label: 'Product Roadmap', description: 'ELT view of the product roadmap, fed from Linear.' },
]

// Fallback-safe: if the page_access table hasn't been created yet (migration
// not run), return no grants instead of throwing, so login keeps working.
export async function fetchPageAccess(userId: string): Promise<PageAccessMap> {
  try {
    const { data, error } = await supabase.from('page_access').select('page_key, can_edit').eq('user_id', userId)
    if (error || !data) return {}
    return Object.fromEntries(data.map(r => [r.page_key as string, { canEdit: !!r.can_edit }]))
  } catch {
    return {}
  }
}

interface AccessUser { role: string; isSuperAdmin: boolean; pageAccess?: PageAccessMap }

export function pageAccessFor(user: AccessUser | null | undefined, pageKey: string): { allowed: boolean; canEdit: boolean } {
  if (!user || user.role === 'operator') return { allowed: false, canEdit: false }
  if (user.isSuperAdmin) return { allowed: true, canEdit: true }
  const g = user.pageAccess?.[pageKey]
  return g ? { allowed: true, canEdit: g.canEdit } : { allowed: false, canEdit: false }
}
