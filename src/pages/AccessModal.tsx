import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AccessAdminData } from '../lib/pageAccess'
import type { Level, PageLevels, UserLike } from '../lib/access/core'
import { PAGES, computeAccess, effectiveProfileKey, lockoutProblem } from '../lib/access/core'

// Per-person access: which access profile they use, plus per-page overrides that beat it.
// A person's data role (set in the Users table) still decides what data they can see inside a page.

type Override = '' | Level   // '' = use the profile

export interface AccessTarget { profileId: string; name: string; role: string; accessProfile: string | null }

const LEVEL_TEXT = (hasEdit: boolean, l: Level) => l === 'none' ? 'No access' : l === 'view' ? (hasEdit ? 'Can view' : 'Can open') : 'Can view and edit'

const field: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '8px 11px', fontSize: 13, color: '#000', background: '#fff',
  fontFamily: 'var(--font-body)', boxSizing: 'border-box',
}

export default function AccessModal({ target, data, users, grantedBy, onClose, onSaved }: {
  target: AccessTarget
  data: AccessAdminData
  /** every non-pending user, for the "someone must keep access management" check */
  users: (UserLike & { name: string })[]
  grantedBy: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [profile, setProfile] = useState<string>(target.accessProfile || '')
  const [ov, setOv] = useState<Record<string, Override>>(() => Object.fromEntries(PAGES.map(p => [p.key, (data.overrides[target.profileId]?.[p.key] ?? '') as Override])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const profileKey = effectiveProfileKey(target.role, profile || null)
  const overrides = useMemo(() => Object.fromEntries(Object.entries(ov).filter(([, v]) => v !== '')) as PageLevels, [ov])
  const effective = useMemo(
    () => computeAccess({ baseRole: target.role, accessProfile: profile || null, profiles: data.pages, overrides }),
    [target.role, profile, data.pages, overrides])
  const profileNameOf = (k: string) => data.profiles.find(p => p.key === k)?.name || k
  const choices = data.profiles.filter(p => p.key !== 'operator')
  const groups = ['Company', 'Dashboards', 'Client operations', 'Admin'] as const

  async function save() {
    setSaving(true); setError('')
    // Would this change leave nobody able to manage access?
    const nextUsers = users.map(u => (u.id === target.profileId ? { ...u, accessProfile: profile || null } : u))
    const nextOverrides = { ...data.overrides, [target.profileId]: overrides }
    const problem = lockoutProblem(nextUsers, data.pages, nextOverrides)
    if (problem) { setError(problem); setSaving(false); return }
    try {
      const up = await supabase.from('users').update({ access_profile: profile || null }).eq('id', target.profileId)
      if (up.error) throw up.error
      for (const p of PAGES) {
        const v = ov[p.key]
        if (v === '') {
          const del = await supabase.from('page_access').delete().eq('user_id', target.profileId).eq('page_key', p.key)
          if (del.error) throw del.error
        } else {
          const w = await supabase.from('page_access').upsert(
            { page_key: p.key, user_id: target.profileId, level: v, can_edit: v === 'edit', granted_by: grantedBy }, { onConflict: 'page_key,user_id' })
          if (w.error) throw w.error
        }
      }
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message || String(e)
      setError(/access_profile|access_profiles|level|does not exist|schema cache/i.test(msg)
        ? 'The access tables are not set up yet. Run supabase/migrations/20261125_access_profiles.sql first.' : msg)
      setSaving(false)
    }
  }

  return (
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-overlay)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: '#000' }}>Access: {target.name}</h2>
          <button onClick={onClose} aria-label="Close" style={{ color: 'rgba(0,0,0,0.35)', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#323232', marginBottom: 16, lineHeight: 1.5 }}>
          Pick the access profile that decides which pages {target.name} can open, then override single pages if needed.
          Their role ({target.role}) is set in the table and still decides what data they see inside a page.
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'var(--font-body)', fontSize: 12, color: '#323232', marginBottom: 18 }}>
          Access profile
          <select value={profile} onChange={e => setProfile(e.target.value)} disabled={saving} style={{ ...field, maxWidth: 320 }}>
            <option value="">{`Default for their role (${profileNameOf(target.role)})`}</option>
            {choices.filter(p => p.key !== target.role).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>

        {groups.map(g => (
          <div key={g} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#323232', marginBottom: 6 }}>{g}</div>
            {PAGES.filter(p => p.group === g).map(p => {
              const fromProfile = data.pages[profileKey]?.[p.key] ?? 'none'
              const fp: Level = p.hasEdit ? fromProfile : fromProfile === 'none' ? 'none' : 'view'
              return (
                <div key={p.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: '#000' }}>
                      {p.label}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 100, background: effective[p.key] === 'none' ? 'rgba(0,0,0,0.05)' : 'rgba(0,168,176,0.12)', color: effective[p.key] === 'none' ? '#323232' : '#00787e' }}>
                        {LEVEL_TEXT(p.hasEdit, effective[p.key])}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#323232' }}>{p.description}</div>
                  </div>
                  {p.superadminOnly && target.role !== 'superadmin' ? <span style={{ width: 190, fontFamily: 'var(--font-body)', fontSize: 12, color: '#323232' }}>SuperAdmin only</span> : <select aria-label={`Override for ${p.label}`} value={ov[p.key]} disabled={saving || target.role === 'operator'}
                    onChange={e => setOv(prev => ({ ...prev, [p.key]: e.target.value as Override }))} style={{ ...field, width: 190 }}>
                    <option value="">{`Use profile (${LEVEL_TEXT(p.hasEdit, fp)})`}</option>
                    <option value="none">No access</option>
                    <option value="view">{p.hasEdit ? 'Can view' : 'Can open'}</option>
                    {p.hasEdit && <option value="edit">Can view and edit</option>}
                  </select>}
                </div>
              )
            })}
          </div>
        ))}

        {error && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e53e3e', marginTop: 8, lineHeight: 1.5 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 14 }}>
          <button onClick={onClose} disabled={saving} style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#323232' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ background: '#000', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
