import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { TARGET_MIN_KEY, TARGET_MAX_KEY, getDailyTarget } from '../lib/settings'

interface Team { id: string; name: string }

export default function Settings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ── My Account ────────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState(user?.name ?? '')
  const [nameSaving,  setNameSaving]  = useState(false)
  const [nameSaved,   setNameSaved]   = useState(false)

  // ── Operator Teams (admin) ────────────────────────────────────────────────
  const [teams,       setTeams]       = useState<Team[]>([])
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [newTeamName, setNewTeamName] = useState('')
  const [addingTeam,  setAddingTeam]  = useState(false)
  const [renamingId,  setRenamingId]  = useState<string | null>(null)
  const [renameVal,   setRenameVal]   = useState('')

  // ── Daily Target (admin) ──────────────────────────────────────────────────
  const tgt = getDailyTarget()
  const [targetMin,   setTargetMin]   = useState(tgt.min.toString())
  const [targetMax,   setTargetMax]   = useState(tgt.max.toString())
  const [targetSaved, setTargetSaved] = useState(false)

  useEffect(() => { if (isAdmin) loadTeams() }, [isAdmin])

  async function loadTeams() {
    setTeamsLoading(true)
    const { data } = await supabase.from('operator_teams').select('*').order('name')
    setTeams(data ?? [])
    setTeamsLoading(false)
  }

  async function addTeam() {
    const name = newTeamName.trim()
    if (!name) return
    setAddingTeam(true)
    await supabase.from('operator_teams').insert([{ name }])
    setNewTeamName('')
    setAddingTeam(false)
    loadTeams()
  }

  async function saveRename(id: string, oldName: string) {
    const name = renameVal.trim()
    if (!name || name === oldName) { setRenamingId(null); return }
    await supabase.from('operator_teams').update({ name }).eq('id', id)
    // Keep users' operator_team in sync
    await supabase.from('users').update({ operator_team: name }).eq('operator_team', oldName)
    setRenamingId(null)
    loadTeams()
  }

  async function deleteTeam(id: string, name: string) {
    const { count } = await supabase
      .from('users').select('id', { count: 'exact', head: true }).eq('operator_team', name)
    if ((count ?? 0) > 0) {
      if (!confirm(`${count} user(s) are on this team and will be unassigned. Continue?`)) return
      await supabase.from('users').update({ operator_team: null }).eq('operator_team', name)
    }
    await supabase.from('operator_teams').delete().eq('id', id)
    loadTeams()
  }

  function saveTarget() {
    const min = Math.max(1, parseInt(targetMin) || 20)
    const max = Math.max(min, parseInt(targetMax) || 30)
    localStorage.setItem(TARGET_MIN_KEY, min.toString())
    localStorage.setItem(TARGET_MAX_KEY, max.toString())
    setTargetSaved(true)
    setTimeout(() => setTargetSaved(false), 2500)
  }

  async function saveName() {
    if (!user || !displayName.trim()) return
    setNameSaving(true)
    await supabase.from('users').update({ name: displayName.trim() }).eq('id', user.id)
    setNameSaving(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
          Settings
        </h1>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
          Configure your Command Center preferences
        </p>
      </div>

      {/* ── My Account ─────────────────────────────────────────────────────── */}
      <SectionCard title="My Account" subtitle="Update your display name shown across the app">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', maxWidth: 380 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Display name</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName() }}
              style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>
          <SaveBtn onClick={saveName} loading={nameSaving} saved={nameSaved} />
        </div>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', marginTop: 8 }}>
          Email: {user?.email} · Role: {user?.role}
        </p>
      </SectionCard>

      {/* ── Admin-only ──────────────────────────────────────────────────────── */}
      {isAdmin && (
        <>
          {/* Operator Teams */}
          <SectionCard
            title="Operator Teams"
            subtitle="Teams available when assigning users. Renaming a team updates all existing users."
          >
            {teamsLoading ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teams.length === 0 && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa', padding: '8px 0' }}>
                    No teams yet. Add one below.
                  </p>
                )}

                {teams.map(t => (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 14px', borderRadius: 10,
                    border: '1.5px solid rgba(0,0,0,0.08)',
                    background: renamingId === t.id ? 'rgba(206,164,255,0.04)' : '#fafafa',
                    transition: 'background 0.15s',
                  }}>
                    {renamingId === t.id ? (
                      <>
                        <input
                          autoFocus
                          value={renameVal}
                          onChange={e => setRenameVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveRename(t.id, t.name)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          style={{ ...inputStyle, flex: 1, padding: '6px 10px' }}
                          onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                          onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                        />
                        <GhostBtn onClick={() => saveRename(t.id, t.name)}>Save</GhostBtn>
                        <GhostBtn onClick={() => setRenamingId(null)}>Cancel</GhostBtn>
                      </>
                    ) : (
                      <>
                        <span style={{
                          flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 13,
                          fontWeight: 500, color: '#000',
                        }}>
                          {t.name}
                        </span>
                        <GhostBtn onClick={() => { setRenamingId(t.id); setRenameVal(t.name) }}>
                          Rename
                        </GhostBtn>
                        <GhostBtn danger onClick={() => deleteTeam(t.id, t.name)}>Delete</GhostBtn>
                      </>
                    )}
                  </div>
                ))}

                {/* Add new team row */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <input
                    value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTeam() }}
                    placeholder="New team name…"
                    style={{ ...inputStyle, flex: 1 }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  />
                  <button
                    onClick={addTeam}
                    disabled={!newTeamName.trim() || addingTeam}
                    style={{
                      background: newTeamName.trim() && !addingTeam ? '#000' : 'rgba(0,0,0,0.1)',
                      color: newTeamName.trim() && !addingTeam ? '#fff' : 'rgba(0,0,0,0.35)',
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                      padding: '9px 18px', borderRadius: 10, border: 'none',
                      cursor: newTeamName.trim() && !addingTeam ? 'pointer' : 'default',
                      transition: 'all 0.15s', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { if (newTeamName.trim() && !addingTeam) e.currentTarget.style.opacity = '0.8' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    {addingTeam ? 'Adding…' : '+ Add team'}
                  </button>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Daily Ticket Target */}
          <SectionCard
            title="Daily Ticket Target"
            subtitle="Sets the target range line shown in Analytics charts and agent status calculations."
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>Min / agent / day</label>
                <input
                  type="number" min={1} value={targetMin}
                  onChange={e => setTargetMin(e.target.value)}
                  style={{ ...inputStyle, width: 110 }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
              <div>
                <label style={labelStyle}>Max / agent / day</label>
                <input
                  type="number" min={1} value={targetMax}
                  onChange={e => setTargetMax(e.target.value)}
                  style={{ ...inputStyle, width: 110 }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
              <SaveBtn onClick={saveTarget} saved={targetSaved} />
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', marginTop: 8 }}>
              Currently: <strong>{tgt.min}–{tgt.max}</strong> tickets/agent/day
              {targetSaved && <span style={{ color: '#166534', marginLeft: 10 }}>✓ Updated — reload Analytics to see changes</span>}
            </p>
          </SectionCard>
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16,
      border: '1.5px solid rgba(0,0,0,0.09)', padding: 24,
    }}>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>
          {title}
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 3 }}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  )
}

function GhostBtn({ onClick, children, danger }: {
  onClick: () => void; children: React.ReactNode; danger?: boolean
}) {
  return (
    <button onClick={onClick} style={{
      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
      color: danger ? '#e53e3e' : '#58595B',
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '4px 8px', borderRadius: 6, transition: 'opacity 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.65')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
    >
      {children}
    </button>
  )
}

function SaveBtn({ onClick, loading, saved }: {
  onClick: () => void; loading?: boolean; saved?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        background: saved ? '#166534' : '#000', color: '#fff',
        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
        padding: '9px 18px', borderRadius: 10, border: 'none',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1, transition: 'all 0.2s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.8' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = loading ? '0.6' : '1' }}
    >
      {saved ? '✓ Saved' : loading ? 'Saving…' : 'Save'}
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '9px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s',
  background: '#fff', width: '100%',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
  color: '#58595B', display: 'block', marginBottom: 6,
}
