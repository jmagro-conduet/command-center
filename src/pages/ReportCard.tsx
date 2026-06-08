import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

type TimeRange    = 'last7' | 'last14' | 'last30' | 'allTime'
type Verdict      = 'CORRECTION' | 'ENHANCEMENT' | 'PREFERENCE'
type TopTab       = 'evals' | 'accuracy' | 'quality' | 'tickets'
type AccuracyClass = 'P1A' | 'P1B' | 'P2' | 'NONE'

interface EvalRow {
  id:                 string
  issueType:          string
  evalVerdict:        Verdict
  evalConfidence:     number
  evalReasoning:      string
  evalRanAt:          string
  customerInput:      string
  suggestedResponse:  string
  finalEdits:         string
  reasoning:          string
  loggedAt:           string | null
  createdAt:          string
  ticketNumber:       string
  agentName:          string
  agentEmail:         string
  category:           string
  // Eval 2 — Response Accuracy
  accuracyErrorClass:   AccuracyClass | null
  accuracyEvidence:     string | null
  accuracyReasoning:    string | null
  accuracyHumanReview:  boolean | null
  accuracyRanAt:        string | null
  // Eval 3 — Response Quality
  qualityIntent:        number | null
  qualityResolution:    number | null
  qualityInfoGathering: number | null
  qualityClarity:       number | null
  qualityBrand:         number | null
  qualityScore:         number | null
  qualityFlag:          boolean | null
  qualityFlagReason:    string | null
  qualityRanAt:         string | null
  // Theme & checklist review
  themeTag:             string | null
  reviewStatus:         'pending' | 'confirmed' | 'dismissed' | null
  reviewNotes:          string | null
  reviewedBy:           string | null
  reviewedAt:           string | null
}

interface TicketRow {
  id:                    string
  ticketNumber:          string
  agentName:             string
  agentEmail:            string
  zdMessageCount:        number | null
  zdResolutionMinutes:   number | null
  zdFcr:                 boolean | null
  zdLastPlayerMessage:   string | null
  zdPlayerSentiment:     string | null  // COMPLIMENT | NEUTRAL | NEGATIVE
  zdSentimentConfidence: number | null
  issueCount:            number   // filled in after join
  createdAt:             string
}

const VERDICT_CONFIG: Record<Verdict, { label: string; color: string; bg: string; desc: string }> = {
  CORRECTION:  { label: 'Correction',  color: '#e53e3e', bg: 'rgba(229,62,62,0.09)',    desc: 'gameLM made an error — agent fix was necessary' },
  ENHANCEMENT: { label: 'Enhancement', color: '#854d0e', bg: 'rgba(234,179,8,0.12)',    desc: 'gameLM was acceptable — agent added genuine value' },
  PREFERENCE:  { label: 'Preference',  color: '#58595B', bg: 'rgba(0,0,0,0.06)',        desc: 'Stylistic edit — original was fully send-worthy' },
}

function rangeDays(r: TimeRange) {
  return r === 'last7' ? 7 : r === 'last14' ? 14 : r === 'last30' ? 30 : 0
}

function rowDate(r: EvalRow): Date {
  return new Date(r.loggedAt ?? r.createdAt)
}

function filterByRange(rows: EvalRow[], range: TimeRange): EvalRow[] {
  if (range === 'allTime') return rows
  const c = new Date(); c.setDate(c.getDate() - rangeDays(range))
  return rows.filter(r => rowDate(r) >= c)
}

function pct(n: number, total: number) {
  return total ? Math.round((n / total) * 100) : 0
}

function fmtMinutes(mins: number | null): string {
  if (mins === null || mins === 0) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// Strip email quoting artifacts so we only show the player's actual words.
function cleanEmailMessage(raw: string): string {
  const lines = raw.split('\n')
  const clean: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^>+/.test(trimmed)) continue
    if (/^on .{5,100} wrote:$/i.test(trimmed)) continue
    if (/^-{3,}|^_{3,}|^={3,}/.test(trimmed)) continue
    if (/^(from|sent|to|subject|date):/i.test(trimmed)) continue
    clean.push(line)
  }
  return clean.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// For native messaging (live chat), ZD stores the entire transcript as one Comment
// body, formatted as "(HH:MM AM/PM) Name: text". Parse it and return only the last
// message from the player — identified by excluding BetSaracen/Web User (bot/system)
// and the logged agent's name.
function extractLastPlayerMessage(raw: string, agentName?: string): string {
  const isTranscript = /\(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\)/i.test(raw)
  if (!isTranscript) return cleanEmailMessage(raw)

  // Split on timestamp markers, parse "Name: message" from each chunk
  const segments = raw
    .split(/(?=\(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\))/i)
    .map(p => {
      const m = p.match(/^\([^)]+\)\s*([^:]+):\s*(.+)/s)
      return m ? { name: m[1].trim(), msg: m[2].trim() } : null
    })
    .filter(Boolean) as { name: string; msg: string }[]

  if (segments.length === 0) return raw

  // Agent's first name for fuzzy matching against transcript speaker names
  const agentFirst = agentName?.split(/[\s.]/)[0]?.toLowerCase() ?? ''

  const nonBot = segments.filter(s => !/^(BetSaracen|Web User)/i.test(s.name))

  // Try player name extracted from BetSaracen's verification form-fill first
  let playerFirstName: string | null = null
  const nameMatch = raw.match(/Name:\s*([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)*\s+(?:Email:|Date)/m)
  if (nameMatch) playerFirstName = nameMatch[1].toLowerCase()

  if (playerFirstName) {
    const playerSegs = nonBot.filter(s => s.name.toLowerCase().startsWith(playerFirstName!))
    if (playerSegs.length > 0) return playerSegs[playerSegs.length - 1].msg.trim()
  }

  // Exclude the logged agent's lines by first-name match
  const withoutAgent = agentFirst
    ? nonBot.filter(s => !s.name.toLowerCase().includes(agentFirst))
    : nonBot

  // Exclude obvious agent closing patterns
  const agentClosingPattern = /thank you for contacting|have a great|feel free to contact|if you have any other questions|you can also contact us/i
  const nonClosing = withoutAgent.filter(s => !agentClosingPattern.test(s.msg))

  const candidates = nonClosing.length > 0 ? nonClosing
    : withoutAgent.length > 0 ? withoutAgent
    : nonBot

  return candidates[candidates.length - 1]?.msg.trim() ?? raw
}

function VerdictBadge({ verdict, small }: { verdict: Verdict; small?: boolean }) {
  const c = VERDICT_CONFIG[verdict]
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif',
      fontSize: small ? 10 : 11,
      fontWeight: 600,
      padding: small ? '2px 7px' : '3px 9px',
      borderRadius: 100,
      background: c.bg,
      color: c.color,
      whiteSpace: 'nowrap',
      letterSpacing: '0.03em',
    }}>
      {c.label}
    </span>
  )
}

function ConfidencePip({ value }: { value: number }) {
  const color = value >= 80 ? '#166534' : value >= 60 ? '#854d0e' : '#e53e3e'
  return (
    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color, fontWeight: 500 }}>
      {value}%
    </span>
  )
}

async function fetchTicketCompleteness(): Promise<TicketRow[]> {
  // Fetch all tickets with zd_message_count populated
  const PAGE = 1000
  const allTickets: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('tickets')
      .select('id,ticket_number,agent_name,agent_email,zd_message_count,zd_resolution_minutes,zd_fcr,zd_last_player_message,zd_player_sentiment,zd_sentiment_confidence,created_at')
      .not('zd_message_count', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    allTickets.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  // For each ticket, count its issue rows
  if (allTickets.length === 0) return []
  const ids = allTickets.map((t: any) => t.id)
  const issueCounts = new Map<string, number>()

  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data } = await supabase
      .from('ticket_issues')
      .select('ticket_id')
      .in('ticket_id', chunk)
    data?.forEach((r: any) => issueCounts.set(r.ticket_id, (issueCounts.get(r.ticket_id) ?? 0) + 1))
  }

  return allTickets.map((t: any) => ({
    id:                    t.id,
    ticketNumber:          t.ticket_number,
    agentName:             t.agent_name ?? '',
    agentEmail:            t.agent_email ?? '',
    zdMessageCount:        t.zd_message_count,
    zdResolutionMinutes:   t.zd_resolution_minutes ?? null,
    zdFcr:                 t.zd_fcr ?? null,
    zdLastPlayerMessage:   t.zd_last_player_message ?? null,
    zdPlayerSentiment:     t.zd_player_sentiment ?? null,
    zdSentimentConfidence: t.zd_sentiment_confidence ?? null,
    issueCount:            issueCounts.get(t.id) ?? 0,
    createdAt:             t.created_at ?? '',
  }))
}

async function fetchAllEvals(): Promise<EvalRow[]> {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('ticket_issues')
      .select('id,issue_type,eval_verdict,eval_confidence,eval_reasoning,eval_ran_at,customer_input,suggested_response,final_edits,reasoning,logged_at,created_at,accuracy_error_class,accuracy_evidence,accuracy_reasoning,accuracy_human_review,accuracy_ran_at,quality_intent,quality_resolution,quality_info_gathering,quality_clarity,quality_brand,quality_score,quality_flag,quality_flag_reason,quality_ran_at,tickets!inner(ticket_number,agent_name,agent_email,ticket_category,created_at)')
      .not('eval_verdict', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all.map(mapEvalRow)
}

// Fetches all issues that have been scored by eval-accuracy or eval-quality,
// regardless of whether eval_verdict (edit eval) has been run.
async function fetchAllScoredIssues(): Promise<EvalRow[]> {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('ticket_issues')
      .select('id,issue_type,eval_verdict,eval_confidence,eval_reasoning,eval_ran_at,customer_input,suggested_response,final_edits,reasoning,logged_at,created_at,accuracy_error_class,accuracy_evidence,accuracy_reasoning,accuracy_human_review,accuracy_ran_at,quality_intent,quality_resolution,quality_info_gathering,quality_clarity,quality_brand,quality_score,quality_flag,quality_flag_reason,quality_ran_at,theme_tag,review_status,review_notes,reviewed_by,reviewed_at,tickets!inner(ticket_number,agent_name,agent_email,ticket_category,created_at)')
      .or('accuracy_ran_at.not.is.null,quality_ran_at.not.is.null')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all.map(mapEvalRow)
}

function mapEvalRow(r: any): EvalRow {
  return {
    id:                r.id,
    issueType:         r.issue_type ?? '',
    evalVerdict:       (r.eval_verdict as Verdict) ?? 'PREFERENCE',
    evalConfidence:    r.eval_confidence ?? 0,
    evalReasoning:     r.eval_reasoning ?? '',
    evalRanAt:         r.eval_ran_at ?? '',
    customerInput:     r.customer_input ?? '',
    suggestedResponse: r.suggested_response ?? '',
    finalEdits:        r.final_edits ?? '',
    reasoning:         r.reasoning ?? '',
    loggedAt:          r.logged_at ?? null,
    createdAt:         r.tickets?.created_at ?? r.created_at ?? '',
    ticketNumber:      r.tickets?.ticket_number ?? '',
    agentName:         r.tickets?.agent_name ?? '',
    agentEmail:        r.tickets?.agent_email ?? '',
    category:          r.tickets?.ticket_category ?? '',
    // Eval 2
    accuracyErrorClass:   (r.accuracy_error_class as AccuracyClass) ?? null,
    accuracyEvidence:     r.accuracy_evidence     ?? null,
    accuracyReasoning:    r.accuracy_reasoning    ?? null,
    accuracyHumanReview:  r.accuracy_human_review ?? null,
    accuracyRanAt:        r.accuracy_ran_at       ?? null,
    // Eval 3
    qualityIntent:        r.quality_intent         ?? null,
    qualityResolution:    r.quality_resolution     ?? null,
    qualityInfoGathering: r.quality_info_gathering ?? null,
    qualityClarity:       r.quality_clarity        ?? null,
    qualityBrand:         r.quality_brand          ?? null,
    qualityScore:         r.quality_score          ?? null,
    qualityFlag:          r.quality_flag           ?? null,
    qualityFlagReason:    r.quality_flag_reason    ?? null,
    qualityRanAt:         r.quality_ran_at         ?? null,
    themeTag:             r.theme_tag              ?? null,
    reviewStatus:         r.review_status          ?? null,
    reviewNotes:          r.review_notes           ?? null,
    reviewedBy:           r.reviewed_by            ?? null,
    reviewedAt:           r.reviewed_at            ?? null,
  }
}

function TimeRangeFilter({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  const opts: { id: TimeRange; label: string }[] = [
    { id: 'last7',   label: 'Last 7'   },
    { id: 'last14',  label: 'Last 14'  },
    { id: 'last30',  label: 'Last 30'  },
    { id: 'allTime', label: 'All Time' },
  ]
  return (
    <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
      {opts.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: value === o.id ? 500 : 400,
          padding: '5px 12px', borderRadius: 6,
          background: value === o.id ? '#fff' : 'transparent',
          color: value === o.id ? '#000' : '#58595B',
          border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          boxShadow: value === o.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Export helpers ───────────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function exportJSONL(rows: EvalRow[], filename = 'training_data.jsonl') {
  const esc = (s: string) => s.replace(/"/g, '\\"')
  const lines = rows.map(r => JSON.stringify({
    messages: [
      { role: 'user', content: `Player: "${esc(r.customerInput)}"\n\ngameLM suggested response: "${esc(r.suggestedResponse)}"` },
      { role: 'assistant', content: [
          r.accuracyErrorClass ? `ERROR_CLASS: ${r.accuracyErrorClass}` : null,
          r.accuracyEvidence   ? `EVIDENCE: ${r.accuracyEvidence}` : null,
          r.qualityScore !== null ? `QUALITY_SCORE: ${r.qualityScore}` : null,
        ].filter(Boolean).join('\n') || '(no eval output)',
      },
    ],
    human_verdict: r.reviewStatus,
    theme:         r.themeTag,
    notes:         r.reviewNotes,
    ticket:        r.ticketNumber,
    agent:         r.agentName,
    category:      r.category,
  }))
  downloadBlob(lines.join('\n'), filename, 'application/x-jsonlines')
}

function exportCSV(rows: EvalRow[], filename = 'qa_export.csv') {
  const q = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`
  const header = 'ticket_number,agent,category,theme,player_message,suggested_response,accuracy_class,quality_score,review_status,notes'
  const body   = rows.map(r => [
    r.ticketNumber, r.agentName, r.category, r.themeTag ?? '',
    q(r.customerInput), q(r.suggestedResponse),
    r.accuracyErrorClass ?? '', r.qualityScore?.toFixed(2) ?? '',
    r.reviewStatus ?? '', q(r.reviewNotes),
  ].join(','))
  downloadBlob([header, ...body].join('\n'), filename, 'text/csv')
}

// ── Shared UI helpers ────────────────────────────────────────────────────────

const filterSelectStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#000',
  padding: '6px 10px', borderRadius: 8,
  border: '1.5px solid rgba(0,0,0,0.12)',
  background: '#fff', cursor: 'pointer', outline: 'none',
}

function DiagnosticFilters({
  rows, categoryFilter, onCategoryChange, agentFilter, onAgentChange,
}: {
  rows: EvalRow[]
  categoryFilter: string; onCategoryChange: (v: string) => void
  agentFilter: string;    onAgentChange:    (v: string) => void
}) {
  const categories = [...new Set(rows.map(r => r.category).filter(Boolean))].sort()
  const agents     = [...new Set(rows.map(r => r.agentName).filter(Boolean))].sort()
  const active     = categoryFilter || agentFilter
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={categoryFilter} onChange={e => onCategoryChange(e.target.value)} style={filterSelectStyle}>
        <option value="">All categories</option>
        {categories.map(c => <option key={c}>{c}</option>)}
      </select>
      <select value={agentFilter} onChange={e => onAgentChange(e.target.value)} style={filterSelectStyle}>
        <option value="">All agents</option>
        {agents.map(a => <option key={a}>{a}</option>)}
      </select>
      {active && (
        <button onClick={() => { onCategoryChange(''); onAgentChange('') }}
          style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Clear filters
        </button>
      )}
    </div>
  )
}

function ThemeDistribution({ rows }: { rows: EvalRow[] }) {
  const tagged = rows.filter(r => r.themeTag)
  if (tagged.length === 0) return null
  const counts = tagged.reduce((acc, r) => {
    acc[r.themeTag!] = (acc[r.themeTag!] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const max    = sorted[0]?.[1] ?? 1
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 20px' }}>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', marginBottom: 14 }}>Conversation Themes</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {sorted.map(([theme, count]) => (
          <div key={theme} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', width: 170, flexShrink: 0 }}>{theme}</span>
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

function ReviewActions({ row, onUpdate }: {
  row: EvalRow
  onUpdate?: (id: string, status: 'confirmed' | 'dismissed', notes: string) => void
}) {
  const [notes,   setNotes]   = useState(row.reviewNotes ?? '')
  const [status,  setStatus]  = useState<string>(row.reviewStatus ?? 'pending')
  const [saving,  setSaving]  = useState(false)

  async function submit(newStatus: 'confirmed' | 'dismissed') {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('ticket_issues').update({
      review_status: newStatus,
      review_notes:  notes || null,
      reviewed_by:   user?.email ?? null,
      reviewed_at:   new Date().toISOString(),
    }).eq('id', row.id)
    setStatus(newStatus)
    onUpdate?.(row.id, newStatus, notes)
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.07)' }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        QA Review — adds to training dataset
      </p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Add context or notes (e.g. why this was a real error, what the correct response should have been)…"
        rows={2}
        style={{ width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '8px 10px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', resize: 'vertical', marginBottom: 8, boxSizing: 'border-box', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => submit('confirmed')} disabled={saving} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
          padding: '6px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
          background: status === 'confirmed' ? '#166534' : '#000', color: '#fff',
          opacity: saving ? 0.6 : 1, transition: 'all 0.15s', border: 'none',
        }}>
          {status === 'confirmed' ? '✓ Confirmed' : 'Confirm error'}
        </button>
        <button onClick={() => submit('dismissed')} disabled={saving} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
          padding: '6px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
          background: status === 'dismissed' ? 'rgba(0,0,0,0.5)' : 'transparent',
          color: status === 'dismissed' ? '#fff' : '#58595B',
          border: '1.5px solid rgba(0,0,0,0.12)',
          opacity: saving ? 0.6 : 1, transition: 'all 0.15s',
        }}>
          {status === 'dismissed' ? 'Dismissed' : 'False positive'}
        </button>
        {status !== 'pending' && (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
            Saved · use Export to download training data
          </span>
        )}
      </div>
    </div>
  )
}

// ── Accuracy helpers ────────────────────────────────────────────────────────

const ACCURACY_CONFIG: Record<AccuracyClass, { label: string; color: string; bg: string; desc: string }> = {
  P1A:  { label: 'P1A — Regulatory', color: '#e53e3e',  bg: 'rgba(229,62,62,0.09)',    desc: 'Regulatory-level — creates direct legal exposure' },
  P1B:  { label: 'P1B — Hallucination', color: '#c05621', bg: 'rgba(237,137,54,0.12)', desc: 'Topic mismatch or unsupported confident claim — human review required' },
  P2:   { label: 'P2 — Data error',  color: '#854d0e',  bg: 'rgba(234,179,8,0.12)',    desc: 'Account data presented as confirmed fact' },
  NONE: { label: 'Clean',            color: '#166534',  bg: 'rgba(22,101,52,0.09)',     desc: 'No accuracy errors detected' },
}

function AccuracyBadge({ cls, small }: { cls: AccuracyClass; small?: boolean }) {
  const c = ACCURACY_CONFIG[cls]
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif', fontSize: small ? 10 : 11, fontWeight: 600,
      padding: small ? '2px 7px' : '3px 9px', borderRadius: 100,
      background: c.bg, color: c.color, whiteSpace: 'nowrap', letterSpacing: '0.03em',
    }}>
      {c.label}
    </span>
  )
}

function QualityScore({ score, small }: { score: number; small?: boolean }) {
  const color = score >= 4 ? '#166534' : score >= 3.5 ? '#854d0e' : '#e53e3e'
  return (
    <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: small ? 13 : 20, fontWeight: 600, color }}>
      {score.toFixed(2)}
    </span>
  )
}

// ── Response Accuracy tab ───────────────────────────────────────────────────

function ResponseAccuracyView({ rows, agentFilter, onReviewUpdate }: {
  rows: EvalRow[]
  agentFilter?: string
  onReviewUpdate?: (id: string, status: 'confirmed' | 'dismissed', notes: string) => void
}) {
  const [expanded,       setExpanded]       = useState<string | null>(null)
  const [subTab,         setSubTab]         = useState<'queue' | 'all'>('queue')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [agentFil,       setAgentFil]       = useState('')

  const scoped = (() => {
    let r = agentFilter ? rows.filter(x => x.agentName === agentFilter) : rows
    if (categoryFilter) r = r.filter(x => x.category === categoryFilter)
    if (agentFil)       r = r.filter(x => x.agentName === agentFil)
    return r
  })()

  const withEval    = scoped.filter(r => r.accuracyRanAt !== null)
  const total       = withEval.length
  const p1a         = withEval.filter(r => r.accuracyErrorClass === 'P1A').length
  const p1b         = withEval.filter(r => r.accuracyErrorClass === 'P1B').length
  const p2          = withEval.filter(r => r.accuracyErrorClass === 'P2').length
  const clean       = withEval.filter(r => r.accuracyErrorClass === 'NONE').length
  const errorRate   = total ? Math.round(((p1a + p1b + p2) / total) * 100) : 0
  const reviewQueue = withEval.filter(r => r.accuracyHumanReview === true && r.accuracyErrorClass !== 'NONE')
  const allResults  = withEval.filter(r => !r.accuracyHumanReview || r.accuracyErrorClass === 'NONE')

  const exportRows  = subTab === 'queue' ? reviewQueue : allResults

  if (withEval.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 6 }}>No accuracy evals yet</p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
          New submissions automatically trigger Eval 2. Run the backfill to score existing issues.
        </p>
      </div>
    )
  }

  const ExpandedRow = ({ r }: { r: EvalRow }) => (
    <div style={{ padding: '16px 20px 20px', background: 'rgba(229,62,62,0.02)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
      {r.accuracyErrorClass && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: ACCURACY_CONFIG[r.accuracyErrorClass].color, marginBottom: 12 }}>
          {ACCURACY_CONFIG[r.accuracyErrorClass].desc}
          {r.accuracyReasoning && <span style={{ color: '#58595B', fontWeight: 400 }}> — {r.accuracyReasoning}</span>}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {[{ label: 'Player message', value: r.customerInput }, { label: 'gameLM suggested', value: r.suggestedResponse }].map(box => (
          <div key={box.label} style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.09)' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{box.label}</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{box.value || '—'}</p>
          </div>
        ))}
      </div>
      {r.accuracyEvidence && r.accuracyEvidence !== 'None' && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(229,62,62,0.05)', border: '1px solid rgba(229,62,62,0.15)', marginBottom: 12 }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#e53e3e' }}>
            <strong style={{ fontWeight: 600 }}>Flagged text: </strong>"{r.accuracyEvidence}"
          </p>
        </div>
      )}
      {r.accuracyHumanReview && <ReviewActions row={r} onUpdate={onReviewUpdate} />}
    </div>
  )

  const TableRow = ({ r }: { r: EvalRow }) => {
    const isExp = expanded === r.id
    return (
      <div key={r.id}>
        <div onClick={() => setExpanded(isExp ? null : r.id)} style={{
          display: 'grid', gridTemplateColumns: '100px 1fr 150px 140px 100px 90px',
          padding: '11px 20px', alignItems: 'center', cursor: 'pointer',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          background: isExp ? 'rgba(229,62,62,0.03)' : 'transparent', transition: 'background 0.15s',
        }}
          onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
          onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(229,62,62,0.03)' : 'transparent' }}
        >
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{r.ticketNumber}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{r.agentName}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.category || '—'}</span>
          {r.accuracyErrorClass ? <AccuracyBadge cls={r.accuracyErrorClass} small /> : <span />}
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>{r.themeTag ?? '—'}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
            {r.accuracyRanAt ? new Date(r.accuracyRanAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
          </span>
        </div>
        {isExp && <ExpandedRow r={r} />}
      </div>
    )
  }

  const cols = ['Ticket', 'Agent', 'Category', 'Result', 'Theme', 'Date']
  const colTemplate = '100px 1fr 150px 140px 100px 90px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Evals run',          value: total.toString(),      color: '#9B59D0',                                                    note: 'responses scored' },
          { label: 'Error rate',         value: `${errorRate}%`,       color: errorRate > 10 ? '#e53e3e' : errorRate > 5 ? '#854d0e' : '#166534', note: 'P1A + P1B + P2' },
          { label: 'P1A — Regulatory',   value: p1a.toString(),        color: p1a > 0 ? '#e53e3e' : '#166534',                             note: p1a > 0 ? 'Action required' : 'None detected' },
          { label: 'P1B — Review queue', value: p1b.toString(),        color: p1b > 0 ? '#c05621' : '#166534',                             note: p1b > 0 ? 'Human review required' : 'None detected' },
          { label: 'Clean responses',    value: total ? `${pct(clean, total)}%` : '—', color: '#166534',                                  note: 'No errors detected' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 2 }}>{k.note}</p>
          </div>
        ))}
      </div>

      <ThemeDistribution rows={withEval} />

      {/* Sub-tab bar + filters + export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
          {([
            { id: 'queue' as const, label: `Review Queue (${reviewQueue.length})` },
            { id: 'all'   as const, label: `All Results (${allResults.length})` },
          ]).map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: subTab === t.id ? 500 : 400,
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: subTab === t.id ? '#fff' : 'transparent',
              color: subTab === t.id ? '#000' : '#58595B',
              boxShadow: subTab === t.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!agentFilter && (
            <DiagnosticFilters rows={withEval} categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter}
              agentFilter={agentFil} onAgentChange={setAgentFil} />
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => exportJSONL(exportRows)} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer' }}>
              Export JSONL
            </button>
            <button onClick={() => exportCSV(exportRows)} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer' }}>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {subTab === 'queue' && (
        <div style={{ background: '#fff', borderRadius: 16, border: reviewQueue.length > 0 ? '1.5px solid rgba(229,62,62,0.2)' : '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: reviewQueue.length > 0 ? 'rgba(229,62,62,0.03)' : 'rgba(0,0,0,0.015)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Human Review Queue</p>
            {reviewQueue.length > 0 && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(229,62,62,0.1)', color: '#e53e3e' }}>{reviewQueue.length}</span>}
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>Confirm errors or dismiss false positives — saved items are included in exports</p>
          </div>
          {reviewQueue.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.3)' }}>No items in review queue for this filter</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
                {cols.map(h => <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>)}
              </div>
              {reviewQueue.map(r => <TableRow key={r.id} r={r} />)}
            </>
          )}
        </div>
      )}

      {subTab === 'all' && allResults.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>All Accuracy Results</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
            {cols.map(h => <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>)}
          </div>
          {allResults.slice(0, 50).map(r => <TableRow key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Response Quality tab ────────────────────────────────────────────────────

const QUALITY_CATEGORIES = [
  { key: 'qualityIntent' as const,        label: 'Intent',        weight: '25%' },
  { key: 'qualityResolution' as const,    label: 'Resolution',    weight: '25%' },
  { key: 'qualityInfoGathering' as const, label: 'Info Gathering',weight: '20%' },
  { key: 'qualityClarity' as const,       label: 'Clarity',       weight: '15%' },
  { key: 'qualityBrand' as const,         label: 'Brand',         weight: '15%' },
]

function avgOf(rows: EvalRow[], key: keyof EvalRow): number | null {
  const vals = rows.map(r => r[key] as number | null).filter((v): v is number => v !== null)
  return vals.length ? parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) : null
}

function ResponseQualityView({ rows, agentFilter }: { rows: EvalRow[]; agentFilter?: string }) {
  const [expanded,       setExpanded]       = useState<string | null>(null)
  const [viewMode,       setViewMode]       = useState<'issue' | 'ticket'>('issue')
  const [subTab,         setSubTab]         = useState<'below' | 'passing'>('below')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [agentFil,       setAgentFil]       = useState('')

  const scoped = (() => {
    let r = agentFilter ? rows.filter(x => x.agentName === agentFilter) : rows
    if (categoryFilter) r = r.filter(x => x.category === categoryFilter)
    if (agentFil)       r = r.filter(x => x.agentName === agentFil)
    return r
  })()

  const withEval    = scoped.filter(r => r.qualityRanAt !== null && r.qualityScore !== null)
  const total       = withEval.length
  const avgScore    = avgOf(withEval, 'qualityScore')
  const aboveBar    = withEval.filter(r => (r.qualityScore ?? 0) >= 3.5).length
  const flagged     = withEval.filter(r => r.qualityFlag === true).length
  const belowBar    = withEval.filter(r => (r.qualityScore ?? 0) < 3.5)
  const passing     = withEval.filter(r => (r.qualityScore ?? 0) >= 3.5)

  const exportRows  = subTab === 'below' ? belowBar : passing

  if (withEval.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 6 }}>No quality evals yet</p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
          New submissions automatically trigger Eval 3. Run the backfill to score existing issues.
        </p>
      </div>
    )
  }

  const scoreColor = (s: number | null) => s === null ? '#aaa' : s >= 4 ? '#166534' : s >= 3.5 ? '#854d0e' : '#e53e3e'

  const sc = (v: number | null) => v !== null ? (
    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: v <= 2 ? '#e53e3e' : v >= 4 ? '#166534' : '#854d0e' }}>{v}</span>
  ) : <span style={{ color: 'rgba(0,0,0,0.2)', fontSize: 12 }}>—</span>

  const colTemplate = '100px 1fr 130px 70px 70px 70px 70px 70px 70px 70px'
  const colHeaders  = ['Ticket', 'Agent', 'Category', 'Score', 'Intent', 'Res', 'Info', 'Clarity', 'Brand', 'Flag']

  const QualityTableRow = ({ r }: { r: EvalRow }) => {
    const isExp = expanded === r.id
    return (
      <div>
        <div onClick={() => setExpanded(isExp ? null : r.id)} style={{
          display: 'grid', gridTemplateColumns: colTemplate,
          padding: '11px 20px', alignItems: 'center', cursor: 'pointer', gap: 8,
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          background: isExp ? 'rgba(206,164,255,0.04)' : 'transparent', transition: 'background 0.15s',
        }}
          onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
          onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.04)' : 'transparent' }}
        >
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{r.ticketNumber}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{r.agentName}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.category || '—'}</span>
          {r.qualityScore !== null ? <QualityScore score={r.qualityScore} small /> : <span />}
          {sc(r.qualityIntent)} {sc(r.qualityResolution)} {sc(r.qualityInfoGathering)} {sc(r.qualityClarity)} {sc(r.qualityBrand)}
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: r.qualityFlag ? 'rgba(229,62,62,0.09)' : 'rgba(0,0,0,0.05)', color: r.qualityFlag ? '#e53e3e' : '#58595B', width: 'fit-content' }}>
            {r.qualityFlag ? 'Flagged' : 'OK'}
          </span>
        </div>
        {isExp && (
          <div style={{ padding: '16px 20px 20px', background: 'rgba(206,164,255,0.02)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
            {r.qualityFlagReason && r.qualityFlagReason !== 'None' && (
              <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(229,62,62,0.05)', border: '1px solid rgba(229,62,62,0.15)' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#e53e3e' }}>
                  <strong style={{ fontWeight: 600 }}>Flag reason: </strong>{r.qualityFlagReason}
                </p>
              </div>
            )}
            {r.themeTag && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 100, background: 'rgba(155,89,208,0.08)', color: '#9B59D0', border: '1px solid rgba(155,89,208,0.2)' }}>
                  {r.themeTag}
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[{ label: 'Player message', value: r.customerInput }, { label: 'gameLM suggested', value: r.suggestedResponse }].map(box => (
                <div key={box.label} style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.09)' }}>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{box.label}</p>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{box.value || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Top KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'Evals run',          value: total.toString(),                          color: '#9B59D0', note: 'responses scored' },
          { label: 'Avg quality score',  value: avgScore !== null ? avgScore.toFixed(2) : '—', color: scoreColor(avgScore), note: 'target ≥ 3.50' },
          { label: 'Above bar (≥3.5)',   value: total ? `${pct(aboveBar, total)}%` : '—', color: '#166534', note: `${aboveBar} / ${total} responses` },
          { label: 'Flagged (any cat=1)', value: flagged.toString(),                        color: flagged > 0 ? '#e53e3e' : '#166534', note: flagged > 0 ? 'Minimum quality fail' : 'None this period' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 2 }}>{k.note}</p>
          </div>
        ))}
      </div>

      {/* Category averages */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 20px' }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', marginBottom: 14 }}>Category Averages</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {QUALITY_CATEGORIES.map(cat => {
            const avg = avgOf(withEval, cat.key)
            const color = scoreColor(avg)
            const pctFill = avg !== null ? ((avg - 1) / 4) * 100 : 0
            return (
              <div key={cat.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B' }}>{cat.label}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.3)' }}>{cat.weight}</span>
                </div>
                <div style={{ height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                  <div style={{ width: `${pctFill}%`, height: '100%', borderRadius: 100, background: color, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color }}>{avg !== null ? avg.toFixed(2) : '—'}</span>
              </div>
            )
          })}
        </div>
      </div>

      <ThemeDistribution rows={withEval} />

      {/* Controls bar: view toggle + sub-tabs (issue mode only) + filters + export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* View mode toggle */}
          <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
            {([
              { id: 'issue'  as const, label: 'Issue Level' },
              { id: 'ticket' as const, label: 'Ticket Level' },
            ]).map(t => (
              <button key={t.id} onClick={() => setViewMode(t.id)} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: viewMode === t.id ? 500 : 400,
                padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: viewMode === t.id ? '#000' : 'transparent',
                color: viewMode === t.id ? '#fff' : '#58595B',
                boxShadow: viewMode === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Sub-tabs — issue mode only */}
          {viewMode === 'issue' && (
            <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
              {([
                { id: 'below'   as const, label: `Below Threshold (${belowBar.length})` },
                { id: 'passing' as const, label: `Passing (${passing.length})` },
              ]).map(t => (
                <button key={t.id} onClick={() => setSubTab(t.id)} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: subTab === t.id ? 500 : 400,
                  padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: subTab === t.id ? '#fff' : 'transparent',
                  color: subTab === t.id ? '#000' : '#58595B',
                  boxShadow: subTab === t.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                }}>{t.label}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!agentFilter && (
            <DiagnosticFilters rows={withEval} categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter}
              agentFilter={agentFil} onAgentChange={setAgentFil} />
          )}
          {viewMode === 'issue' && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => exportJSONL(exportRows)} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer' }}>
                Export JSONL
              </button>
              <button onClick={() => exportCSV(exportRows)} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer' }}>
                Export CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Ticket level view */}
      {viewMode === 'ticket' && <TicketLevelView rows={withEval} />}

      {/* Issue level table */}
      {viewMode === 'issue' && (subTab === 'below' ? belowBar : passing).length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>
              {subTab === 'below' ? 'Below Threshold' : 'Passing Responses'}
            </p>
            {subTab === 'below' && belowBar.length > 0 && (
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(229,62,62,0.09)', color: '#e53e3e' }}>
                {belowBar.length} below 3.5
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)', gap: 8 }}>
            {colHeaders.map(h => <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>)}
          </div>
          {(subTab === 'below' ? belowBar : passing).slice(0, 50).map(r => <QualityTableRow key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Agent Drilldown ────────────────────────────────────────────────────────────

function AgentDrilldown({ rows, tickets, agentName, onBack }: { rows: EvalRow[]; tickets: TicketRow[]; agentName: string; onBack: () => void }) {
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'evals' | 'accuracy' | 'quality' | 'completeness' | 'wins'>('evals')

  const total      = rows.length
  const correction = rows.filter(r => r.evalVerdict === 'CORRECTION').length
  const enhancement = rows.filter(r => r.evalVerdict === 'ENHANCEMENT').length
  const preference = rows.filter(r => r.evalVerdict === 'PREFERENCE').length
  const avgConf    = total ? Math.round(rows.reduce((s, r) => s + r.evalConfidence, 0) / total) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
          background: 'none', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 8,
          padding: '6px 12px', cursor: 'pointer', transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ← Back
        </button>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: '#000' }}>
          {agentName}
        </h2>
      </div>

      {/* Summary cards */}
      {(() => {
        const ticketsWithData  = tickets.filter(t => t.zdMessageCount !== null)
        const completeTickets  = ticketsWithData.filter(t => t.issueCount >= (t.zdMessageCount ?? 0)).length
        const completenessVal  = ticketsWithData.length ? `${pct(completeTickets, ticketsWithData.length)}%` : '—'
        const completenessColor = ticketsWithData.length === 0 ? '#aaa'
          : pct(completeTickets, ticketsWithData.length) >= 80 ? '#166534'
          : pct(completeTickets, ticketsWithData.length) >= 60 ? '#854d0e'
          : '#e53e3e'

        const ticketsWithRes   = tickets.filter(t => t.zdResolutionMinutes !== null)
        const avgRes           = ticketsWithRes.length
          ? Math.round(ticketsWithRes.reduce((s, t) => s + (t.zdResolutionMinutes ?? 0), 0) / ticketsWithRes.length)
          : null
        const ticketsWithFcr   = tickets.filter(t => t.zdFcr !== null)
        const fcrPct           = ticketsWithFcr.length ? pct(ticketsWithFcr.filter(t => t.zdFcr).length, ticketsWithFcr.length) : null
        const complimentCount  = tickets.filter(t => t.zdPlayerSentiment === 'COMPLIMENT').length

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Row 1: eval metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[
                { label: 'Total evals',    value: total.toString(),             color: '#9B59D0' },
                { label: 'Corrections',    value: `${pct(correction, total)}%`, color: '#e53e3e' },
                { label: 'Enhancements',   value: `${pct(enhancement, total)}%`,color: '#854d0e' },
                { label: 'Preferences',    value: `${pct(preference, total)}%`, color: '#58595B' },
                { label: 'Avg confidence', value: `${avgConf}%`,                color: avgConf >= 80 ? '#166534' : '#854d0e' },
              ].map(k => (
                <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
                </div>
              ))}
            </div>
            {/* Row 2: operations metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { label: 'Logging completeness', value: completenessVal, color: completenessColor, note: ticketsWithData.length ? `${completeTickets}/${ticketsWithData.length} tickets` : 'No ZD data yet' },
                { label: 'Avg resolution time',  value: fmtMinutes(avgRes), color: '#000', note: ticketsWithRes.length ? `${ticketsWithRes.length} resolved tickets` : 'No data yet' },
                { label: 'FCR rate',             value: fcrPct !== null ? `${fcrPct}%` : '—', color: fcrPct === null ? '#aaa' : fcrPct >= 80 ? '#166534' : fcrPct >= 60 ? '#854d0e' : '#e53e3e', note: 'First contact resolution' },
                { label: 'Player compliments',   value: complimentCount > 0 ? `+${complimentCount}` : complimentCount.toString(), color: complimentCount > 0 ? '#166534' : 'rgba(0,0,0,0.25)', note: 'Genuine positive feedback' },
              ].map(k => (
                <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
                  {k.note && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 2 }}>{k.note}</p>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.09)', padding: 3, alignSelf: 'flex-start' }}>
        {([
          { id: 'evals',        label: 'Edit Evals',       count: rows.length },
          { id: 'accuracy',     label: 'Accuracy',         count: rows.filter(r => r.accuracyRanAt).length },
          { id: 'quality',      label: 'Quality',          count: rows.filter(r => r.qualityRanAt).length },
          { id: 'completeness', label: 'Completeness',     count: tickets.length },
          { id: 'wins',         label: 'Wins',             count: tickets.filter(t => t.zdPlayerSentiment === 'COMPLIMENT').length },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13,
            fontWeight: activeTab === t.id ? 500 : 400,
            padding: '6px 14px', borderRadius: 8,
            background: activeTab === t.id ? '#000' : 'transparent',
            color: activeTab === t.id ? '#fff' : '#58595B',
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500,
              padding: '1px 6px', borderRadius: 100,
              background: activeTab === t.id ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.07)',
              color: activeTab === t.id ? '#fff' : '#58595B',
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Edit Evaluations tab */}
      {activeTab === 'evals' && (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Edit Evaluations</p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>Click any row to see full context</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 120px 100px 80px', padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
          {['Ticket', 'Category', 'Verdict', 'Issue type', 'Confidence'].map(h => (
            <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
          ))}
        </div>
        {rows.map((r) => {
          const isExp = expanded === r.id
          return (
            <div key={r.id}>
              <div
                onClick={() => setExpanded(isExp ? null : r.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '100px 1fr 120px 100px 80px',
                  padding: '11px 20px', alignItems: 'center', cursor: 'pointer',
                  borderBottom: '1px solid rgba(0,0,0,0.05)',
                  background: isExp ? 'rgba(206,164,255,0.06)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.06)' : 'transparent' }}
              >
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{r.ticketNumber}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{r.category || '—'}</span>
                <VerdictBadge verdict={r.evalVerdict} small />
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{r.issueType}</span>
                <ConfidencePip value={r.evalConfidence} />
              </div>

              {isExp && (
                <div style={{ padding: '16px 20px 20px', background: 'rgba(206,164,255,0.03)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#9B59D0', marginBottom: 12 }}>
                    {VERDICT_CONFIG[r.evalVerdict].desc}
                    {r.evalReasoning && <span style={{ color: '#58595B', fontWeight: 400 }}> — {r.evalReasoning}</span>}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    {[
                      { label: 'Player message',        value: r.customerInput,      color: '#000' },
                      { label: 'gameLM suggested',      value: r.suggestedResponse,  color: '#58595B' },
                      { label: 'Agent final response',  value: r.finalEdits,         color: '#000' },
                    ].map(box => (
                      <div key={box.label} style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.09)' }}>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{box.label}</p>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: box.color, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{box.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                  {r.reasoning && (
                    <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.03)' }}>
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>
                        <strong style={{ fontWeight: 600 }}>Agent reason: </strong>{r.reasoning}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No evaluated edits in this period</p>
          </div>
        )}
      </div>
      )}

      {/* Response Accuracy tab */}
      {activeTab === 'accuracy' && (
        <ResponseAccuracyView rows={rows} agentFilter={agentName} />
      )}

      {/* Response Quality tab */}
      {activeTab === 'quality' && (
        <ResponseQualityView rows={rows} agentFilter={agentName} />
      )}

      {/* Logging Completeness tab */}
      {activeTab === 'completeness' && tickets.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 40, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No ZD message data yet — run the backfill script to populate.</p>
        </div>
      )}
      {activeTab === 'completeness' && tickets.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Logging Completeness</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>
              Issues logged vs actual player messages in ZD — flags potential under-logging
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 90px 90px 90px 1fr', padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
            {['Ticket', 'Logged', 'ZD msgs', 'Delta', 'Status'].map(h => (
              <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
            ))}
          </div>
          {tickets.map((t, i) => {
            const delta = t.issueCount - (t.zdMessageCount ?? 0)
            // ±1 tolerance: ZD audit consolidation (back-to-back messages) and
            // button-click events can cause a natural ±1 gap. Only flag when ≥2.
            const underLogged = delta < -1
            const overLogged  = delta >  1
            return (
              <div key={t.id} style={{
                display: 'grid', gridTemplateColumns: '100px 90px 90px 90px 1fr',
                padding: '11px 20px', alignItems: 'center',
                borderBottom: i < tickets.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                background: underLogged ? 'rgba(229,62,62,0.03)' : 'transparent',
              }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{t.ticketNumber}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{t.issueCount}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{t.zdMessageCount ?? '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: underLogged ? '#e53e3e' : overLogged ? '#854d0e' : '#166534' }}>
                  {delta > 0 ? `+${delta}` : delta}
                </span>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                  padding: '2px 8px', borderRadius: 100, width: 'fit-content',
                  background: underLogged ? 'rgba(229,62,62,0.09)' : overLogged ? 'rgba(234,179,8,0.12)' : 'rgba(22,101,52,0.09)',
                  color: underLogged ? '#e53e3e' : overLogged ? '#854d0e' : '#166534',
                }}>
                  {underLogged ? 'Under-logged' : overLogged ? 'Over-logged' : 'Exact ✓'}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {/* Agent Wins tab */}
      {activeTab === 'wins' && (() => {
        const wins = tickets.filter(t => t.zdPlayerSentiment === 'COMPLIMENT')
        if (wins.length === 0) {
          return (
            <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 40, textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
                No compliments detected yet — run the ZD backfill to analyse player messages.
              </p>
            </div>
          )
        }
        return (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Agent Wins</p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>
                Tickets where the player left a genuine compliment — classified by AI from the last player message
              </p>
            </div>
            {wins.map((t, i) => (
              <div key={t.id} style={{
                padding: '14px 20px',
                borderBottom: i < wins.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{t.ticketNumber}</span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                    padding: '2px 8px', borderRadius: 100,
                    background: 'rgba(22,101,52,0.09)', color: '#166534',
                  }}>Compliment</span>
                  {t.zdSentimentConfidence !== null && (
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>
                      {t.zdSentimentConfidence}% confidence
                    </span>
                  )}
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto' }}>
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
                {t.zdLastPlayerMessage && (
                  <p style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000',
                    lineHeight: 1.5, fontStyle: 'italic',
                    padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(22,101,52,0.04)',
                    borderLeft: '3px solid rgba(22,101,52,0.3)',
                  }}>
                    "{extractLastPlayerMessage(t.zdLastPlayerMessage ?? '', t.agentName)}"
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

// ── Ticket-level view ──────────────────────────────────────────────────────────

function TicketLevelView({ rows }: { rows: EvalRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // Group rows by ticket
  const tickets = useMemo(() => {
    const map = new Map<string, { ticketNumber: string; issues: EvalRow[] }>()
    for (const r of rows) {
      const key = r.ticketNumber ?? r.id
      if (!map.has(key)) map.set(key, { ticketNumber: r.ticketNumber ?? '—', issues: [] })
      map.get(key)!.issues.push(r)
    }
    // Sort issues within each ticket by date asc
    return [...map.values()].map(t => ({
      ...t,
      issues: [...t.issues].sort((a, b) => (a.accuracyRanAt ?? '').localeCompare(b.accuracyRanAt ?? '')),
    })).sort((a, b) => b.issues.length - a.issues.length)
  }, [rows])

  const scoreColor = (s: number | null) => s === null ? '#aaa' : s >= 4 ? '#166534' : s >= 3.5 ? '#854d0e' : '#e53e3e'

  if (tickets.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 6 }}>No scored tickets yet</p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>Run the backfill to populate ticket-level data.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '12px 16px', display: 'flex', gap: 20 }}>
        <div>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Tickets</p>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: '#9B59D0' }}>{tickets.length}</p>
        </div>
        <div>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Responses scored</p>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: '#000' }}>{rows.length}</p>
        </div>
        <div>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Multi-turn tickets</p>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: '#000' }}>{tickets.filter(t => t.issues.length > 1).length}</p>
        </div>
      </div>

      {tickets.map(ticket => {
        const isExp = expanded === ticket.ticketNumber
        const hasP1 = ticket.issues.some(i => i.accuracyErrorClass === 'P1A' || i.accuracyErrorClass === 'P1B')
        const avgQuality = ticket.issues.filter(i => i.qualityScore !== null).length
          ? parseFloat((ticket.issues.filter(i => i.qualityScore !== null).reduce((s, i) => s + (i.qualityScore ?? 0), 0) / ticket.issues.filter(i => i.qualityScore !== null).length).toFixed(2))
          : null
        const themes = [...new Set(ticket.issues.map(i => i.themeTag).filter(Boolean))]

        return (
          <div key={ticket.ticketNumber} style={{ background: '#fff', borderRadius: 14, border: `1.5px solid ${hasP1 ? 'rgba(229,62,62,0.2)' : 'rgba(0,0,0,0.09)'}`, overflow: 'hidden' }}>
            {/* Ticket header row */}
            <div onClick={() => setExpanded(isExp ? null : ticket.ticketNumber)} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
              cursor: 'pointer', transition: 'background 0.15s',
              background: isExp ? 'rgba(206,164,255,0.04)' : 'transparent',
              borderBottom: isExp ? '1px solid rgba(0,0,0,0.07)' : 'none',
            }}
              onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
              onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.04)' : 'transparent' }}
            >
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500, color: '#9B59D0', minWidth: 80 }}>#{ticket.ticketNumber}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                {ticket.issues.length} response{ticket.issues.length !== 1 ? 's' : ''}
              </span>
              {hasP1 && (
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(229,62,62,0.1)', color: '#e53e3e' }}>P1 flagged</span>
              )}
              {avgQuality !== null && (
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: scoreColor(avgQuality) }}>
                  Avg quality {avgQuality.toFixed(2)}
                </span>
              )}
              {themes.map(t => (
                <span key={t} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 100, background: 'rgba(155,89,208,0.07)', color: '#9B59D0', border: '1px solid rgba(155,89,208,0.15)' }}>{t}</span>
              ))}
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto' }}>
                {isExp ? '▲' : '▼'}
              </span>
            </div>

            {/* Expanded: full conversation thread */}
            {isExp && (
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {ticket.issues.map((issue, idx) => (
                  <div key={issue.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Turn label */}
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      Turn {idx + 1} {issue.agentName && `· ${issue.agentName}`}
                    </p>
                    {/* Player message */}
                    {issue.customerInput && (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', minWidth: 52, paddingTop: 2 }}>Player</span>
                        <div style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.07)' }}>
                          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{issue.customerInput}</p>
                        </div>
                      </div>
                    )}
                    {/* Agent response + scores */}
                    {issue.suggestedResponse && (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#9B59D0', minWidth: 52, paddingTop: 2 }}>Agent</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(155,89,208,0.04)', border: '1px solid rgba(155,89,208,0.12)', marginBottom: 6 }}>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{issue.suggestedResponse}</p>
                          </div>
                          {/* Inline scores */}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            {issue.accuracyErrorClass && (
                              <AccuracyBadge cls={issue.accuracyErrorClass} small />
                            )}
                            {issue.qualityScore !== null && (
                              <QualityScore score={issue.qualityScore} small />
                            )}
                            {issue.qualityFlag && (
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: 'rgba(229,62,62,0.09)', color: '#e53e3e' }}>Flagged</span>
                            )}
                            {issue.themeTag && (
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, padding: '2px 7px', borderRadius: 100, background: 'rgba(155,89,208,0.07)', color: '#9B59D0', border: '1px solid rgba(155,89,208,0.15)' }}>{issue.themeTag}</span>
                            )}
                            {issue.accuracyEvidence && issue.accuracyEvidence !== 'None' && (
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#e53e3e' }}>
                                Flagged: "{issue.accuracyEvidence}"
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {idx < ticket.issues.length - 1 && (
                      <div style={{ borderBottom: '1px dashed rgba(0,0,0,0.07)', marginTop: 2 }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function ReportCard() {
  const { user }                     = useAuth()
  const { selectedOperator: operator } = useOperator()

  const [allRows, setAllRows]             = useState<EvalRow[]>([])
  const [allScoredRows, setAllScoredRows] = useState<EvalRow[]>([])
  const [ticketRows, setTicketRows]       = useState<TicketRow[]>([])
  const [loading, setLoading]             = useState(true)
  const [range, setRange]                 = useState<TimeRange>('last30')
  const [selected, setSelected]           = useState<string | null>(null)
  const [showWins, setShowWins]           = useState(false)
  const [topTab, setTopTab]               = useState<TopTab>('evals')

  // Update local state when a review action is saved
  const handleReviewUpdate = (id: string, status: 'confirmed' | 'dismissed', notes: string) => {
    setAllScoredRows(prev => prev.map(r => r.id === id
      ? { ...r, reviewStatus: status, reviewNotes: notes, reviewedBy: user?.email ?? null, reviewedAt: new Date().toISOString() }
      : r
    ))
  }

  useEffect(() => {
    Promise.all([fetchAllEvals(), fetchTicketCompleteness(), fetchAllScoredIssues()]).then(([evals, tickets, scored]) => {
      setAllRows(evals)
      setTicketRows(tickets)
      setAllScoredRows(scored)
      setLoading(false)
    })
  }, [])

  const rows        = useMemo(() => filterByRange(allRows, range), [allRows, range])
  const scoredRows  = useMemo(() => filterByRange(allScoredRows, range), [allScoredRows, range])

  // Per-agent summary
  const agentSummaries = useMemo(() => {
    const map = new Map<string, { name: string; email: string; rows: EvalRow[] }>()
    for (const r of rows) {
      if (!map.has(r.agentName)) map.set(r.agentName, { name: r.agentName, email: r.agentEmail, rows: [] })
      map.get(r.agentName)!.rows.push(r)
    }
    return [...map.values()].map(a => {
      const total      = a.rows.length
      const correction = a.rows.filter(r => r.evalVerdict === 'CORRECTION').length
      const enhancement = a.rows.filter(r => r.evalVerdict === 'ENHANCEMENT').length
      const preference = a.rows.filter(r => r.evalVerdict === 'PREFERENCE').length
      const avgConf    = total ? Math.round(a.rows.reduce((s, r) => s + r.evalConfidence, 0) / total) : 0
      return {
        ...a,
        total, correction, enhancement, preference, avgConf,
        correctionPct:  pct(correction, total),
        enhancementPct: pct(enhancement, total),
        preferencePct:  pct(preference, total),
      }
    }).sort((a, b) => b.total - a.total)
  }, [rows])

  // Team-level summary
  const teamTotal       = rows.length
  const teamCorrection  = rows.filter(r => r.evalVerdict === 'CORRECTION').length
  const teamEnhancement = rows.filter(r => r.evalVerdict === 'ENHANCEMENT').length
  const teamPreference  = rows.filter(r => r.evalVerdict === 'PREFERENCE').length

  // "Added today" — always counted from all evals regardless of time range filter
  const todayStr   = new Date().toISOString().slice(0, 10)
  const addedToday = allRows.filter(r => (r.evalRanAt ?? '').slice(0, 10) === todayStr).length

  // Ticket-level ops metrics — filtered by selected time range
  const filteredTickets = useMemo(() => {
    if (range === 'allTime') return ticketRows
    const c = new Date(); c.setDate(c.getDate() - rangeDays(range))
    return ticketRows.filter(t => new Date(t.createdAt) >= c)
  }, [ticketRows, range])

  const ticketsWithRes  = filteredTickets.filter(t => t.zdResolutionMinutes !== null)
  const avgResolutionMins = ticketsWithRes.length
    ? Math.round(ticketsWithRes.reduce((s, t) => s + (t.zdResolutionMinutes ?? 0), 0) / ticketsWithRes.length)
    : null
  const ticketsWithFcr  = filteredTickets.filter(t => t.zdFcr !== null)
  const teamFcrPct      = ticketsWithFcr.length
    ? pct(ticketsWithFcr.filter(t => t.zdFcr).length, ticketsWithFcr.length)
    : null
  const teamCompliments = filteredTickets.filter(t => t.zdPlayerSentiment === 'COMPLIMENT').length

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600 }}>Report Card</h1>
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading evaluations…</p>
        </div>
      </div>
    )
  }

  // Drilldown view
  if (selected) {
    const agentRows    = rows.filter(r => r.agentName === selected)
    const agentTickets = filteredTickets.filter(t => t.agentName === selected)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600 }}>Report Card</h1>
          <TimeRangeFilter value={range} onChange={setRange} />
        </div>
        <AgentDrilldown rows={agentRows} tickets={agentTickets} agentName={selected} onBack={() => setSelected(null)} />
      </div>
    )
  }

  // Team Wins view
  if (showWins) {
    const wins = filteredTickets
      .filter(t => t.zdPlayerSentiment === 'COMPLIMENT')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowWins(false)} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
              background: 'none', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 8,
              padding: '6px 12px', cursor: 'pointer', transition: 'all 0.15s',
            }}>
              ← Back
            </button>
            <div>
              <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Player Compliments</h1>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
                {wins.length} genuine compliment{wins.length !== 1 ? 's' : ''} across the team in this period
              </p>
            </div>
          </div>
          <TimeRangeFilter value={range} onChange={setRange} />
        </div>

        {wins.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 60, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
              No compliments detected in this period. Run the ZD backfill to analyse player messages.
            </p>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
            {wins.map((t, i) => (
              <div key={t.id} style={{
                padding: '16px 20px',
                borderBottom: i < wins.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{t.ticketNumber}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{t.agentName}</span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                    padding: '2px 8px', borderRadius: 100,
                    background: 'rgba(22,101,52,0.09)', color: '#166534',
                  }}>Compliment</span>
                  {t.zdSentimentConfidence !== null && (
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>
                      {t.zdSentimentConfidence}% confidence
                    </span>
                  )}
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto' }}>
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                  </span>
                </div>
                {t.zdLastPlayerMessage && (
                  <p style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000',
                    lineHeight: 1.55, fontStyle: 'italic',
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(22,101,52,0.04)',
                    borderLeft: '3px solid rgba(22,101,52,0.25)',
                    margin: 0,
                  }}>
                    "{extractLastPlayerMessage(t.zdLastPlayerMessage ?? '', t.agentName)}"
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Team overview
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Report Card</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
            AI evaluation of agent performance{operator?.name ? ` · ${operator.name}` : ''} — click an agent to drill down
          </p>
        </div>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* Top-level tab switcher */}
      <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: 3, alignSelf: 'flex-start' }}>
        {([
          { id: 'evals'    as TopTab, label: 'Edit Evaluations' },
          { id: 'accuracy' as TopTab, label: 'Response Accuracy' },
          { id: 'quality'  as TopTab, label: 'Response Quality'  },
          { id: 'tickets'  as TopTab, label: 'Ticket View'        },
        ]).map(t => (
          <button key={t.id} onClick={() => setTopTab(t.id)} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13,
            fontWeight: topTab === t.id ? 500 : 400,
            padding: '7px 16px', borderRadius: 9,
            background: topTab === t.id ? '#000' : 'transparent',
            color: topTab === t.id ? '#fff' : '#58595B',
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Response Accuracy tab ── */}
      {topTab === 'accuracy' && <ResponseAccuracyView rows={scoredRows} onReviewUpdate={handleReviewUpdate} />}

      {/* ── Response Quality tab ── */}
      {topTab === 'quality' && <ResponseQualityView rows={scoredRows} />}

      {/* ── Ticket View tab ── */}
      {topTab === 'tickets' && <TicketLevelView rows={scoredRows} />}

      {/* ── Edit Evaluations tab ── */}
      {topTab === 'evals' && <>

      {/* Team summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {/* Evals run — split card with "added today" secondary metric */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Evals run</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            {/* Primary: total */}
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#9B59D0', lineHeight: 1 }}>{teamTotal}</p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>in period</p>
            </div>
            {/* Divider */}
            <div style={{ width: 1, height: 36, background: 'rgba(0,0,0,0.08)', margin: '0 14px', flexShrink: 0 }} />
            {/* Secondary: today */}
            <div style={{ flexShrink: 0 }}>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: addedToday > 0 ? '#9B59D0' : 'rgba(0,0,0,0.2)', lineHeight: 1 }}>
                {addedToday > 0 ? `+${addedToday}` : '—'}
              </p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>today</p>
            </div>
          </div>
        </div>

        {[
          { label: 'Corrections',  value: `${pct(teamCorrection, teamTotal)}%`,  color: '#e53e3e', note: 'gameLM had an error' },
          { label: 'Enhancements', value: `${pct(teamEnhancement, teamTotal)}%`, color: '#854d0e', note: 'Agent added value' },
          { label: 'Preferences',  value: `${pct(teamPreference, teamTotal)}%`,  color: '#58595B', note: 'Stylistic only' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: k.color }}>{k.value}</p>
            {k.note && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 3 }}>{k.note}</p>}
          </div>
        ))}
      </div>

      {/* Operations KPIs row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          {
            label: 'Avg resolution time',
            value: fmtMinutes(avgResolutionMins),
            color: '#000',
            note: ticketsWithRes.length ? `across ${ticketsWithRes.length} resolved tickets` : 'Run ZD backfill to populate',
          },
          {
            label: 'FCR rate',
            value: teamFcrPct !== null ? `${teamFcrPct}%` : '—',
            color: teamFcrPct === null ? '#aaa' : teamFcrPct >= 80 ? '#166534' : teamFcrPct >= 60 ? '#854d0e' : '#e53e3e',
            note: 'First contact resolution — no reopens',
          },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: k.color }}>{k.value}</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 3 }}>{k.note}</p>
          </div>
        ))}

        {/* Player compliments — clickable card */}
        <div
          onClick={() => teamCompliments > 0 && setShowWins(true)}
          style={{
            background: '#fff', borderRadius: 14, padding: '16px 18px',
            border: teamCompliments > 0 ? '1.5px solid rgba(22,101,52,0.25)' : '1.5px solid rgba(0,0,0,0.09)',
            cursor: teamCompliments > 0 ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (teamCompliments > 0) e.currentTarget.style.background = 'rgba(22,101,52,0.03)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
        >
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Player compliments</p>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: teamCompliments > 0 ? '#166534' : 'rgba(0,0,0,0.25)' }}>
            {teamCompliments > 0 ? `+${teamCompliments}` : '—'}
          </p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: teamCompliments > 0 ? '#166534' : 'rgba(0,0,0,0.3)', marginTop: 3 }}>
            {teamCompliments > 0 ? 'Click to view all →' : 'Genuine positive feedback detected'}
          </p>
        </div>
      </div>

      {/* Per-agent table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Agent Breakdown</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 110px 120px 110px 100px', padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
          {['Agent', 'Evals', 'Corrections', 'Enhancements', 'Preferences', 'Avg confidence'].map(h => (
            <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
          ))}
        </div>
        {agentSummaries.map((a, i) => (
          <div
            key={a.name}
            onClick={() => setSelected(a.name)}
            style={{
              display: 'grid', gridTemplateColumns: '1.5fr 80px 110px 120px 110px 100px',
              padding: '13px 20px', alignItems: 'center', cursor: 'pointer',
              borderBottom: i < agentSummaries.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{a.name}</p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 1 }}>{a.email}</p>
            </div>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{a.total}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, maxWidth: 48, height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                <div style={{ width: `${a.correctionPct}%`, height: '100%', borderRadius: 100, background: '#e53e3e' }} />
              </div>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e', fontWeight: 500 }}>{a.correctionPct}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, maxWidth: 48, height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                <div style={{ width: `${a.enhancementPct}%`, height: '100%', borderRadius: 100, background: '#854d0e' }} />
              </div>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#854d0e' }}>{a.enhancementPct}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, maxWidth: 48, height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                <div style={{ width: `${a.preferencePct}%`, height: '100%', borderRadius: 100, background: 'rgba(0,0,0,0.25)' }} />
              </div>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{a.preferencePct}%</span>
            </div>
            <ConfidencePip value={a.avgConf} />
          </div>
        ))}
        {agentSummaries.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
              No evaluations found for this period. Run the backfill script to populate.
            </p>
          </div>
        )}
      </div>
      <div style={{ height: 8 }} />

      </> /* end topTab === 'evals' */}
    </div>
  )
}
