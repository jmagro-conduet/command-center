import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

interface DBUser {
  authId: string
  profileId: string | null
  name: string
  email: string
  role: 'admin' | 'agent' | 'qa' | 'operator' | 'superadmin'
  operator_team: string | null
  operator_id: string | null
  created_at: string
}

interface OperatorTeam {
  id: string
  name: string
  active: boolean
}

interface Operator {
  id: string
  name: string
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
  const [operators, setOperators]   = useState<Operator[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterOpId, setFilterOpId] = useState('')

  // Edit modal
  const [editTarget, setEditTarget] = useState<DBUser | null>(null)
  const [editName, setEditName]     = useState('')
  const [editEmail, setEditEmail]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [pwSaving, setPwSaving]     = useState(false)
  const [pwMessage, setPwMessage]   = useState<{ ok: boolean; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]     = useState(false)

  // Extra operator access (beyond the user's home Operator) — grantable by SuperAdmins
  const [accessByUser, setAccessByUser] = useState<Map<string, string[]>>(new Map()) // profileId -> granted operator ids
  const [accessTarget, setAccessTarget] = useState<DBUser | null>(null)
  const [accessSelected, setAccessSelected] = useState<Set<string>>(new Set())
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessSaving, setAccessSaving]   = useState(false)

  // Add user modal
  const [addOpen, setAddOpen]         = useState(false)
  const [addName, setAddName]         = useState('')
  const [addEmail, setAddEmail]       = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addRole, setAddRole]         = useState<'admin' | 'agent' | 'qa' | 'operator' | 'superadmin'>('agent')
  const [addTeam, setAddTeam]         = useState('')
  const [addOperatorId, setAddOperatorId] = useState('')
  const [addSaving, setAddSaving]     = useState(false)
  const [addError, setAddError]       = useState<string | null>(null)

  useEffect(() => {
    Promise.all([loadUsers(), loadTeams(), loadOperators(), loadAccessGrants()])
  }, [])

  async function loadAccessGrants() {
    const { data } = await supabase.from('user_operator_access').select('user_id, operator_id')
    const map = new Map<string, string[]>()
    for (const row of data ?? []) {
      const list = map.get(row.user_id) ?? []
      list.push(row.operator_id)
      map.set(row.user_id, list)
    }
    setAccessByUser(map)
  }

  async function loadOperators() {
    const { data } = await supabase.from('operators').select('id, name').order('name')
    setOperators((data ?? []).map((o: any) => ({ id: o.id, name: o.name })))
  }

  async function loadUsers() {
    const [{ data: { users: authUsers } = { users: [] } }, { data: profiles }] = await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      supabase.from('users').select('id, name, email, role, operator_team, operator_id, created_at, auth_id'),
    ])

    const profileByEmail = new Map((profiles ?? []).map((p: any) => [p.email, p]))

    const merged: DBUser[] = (authUsers ?? []).map((au: any) => {
      const profile = profileByEmail.get(au.email)
      const nameFromMeta = au.user_metadata?.name || au.user_metadata?.full_name || ''
      return {
        authId:        au.id,
        profileId:     profile?.id ?? null,
        name:          profile?.name || nameFromMeta || au.email.split('@')[0],
        email:         au.email,
        role:          profile?.role ?? 'agent',
        operator_team: profile?.operator_team ?? null,
        operator_id:   profile?.operator_id ?? null,
        created_at:    au.created_at,
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

  async function handleRoleChange(u: DBUser, newRole: 'admin' | 'agent' | 'qa' | 'operator' | 'superadmin') {
    await supabase.from('users').upsert(
      { email: u.email, name: u.name, role: newRole, operator_team: u.operator_team, auth_id: u.authId },
      { onConflict: 'email' }
    )
    setUsers(us => us.map(x => x.authId === u.authId ? { ...x, role: newRole } : x))
  }

  async function handleTeamChange(u: DBUser, newTeam: string) {
    const val = newTeam === '' ? null : newTeam
    await supabase.from('users').upsert(
      { email: u.email, name: u.name, role: u.role, operator_team: val, operator_id: u.operator_id, auth_id: u.authId },
      { onConflict: 'email' }
    )
    setUsers(us => us.map(x => x.authId === u.authId ? { ...x, operator_team: val } : x))
  }

  async function handleOperatorChange(u: DBUser, newOperatorId: string) {
    const val = newOperatorId === '' ? null : newOperatorId
    await supabase.from('users').upsert(
      { email: u.email, name: u.name, role: u.role, operator_team: u.operator_team, operator_id: val, auth_id: u.authId },
      { onConflict: 'email' }
    )
    setUsers(us => us.map(x => x.authId === u.authId ? { ...x, operator_id: val } : x))
  }

  function openEdit(u: DBUser) {
    setEditTarget(u)
    setEditName(u.name)
    setEditEmail(u.email)
    setSaveError(null)
    setNewPassword('')
    setPwMessage(null)
    setDeleteConfirm(false)
  }

  function closeEdit() {
    setEditTarget(null)
    setDeleteConfirm(false)
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
    closeEdit()
  }

  async function handleDeleteUser() {
    if (!editTarget) return
    setDeleting(true)
    const { error } = await supabase.auth.admin.deleteUser(editTarget.authId)
    if (error) {
      setSaveError(error.message)
      setDeleting(false)
      setDeleteConfirm(false)
      return
    }
    // Also remove from public.users if a profile row exists
    await supabase.from('users').delete().eq('email', editTarget.email)
    setUsers(us => us.filter(u => u.authId !== editTarget.authId))
    setDeleting(false)
    closeEdit()
  }

  // Ensures a public.users profile row exists for this auth user (role-change/
  // operator-change handlers already lazily create one via upsert; extra-access
  // grants need the real profile id as a FK, so do the same here if it's missing).
  async function ensureProfileId(u: DBUser): Promise<string | null> {
    if (u.profileId) return u.profileId
    const { data } = await supabase.from('users').upsert(
      { email: u.email, name: u.name, role: u.role, operator_team: u.operator_team, operator_id: u.operator_id, auth_id: u.authId },
      { onConflict: 'email' }
    ).select('id').single()
    if (data?.id) {
      setUsers(us => us.map(x => x.authId === u.authId ? { ...x, profileId: data.id } : x))
    }
    return data?.id ?? null
  }

  async function openManageAccess(u: DBUser) {
    setAccessLoading(true)
    setAccessTarget(u)
    const profileId = await ensureProfileId(u)
    setAccessSelected(new Set(profileId ? (accessByUser.get(profileId) ?? []) : []))
    setAccessLoading(false)
  }

  function toggleAccess(operatorId: string) {
    setAccessSelected(prev => {
      const next = new Set(prev)
      if (next.has(operatorId)) next.delete(operatorId)
      else next.add(operatorId)
      return next
    })
  }

  async function handleSaveAccess() {
    if (!accessTarget) return
    const profileId = await ensureProfileId(accessTarget)
    if (!profileId) return
    setAccessSaving(true)
    // Simplest correct approach for a small per-user set: replace wholesale.
    await supabase.from('user_operator_access').delete().eq('user_id', profileId)
    const rows = Array.from(accessSelected).map(operatorId => ({ user_id: profileId, operator_id: operatorId }))
    if (rows.length > 0) await supabase.from('user_operator_access').insert(rows)
    setAccessByUser(prev => new Map(prev).set(profileId, Array.from(accessSelected)))
    setAccessSaving(false)
    setAccessTarget(null)
  }

  function openAdd() {
    setAddName(''); setAddEmail(''); setAddPassword('')
    setAddRole('agent'); setAddTeam(''); setAddOperatorId('')
    setAddError(null)
    setAddOpen(true)
  }

  async function handleAddUser() {
    if (!addName.trim() || !addEmail.trim()) { setAddError('Name and email are required'); return }
    if (addPassword.trim().length < 6) { setAddError('Password must be at least 6 characters'); return }
    setAddSaving(true); setAddError(null)

    const { data, error } = await supabase.auth.admin.createUser({
      email:    addEmail.trim(),
      password: addPassword.trim(),
      email_confirm: true,
      user_metadata: { name: addName.trim() },
    })

    if (error || !data.user) {
      setAddError(error?.message ?? 'Failed to create user')
      setAddSaving(false)
      return
    }

    // Create the profile row
    await supabase.from('users').upsert(
      {
        email:         addEmail.trim(),
        name:          addName.trim(),
        role:          addRole,
        operator_team: addTeam || null,
        operator_id:   addOperatorId || null,
        auth_id:       data.user.id,
      },
      { onConflict: 'email' }
    )

    const newUser: DBUser = {
      authId:        data.user.id,
      profileId:     null,
      name:          addName.trim(),
      email:         addEmail.trim(),
      role:          addRole,
      operator_team: addTeam || null,
      operator_id:   addOperatorId || null,
      created_at:    data.user.created_at,
    }

    setUsers(us => [...us, newUser].sort((a, b) => a.name.localeCompare(b.name)))
    setAddSaving(false)
    setAddOpen(false)
  }

  const filtered = useMemo(() =>
    users.filter(u => {
      if (filterOpId && u.operator_id !== filterOpId) return false
      if (!search) return true
      const q = search.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    }),
  [users, search, filterOpId])

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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search users…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 200 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          />
          <select
            value={filterOpId}
            onChange={e => setFilterOpId(e.target.value)}
            style={{ ...inputStyle, width: 170 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          >
            <option value="">All operators</option>
            {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button
            onClick={openAdd}
            style={{
              background: '#000', color: '#fff',
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              padding: '9px 16px', borderRadius: 10, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            + Add user
          </button>
        </div>
      </div>

      {/* Table card */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.03)', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Member', 'Role', 'Operator', 'Team', 'Extra access', 'Joined', ''].map(h => (
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

                <td style={{ padding: '14px 16px' }}>
                  <select
                    value={u.role}
                    onChange={e => handleRoleChange(u, e.target.value as 'admin' | 'agent' | 'qa' | 'superadmin')}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                      padding: '4px 10px', borderRadius: 100, cursor: 'pointer',
                      border: '1.5px solid rgba(0,0,0,0.12)', outline: 'none',
                      background: u.role === 'superadmin' ? 'rgba(155,89,208,0.18)' : u.role === 'admin' ? 'rgba(155,89,208,0.1)' : 'rgba(0,0,0,0.06)',
                      color: u.role === 'superadmin' ? '#6b21a8' : u.role === 'admin' ? '#6b21a8' : u.role === 'qa' ? '#0369a1' : '#58595B',
                    }}
                  >
                    <option value="agent">Agent</option>
                    <option value="qa">QA</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </td>

                <td style={{ padding: '14px 16px' }}>
                  <select
                    value={u.operator_id ?? ''}
                    onChange={e => handleOperatorChange(u, e.target.value)}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12,
                      padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                      border: '1.5px solid rgba(0,0,0,0.12)', outline: 'none', background: '#fff', color: '#000',
                    }}
                  >
                    <option value="">No operator</option>
                    {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>

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

                <td style={{ padding: '14px 16px' }}>
                  {(() => {
                    const grantCount = u.profileId ? (accessByUser.get(u.profileId)?.length ?? 0) : 0
                    return (
                      <button
                        onClick={() => openManageAccess(u)}
                        style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                          padding: '5px 12px', borderRadius: 100, cursor: 'pointer',
                          border: `1.5px solid ${grantCount > 0 ? 'rgba(155,89,208,0.3)' : 'rgba(0,0,0,0.12)'}`,
                          background: grantCount > 0 ? 'rgba(155,89,208,0.08)' : '#fff',
                          color: grantCount > 0 ? '#9B59D0' : '#58595B',
                          transition: 'all 0.15s',
                        }}
                      >
                        {grantCount > 0 ? `+${grantCount} operator${grantCount === 1 ? '' : 's'}` : 'Manage access'}
                      </button>
                    )
                  })()}
                </td>

                <td style={{ padding: '14px 16px' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                    {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </td>

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

      {/* Add user modal */}
      {addOpen && (
        <div
          onClick={() => setAddOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>Add user</h2>
              <button onClick={() => setAddOpen(false)} style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Name <span style={{ color: '#e53e3e' }}>*</span></label>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Full name" style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </div>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Email <span style={{ color: '#e53e3e' }}>*</span></label>
                <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="name@company.com" style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </div>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Password <span style={{ color: '#e53e3e' }}>*</span></label>
                <input type="text" value={addPassword} onChange={e => setAddPassword(e.target.value)} placeholder="Min. 6 characters — share with user securely" style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Role</label>
                  <select value={addRole} onChange={e => setAddRole(e.target.value as 'admin' | 'agent' | 'qa' | 'operator' | 'superadmin')} style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}>
                    <option value="agent">Agent</option>
                    <option value="qa">QA</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Operator</label>
                  <select value={addOperatorId} onChange={e => setAddOperatorId(e.target.value)} style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}>
                    <option value="">No operator</option>
                    {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Team</label>
                <select value={addTeam} onChange={e => setAddTeam(e.target.value)} style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}>
                  <option value="">No team</option>
                  {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>

              {addError && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{addError}</p>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button onClick={() => setAddOpen(false)} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                }}>Cancel</button>
                <button onClick={handleAddUser} disabled={addSaving} style={{
                  background: '#000', color: '#fff',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, border: 'none',
                  cursor: addSaving ? 'not-allowed' : 'pointer', opacity: addSaving ? 0.6 : 1, transition: 'opacity 0.15s',
                }}>{addSaving ? 'Creating…' : 'Create user'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div
          onClick={closeEdit}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>Edit user</h2>
              <button onClick={closeEdit} style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </div>
              <div>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </div>

              {saveError && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{saveError}</p>}

              {/* Reset password */}
              <div style={{ paddingTop: 8, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>Reset password</label>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginBottom: 8 }}>
                  Sets a new password directly without sending an email. Share with the user securely.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text" value={newPassword}
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

              {/* Delete section */}
              <div style={{ paddingTop: 8, marginTop: 4, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                      color: '#e53e3e', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 0, textDecoration: 'underline',
                    }}
                  >
                    Delete user
                  </button>
                ) : (
                  <div style={{ background: 'rgba(229,62,62,0.06)', border: '1px solid rgba(229,62,62,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#e53e3e', marginBottom: 4 }}>
                      Delete {editTarget.name}?
                    </p>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginBottom: 12 }}>
                      This removes their login access permanently. Their submitted tickets are retained.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setDeleteConfirm(false)}
                        style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                          padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                          border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteUser}
                        disabled={deleting}
                        style={{
                          background: '#e53e3e', color: '#fff',
                          fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                          padding: '7px 14px', borderRadius: 8, border: 'none',
                          cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1,
                        }}
                      >
                        {deleting ? 'Deleting…' : 'Yes, delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button onClick={closeEdit} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                }}>Cancel</button>
                <button onClick={handleEditSave} disabled={saving} style={{
                  background: '#000', color: '#fff',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s',
                }}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage extra operator access modal */}
      {accessTarget && (
        <div
          onClick={() => !accessSaving && setAccessTarget(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>Manage access</h2>
              <button onClick={() => setAccessTarget(null)} style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginBottom: 18 }}>
              Operators {accessTarget.name} can switch into, on top of their home operator
              {accessTarget.operator_id ? ` (${operators.find(o => o.id === accessTarget.operator_id)?.name ?? '—'})` : ''}.
              Useful for QA covering more than one client, or agents dual-logging tickets across operators.
            </p>

            {accessLoading ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
                {operators.filter(o => o.id !== accessTarget.operator_id).map(o => {
                  const checked = accessSelected.has(o.id)
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleAccess(o.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, background: checked ? 'rgba(155,89,208,0.06)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                    >
                      <span style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        border: checked ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.25)',
                        background: checked ? '#9B59D0' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{o.name}</span>
                    </button>
                  )
                })}
                {operators.filter(o => o.id !== accessTarget.operator_id).length === 0 && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>No other operators exist yet.</p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 18 }}>
              <button onClick={() => setAccessTarget(null)} disabled={accessSaving} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
              }}>Cancel</button>
              <button onClick={handleSaveAccess} disabled={accessSaving || accessLoading} style={{
                background: '#000', color: '#fff',
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                padding: '9px 16px', borderRadius: 10, border: 'none',
                cursor: accessSaving ? 'not-allowed' : 'pointer', opacity: accessSaving ? 0.6 : 1, transition: 'opacity 0.15s',
              }}>{accessSaving ? 'Saving…' : 'Save access'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
