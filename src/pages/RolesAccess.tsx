import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadAccessAdmin } from '../lib/pageAccess'
import type { AccessAdminData } from '../lib/pageAccess'
import type { Level, PageLevels, ProfilePages, UserLike } from '../lib/access/core'
import { BUILTIN_PROFILES, PAGES, effectiveProfileKey, lockoutProblem, slugify } from '../lib/access/core'
import { useAuth } from '../context/AuthContext'

// Admin settings -> Roles & access. Access profiles are named bundles of page access.
// The built-in ones (Agent, QA, Admin, SuperAdmin) start with what those roles could always
// open and can be edited; add your own (for example "ELT" with only Roadmap and Strategy).
// Operator is fixed. People get a profile in Users -> Pages, where single pages can also
// be overridden per person.

const card: React.CSSProperties = { background: '#fff', border: '1.5px solid rgba(0,0,0,0.09)', borderRadius: 20, padding: 24 }
const field: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '7px 10px', fontSize: 13, color: '#000', background: '#fff',
  fontFamily: 'var(--font-body)', boxSizing: 'border-box',
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
  border: primary ? 'none' : '1.5px solid rgba(0,0,0,0.12)', background: primary ? '#000' : '#fff', color: primary ? '#fff' : '#323232', transition: 'all 0.15s',
})
const GROUPS = ['Support', 'Insights', 'Leadership', 'Admin'] as const
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export default function RolesAccess() {
  const { user } = useAuth()
  const [data, setData] = useState<AccessAdminData | null>(null)
  const [pages, setPages] = useState<ProfilePages>({})                 // working copy
  const [users, setUsers] = useState<(UserLike & { name: string })[]>([])
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [newName, setNewName] = useState('')
  const [newCopy, setNewCopy] = useState('')

  async function load() {
    const d = await loadAccessAdmin()
    setData(d); setPages(clone(d.pages)); setDirty(new Set())
    let r = await supabase.from('users').select('id, name, role, access_profile')
    if (r.error) r = await supabase.from('users').select('id, name, role') as typeof r
    setUsers((r.data ?? []).map((u: { id: string; name: string; role: string; access_profile?: string | null }) => ({ id: u.id, name: u.name, role: u.role, accessProfile: u.access_profile ?? null })))
  }
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [])

  const profiles = data?.profiles ?? BUILTIN_PROFILES
  const ready = !!data?.ready
  const countFor = useMemo(() => {
    const m: Record<string, number> = {}
    for (const u of users) { if (u.role === 'operator') continue; const k = effectiveProfileKey(u.role, u.accessProfile); m[k] = (m[k] || 0) + 1 }
    return m
  }, [users])

  const setCell = (profile: string, page: string, level: Level) => {
    setPages(prev => {
      const n = clone(prev); const row: PageLevels = (n[profile] ||= {})
      if (level === 'none') delete row[page]; else row[page] = level
      return n
    })
    setDirty(prev => new Set(prev).add(profile)); setMsg(null)
  }

  async function save() {
    if (!data) return
    const problem = lockoutProblem(users, pages, data.overrides)
    if (problem) { setMsg({ ok: false, text: problem }); return }
    setSaving(true); setMsg(null)
    try {
      for (const key of dirty) {
        for (const p of PAGES) {
          const lvl = pages[key]?.[p.key] ?? 'none'
          if (lvl === 'none') {
            const del = await supabase.from('access_profile_pages').delete().eq('profile_key', key).eq('page_key', p.key)
            if (del.error) throw del.error
          } else {
            const up = await supabase.from('access_profile_pages').upsert({ profile_key: key, page_key: p.key, level: lvl }, { onConflict: 'profile_key,page_key' })
            if (up.error) throw up.error
          }
        }
      }
      await load(); setMsg({ ok: true, text: 'Saved. People see the change the next time they load Raphie Hub.' })
    } catch (e) { setMsg({ ok: false, text: (e as { message?: string })?.message || 'Could not save.' }) }
    setSaving(false)
  }

  async function createProfile() {
    const name = newName.trim(); if (!name) return
    let key = slugify(name) || 'profile'
    if (profiles.some(p => p.key === key)) key = `${key}-${Date.now().toString(36).slice(-3)}`
    setSaving(true); setMsg(null)
    try {
      const ins = await supabase.from('access_profiles').insert({ key, name, description: '', built_in: false, locked: false, created_by: user?.email ?? null })
      if (ins.error) throw ins.error
      const copy = newCopy ? Object.entries(pages[newCopy] ?? {}) : []
      if (copy.length) {
        const rows = await supabase.from('access_profile_pages').insert(copy.map(([page_key, level]) => ({ profile_key: key, page_key, level })))
        if (rows.error) throw rows.error
      }
      setNewName(''); setNewCopy(''); await load(); setMsg({ ok: true, text: `Created "${name}". Give people this profile in Users, Pages.` })
    } catch (e) { setMsg({ ok: false, text: (e as { message?: string })?.message || 'Could not create the profile.' }) }
    setSaving(false)
  }

  async function removeProfile(key: string, name: string) {
    if (countFor[key]) { setMsg({ ok: false, text: `${countFor[key]} ${countFor[key] === 1 ? 'person uses' : 'people use'} "${name}". Move them to another profile first.` }); return }
    if (!window.confirm(`Delete the "${name}" profile? This cannot be undone.`)) return
    setSaving(true)
    const del = await supabase.from('access_profiles').delete().eq('key', key)
    setMsg(del.error ? { ok: false, text: del.error.message } : { ok: true, text: `Deleted "${name}".` })
    await load(); setSaving(false)
  }

  async function rename(key: string, current: string) {
    const name = window.prompt('Profile name', current)?.trim(); if (!name || name === current) return
    const up = await supabase.from('access_profiles').update({ name }).eq('key', key)
    setMsg(up.error ? { ok: false, text: up.error.message } : null); await load()
  }

  const cols = [...profiles.filter(p => !p.locked), ...profiles.filter(p => p.locked)]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, margin: 0 }}>Roles &amp; access</h2>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#323232', margin: '6px 0 0', lineHeight: 1.55, maxWidth: 760 }}>
          An access profile decides which pages someone can open. Agent, QA, Admin and SuperAdmin start with what they could always open; change them, or add your own, such as an ELT profile with only Roadmap and Strategy.
          Assign a profile to a person in Users, Pages, where single pages can also be overridden. A person's role still decides what data they see inside a page.
        </p>
        {!ready && data && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#b45309', marginTop: 10 }}>The access tables are not set up yet, so the defaults are shown read-only. Run <b>supabase/migrations/20261125_access_profiles.sql</b> to enable editing.</p>}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--font-body)', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '14px 20px', minWidth: 220, borderBottom: '1.5px solid rgba(0,0,0,0.09)' }} />
                {cols.map(p => (
                  <th key={p.key} style={{ textAlign: 'left', padding: '14px 12px', minWidth: 150, borderBottom: '1.5px solid rgba(0,0,0,0.09)', verticalAlign: 'bottom' }}>
                    <div style={{ fontWeight: 600, color: '#000' }}>{p.name}</div>
                    <div style={{ fontSize: 11, fontWeight: 400, color: '#323232' }}>{p.locked ? 'Fixed' : `${countFor[p.key] || 0} ${(countFor[p.key] || 0) === 1 ? 'person' : 'people'}`}</div>
                    {!p.builtIn && ready && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                        <button onClick={() => rename(p.key, p.name)} style={{ background: 'none', border: 0, padding: 0, fontSize: 11, color: '#00787e', cursor: 'pointer' }}>Rename</button>
                        <button onClick={() => removeProfile(p.key, p.name)} style={{ background: 'none', border: 0, padding: 0, fontSize: 11, color: '#e53e3e', cursor: 'pointer' }}>Delete</button>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(g => (
                <Fragment key={g}>
                  <tr><td colSpan={cols.length + 1} style={{ padding: '10px 20px 4px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#323232', background: '#fbfaf9' }}>{g}</td></tr>
                  {PAGES.filter(pg => pg.group === g).map(pg => (
                    <tr key={pg.key}>
                      <td style={{ padding: '10px 20px', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                        <div style={{ fontWeight: 500, color: '#000' }}>{pg.label}</div>
                        <div style={{ fontSize: 12, color: '#323232' }}>{pg.description}</div>
                      </td>
                      {cols.map(p => {
                        const raw = pages[p.key]?.[pg.key] ?? 'none'
                        const val: Level = pg.hasEdit ? raw : raw === 'none' ? 'none' : 'view'
                        return (
                          <td key={p.key} style={{ padding: '8px 12px', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                            <select aria-label={`${pg.label} for ${p.name}`} value={val} disabled={!ready || p.locked || saving}
                              onChange={e => setCell(p.key, pg.key, e.target.value as Level)}
                              style={{ ...field, width: '100%', background: val === 'none' ? '#fff' : 'rgba(0,168,176,0.08)', borderColor: val === 'none' ? 'rgba(0,0,0,0.12)' : 'rgba(0,168,176,0.3)' }}>
                              <option value="none">None</option>
                              <option value="view">{pg.hasEdit ? 'View' : 'Open'}</option>
                              {pg.hasEdit && <option value="edit">View and edit</option>}
                            </select>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '14px 20px', borderTop: '1.5px solid rgba(0,0,0,0.09)' }}>
          <span role="status" style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: msg ? (msg.ok ? '#00787e' : '#e53e3e') : '#323232', lineHeight: 1.5, maxWidth: 640 }}>
            {msg ? msg.text : dirty.size ? `Unsaved changes to ${[...dirty].map(k => profiles.find(p => p.key === k)?.name ?? k).join(', ')}.` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn()} disabled={!dirty.size || saving} onClick={() => { setPages(clone(data?.pages ?? {})); setDirty(new Set()); setMsg(null) }}>Discard</button>
            <button style={{ ...btn(true), opacity: !dirty.size || saving ? 0.5 : 1 }} disabled={!dirty.size || saving || !ready} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </div>

      {ready && (
        <div style={card}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Add a profile</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12, color: '#323232' }}>Name
              <input type="text" value={newName} placeholder="e.g. ELT" onChange={e => setNewName(e.target.value)} style={{ ...field, width: 220 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12, color: '#323232' }}>Start from
              <select value={newCopy} onChange={e => setNewCopy(e.target.value)} style={{ ...field, width: 200 }}>
                <option value="">Nothing (no pages)</option>
                {profiles.filter(p => !p.locked).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </label>
            <button style={{ ...btn(true), opacity: !newName.trim() || saving ? 0.5 : 1 }} disabled={!newName.trim() || saving} onClick={createProfile}>Create profile</button>
          </div>
        </div>
      )}
    </div>
  )
}
