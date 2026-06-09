import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { TARGET_MIN_KEY, TARGET_MAX_KEY, getDailyTarget } from '../lib/settings'
import Users from './Users'

type SettingsTab = 'general' | 'users'

interface Team { id: string; name: string }

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim()); cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur.trim())
  return result
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  return lines.map(parseCSVLine)
}

function parseTimestamp(ts: string): string | null {
  if (!ts?.trim()) return null
  // Try native parse first (handles ISO 8601 and most standard formats)
  const d = new Date(ts)
  if (!isNaN(d.getTime())) return d.toISOString()
  // M/D/YYYY H:mm:ss [AM/PM] — Google Forms / Sheets export format
  const m = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?/i)
  if (m) {
    let h = parseInt(m[4])
    const ap = (m[7] ?? '').toUpperCase()
    if (ap === 'PM' && h !== 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    const d2 = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]), h, parseInt(m[5]), parseInt(m[6] ?? '0'))
    if (!isNaN(d2.getTime())) return d2.toISOString()
  }
  return null
}

interface CSVRow {
  timestamp: string; agentName: string; agentEmail: string; agentTeam: string
  ticketNumber: string; category: string; issueType: string
  customerInput: string; suggestedResponse: string; reasoning: string; finalEdits: string; notes: string
}

interface ImportPreview {
  rows: CSVRow[]
  uniqueTickets: number
  newTickets: number
  existingTickets: number
  totalIssues: number
}

interface BackfillCounts {
  accuracyIds: string[]
  qualityIds:  string[]
  totalUnique: number
}

// ── Module-level helpers ──────────────────────────────────────────────────────
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function estimateMinutes(accCount: number, quaCount: number): number {
  // Accuracy ~3 s/issue (Sonnet), Quality ~0.5 s/issue (Haiku)
  return Math.max(1, Math.ceil((accCount * 3 + quaCount * 0.5) / 60))
}

interface SettingsProps {
  initialTab?: SettingsTab
}

export default function Settings({ initialTab = 'general' }: SettingsProps) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<SettingsTab>(isAdmin ? initialTab : 'general')

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

  // ── CSV Import (admin) ───────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [importPreview,   setImportPreview]   = useState<ImportPreview | null>(null)
  const [importStatus,    setImportStatus]    = useState<'idle' | 'parsing' | 'ready' | 'importing' | 'done' | 'error'>('idle')
  const [importLog,       setImportLog]       = useState<string[]>([])
  const [importError,     setImportError]     = useState('')
  const [repairMode,      setRepairMode]      = useState(false)

  // ── Backfill Evaluations (admin) ──────────────────────────────────────────
  type BackfillStatus = 'idle' | 'loading' | 'ready' | 'running' | 'done' | 'error'
  const [backfillStatus,   setBackfillStatus]   = useState<BackfillStatus>('idle')
  const [backfillCounts,   setBackfillCounts]   = useState<BackfillCounts | null>(null)
  const [backfillProgress, setBackfillProgress] = useState({ done: 0, total: 0, accDone: 0, accTotal: 0, quaDone: 0, quaTotal: 0, errors: 0 })
  const [backfillError,    setBackfillError]    = useState('')
  const [backfillOperator, setBackfillOperator] = useState('')

  useEffect(() => { if (isAdmin) loadTeams() }, [isAdmin])

  async function loadTeams() {
    setTeamsLoading(true)
    const { data } = await supabase.from('operators').select('id, name').order('name')
    setTeams(data ?? [])
    setTeamsLoading(false)
  }

  async function addTeam() {
    const name = newTeamName.trim()
    if (!name) return
    setAddingTeam(true)
    const slug = toSlug(name)
    await supabase.from('operators').insert([{ name, slug }])
    setNewTeamName('')
    setAddingTeam(false)
    loadTeams()
  }

  async function saveRename(id: string, oldName: string) {
    const name = renameVal.trim()
    if (!name || name === oldName) { setRenamingId(null); return }
    const slug = toSlug(name)
    await supabase.from('operators').update({ name, slug }).eq('id', id)
    // Keep users' operator_team display string in sync
    await supabase.from('users').update({ operator_team: name }).eq('operator_team', oldName)
    setRenamingId(null)
    loadTeams()
  }

  async function deleteTeam(id: string, name: string) {
    const { count } = await supabase
      .from('users').select('id', { count: 'exact', head: true }).eq('operator_id', id)
    if ((count ?? 0) > 0) {
      if (!confirm(`${count} user(s) are assigned to "${name}" and will be unassigned. Continue?`)) return
      await supabase.from('users').update({ operator_id: null, operator_team: null }).eq('operator_id', id)
    }
    await supabase.from('operators').delete().eq('id', id)
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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportStatus('parsing')
    setImportPreview(null)
    setImportLog([])
    setImportError('')
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length < 2) throw new Error('CSV appears empty or has no data rows')
      // Skip header row
      const dataRows: CSVRow[] = rows.slice(1).filter(r => r.length >= 6 && r[4]?.trim()).map(r => ({
        timestamp:         r[0] ?? '',
        agentName:         r[1] ?? '',
        agentEmail:        r[2] ?? '',
        agentTeam:         r[3] ?? '',
        ticketNumber:      r[4] ?? '',
        category:          r[5] ?? '',
        issueType:         r[6] ?? '',
        customerInput:     r[7] ?? '',
        suggestedResponse: r[8] ?? '',
        reasoning:         r[9] ?? '',
        finalEdits:        r[10] ?? '',
        notes:             r[11] ?? '',
      }))
      const uniqueNums = [...new Set(dataRows.map(r => r.ticketNumber))]
      // Check which already exist
      const { data: existing } = await supabase
        .from('tickets').select('ticket_number').in('ticket_number', uniqueNums)
      const existingSet = new Set((existing ?? []).map((t: any) => t.ticket_number))
      setImportPreview({
        rows: dataRows,
        uniqueTickets: uniqueNums.length,
        newTickets: uniqueNums.filter(n => !existingSet.has(n)).length,
        existingTickets: uniqueNums.filter(n => existingSet.has(n)).length,
        totalIssues: dataRows.length,
      })
      setImportStatus('ready')
    } catch (err: any) {
      setImportError(err.message ?? 'Failed to parse CSV')
      setImportStatus('error')
    }
  }

  async function runImport() {
    if (!importPreview) return
    setImportStatus('importing')
    const log: string[] = []
    try {
      // Get existing ticket_numbers to skip them
      const uniqueNums = [...new Set(importPreview.rows.map(r => r.ticketNumber))]
      const { data: existing } = await supabase
        .from('tickets').select('ticket_number, id').in('ticket_number', uniqueNums)
      const existingMap = new Map((existing ?? []).map((t: any) => [t.ticket_number, t.id]))

      // Group rows by ticket number
      const groups = new Map<string, CSVRow[]>()
      for (const row of importPreview.rows) {
        if (!groups.has(row.ticketNumber)) groups.set(row.ticketNumber, [])
        groups.get(row.ticketNumber)!.push(row)
      }

      let ticketsInserted = 0, issuesInserted = 0, skipped = 0

      for (const [ticketNum, rows] of groups) {
        if (existingMap.has(ticketNum)) { skipped++; continue }
        const first = rows[0]
        // Insert ticket
        const { data: tktData, error: tktErr } = await supabase
          .from('tickets')
          .insert([{
            ticket_number:   ticketNum,
            ticket_category: first.category,
            agent_name:      first.agentName,
            agent_email:     first.agentEmail,
            agent_team:      first.agentTeam,
            notes:           '',
            created_at:      parseTimestamp(first.timestamp),
          }])
          .select('id')
          .single()
        if (tktErr) { log.push(`❌ Ticket ${ticketNum}: ${tktErr.message}`); continue }
        ticketsInserted++
        // Insert ticket_issues
        let badTs = 0
        const issues = rows.map(r => {
          const ts = parseTimestamp(r.timestamp)
          if (!ts) badTs++
          return {
            ticket_id:           tktData.id,
            issue_type:          r.issueType,
            issue_comment:       r.notes,
            customer_input:      r.customerInput,
            suggested_response:  r.suggestedResponse,
            reasoning:           r.reasoning,
            final_edits:         r.finalEdits,
            logged_at:           ts,
            created_at:          ts,
          }
        })
        if (badTs > 0) log.push(`⚠️ ${ticketNum}: ${badTs} row(s) had unparseable timestamps — stored as NULL`)
        const { error: issErr } = await supabase.from('ticket_issues').insert(issues)
        if (issErr) { log.push(`❌ Issues for ${ticketNum}: ${issErr.message}`) }
        else issuesInserted += issues.length
      }

      log.push(`✅ Done — ${ticketsInserted} tickets + ${issuesInserted} issues imported, ${skipped} skipped (already existed)`)
      setImportLog(log)
      setImportStatus('done')
    } catch (err: any) {
      setImportError(err.message ?? 'Import failed')
      setImportStatus('error')
    }
  }

  // Repair mode: re-read the CSV and overwrite timestamps + text fields on existing
  // records. Matches each ticket by ticket_number, then pairs CSV rows to DB
  // ticket_issues in insertion order (by id ASC) so values get corrected without
  // duplication. Use this to backfill new columns or fix bad timestamps.
  async function repairTimestamps() {
    if (!importPreview) return
    setImportStatus('importing')
    const log: string[] = []
    let fixed = 0, skipped = 0, badTs = 0
    try {
      const groups = new Map<string, CSVRow[]>()
      for (const row of importPreview.rows) {
        if (!groups.has(row.ticketNumber)) groups.set(row.ticketNumber, [])
        groups.get(row.ticketNumber)!.push(row)
      }
      for (const [ticketNum, rows] of groups) {
        // Find the ticket
        const { data: tkt } = await supabase
          .from('tickets').select('id').eq('ticket_number', ticketNum).single()
        if (!tkt) { skipped++; continue }
        // Get existing ticket_issues in insertion order
        const { data: existingIssues } = await supabase
          .from('ticket_issues').select('id').eq('ticket_id', tkt.id).order('id', { ascending: true })
        if (!existingIssues?.length) { skipped++; continue }
        // Pair CSV rows (in order) with DB rows (in insertion order) and update fields
        for (let i = 0; i < Math.min(rows.length, existingIssues.length); i++) {
          const r = rows[i]
          const ts = parseTimestamp(r.timestamp)
          if (!ts) badTs++
          const update: Record<string, any> = {
            issue_type:         r.issueType,
            issue_comment:      r.notes,
            customer_input:     r.customerInput,
            suggested_response: r.suggestedResponse,
            reasoning:          r.reasoning,
            final_edits:        r.finalEdits,
          }
          if (ts) { update.logged_at = ts; update.created_at = ts }
          await supabase.from('ticket_issues').update(update).eq('id', existingIssues[i].id)
          fixed++
        }
        // Also fix the ticket's created_at + agent/team/category in case they changed
        const first = rows[0]
        const firstTs = parseTimestamp(first.timestamp)
        const tktUpdate: Record<string, any> = {
          ticket_category: first.category,
          agent_name:      first.agentName,
          agent_email:     first.agentEmail,
          agent_team:      first.agentTeam,
        }
        if (firstTs) tktUpdate.created_at = firstTs
        await supabase.from('tickets').update(tktUpdate).eq('id', tkt.id)
      }
      log.push(`✅ Repair complete — ${fixed} issues backfilled, ${skipped} tickets not found, ${badTs} rows had unparseable timestamps`)
      setImportLog(log)
      setImportStatus('done')
    } catch (err: any) {
      setImportError(err.message ?? 'Repair failed')
      setImportStatus('error')
    }
  }

  async function saveName() {
    if (!user || !displayName.trim()) return
    setNameSaving(true)
    await supabase.from('users').update({ name: displayName.trim() }).eq('id', user.id)
    setNameSaving(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2500)
  }

  // ── Backfill helpers ────────────────────────────────────────────────────────
  async function loadBackfillCounts() {
    setBackfillStatus('loading')
    setBackfillError('')
    setBackfillCounts(null)
    try {
      const { data, error } = await supabase.functions.invoke('backfill-evals', {
        body: { operator_id: backfillOperator || undefined },
      })
      if (error) throw error
      setBackfillCounts(data as BackfillCounts)
      setBackfillStatus('ready')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to scan issues'
      setBackfillError(msg)
      setBackfillStatus('error')
    }
  }

  async function runBackfill() {
    if (!backfillCounts) return
    setBackfillStatus('running')

    const ACC_CHUNK = 25   // Sonnet — deeper eval, smaller batches
    const QUA_CHUNK = 50   // Haiku  — faster, larger batches

    const accChunks = chunkArray(backfillCounts.accuracyIds, ACC_CHUNK)
    const quaChunks = chunkArray(backfillCounts.qualityIds,  QUA_CHUNK)
    const total     = accChunks.length + quaChunks.length

    let done = 0, accDone = 0, quaDone = 0, errors = 0
    const accTotal = accChunks.length
    const quaTotal = quaChunks.length

    setBackfillProgress({ done, total, accDone, accTotal, quaDone, quaTotal, errors })

    for (const ch of accChunks) {
      const { error } = await supabase.functions.invoke('eval-accuracy', { body: { ids: ch } })
      if (error) errors++
      done++; accDone++
      setBackfillProgress({ done, total, accDone, accTotal, quaDone, quaTotal, errors })
    }

    for (const ch of quaChunks) {
      const { error } = await supabase.functions.invoke('eval-quality', { body: { ids: ch } })
      if (error) errors++
      done++; quaDone++
      setBackfillProgress({ done, total, accDone, accTotal, quaDone, quaTotal, errors })
    }

    setBackfillStatus('done')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
            {isAdmin ? 'Admin settings' : 'Settings'}
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            {activeTab === 'users' ? 'Manage team members and their operator access' : 'Configure your Command Center preferences'}
          </p>
        </div>

        {/* Tab strip — admin only */}
        {isAdmin && (
          <div style={{
            display: 'flex', gap: 2, padding: 4,
            background: 'rgba(0,0,0,0.05)', borderRadius: 12,
            alignSelf: 'flex-start',
          }}>
            {(['general', 'users'] as SettingsTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '7px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: activeTab === tab ? '#fff' : 'transparent',
                  color: activeTab === tab ? '#000' : '#58595B',
                  boxShadow: activeTab === tab ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {tab === 'general' ? 'General' : 'Users'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Users tab ───────────────────────────────────────────────────────── */}
      {isAdmin && activeTab === 'users' && <Users />}

      {/* ── General tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'general' && <>

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
          {/* Operators */}
          <SectionCard
            title="Operators"
            subtitle="Client operators you support. Each entry appears in the sidebar switcher and can be assigned to agents."
          >
            {teamsLoading ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teams.length === 0 && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa', padding: '8px 0' }}>
                    No operators yet. Add one below.
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
                    placeholder="New operator name…"
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
                    {addingTeam ? 'Adding…' : '+ Add operator'}
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

          {/* Backfill Evaluations */}
          <SectionCard
            title="Backfill Evaluations"
            subtitle="Run accuracy (Sonnet) and quality (Haiku) evals on all historical issues not yet scored. Keep this tab open while running."
          >
            {/* Operator filter */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 0 220px' }}>
                <label style={labelStyle}>Scope to operator (optional)</label>
                <select
                  value={backfillOperator}
                  onChange={e => { setBackfillOperator(e.target.value); setBackfillStatus('idle'); setBackfillCounts(null) }}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">All operators</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button
                onClick={loadBackfillCounts}
                disabled={backfillStatus === 'loading' || backfillStatus === 'running'}
                style={{
                  background: (backfillStatus === 'loading' || backfillStatus === 'running') ? 'rgba(0,0,0,0.1)' : '#000',
                  color:      (backfillStatus === 'loading' || backfillStatus === 'running') ? 'rgba(0,0,0,0.35)' : '#fff',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 18px', borderRadius: 10, border: 'none',
                  cursor: (backfillStatus === 'loading' || backfillStatus === 'running') ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (backfillStatus === 'idle' || backfillStatus === 'ready' || backfillStatus === 'done' || backfillStatus === 'error') e.currentTarget.style.opacity = '0.8' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                {backfillStatus === 'loading' ? 'Scanning…' : '🔍 Scan for unscored issues'}
              </button>
            </div>

            {/* Error */}
            {backfillStatus === 'error' && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e', marginBottom: 12 }}>
                ❌ {backfillError}
              </p>
            )}

            {/* Counts */}
            {(backfillStatus === 'ready' || backfillStatus === 'running' || backfillStatus === 'done') && backfillCounts && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Needs accuracy eval', value: backfillCounts.accuracyIds.length, accent: backfillCounts.accuracyIds.length > 0 },
                  { label: 'Needs quality eval',  value: backfillCounts.qualityIds.length,  accent: backfillCounts.qualityIds.length > 0 },
                  { label: 'Total unique issues',  value: backfillCounts.totalUnique,        accent: false },
                ].map(s => (
                  <div key={s.label} style={{
                    background: s.accent ? 'rgba(155,89,208,0.06)' : 'rgba(0,0,0,0.03)',
                    border: `1.5px solid ${s.accent ? 'rgba(155,89,208,0.2)' : 'rgba(0,0,0,0.08)'}`,
                    borderRadius: 10, padding: '12px 16px',
                  }}>
                    <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: s.accent ? '#9B59D0' : '#000' }}>
                      {s.value}
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 2 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Run button */}
            {backfillStatus === 'ready' && backfillCounts && backfillCounts.totalUnique > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={runBackfill}
                  style={{
                    background: '#000', color: '#fff',
                    fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                    padding: '9px 20px', borderRadius: 10, border: 'none',
                    cursor: 'pointer', transition: 'opacity 0.15s', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  ▶ Run backfill
                </button>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>
                  Est. ~{estimateMinutes(backfillCounts.accuracyIds.length, backfillCounts.qualityIds.length)} min — keep this tab open
                </span>
              </div>
            )}

            {backfillStatus === 'ready' && backfillCounts && backfillCounts.totalUnique === 0 && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534' }}>
                ✅ All issues are already scored — nothing to backfill.
              </p>
            )}

            {/* Progress */}
            {backfillStatus === 'running' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
                    Accuracy: {backfillProgress.accDone}/{backfillProgress.accTotal} batches &nbsp;·&nbsp;
                    Quality: {backfillProgress.quaDone}/{backfillProgress.quaTotal} batches
                    {backfillProgress.errors > 0 && (
                      <span style={{ color: '#e53e3e', marginLeft: 8 }}>
                        · {backfillProgress.errors} error{backfillProgress.errors !== 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                  <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#9B59D0' }}>
                    {backfillProgress.total > 0 ? Math.round((backfillProgress.done / backfillProgress.total) * 100) : 0}%
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 100, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${backfillProgress.total > 0 ? (backfillProgress.done / backfillProgress.total) * 100 : 0}%`,
                    background: '#CEA4FF',
                    borderRadius: 100,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            )}

            {/* Done */}
            {backfillStatus === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  background: 'rgba(22,101,52,0.06)', border: '1.5px solid rgba(22,101,52,0.2)',
                  borderRadius: 10, padding: 14,
                  fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534',
                }}>
                  ✅ Backfill complete — {backfillProgress.accTotal} accuracy batches &amp; {backfillProgress.quaTotal} quality batches processed
                  {backfillProgress.errors > 0 && (
                    <span style={{ color: '#c05621' }}>
                      &nbsp;({backfillProgress.errors} batch error{backfillProgress.errors !== 1 ? 's' : ''} — re-scan to retry)
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setBackfillStatus('idle'); setBackfillCounts(null) }}
                  style={resetBtnStyle}
                >
                  Scan again
                </button>
              </div>
            )}
          </SectionCard>

          {/* Import Data */}
          <SectionCard
            title="Import Submission Data"
            subtitle="Import historical gameLM feedback CSV. Existing tickets (by ticket number) are skipped automatically."
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />

            {importStatus === 'idle' && (
              <button
                onClick={() => { fileRef.current?.click() }}
                style={{
                  border: '1.5px dashed rgba(0,0,0,0.2)', borderRadius: 10,
                  background: '#fafafa', padding: '20px 32px',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
                  cursor: 'pointer', transition: 'all 0.15s', display: 'flex',
                  alignItems: 'center', gap: 10,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#CEA4FF'; e.currentTarget.style.color = '#000' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.2)'; e.currentTarget.style.color = '#58595B' }}
              >
                📂 Choose CSV file to import
              </button>
            )}

            {importStatus === 'parsing' && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Parsing CSV…</p>
            )}

            {importStatus === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>
                  ❌ {importError}
                </p>
                <button onClick={() => { setImportStatus('idle'); if (fileRef.current) fileRef.current.value = '' }} style={resetBtnStyle}>
                  Try again
                </button>
              </div>
            )}

            {(importStatus === 'ready' || importStatus === 'importing') && importPreview && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
                }}>
                  {[
                    { label: 'Total rows', value: importPreview.totalIssues },
                    { label: 'Unique tickets', value: importPreview.uniqueTickets },
                    { label: 'New (will import)', value: importPreview.newTickets, accent: true },
                    { label: 'Existing (skip)', value: importPreview.existingTickets },
                  ].map(s => (
                    <div key={s.label} style={{
                      background: s.accent ? 'rgba(206,164,255,0.1)' : 'rgba(0,0,0,0.03)',
                      border: `1.5px solid ${s.accent ? 'rgba(206,164,255,0.4)' : 'rgba(0,0,0,0.08)'}`,
                      borderRadius: 10, padding: '12px 16px',
                    }}>
                      <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: s.accent ? '#9B59D0' : '#000' }}>
                        {s.value}
                      </div>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 2 }}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Repair mode toggle */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, background: repairMode ? 'rgba(234,179,8,0.08)' : 'rgba(0,0,0,0.03)', border: `1.5px solid ${repairMode ? 'rgba(234,179,8,0.3)' : 'rgba(0,0,0,0.08)'}`, transition: 'all 0.15s' }}>
                  <input type="checkbox" id="repairMode" checked={repairMode} onChange={e => setRepairMode(e.target.checked)} style={{ marginTop: 2, cursor: 'pointer', accentColor: '#9B59D0' }} />
                  <label htmlFor="repairMode" style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', cursor: 'pointer', lineHeight: 1.5 }}>
                    <strong style={{ color: '#000' }}>Repair / backfill from CSV</strong> — re-read this CSV and overwrite timestamps, customer input, suggested response, reasoning, final edits, and notes on existing records (no duplicates inserted). Use this to fix bad dates or backfill newly-added fields.
                  </label>
                </div>

                {repairMode ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={repairTimestamps}
                      disabled={importStatus === 'importing'}
                      style={{
                        background: '#854d0e', color: '#fff',
                        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                        padding: '9px 20px', borderRadius: 10, border: 'none',
                        cursor: importStatus === 'importing' ? 'not-allowed' : 'pointer',
                        opacity: importStatus === 'importing' ? 0.6 : 1, transition: 'opacity 0.15s',
                      }}
                    >
                      {importStatus === 'importing' ? 'Repairing…' : `Repair / backfill ${importPreview.uniqueTickets} tickets`}
                    </button>
                    <button onClick={() => { setImportStatus('idle'); setImportPreview(null); setRepairMode(false); if (fileRef.current) fileRef.current.value = '' }} style={resetBtnStyle}>Cancel</button>
                  </div>
                ) : importPreview.newTickets === 0 ? (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>
                    All tickets in this file already exist — nothing new to import. Use Repair mode to fix timestamps.
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={runImport}
                      disabled={importStatus === 'importing'}
                      style={{
                        background: '#000', color: '#fff',
                        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                        padding: '9px 20px', borderRadius: 10, border: 'none',
                        cursor: importStatus === 'importing' ? 'not-allowed' : 'pointer',
                        opacity: importStatus === 'importing' ? 0.6 : 1, transition: 'opacity 0.15s',
                      }}
                    >
                      {importStatus === 'importing' ? 'Importing…' : `Import ${importPreview.newTickets} tickets`}
                    </button>
                    <button onClick={() => { setImportStatus('idle'); setImportPreview(null); if (fileRef.current) fileRef.current.value = '' }} style={resetBtnStyle}>Cancel</button>
                  </div>
                )}
              </div>
            )}

            {importStatus === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  background: 'rgba(22,101,52,0.06)', border: '1.5px solid rgba(22,101,52,0.2)',
                  borderRadius: 10, padding: 14,
                  fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  {importLog.map((l, i) => <span key={i}>{l}</span>)}
                </div>
                <button
                  onClick={() => { setImportStatus('idle'); setImportPreview(null); setImportLog([]); if (fileRef.current) fileRef.current.value = '' }}
                  style={resetBtnStyle}
                >
                  Import another file
                </button>
              </div>
            )}
          </SectionCard>
        </>
      )}

      </> /* end General tab */}
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

const resetBtnStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
  padding: '9px 18px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
}
