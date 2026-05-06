import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

interface DBUser {
  authId: string          // auth.users.id — always present, used for password reset
  profileId: string | null // public.users.id — null if no profile row exists yet
  name: string
  email: string
  role: 'admin' | 'agent'
  operator_team: string | null
  created_at: string
}

interface OperatorTeam {
  id: string
  name: string
  active: boolean
}

const AVATAR_COLORS = ['#9B59D0', '#0891b2', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#be185d']

function avatarColor(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function initials(name: string): string {
  const parts = name.trim().split(' ')
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '9px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s', background: '#fff', width: '100%',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}

export default function Users() {
  const [users, setUsers]           = useState<DBUser[]>([])
  const [teams, setTeams]           = useState<OperatorTeam[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [editTarget, setEditTarget] = useState<DBUser | null>(null)
  const [editName, setEditName]     = useState('')
  const [editEmail, setEditEmail]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [pwSaving, setPwSaving]     = useState(false)
  const [pwMessage, setPwMessage]   = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    Promise.all([loadUsers(), loadTeams()])
  }, [])

  async function loadUsers() {
    // Pull from both sources and merge so auth users without a profile row are visible
    const [{ data: { users: authUsers } = { users: [] } }, { data: profiles }] = await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      supabase.from('users').select('id, name, email, role, operator_team, created_at, auth_id'),
    ])

    const profileByEmail = new Map((profiles ?? []).map((p: any) => [p.email, p]))

    const merged: DBUser[] = (authUsers ?? []).map((au: any) => {
      const profile = profileByEmail.get(au.email)
      const nameFromMeta = au.user_metadata?.name || au.user_metadata?.full_name || ''
      return {
        authId:       au.id,
        profileId:    profile?.id ?? null,
        name:         profile?.name || nameFromMeta || au.email.split('@')[0],
        email:        au.email,
        role:         profile?.role ?? 'agent',
        operator_team: profile?.operator_team ?? null,
        created_at:   au.created_at,
      }
    })

    merged.sort((a, b) => a.name.localeCompare(b.name))
    setUsers(merged)
    setLoading(false)
  }

  async function loadTeams() {
    const { data } = await supabase
      .from('operator_teams')
      .select('id, name, active')
      .eq('active', true)
      .order('name', { ascending: true })
    setTeams(data ?? [])
  }

  async function handleRoleChange(u: DBUser, newRole: 'admin' | 'agent') {
    await supabase.from('users').upsert(
      { email: u.email, name: u.name, role: newRole, operator_team: u.operator_team, auth_id: u.authId },
      { onConflict: 'email' }
    )
    setUsers(us => us.map(x => x.authId === u.authId ? { ...x, role: newRole } : x))
  }

  async function handleTeamChange(u: DBUser, newTeam: string) {
    const val = newTeam === '' ? null : newTeam
    await supabase.from('users').upsert(
      { email: u.email, name: u.name, role: u.role, operator_team: val, auth_id: u.authId },
      { onConflict: 'email' }
    )
    setUsers(us => us.map(x => x.authId === u.authId ? { ...x, operator_team: val } : x))
  }

  function openEdit(u: DBUser) {
    setEditTarget(u)
    setEditName(u.name)
    setEditEmail(u.email)
    setSaveError(null)
    setNewPassword('')
    setPwMessage(null)
  }

  async function handleSetPassword() {
    if (!editTarget) return
    const pw = newPassword.trim()
    if (pw.length < 6) { setPwMessage({ ok: false, text: 'Password must be at least 6 characters' }); return }
    setPwSaving(true); setPwMessage(null)
    const { error } = await supabase.auth.admin.updateUserById(editTarget.authId, { password: pw })
    setPwSaving(false)
    if (error) { setPwMessage({ ok: false, text: error.message }); return }
    setPwMessage({ ok: true, text: `Password updated — share it with ${editTarget.name} securely` })
    setNewPassword('')
  }

  async function handleEditSave() {
    if (!editTarget) return
    if (!editName.trim() || !editEmail.trim()) { setSaveError('Name and email are required'); return }
    setSaving(true); setSaveError(null)
    const { error } = await supabase.from('users').upsert(
      { email: editEmail.trim(), name: editName.trim(), role: editTarget.role, operator_team: editTarget.operator_team, auth_id: editTarget.authId },
      { onConflict: 'email' }
    )
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    setUsers(us => us.map(u => u.authId === editTarget.authId ? { ...u, name: editName.trim(), email: editEmail.trim() } : u))
    setEditTarget(null)
  }

  const filtered = useMemo(() =>
    users.filter(u => {
      if (!search) return true
      const q = search.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    }),
  [users, search])

  if (loading) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading users…</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Users</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            {users.length} team member{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <input
          type="text"
          placeholder="Search users…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220 }}
          onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
          onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
        />
      </div>

      {/* Table card */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.03)', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Member', 'Role', 'Team', 'Joined', ''].map(h => (
                <th key={h} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600,
                  color: '#58595B', textAlign: 'left', padding: '12px 16px',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => (
              <tr key={u.authId} style={{ borderBottom: i < filtered.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                {/* Avatar + name */}
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      background: avatarColor(u.name), display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                        {initials(u.name)}
                      </span>
                    </div>
                    <div>
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{u.name}</p>
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{u.email}</p>
                    </div>
                  </div>
                </td>

                {/* Role */}
                <td style={{ padding: '14px 16px' }}>
                  <select
                    value={u.role}
                    onChange={e => handleRoleChange(u, e.target.value as 'admin' | 'agent')}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                      padding: '4px 10px', borderRadius: 100, cursor: 'pointer',
                      border: '1.5px solid rgba(0,0,0,0.12)', outline: 'none',
                      background: u.role === 'admin' ? 'rgba(155,89,208,0.1)' : 'rgba(0,0,0,0.06)',
                      color: u.role === 'admin' ? '#6b21a8' : '#58595B',
                    }}
                  >
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>

                {/* Team */}
                <td style={{ padding: '14px 16px' }}>
                  <select
                    value={u.operator_team ?? ''}
                    onChange={e => handleTeamChange(u, e.target.value)}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12,
                      padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                      border: '1.5px solid rgba(0,0,0,0.12)', outline: 'none', background: '#fff', color: '#000',
                    }}
                  >
                    <option value="">No team</option>
                    {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </td>

                {/* Joined */}
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                    {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </td>

                {/* Edit action */}
                <td style={{ padding: '14px 16px' }}>
                  <button
                    onClick={() => openEdit(u)}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12,
                      padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                      border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000',
                      transition: 'all 0.15s',
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No users match your search</p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editTarget && (
        <div
          onClick={() => setEditTarget(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420,
              boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>Edit user</h2>
              <button onClick={() => setEditTarget(null)} style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Name</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>

              {saveError && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{saveError}</p>}

              {/* Reset password */}
              <div style={{ paddingTop: 8, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>
                  Reset password
                </label>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginBottom: 8 }}>
                  Sets a new password directly without sending an email. Share with the user securely.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={e => { setNewPassword(e.target.value); setPwMessage(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
                    placeholder="Min. 6 characters"
                    style={{ ...inputStyle, flex: 1 }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  />
                  <button
                    onClick={handleSetPassword}
                    disabled={pwSaving || newPassword.trim().length < 1}
                    style={{
                      background: pwSaving || newPassword.trim().length < 1 ? 'rgba(0,0,0,0.1)' : '#000',
                      color: pwSaving || newPassword.trim().length < 1 ? 'rgba(0,0,0,0.35)' : '#fff',
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                      padding: '9px 16px', borderRadius: 10, border: 'none',
                      cursor: pwSaving || newPassword.trim().length < 1 ? 'default' : 'pointer',
                      transition: 'opacity 0.15s', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { if (!pwSaving && newPassword.trim().length >= 1) e.currentTarget.style.opacity = '0.8' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    {pwSaving ? 'Setting…' : 'Set password'}
                  </button>
                </div>
                {pwMessage && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: pwMessage.ok ? '#166534' : '#e53e3e', marginTop: 6 }}>
                    {pwMessage.ok ? '✓ ' : '✗ '}{pwMessage.text}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button onClick={() => setEditTarget(null)} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                }}>
                  Cancel
                </button>
                <button onClick={handleEditSave} disabled={saving} style={{
                  background: '#000', color: '#fff',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s',
                }}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
