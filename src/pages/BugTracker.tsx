import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

// ── Types ───────────────────────────────────────────────────────────────────
interface BugReport {
  id: string
  ticket_id: string | null
  ticket_number: string | null
  player_input: string | null
  suggested_response: string | null
  expected_outcome: string
  actual_outcome: string
  failing_component: string | null
  additional_context: string | null
  mode: 'copilot' | 'full_auto'
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'investigating' | 'resolved' | 'wont_fix'
  reported_by: string | null
  created_at: string
}

interface FormState {
  mode: 'copilot' | 'full_auto' | ''
  severity: 'low' | 'medium' | 'high' | 'critical' | ''
  ticketId: string
  ticketNumber: string
  playerInput: string
  suggestedResponse: string
  expectedOutcome: string
  actualOutcome: string
  failingComponent: string
  additionalContext: string
}

// ── Constants ────────────────────────────────────────────────────────────────
const FAILING_COMPONENTS = [
  { value: 'intent_recognition',  label: 'Intent Recognition' },
  { value: 'data_lookup',         label: 'Data Lookup / Account Access' },
  { value: 'response_generation', label: 'Response Generation' },
  { value: 'policy_application',  label: 'Policy / Rules Application' },
  { value: 'hallucination',       label: 'Hallucination / Accuracy' },
  { value: 'context_handling',    label: 'Context Handling' },
  { value: 'verification_kyc',    label: 'Verification / KYC' },
  { value: 'other',               label: 'Other' },
]

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  low:      { label: 'Low',      color: '#58595B', bg: 'rgba(0,0,0,0.06)' },
  medium:   { label: 'Medium',   color: '#b45309', bg: 'rgba(180,83,9,0.08)' },
  high:     { label: 'High',     color: '#e53e3e', bg: 'rgba(229,62,62,0.08)' },
  critical: { label: 'Critical', color: '#fff',    bg: '#e53e3e' },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open:          { label: 'Open',          color: '#e53e3e', bg: 'rgba(229,62,62,0.08)' },
  investigating: { label: 'Investigating', color: '#b45309', bg: 'rgba(180,83,9,0.08)' },
  resolved:      { label: 'Resolved',      color: '#166534', bg: 'rgba(22,101,52,0.08)' },
  wont_fix:      { label: "Won't Fix",     color: '#58595B', bg: 'rgba(0,0,0,0.06)' },
}

const MODE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  copilot:   { label: 'CoPilot',   color: '#58595B', bg: 'rgba(0,0,0,0.06)' },
  full_auto: { label: 'Full Auto', color: '#9B59D0', bg: 'rgba(155,89,208,0.09)' },
}

const EMPTY_FORM: FormState = {
  mode: '', severity: '', ticketId: '', ticketNumber: '', playerInput: '',
  suggestedResponse: '', expectedOutcome: '', actualOutcome: '',
  failingComponent: '', additionalContext: '',
}

// ── Small helpers ────────────────────────────────────────────────────────────
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 100, color, background: bg,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function SeverityBadge({ s }: { s: string }) {
  const c = SEVERITY_CONFIG[s] ?? SEVERITY_CONFIG.medium
  return <Badge label={c.label} color={c.color} bg={c.bg} />
}

function StatusBadge({ s }: { s: string }) {
  const c = STATUS_CONFIG[s] ?? STATUS_CONFIG.open
  return <Badge label={c.label} color={c.color} bg={c.bg} />
}

function ModeBadge({ m }: { m: string }) {
  const c = MODE_CONFIG[m] ?? MODE_CONFIG.copilot
  return <Badge label={c.label} color={c.color} bg={c.bg} />
}

function shortId(id: string) { return id.substring(0, 8).toUpperCase() }

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function failLabel(val: string | null) {
  return FAILING_COMPONENTS.find(f => f.value === val)?.label ?? val ?? '—'
}

// ── Copy formatter ───────────────────────────────────────────────────────────
function buildCopyText(bug: BugReport): string {
  const lines: string[] = [
    `Bug ${shortId(bug.id)} | ${MODE_CONFIG[bug.mode]?.label ?? bug.mode} | ${SEVERITY_CONFIG[bug.severity]?.label ?? bug.severity} | ${STATUS_CONFIG[bug.status]?.label ?? bug.status}`,
    bug.ticket_id     ? `Ticket ID: ${bug.ticket_id}` : '',
    bug.ticket_number ? `Ticket #: ${bug.ticket_number}` : '',
    `Reported by: ${bug.reported_by ?? 'Unknown'} | ${fmtDate(bug.created_at)}`,
    '',
  ]
  if (bug.player_input)       lines.push('Player Input:', bug.player_input, '')
  if (bug.suggested_response) lines.push('gameLM Suggested:', bug.suggested_response, '')
  lines.push('Expected Outcome:', bug.expected_outcome, '')
  lines.push('Actual Outcome:', bug.actual_outcome, '')
  if (bug.failing_component)  lines.push(`Failing Component: ${failLabel(bug.failing_component)}`, '')
  if (bug.additional_context) lines.push('Additional Context:', bug.additional_context, '')
  return lines.filter(l => l !== null).join('\n').trim()
}

// ── Input styles ─────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 13,
  padding: '9px 12px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)',
  background: '#fff', outline: 'none', boxSizing: 'border-box', resize: 'vertical',
  transition: 'border-color 0.15s',
}
const labelStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
  color: '#58595B', marginBottom: 5, display: 'block',
}
const requiredDot = <span style={{ color: '#e53e3e', marginLeft: 2 }}>*</span>

// ── Main component ────────────────────────────────────────────────────────────
export default function BugTracker() {
  const { user } = useAuth()
  const { selectedOperator } = useOperator()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<'log' | 'tracker'>('log')
  const [bugs, setBugs]           = useState<BugReport[]>([])
  const [loading, setLoading]     = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]     = useState(false)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [copied, setCopied]       = useState<string | null>(null)

  // Filters (admin tracker tab)
  const [filterStatus,   setFilterStatus]   = useState<string>('all')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [filterMode,     setFilterMode]     = useState<string>('all')

  useEffect(() => { fetchBugs() }, [selectedOperator?.id, user?.email])

  async function fetchBugs() {
    setLoading(true)
    let q = supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false })
    if (selectedOperator?.id) q = q.eq('operator_id', selectedOperator.id)
    if (!isAdmin) q = q.eq('reported_by', user?.email ?? '')
    const { data } = await q
    setBugs((data as BugReport[]) ?? [])
    setLoading(false)
  }

  async function submitBug() {
    if (!form.mode || !form.severity || !form.expectedOutcome.trim() || !form.actualOutcome.trim()) return
    setSubmitting(true)
    await supabase.from('bug_reports').insert({
      operator_id:        selectedOperator?.id ?? null,
      ticket_id:          form.ticketId.trim()          || null,
      ticket_number:      form.ticketNumber.trim()      || null,
      player_input:       form.playerInput.trim()       || null,
      suggested_response: form.suggestedResponse.trim() || null,
      expected_outcome:   form.expectedOutcome.trim(),
      actual_outcome:     form.actualOutcome.trim(),
      failing_component:  form.failingComponent         || null,
      additional_context: form.additionalContext.trim() || null,
      mode:               form.mode,
      severity:           form.severity,
      status:             'open',
      reported_by:        user?.email ?? null,
    })
    await fetchBugs()
    setForm(EMPTY_FORM)
    setSuccess(true)
    setSubmitting(false)
    setTimeout(() => setSuccess(false), 3000)
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('bug_reports').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setBugs(prev => prev.map(b => b.id === id ? { ...b, status: status as BugReport['status'] } : b))
  }

  function copyBug(bug: BugReport) {
    navigator.clipboard.writeText(buildCopyText(bug))
    setCopied(bug.id)
    setTimeout(() => setCopied(null), 2000)
  }

  // Export CSV (admin)
  function exportCSV() {
    const headers = ['ID', 'Mode', 'Severity', 'Status', 'Ticket ID', 'Ticket #', 'Failing Component', 'Expected Outcome', 'Actual Outcome', 'Player Input', 'gameLM Suggested', 'Additional Context', 'Reported By', 'Date']
    const rows = filteredBugs.map(b => [
      shortId(b.id), MODE_CONFIG[b.mode]?.label ?? b.mode, b.severity, b.status,
      b.ticket_id ?? '', b.ticket_number ?? '', failLabel(b.failing_component),
      b.expected_outcome, b.actual_outcome,
      b.player_input ?? '', b.suggested_response ?? '',
      b.additional_context ?? '', b.reported_by ?? '', fmtDate(b.created_at),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `bug_reports_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  const filteredBugs = bugs.filter(b => {
    if (filterStatus   !== 'all' && b.status   !== filterStatus)   return false
    if (filterSeverity !== 'all' && b.severity  !== filterSeverity) return false
    if (filterMode     !== 'all' && b.mode      !== filterMode)     return false
    return true
  })

  const formValid = form.mode && form.severity && form.expectedOutcome.trim() && form.actualOutcome.trim()

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'log' as const, label: 'Report a Bug' },
    ...(isAdmin ? [{ id: 'tracker' as const, label: `Bug Tracker${bugs.length > 0 ? ` (${bugs.length})` : ''}` }] : []),
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 32 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#000', margin: 0 }}>Bug Tracker</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 3 }}>
            Report gameLM issues to engineering
          </p>
        </div>
      </div>

      {/* Tab row */}
      <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 10, padding: 3, width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: activeTab === t.id ? 500 : 400,
            padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: activeTab === t.id ? '#000' : 'transparent',
            color: activeTab === t.id ? '#fff' : '#58595B',
            transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Log Bug tab ─────────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', padding: 28, maxWidth: 760 }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 24 }}>Bug Report</p>

          {/* Row 1: Mode + Severity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Mode {requiredDot}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['copilot', 'full_auto'] as const).map(m => (
                  <button key={m} onClick={() => setForm(f => ({ ...f, mode: m }))} style={{
                    flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                    padding: '9px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                    border: form.mode === m ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.12)',
                    background: form.mode === m ? 'rgba(155,89,208,0.06)' : '#fff',
                    color: form.mode === m ? '#9B59D0' : '#58595B',
                  }}>{MODE_CONFIG[m].label}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Severity {requiredDot}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['low', 'medium', 'high', 'critical'] as const).map(s => {
                  const cfg = SEVERITY_CONFIG[s]
                  const sel = form.severity === s
                  return (
                    <button key={s} onClick={() => setForm(f => ({ ...f, severity: s }))} style={{
                      flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                      padding: '9px 4px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                      border: sel ? `1.5px solid ${cfg.color}` : '1.5px solid rgba(0,0,0,0.12)',
                      background: sel ? cfg.bg : '#fff',
                      color: sel ? (s === 'critical' ? '#e53e3e' : cfg.color) : '#58595B',
                    }}>{cfg.label}</button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Row 2: Ticket ID + Ticket # + Failing component */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Ticket ID</label>
              <input
                value={form.ticketId}
                onChange={e => setForm(f => ({ ...f, ticketId: e.target.value }))}
                placeholder="Internal UUID"
                style={{ ...inputStyle, height: 40 }}
              />
            </div>
            <div>
              <label style={labelStyle}>Ticket number</label>
              <input
                value={form.ticketNumber}
                onChange={e => setForm(f => ({ ...f, ticketNumber: e.target.value }))}
                placeholder="e.g. 537539"
                style={{ ...inputStyle, height: 40 }}
              />
            </div>
            <div>
              <label style={labelStyle}>Failing component</label>
              <select
                value={form.failingComponent}
                onChange={e => setForm(f => ({ ...f, failingComponent: e.target.value }))}
                style={{ ...inputStyle, height: 40, resize: 'none', cursor: 'pointer' }}
              >
                <option value="">— select if known —</option>
                {FAILING_COMPONENTS.map(fc => (
                  <option key={fc.value} value={fc.value}>{fc.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Player input + gameLM suggested */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Player conversation input</label>
              <textarea
                value={form.playerInput}
                onChange={e => setForm(f => ({ ...f, playerInput: e.target.value }))}
                placeholder="What did the player say?"
                rows={4}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>gameLM suggested response</label>
              <textarea
                value={form.suggestedResponse}
                onChange={e => setForm(f => ({ ...f, suggestedResponse: e.target.value }))}
                placeholder="What did gameLM suggest?"
                rows={4}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Expected + Actual */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Expected outcome {requiredDot}</label>
              <textarea
                value={form.expectedOutcome}
                onChange={e => setForm(f => ({ ...f, expectedOutcome: e.target.value }))}
                placeholder="What should have happened?"
                rows={4}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Actual outcome {requiredDot}</label>
              <textarea
                value={form.actualOutcome}
                onChange={e => setForm(f => ({ ...f, actualOutcome: e.target.value }))}
                placeholder="What actually happened?"
                rows={4}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Additional context */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Additional context</label>
            <textarea
              value={form.additionalContext}
              onChange={e => setForm(f => ({ ...f, additionalContext: e.target.value }))}
              placeholder="Any other details, screenshots descriptions, frequency, etc."
              rows={3}
              style={inputStyle}
            />
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={submitBug}
              disabled={!formValid || submitting}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
                padding: '10px 24px', borderRadius: 10, border: 'none', cursor: formValid && !submitting ? 'pointer' : 'not-allowed',
                background: formValid && !submitting ? '#000' : 'rgba(0,0,0,0.25)',
                color: '#fff', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { if (formValid && !submitting) e.currentTarget.style.opacity = '0.8' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
            >
              {submitting ? 'Submitting…' : 'Submit Bug Report'}
            </button>
            {success && (
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534', fontWeight: 500 }}>
                ✓ Submitted
              </span>
            )}
            {!formValid && (
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
                Mode, severity, expected outcome and actual outcome are required
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── My Submissions (non-admin on log tab) ────────────────────────── */}
      {activeTab === 'log' && !isAdmin && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>My Submissions</p>
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
            </div>
          ) : bugs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>No bug reports submitted yet</p>
            </div>
          ) : (
            <BugList bugs={bugs} expanded={expanded} onExpand={setExpanded} onCopy={copyBug} copied={copied} isAdmin={false} />
          )}
        </div>
      )}

      {/* ── Tracker tab (admin only) ─────────────────────────────────────── */}
      {activeTab === 'tracker' && isAdmin && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* Status filter */}
              <FilterSelect value={filterStatus} onChange={setFilterStatus} options={[
                { value: 'all', label: 'All statuses' },
                ...Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label })),
              ]} />
              <FilterSelect value={filterSeverity} onChange={setFilterSeverity} options={[
                { value: 'all', label: 'All severities' },
                ...Object.entries(SEVERITY_CONFIG).map(([v, c]) => ({ value: v, label: c.label })),
              ]} />
              <FilterSelect value={filterMode} onChange={setFilterMode} options={[
                { value: 'all', label: 'All modes' },
                ...Object.entries(MODE_CONFIG).map(([v, c]) => ({ value: v, label: c.label })),
              ]} />
            </div>
            <button
              onClick={exportCSV}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                padding: '6px 14px', borderRadius: 8, border: 'none',
                background: '#000', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >Export CSV</button>
          </div>

          {loading ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
            </div>
          ) : filteredBugs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No bug reports match the current filters</p>
            </div>
          ) : (
            <BugList bugs={filteredBugs} expanded={expanded} onExpand={setExpanded} onCopy={copyBug} copied={copied} isAdmin onStatusChange={updateStatus} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Filter select ─────────────────────────────────────────────────────────────
function FilterSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '6px 10px',
        borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)',
        background: '#fff', outline: 'none', cursor: 'pointer', color: '#000',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── Bug list ──────────────────────────────────────────────────────────────────
function BugList({ bugs, expanded, onExpand, onCopy, copied, isAdmin, onStatusChange }: {
  bugs: BugReport[]
  expanded: string | null
  onExpand: (id: string | null) => void
  onCopy: (bug: BugReport) => void
  copied: string | null
  isAdmin: boolean
  onStatusChange?: (id: string, status: string) => void
}) {
  // Table header
  const cols = isAdmin
    ? '80px 100px 90px 100px 1fr 130px 140px 100px 90px'
    : '80px 100px 90px 1fr 90px'

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: cols,
        padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: 'rgba(0,0,0,0.01)',
      }}>
        {(isAdmin
          ? ['ID', 'Mode', 'Severity', 'Status', 'Failing Component', 'Reported By', 'Ticket ID', 'Ticket #', 'Date']
          : ['ID', 'Mode', 'Severity', 'Failing Component', 'Date']
        ).map(h => (
          <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
        ))}
      </div>

      {bugs.map(bug => {
        const isExp = expanded === bug.id
        return (
          <div key={bug.id}>
            {/* Row */}
            <div
              onClick={() => onExpand(isExp ? null : bug.id)}
              style={{
                display: 'grid', gridTemplateColumns: cols,
                padding: '11px 20px', alignItems: 'center', cursor: 'pointer',
                borderBottom: '1px solid rgba(0,0,0,0.05)',
                background: isExp ? 'rgba(206,164,255,0.05)' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
              onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.05)' : 'transparent' }}
            >
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {shortId(bug.id)}
              </span>
              <ModeBadge m={bug.mode} />
              <SeverityBadge s={bug.severity} />
              {isAdmin && <StatusBadge s={bug.status} />}
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {failLabel(bug.failing_component)}
              </span>
              {isAdmin && (
                <>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bug.reported_by ?? '—'}
                  </span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9B59D0', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bug.ticket_id ?? '—'}
                  </span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                    {bug.ticket_number ? `#${bug.ticket_number}` : '—'}
                  </span>
                </>
              )}
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                {fmtDate(bug.created_at)}
              </span>
            </div>

            {/* Expanded detail */}
            {isExp && (
              <div style={{ padding: '16px 20px 20px', background: 'rgba(206,164,255,0.025)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                {/* Detail boxes */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  {bug.player_input && (
                    <DetailBox label="Player Input" value={bug.player_input} />
                  )}
                  {bug.suggested_response && (
                    <DetailBox label="gameLM Suggested" value={bug.suggested_response} />
                  )}
                  <DetailBox label="Expected Outcome" value={bug.expected_outcome} />
                  <DetailBox label="Actual Outcome" value={bug.actual_outcome} highlight />
                </div>
                {bug.additional_context && (
                  <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.03)' }}>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Additional Context</p>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{bug.additional_context}</p>
                  </div>
                )}

                {/* Actions row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => onCopy(bug)}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                      padding: '6px 14px', borderRadius: 8,
                      border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff',
                      color: copied === bug.id ? '#166534' : '#58595B',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {copied === bug.id ? '✓ Copied' : 'Copy for Engineering'}
                  </button>

                  {/* Status update (admin only) */}
                  {isAdmin && onStatusChange && (
                    <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                      {Object.entries(STATUS_CONFIG).map(([s, c]) => (
                        <button
                          key={s}
                          onClick={e => { e.stopPropagation(); onStatusChange(bug.id, s) }}
                          style={{
                            fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500,
                            padding: '4px 10px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                            border: bug.status === s ? `1.5px solid ${c.color}` : '1.5px solid rgba(0,0,0,0.10)',
                            background: bug.status === s ? c.bg : 'transparent',
                            color: bug.status === s ? c.color : 'rgba(0,0,0,0.4)',
                          }}
                        >{c.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function DetailBox({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: highlight ? 'rgba(229,62,62,0.03)' : '#fff',
      border: highlight ? '1px solid rgba(229,62,62,0.12)' : '1px solid rgba(0,0,0,0.09)',
    }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: highlight ? 'rgba(229,62,62,0.7)' : '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</p>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</p>
    </div>
  )
}
