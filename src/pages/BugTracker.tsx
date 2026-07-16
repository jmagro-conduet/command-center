import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

// ── Types ───────────────────────────────────────────────────────────────────
interface EvidenceFile {
  url: string
  name: string
  type: string
  size: number
}

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
  evidence: EvidenceFile[]
}

interface TriageBrief {
  bug_id: string
  ticket_id: string | null
  ticket_number: string | null
  mode: string
  severity: string
  failing_component: string | null
  status: string
  description?: string
  steps_to_reproduce?: string
  suggested_fix?: string
  expected_behavior?: string
  actual_behavior?: string
  impact?: string
  error?: string
}

interface TriageTheme {
  title: string
  explanation: string
  bugs: { bug_id: string; ticket_id: string | null; ticket_number: string | null }[]
}

interface TriageReport {
  id: string | null
  generated_at: string
  generated_by: string | null
  bug_count: number
  briefs: TriageBrief[]
  themes: TriageTheme[]
  usage: { input_tokens: number; output_tokens: number; calls: number } | null
  meta: { total_open: number; analyzed: number; truncated: boolean }
  isHistorical?: boolean
}

interface TriageHistoryEntry {
  id: string
  generated_at: string
  generated_by: string | null
  bug_count: number
  meta: { total_open: number; analyzed: number; truncated: boolean } | null
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

const MAX_EVIDENCE_FILES = 5
const MAX_EVIDENCE_SIZE  = 25 * 1024 * 1024 // 25MB per file
const EVIDENCE_ACCEPT    = 'image/*,video/*,.pdf'

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

// Small inline copy affordance for values engineers need verbatim (the
// internal ticket UUID, primarily) -- separate from the full "Copy for
// Engineering" text block so a single value can be grabbed without it.
function CopyIconButton({ value, title = 'Copy' }: { value: string; title?: string }) {
  const [justCopied, setJustCopied] = useState(false)
  return (
    <button
      type="button"
      title={title}
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard.writeText(value)
        setJustCopied(true)
        setTimeout(() => setJustCopied(false), 1200)
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, flexShrink: 0, padding: 0, marginLeft: 4,
        border: 'none', background: 'none', cursor: 'pointer', borderRadius: 4,
        color: justCopied ? '#166534' : 'rgba(0,0,0,0.35)', transition: 'color 0.15s',
      }}
    >
      {justCopied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  )
}

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function failLabel(val: string | null) {
  return FAILING_COMPONENTS.find(f => f.value === val)?.label ?? val ?? '—'
}

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function isImageType(type: string) { return type.startsWith('image/') }

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
  if (bug.evidence?.length)   lines.push('Evidence:', ...bug.evidence.map(e => `- ${e.name}: ${e.url}`), '')
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

  const [activeTab, setActiveTab] = useState<'log' | 'tracker' | 'report'>('log')
  const [bugs, setBugs]           = useState<BugReport[]>([])
  const [loading, setLoading]     = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]     = useState(false)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [copied, setCopied]       = useState<string | null>(null)

  // Evidence upload (Report a Bug tab)
  const [evidence, setEvidence]           = useState<EvidenceFile[]>([])
  const [evidenceUploading, setEvidenceUploading] = useState(false)
  const [evidenceError, setEvidenceError] = useState('')
  const evidenceInputRef = useRef<HTMLInputElement>(null)

  // Filters (admin tracker tab)
  const [filterStatus,   setFilterStatus]   = useState<string>('all')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [filterMode,     setFilterMode]     = useState<string>('all')

  // Engineering Report (admin-only tab)
  const [triageReport, setTriageReport]           = useState<TriageReport | null>(null)
  const [reportLoading, setReportLoading]         = useState(false)
  const [reportError, setReportError]             = useState('')
  const [reportHistory, setReportHistory]         = useState<TriageHistoryEntry[] | null>(null)
  const [reportHistoryOpen, setReportHistoryOpen] = useState(false)
  const [reportHistoryLoading, setReportHistoryLoading] = useState(false)
  const [reportCopied, setReportCopied]           = useState<string | null>(null)

  useEffect(() => { fetchBugs() }, [selectedOperator?.id, user?.email])

  useEffect(() => {
    if (!isAdmin) return
    loadLatestReport()
    setReportHistoryOpen(false)
    setReportHistory(null)
    setReportError('')
  }, [selectedOperator?.id, isAdmin])

  async function loadLatestReport() {
    if (!selectedOperator?.id) { setTriageReport(null); return }
    const { data } = await supabase
      .from('bug_triage_reports')
      .select('*')
      .eq('operator_id', selectedOperator.id)
      .order('generated_at', { ascending: false })
      .limit(1)
    const row = data?.[0]
    setTriageReport(row ? { ...(row as any), isHistorical: false } : null)
  }

  async function generateReport() {
    if (!selectedOperator?.id) return
    setReportLoading(true)
    setReportError('')
    const { data, error } = await supabase.functions.invoke('bug-triage-report', {
      body: { operator_id: selectedOperator.id, generated_by: user?.name ?? user?.email ?? null },
    })
    if (error || data?.error) {
      setReportError(data?.error ?? error?.message ?? 'Report generation failed.')
      setReportLoading(false)
      return
    }
    setTriageReport({ ...data, isHistorical: false })
    setReportHistory(null)
    setReportHistoryOpen(false)
    setReportLoading(false)
  }

  async function toggleReportHistory() {
    if (reportHistoryOpen) { setReportHistoryOpen(false); return }
    setReportHistoryOpen(true)
    if (reportHistory || !selectedOperator?.id) return
    setReportHistoryLoading(true)
    const { data } = await supabase
      .from('bug_triage_reports')
      .select('id,generated_at,generated_by,bug_count,meta')
      .eq('operator_id', selectedOperator.id)
      .order('generated_at', { ascending: false })
      .limit(30)
    setReportHistory((data as any) ?? [])
    setReportHistoryLoading(false)
  }

  async function viewHistoricalReport(id: string) {
    const { data } = await supabase.from('bug_triage_reports').select('*').eq('id', id).single()
    if (!data) return
    setTriageReport({ ...(data as any), isHistorical: true })
    setReportHistoryOpen(false)
  }

  async function backToLatestReport() {
    await loadLatestReport()
    setReportHistoryOpen(false)
  }

  function buildBriefCopyText(b: TriageBrief): string {
    if (b.error) return `Bug ${shortId(b.bug_id)} — brief generation failed: ${b.error}`
    return [
      `Bug ${shortId(b.bug_id)}${b.ticket_number ? ` | Ticket #${b.ticket_number}` : ''} | ${b.severity.toUpperCase()}`,
      '',
      'Description:', b.description ?? '—', '',
      'Steps to Reproduce:', b.steps_to_reproduce ?? '—', '',
      'Expected Behavior:', b.expected_behavior ?? '—', '',
      'Actual Behavior:', b.actual_behavior ?? '—', '',
      'Suggested Fix:', b.suggested_fix ?? '—', '',
      'Impact:', b.impact ?? '—',
    ].join('\n').trim()
  }

  function copyBrief(b: TriageBrief) {
    navigator.clipboard.writeText(buildBriefCopyText(b))
    setReportCopied(b.bug_id)
    setTimeout(() => setReportCopied(null), 2000)
  }

  // Export the whole triage report as CSV -- one row per resolution brief,
  // columns aligned to what most ticket trackers expect on CSV import
  // (title/description/steps/severity) so this can seed real tickets directly
  // rather than needing every brief copied over one at a time.
  function exportTriageReportCSV() {
    if (!triageReport) return
    const headers = ['Bug ID', 'Ticket ID', 'Ticket #', 'Severity', 'Mode', 'Failing Component', 'Status', 'Title', 'Description', 'Steps to Reproduce', 'Expected Behavior', 'Actual Behavior', 'Suggested Fix', 'Impact']
    const rows = triageReport.briefs.map(b => [
      shortId(b.bug_id), b.ticket_id ?? '', b.ticket_number ?? '', b.severity, b.mode, failLabel(b.failing_component), b.status,
      b.error ? `Brief generation failed: ${b.error}` : (b.description ?? '').slice(0, 80),
      b.error ? '' : (b.description ?? '—'),
      b.error ? '' : (b.steps_to_reproduce ?? '—'),
      b.error ? '' : (b.expected_behavior ?? '—'),
      b.error ? '' : (b.actual_behavior ?? '—'),
      b.error ? '' : (b.suggested_fix ?? '—'),
      b.error ? '' : (b.impact ?? '—'),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `eng_triage_report_${new Date(triageReport.generated_at).toISOString().slice(0,10)}.csv`
    a.click()
  }

  // Fetches every bug for the current operator regardless of role — agents/QA get
  // view-only access to the full log (not just their own reports) so they can
  // cross-reference status and stay bought into logging accurately. RLS already
  // permits this (authenticated_manage_bug_reports is USING(true)); only the
  // operator scope below narrows it, same as every other role.
  async function fetchBugs() {
    setLoading(true)
    let q = supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false })
    if (selectedOperator?.id) q = q.eq('operator_id', selectedOperator.id)
    const { data } = await q
    setBugs((data as BugReport[]) ?? [])
    setLoading(false)
  }

  async function handleEvidenceSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (evidenceInputRef.current) evidenceInputRef.current.value = ''
    if (files.length === 0) return

    setEvidenceError('')
    const room = MAX_EVIDENCE_FILES - evidence.length
    if (room <= 0) { setEvidenceError(`Up to ${MAX_EVIDENCE_FILES} files per report`); return }
    const toUpload = files.slice(0, room)
    const oversize = toUpload.find(f => f.size > MAX_EVIDENCE_SIZE)
    if (oversize) { setEvidenceError(`"${oversize.name}" is over the 25MB limit`); return }

    setEvidenceUploading(true)
    for (const file of toUpload) {
      const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage.from('bug-evidence').upload(path, file, { upsert: false, contentType: file.type })
      if (error) { setEvidenceError(error.message); continue }
      const { data: urlData } = supabase.storage.from('bug-evidence').getPublicUrl(path)
      setEvidence(prev => [...prev, { url: urlData.publicUrl, name: file.name, type: file.type, size: file.size }])
    }
    setEvidenceUploading(false)
  }

  function removeEvidence(idx: number) {
    setEvidence(prev => prev.filter((_, i) => i !== idx))
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
      evidence,
    })
    await fetchBugs()
    setForm(EMPTY_FORM)
    setEvidence([])
    setEvidenceError('')
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
    const headers = ['ID', 'Mode', 'Severity', 'Status', 'Ticket ID', 'Ticket #', 'Failing Component', 'Expected Outcome', 'Actual Outcome', 'Player Input', 'gameLM Suggested', 'Additional Context', 'Evidence', 'Reported By', 'Date']
    const rows = filteredBugs.map(b => [
      shortId(b.id), MODE_CONFIG[b.mode]?.label ?? b.mode, b.severity, b.status,
      b.ticket_id ?? '', b.ticket_number ?? '', failLabel(b.failing_component),
      b.expected_outcome, b.actual_outcome,
      b.player_input ?? '', b.suggested_response ?? '',
      b.additional_context ?? '', (b.evidence ?? []).map(e => e.url).join(' '), b.reported_by ?? '', fmtDate(b.created_at),
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

  const myBugs = bugs.filter(b => b.reported_by === user?.email)

  const formValid = form.mode && form.severity && form.expectedOutcome.trim() && form.actualOutcome.trim()

  // ── Tabs ──────────────────────────────────────────────────────────────────
  // Bug Tracker is visible to every role now — agents/QA get view-only access
  // so they can cross-reference the status of what they've logged; admin keeps
  // the extra filters, CSV export, and status-change controls.
  const tabs = [
    { id: 'log' as const, label: 'Report a Bug' },
    { id: 'tracker' as const, label: `Bug Tracker${bugs.length > 0 ? ` (${bugs.length})` : ''}` },
    ...(isAdmin ? [{ id: 'report' as const, label: 'Engineering Report' }] : []),
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

          {/* Evidence upload */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Evidence <span style={{ fontWeight: 400, color: '#aaa' }}>(screenshots, screen recordings, PDFs — up to {MAX_EVIDENCE_FILES})</span>
            </label>

            {evidence.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {evidence.map((ev, idx) => (
                  <div key={ev.url} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    border: '1.5px solid rgba(22,101,52,0.3)', borderRadius: 10,
                    padding: '8px 12px', background: 'rgba(22,101,52,0.04)',
                  }}>
                    {isImageType(ev.type) ? (
                      <img src={ev.url} alt={ev.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(22,101,52,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </div>
                    )}
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.name}
                    </span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(22,101,52,0.6)', flexShrink: 0 }}>{fmtBytes(ev.size)}</span>
                    <button onClick={() => removeEvidence(idx)} style={{ color: '#aaa', fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }} title="Remove">×</button>
                  </div>
                ))}
              </div>
            )}

            {evidence.length < MAX_EVIDENCE_FILES && (
              <div
                onClick={() => !evidenceUploading && evidenceInputRef.current?.click()}
                style={{
                  border: '1.5px dashed rgba(206,164,255,0.6)', borderRadius: 10,
                  padding: '18px 20px', background: 'rgba(206,164,255,0.04)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  cursor: evidenceUploading ? 'default' : 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!evidenceUploading) e.currentTarget.style.background = 'rgba(206,164,255,0.09)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(206,164,255,0.04)' }}
              >
                {evidenceUploading ? (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', margin: 0 }}>Uploading…</p>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#CEA4FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                    </svg>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', margin: 0 }}>Click to attach files</p>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', margin: 0 }}>Images, video, or PDF — max 25MB each</p>
                  </>
                )}
              </div>
            )}

            {evidenceError && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e53e3e', marginTop: 6 }}>{evidenceError}</p>
            )}

            <input
              ref={evidenceInputRef}
              type="file"
              accept={EVIDENCE_ACCEPT}
              multiple
              onChange={handleEvidenceSelect}
              style={{ display: 'none' }}
            />
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={submitBug}
              disabled={!formValid || submitting || evidenceUploading}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
                padding: '10px 24px', borderRadius: 10, border: 'none', cursor: formValid && !submitting && !evidenceUploading ? 'pointer' : 'not-allowed',
                background: formValid && !submitting && !evidenceUploading ? '#000' : 'rgba(0,0,0,0.25)',
                color: '#fff', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { if (formValid && !submitting && !evidenceUploading) e.currentTarget.style.opacity = '0.8' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
            >
              {submitting ? 'Submitting…' : evidenceUploading ? 'Uploading evidence…' : 'Submit Bug Report'}
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
          ) : myBugs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>No bug reports submitted yet</p>
            </div>
          ) : (
            <BugList bugs={myBugs} expanded={expanded} onExpand={setExpanded} onCopy={copyBug} copied={copied} />
          )}
        </div>
      )}

      {/* ── Tracker tab (everyone — admin can filter/export/update status, agents & QA get view-only) ── */}
      {activeTab === 'tracker' && (
        <BugThemeDistribution bugs={bugs} />
      )}
      {activeTab === 'tracker' && (
        <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
              {!isAdmin && (
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>View only</span>
              )}
            </div>
            {isAdmin && (
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
            )}
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
            <BugList bugs={filteredBugs} expanded={expanded} onExpand={setExpanded} onCopy={copyBug} copied={copied} onStatusChange={isAdmin ? updateStatus : undefined} />
          )}
        </div>
      )}

      {/* ── Engineering Report tab (admin only) ───────────────────────────── */}
      {activeTab === 'report' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 4 }}>Engineering Report</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.6, maxWidth: 620 }}>
                  AI-drafted resolution briefs for every open bug — description, steps to reproduce, suggested fix, expected/actual behavior, and impact —
                  plus a cross-cutting pass looking for shared root causes across bugs tagged under different components.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {triageReport?.generated_at && (
                  <button
                    onClick={toggleReportHistory}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#58595B',
                      padding: '8px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)',
                      background: reportHistoryOpen ? 'rgba(0,0,0,0.04)' : '#fff', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >{reportHistoryOpen ? 'Hide history' : 'History'}</button>
                )}
                <button
                  onClick={generateReport}
                  disabled={reportLoading || !selectedOperator?.id}
                  style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
                    padding: '10px 20px', borderRadius: 10, border: 'none', cursor: reportLoading ? 'not-allowed' : 'pointer',
                    background: reportLoading ? 'rgba(0,0,0,0.25)' : '#000', color: '#fff', transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => { if (!reportLoading) e.currentTarget.style.opacity = '0.8' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                >{reportLoading ? 'Analyzing…' : triageReport ? 'Regenerate' : 'Generate Report'}</button>
              </div>
            </div>

            {reportHistoryOpen && (
              <div style={{ marginTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 14 }}>
                {reportHistoryLoading ? (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading history…</p>
                ) : !reportHistory?.length ? (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No past reports yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {reportHistory.map(h => {
                      const isCurrent = triageReport?.id === h.id
                      return (
                        <button
                          key={h.id}
                          onClick={() => !isCurrent && viewHistoricalReport(h.id)}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
                            padding: '8px 10px', borderRadius: 8, border: 'none', cursor: isCurrent ? 'default' : 'pointer',
                            background: isCurrent ? 'rgba(206,164,255,0.1)' : 'transparent', transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                          onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent' }}
                        >
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>
                            {new Date(h.generated_at).toLocaleString()}{isCurrent ? ' (viewing)' : ''}
                          </span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                            {h.bug_count} bug{h.bug_count === 1 ? '' : 's'}{h.generated_by ? ` · ${h.generated_by}` : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {reportError && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e', marginTop: 12 }}>{reportError}</p>
            )}

            {triageReport && !reportError && (
              <div style={{ marginTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
                      {triageReport.isHistorical ? 'Generated' : 'Last generated'} {new Date(triageReport.generated_at).toLocaleString()}
                      {triageReport.generated_by ? ` · by ${triageReport.generated_by}` : ''}
                    </p>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
                      Analyzed {triageReport.meta?.analyzed ?? triageReport.bug_count} open/investigating bug{(triageReport.meta?.analyzed ?? triageReport.bug_count) === 1 ? '' : 's'}
                      {triageReport.meta?.truncated ? ` (of ${triageReport.meta.total_open} total — highest severity + most recent kept)` : ''}
                    </p>
                  </div>
                  {triageReport.briefs.length > 0 && (
                    <button
                      onClick={exportTriageReportCSV}
                      style={{
                        flexShrink: 0, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                        padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)',
                        background: '#fff', color: '#58595B', cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >Export CSV</button>
                  )}
                </div>
                {triageReport.isHistorical && (
                  <button
                    onClick={backToLatestReport}
                    style={{
                      alignSelf: 'flex-start', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#9B59D0',
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    }}
                  >← Back to latest</button>
                )}
              </div>
            )}
          </div>

          {reportLoading && (
            <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', padding: 40, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>
                Reading every open bug (and any attached evidence) and drafting resolution briefs — this can take a minute for a large backlog…
              </p>
            </div>
          )}

          {triageReport && !reportLoading && (
            <>
              {triageReport.themes.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: '18px 20px' }}>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', marginBottom: 4 }}>Root Cause Themes</p>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.35)', marginBottom: 14 }}>
                    Bugs that likely share one deeper cause, even where they were tagged under different components
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {triageReport.themes.map((t, i) => (
                      <div key={i} style={{ borderRadius: 10, border: '1.5px solid rgba(155,89,208,0.2)', background: 'rgba(155,89,208,0.03)', padding: '12px 14px' }}>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#9B59D0', marginBottom: 4 }}>{t.title}</p>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.55, marginBottom: 8 }}>{t.explanation}</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {t.bugs.map(b => (
                            <span key={b.bug_id} style={{ display: 'inline-flex', alignItems: 'center', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#9B59D0', background: 'rgba(155,89,208,0.1)', padding: '2px 8px', borderRadius: 100 }}>
                              {b.ticket_number ? `#${b.ticket_number}` : shortId(b.bug_id)}
                              {b.ticket_id && <CopyIconButton value={b.ticket_id} title="Copy ticket ID" />}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: '18px 20px' }}>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', marginBottom: 14 }}>
                  Resolution Briefs ({triageReport.briefs.length})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {triageReport.briefs.map(b => (
                    <div key={b.bug_id} style={{ borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0', fontWeight: 600 }}>{shortId(b.bug_id)}</span>
                        {b.ticket_number && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>#{b.ticket_number}</span>}
                        {b.ticket_id && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', fontFamily: 'monospace', fontSize: 11, color: '#58595B' }}>
                            {b.ticket_id}
                            <CopyIconButton value={b.ticket_id} title="Copy ticket ID" />
                          </span>
                        )}
                        <SeverityBadge s={b.severity} />
                        <ModeBadge m={b.mode} />
                        {b.failing_component && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{failLabel(b.failing_component)}</span>
                        )}
                        <button
                          onClick={() => copyBrief(b)}
                          style={{
                            marginLeft: 'auto', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                            padding: '5px 12px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff',
                            color: reportCopied === b.bug_id ? '#166534' : '#58595B', cursor: 'pointer', transition: 'all 0.15s',
                          }}
                        >{reportCopied === b.bug_id ? '✓ Copied' : 'Copy for Engineering'}</button>
                      </div>

                      {b.error ? (
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>Brief generation failed: {b.error}</p>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <DetailBox label="Description" value={b.description ?? '—'} />
                          <DetailBox label="Steps to Reproduce" value={b.steps_to_reproduce ?? '—'} />
                          <DetailBox label="Expected Behavior" value={b.expected_behavior ?? '—'} />
                          <DetailBox label="Actual Behavior" value={b.actual_behavior ?? '—'} highlight />
                          <DetailBox label="Suggested Fix" value={b.suggested_fix ?? '—'} />
                          <DetailBox label="Impact" value={b.impact ?? '—'} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Recurring themes ─────────────────────────────────────────────────────────
// Reuses "Failing component" as the theme axis — surfaces which parts of gameLM
// keep recurring across bug submissions, same pattern as ReportCard's Conversation Themes.
function BugThemeDistribution({ bugs }: { bugs: BugReport[] }) {
  const tagged = bugs.filter(b => b.failing_component)
  if (tagged.length === 0) return null

  const counts = tagged.reduce((acc, b) => {
    const label = failLabel(b.failing_component)
    acc[label] = (acc[label] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] ?? 1

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 20px' }}>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', marginBottom: 4 }}>Recurring Themes</p>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)', marginBottom: 14 }}>
        Failing component across all {tagged.length} tagged reports — the biggest bar is where gameLM keeps breaking
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {sorted.map(([theme, count]) => (
          <div key={theme} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', width: 190, flexShrink: 0 }}>{theme}</span>
            <div style={{ flex: 1, height: 5, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', borderRadius: 100, background: '#9B59D0', transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', width: 20, textAlign: 'right', flexShrink: 0 }}>{count}</span>
          </div>
        ))}
      </div>
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
// Columns are the same for every viewer (agents/QA get view-only access to the
// full log so they can cross-reference status) — onStatusChange being present
// is the only thing that turns on edit affordances, and it's only ever passed
// in for admins.
function BugList({ bugs, expanded, onExpand, onCopy, copied, onStatusChange }: {
  bugs: BugReport[]
  expanded: string | null
  onExpand: (id: string | null) => void
  onCopy: (bug: BugReport) => void
  copied: string | null
  onStatusChange?: (id: string, status: string) => void
}) {
  // Table header
  const cols = '80px 100px 90px 100px 1fr 130px 140px 100px 90px'

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: cols,
        padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: 'rgba(0,0,0,0.01)',
      }}>
        {['ID', 'Mode', 'Severity', 'Status', 'Failing Component', 'Reported By', 'Ticket ID', 'Ticket #', 'Date'].map(h => (
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
              <StatusBadge s={bug.status} />
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {failLabel(bug.failing_component)}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bug.reported_by ?? '—'}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', fontFamily: 'monospace', fontSize: 11, color: '#9B59D0', overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.ticket_id ?? '—'}</span>
                {bug.ticket_id && <CopyIconButton value={bug.ticket_id} title="Copy ticket ID" />}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                {bug.ticket_number ? `#${bug.ticket_number}` : '—'}
              </span>
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

                {bug.evidence?.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                      Evidence ({bug.evidence.length})
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {bug.evidence.map(ev => (
                        <a key={ev.url} href={ev.url} target="_blank" rel="noopener noreferrer" style={{
                          display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
                          border: '1.5px solid rgba(0,0,0,0.09)', borderRadius: 8, padding: '6px 10px', background: '#fff',
                        }}>
                          {isImageType(ev.type) ? (
                            <img src={ev.url} alt={ev.name} style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(155,89,208,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9B59D0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                              </svg>
                            </div>
                          )}
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#000', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</span>
                        </a>
                      ))}
                    </div>
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

                  {/* Status update (admin only — onStatusChange is only passed in for admins) */}
                  {onStatusChange && (
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
