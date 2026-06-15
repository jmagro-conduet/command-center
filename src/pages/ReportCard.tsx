import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

type TimeRange    = 'last7' | 'last14' | 'last30' | 'allTime'
type Verdict      = 'CORRECTION' | 'ENHANCEMENT' | 'PREFERENCE'
type TopTab       = 'dashboard' | 'evals' | 'accuracy' | 'quality'
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
  themeDetail:          string | null
  reviewStatus:         'pending' | 'confirmed' | 'dismissed' | null
  reviewNotes:          string | null
  reviewCorrectVerdict: string | null
  reviewContext:        string | null
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

// Returns an ISO date string covering 2× the range so the prior period is included.
function sinceDate(range: TimeRange): string | null {
  if (range === 'allTime') return null
  const d = new Date()
  d.setDate(d.getDate() - rangeDays(range) * 2)
  return d.toISOString()
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

// Trend indicator — shows ↑/↓ delta vs prior period
// isPositiveGood: true  = up is green (FCR, compliments, evals)
//                 false = up is red  (corrections, resolution time)
function TrendPip({ curr, prev, isPositiveGood = true, fmt }: {
  curr: number
  prev: number | null
  isPositiveGood?: boolean
  fmt: (delta: number) => string
}) {
  if (prev === null || (curr === 0 && prev === 0)) return null
  const delta = curr - prev
  if (delta === 0) return (
    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.28)', marginTop: 2, display: 'block' }}>
      — same as prior period
    </span>
  )
  const up   = delta > 0
  const good = isPositiveGood ? up : !up
  const color = good ? '#166534' : '#e53e3e'
  const bg    = good ? 'rgba(22,101,52,0.08)' : 'rgba(229,62,62,0.08)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600,
      padding: '2px 7px', borderRadius: 100, marginTop: 3,
      background: bg, color,
    }}>
      {up ? '↑' : '↓'} {fmt(Math.abs(delta))} vs prior
    </span>
  )
}

async function fetchTicketCompleteness(operatorId: string | null, since: string | null): Promise<TicketRow[]> {
  const PAGE = 1000
  const allTickets: any[] = []
  let from = 0
  while (true) {
    let q = supabase
      .from('tickets')
      .select('id,ticket_number,agent_name,agent_email,zd_message_count,zd_resolution_minutes,zd_fcr,zd_last_player_message,zd_player_sentiment,zd_sentiment_confidence,created_at')
      .not('zd_message_count', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (operatorId) q = q.eq('operator_id', operatorId)
    if (since)      q = q.gte('created_at', since)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    allTickets.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  if (allTickets.length === 0) return []
  const ids = allTickets.map((t: any) => t.id)
  const issueCounts = new Map<string, number>()

  // Single RPC call replaces the N/200 serial chunk loop
  const { data: counts } = await supabase.rpc('get_ticket_issue_counts', { p_ticket_ids: ids })
  counts?.forEach((r: any) => issueCounts.set(r.ticket_id, Number(r.cnt)))

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

async function fetchAllEvals(operatorId: string | null, since: string | null): Promise<EvalRow[]> {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    let q = supabase
      .from('ticket_issues')
      .select('id,issue_type,eval_verdict,eval_confidence,eval_reasoning,eval_ran_at,customer_input,suggested_response,final_edits,reasoning,logged_at,created_at,accuracy_error_class,accuracy_evidence,accuracy_reasoning,accuracy_human_review,accuracy_ran_at,quality_intent,quality_resolution,quality_info_gathering,quality_clarity,quality_brand,quality_score,quality_flag,quality_flag_reason,quality_ran_at,theme_tag,theme_detail,review_status,review_notes,review_correct_verdict,review_context,reviewed_by,reviewed_at,tickets!inner(ticket_number,agent_name,agent_email,ticket_category,created_at)')
      .not('eval_verdict', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (operatorId) q = q.eq('operator_id', operatorId)
    if (since)      q = q.gte('created_at', since)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all.map(mapEvalRow)
}

// Fetches all issues that have been scored by eval-accuracy or eval-quality,
// regardless of whether eval_verdict (edit eval) has been run.
async function fetchAllScoredIssues(operatorId: string | null, since: string | null): Promise<EvalRow[]> {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    let q = supabase
      .from('ticket_issues')
      .select('id,issue_type,eval_verdict,eval_confidence,eval_reasoning,eval_ran_at,customer_input,suggested_response,final_edits,reasoning,logged_at,created_at,accuracy_error_class,accuracy_evidence,accuracy_reasoning,accuracy_human_review,accuracy_ran_at,quality_intent,quality_resolution,quality_info_gathering,quality_clarity,quality_brand,quality_score,quality_flag,quality_flag_reason,quality_ran_at,theme_tag,theme_detail,review_status,review_notes,review_correct_verdict,review_context,reviewed_by,reviewed_at,tickets!inner(ticket_number,agent_name,agent_email,ticket_category,created_at)')
      .or('accuracy_ran_at.not.is.null,quality_ran_at.not.is.null')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (operatorId) q = q.eq('operator_id', operatorId)
    if (since)      q = q.gte('created_at', since)
    const { data, error } = await q
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
    themeDetail:          r.theme_detail           ?? null,
    reviewStatus:         r.review_status           ?? null,
    reviewNotes:          r.review_notes            ?? null,
    reviewCorrectVerdict: r.review_correct_verdict  ?? null,
    reviewContext:        r.review_context          ?? null,
    reviewedBy:           r.reviewed_by             ?? null,
    reviewedAt:           r.reviewed_at             ?? null,
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
    human_verdict:    r.reviewStatus,
    correct_verdict:  r.reviewCorrectVerdict,
    override_context: r.reviewContext,
    theme:            r.themeTag,
    notes:            r.reviewNotes,
    ticket:           r.ticketNumber,
    agent:            r.agentName,
    category:         r.category,
  }))
  downloadBlob(lines.join('\n'), filename, 'application/x-jsonlines')
}

function exportCSV(rows: EvalRow[], filename = 'qa_export.csv') {
  const q = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`
  const header = 'ticket_number,agent,category,theme,player_message,suggested_response,accuracy_class,quality_score,review_status,correct_verdict,override_context,notes'
  const body   = rows.map(r => [
    r.ticketNumber, r.agentName, r.category, r.themeTag ?? '',
    q(r.customerInput), q(r.suggestedResponse),
    r.accuracyErrorClass ?? '', r.qualityScore?.toFixed(2) ?? '',
    r.reviewStatus ?? '', r.reviewCorrectVerdict ?? '', q(r.reviewContext), q(r.reviewNotes),
  ].join(','))
  downloadBlob([header, ...body].join('\n'), filename, 'text/csv')
}

function exportEditEvalJSONL(rows: EvalRow[], filename = 'edit_eval_qa.jsonl') {
  const esc = (s: string | null | undefined) => (s ?? '').replace(/"/g, '\\"')
  const lines = rows.filter(r => r.evalVerdict).map(r => JSON.stringify({
    messages: [
      {
        role: 'user',
        content:
          `Player: "${esc(r.customerInput)}"\n\n` +
          `gameLM suggested: "${esc(r.suggestedResponse)}"\n\n` +
          `Agent final: "${esc(r.finalEdits)}"\n\n` +
          `Agent reason: "${esc(r.reasoning)}"`,
      },
      {
        role: 'assistant',
        content: `VERDICT: ${r.evalVerdict}\nCONFIDENCE: ${r.evalConfidence}\nREASONING: ${r.evalReasoning ?? ''}`,
      },
    ],
    claude_verdict:   r.evalVerdict,
    human_review:     r.reviewStatus,
    correct_verdict:  r.reviewCorrectVerdict,
    override_context: r.reviewContext,
    notes:            r.reviewNotes,
    ticket:           r.ticketNumber,
    agent:            r.agentName,
    category:         r.category,
    issue_type:       r.issueType,
  }))
  downloadBlob(lines.join('\n'), filename, 'application/x-jsonlines')
}

function exportEditEvalCSV(rows: EvalRow[], filename = 'edit_eval_qa.csv') {
  const q = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`
  const header = 'ticket_number,agent,category,issue_type,claude_verdict,confidence,eval_reasoning,review_status,correct_verdict,override_context,review_notes,player_message,suggested_response,final_edits,agent_reason'
  const body = rows.filter(r => r.evalVerdict).map(r => [
    r.ticketNumber, q(r.agentName), q(r.category), q(r.issueType),
    r.evalVerdict ?? '', r.evalConfidence,
    q(r.evalReasoning), r.reviewStatus ?? '',
    r.reviewCorrectVerdict ?? '', q(r.reviewContext), q(r.reviewNotes),
    q(r.customerInput), q(r.suggestedResponse), q(r.finalEdits), q(r.reasoning),
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
  const [view,      setView]      = useState<'categories' | 'context'>('categories')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const tagged = rows.filter(r => r.themeTag)
  if (tagged.length === 0) return null

  // ── Categories view ───────────────────────────────────────────────────────
  const catCounts = tagged.reduce((acc, r) => {
    acc[r.themeTag!] = (acc[r.themeTag!] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const catSorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
  const catMax    = catSorted[0]?.[1] ?? 1

  // ── Context Themes view ───────────────────────────────────────────────────
  // Group themeDetail values within each category
  const contextMap = new Map<string, Map<string, number>>()
  for (const r of tagged) {
    if (!contextMap.has(r.themeTag!)) contextMap.set(r.themeTag!, new Map())
    if (r.themeDetail) {
      const m = contextMap.get(r.themeTag!)!
      m.set(r.themeDetail, (m.get(r.themeDetail) ?? 0) + 1)
    }
  }
  const contextGroups = catSorted.map(([cat, total]) => ({
    cat,
    total,
    details: [...(contextMap.get(cat) ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  }))
  const hasDetails     = tagged.some(r => r.themeDetail)
  const withDetails    = contextGroups.filter(g => g.details.length > 0)
  const pendingCount   = contextGroups.filter(g => g.details.length === 0).length

  const toggleCollapse = (cat: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n })

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 20px' }}>
      {/* Header + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>
          {view === 'categories' ? 'Conversation Themes' : 'Context Themes'}
        </p>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
          {([
            { id: 'categories' as const, label: 'Categories' },
            { id: 'context'    as const, label: 'Context'    },
          ]).map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: view === t.id ? 500 : 400,
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: view === t.id ? '#000' : 'transparent',
              color:      view === t.id ? '#fff' : '#58595B',
              boxShadow:  view === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Categories view ─────────────────────────────────────────────────── */}
      {view === 'categories' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {catSorted.map(([theme, count]) => (
            <div key={theme} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', width: 170, flexShrink: 0 }}>{theme}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                <div style={{ width: `${(count / catMax) * 100}%`, height: '100%', borderRadius: 100, background: '#9B59D0', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', width: 20, textAlign: 'right', flexShrink: 0 }}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Context Themes view ─────────────────────────────────────────────── */}
      {view === 'context' && !hasDetails && (
        <div style={{ padding: '28px 0', textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)', marginBottom: 4 }}>
            Context themes populate as new issues are scored
          </p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.22)' }}>
            Run a backfill to generate themes for existing issues
          </p>
        </div>
      )}

      {view === 'context' && hasDetails && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {withDetails.map(group => {
            const isOpen   = !collapsed.has(group.cat)
            const detailMax = group.details[0]?.[1] ?? 1
            return (
              <div key={group.cat} style={{ borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                {/* Category header row */}
                <button
                  onClick={() => toggleCollapse(group.cat)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 14px', background: isOpen ? 'rgba(155,89,208,0.04)' : 'rgba(0,0,0,0.015)',
                    border: 'none', cursor: 'pointer', transition: 'background 0.15s', textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#000' }}>{group.cat}</span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 100, background: 'rgba(155,89,208,0.1)', color: '#9B59D0' }}>{group.total}</span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)' }}>{group.details.length} situation{group.details.length !== 1 ? 's' : ''}</span>
                  </div>
                  <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.3)', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▼</span>
                </button>

                {/* Sub-theme bars */}
                {isOpen && (
                  <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    {group.details.map(([detail, count]) => (
                      <div key={detail} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', flex: 1, minWidth: 0, lineHeight: 1.3 }}>{detail}</span>
                        <div style={{ width: 72, height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)', flexShrink: 0 }}>
                          <div style={{ width: `${(count / detailMax) * 100}%`, height: '100%', borderRadius: 100, background: '#CEA4FF', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 600, color: '#000', width: 18, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {pendingCount > 0 && (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.28)', textAlign: 'center', marginTop: 4 }}>
              +{pendingCount} categor{pendingCount > 1 ? 'ies' : 'y'} awaiting backfill
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface ReviewUpdate {
  status:         'confirmed' | 'dismissed'
  notes:          string
  correctVerdict: string | null
  context:        string | null
}

function ReviewActions({
  row, onUpdate,
  confirmLabel = 'Confirm', dismissLabel = 'Override',
  verdictOptions,
}: {
  row: EvalRow
  onUpdate?: (id: string, update: ReviewUpdate) => void
  confirmLabel?: string
  dismissLabel?: string
  verdictOptions?: string[]
}) {
  const [notes,           setNotes]           = useState(row.reviewNotes         ?? '')
  const [correctVerdict,  setCorrectVerdict]  = useState(row.reviewCorrectVerdict ?? '')
  const [context,         setContext]         = useState(row.reviewContext        ?? '')
  const [status,          setStatus]          = useState<'pending' | 'confirmed' | 'dismissed'>(
    (row.reviewStatus as 'pending' | 'confirmed' | 'dismissed') ?? 'pending'
  )
  const [showOverride, setShowOverride] = useState(row.reviewStatus === 'dismissed')
  const [saving,       setSaving]       = useState(false)
  // App auth lives on authClient (AuthContext), not supabase.auth — so use the
  // AuthContext user for reviewer attribution. supabase.auth.getUser() is null here.
  const { user } = useAuth()

  async function saveConfirm() {
    setSaving(true)
    await supabase.from('ticket_issues').update({
      review_status:          'confirmed',
      review_notes:           notes || null,
      review_correct_verdict: null,
      review_context:         null,
      reviewed_by:            user?.email ?? null,
      reviewed_at:            new Date().toISOString(),
    }).eq('id', row.id)
    setStatus('confirmed')
    setShowOverride(false)
    onUpdate?.(row.id, { status: 'confirmed', notes, correctVerdict: null, context: null })
    setSaving(false)
  }

  async function saveOverride() {
    setSaving(true)
    await supabase.from('ticket_issues').update({
      review_status:          'dismissed',
      review_notes:           notes || null,
      review_correct_verdict: correctVerdict || null,
      review_context:         context || null,
      reviewed_by:            user?.email ?? null,
      reviewed_at:            new Date().toISOString(),
    }).eq('id', row.id)
    setStatus('dismissed')
    onUpdate?.(row.id, { status: 'dismissed', notes, correctVerdict: correctVerdict || null, context: context || null })
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 12,
    padding: '8px 10px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)',
    resize: 'vertical' as const, boxSizing: 'border-box', outline: 'none',
  }

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.07)' }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        QA Review — adds to training dataset
      </p>

      {/* General QA notes — always visible */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="General QA observations (optional)…"
        rows={2}
        style={{ ...inputStyle, marginBottom: 8 }}
      />

      {/* Override expanded section */}
      {showOverride && (
        <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, border: '1.5px solid rgba(229,62,62,0.2)', background: 'rgba(229,62,62,0.03)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {verdictOptions && verdictOptions.length > 0 && (
            <div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', marginBottom: 4 }}>
                Correct verdict
              </p>
              <select
                value={correctVerdict}
                onChange={e => setCorrectVerdict(e.target.value)}
                style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', outline: 'none', cursor: 'pointer', width: '100%' }}
              >
                <option value="">— select correct verdict —</option>
                {verdictOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}
          <div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', marginBottom: 4 }}>
              Override context <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>— edge case or missing nuance</span>
            </p>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Explain why the LLM verdict is wrong — edge case, missing context, player history, etc."
              rows={3}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Confirm path */}
        {!showOverride && (
          <button onClick={saveConfirm} disabled={saving} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
            padding: '6px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
            background: status === 'confirmed' ? '#166534' : '#000', color: '#fff',
            opacity: saving ? 0.6 : 1, transition: 'all 0.15s', border: 'none',
          }}>
            {status === 'confirmed' ? `✓ ${confirmLabel}ed` : confirmLabel}
          </button>
        )}

        {/* Override path */}
        {!showOverride ? (
          <button onClick={() => setShowOverride(true)} disabled={saving} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
            padding: '6px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
            background: 'transparent', color: '#58595B',
            border: '1.5px solid rgba(0,0,0,0.12)',
            opacity: saving ? 0.6 : 1, transition: 'all 0.15s',
          }}>
            {status === 'dismissed' ? `✕ Edit Override` : dismissLabel}
          </button>
        ) : (
          <>
            <button onClick={saveOverride} disabled={saving} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
              padding: '6px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
              background: '#e53e3e', color: '#fff',
              opacity: saving ? 0.6 : 1, transition: 'all 0.15s', border: 'none',
            }}>
              {status === 'dismissed' ? '✓ Update Override' : 'Save Override'}
            </button>
            <button onClick={saveConfirm} disabled={saving} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
              padding: '6px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
              background: 'transparent', color: '#58595B',
              border: '1.5px solid rgba(0,0,0,0.12)',
              opacity: saving ? 0.6 : 1, transition: 'all 0.15s',
            }}>
              {confirmLabel} instead
            </button>
            {status !== 'dismissed' && (
              <button onClick={() => setShowOverride(false)} disabled={saving} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)',
                background: 'none', border: 'none', cursor: 'pointer', padding: '6px 4px',
              }}>
                Cancel
              </button>
            )}
          </>
        )}

        {(status === 'confirmed' || status === 'dismissed') && !saving && (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
            Saved · use Export to download training data
          </span>
        )}
      </div>
    </div>
  )
}

// ── Verdict Theme Modal ──────────────────────────────────────────────────────

const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string; desc: string }> = {
  CORRECTION:   { label: 'Corrections',  color: '#e53e3e', bg: 'rgba(229,62,62,0.06)',    desc: 'Cases where the agent identified an error in the gameLM response' },
  ENHANCEMENT:  { label: 'Enhancements', color: '#854d0e', bg: 'rgba(133,77,14,0.06)',    desc: 'Cases where the agent meaningfully improved or expanded the response' },
  PREFERENCE:   { label: 'Preferences',  color: '#58595B', bg: 'rgba(88,89,91,0.06)',     desc: 'Stylistic changes — the original response was also acceptable' },
}

function VerdictThemeModal({ verdict, rows, onClose }: {
  verdict: Verdict
  rows: EvalRow[]
  onClose: () => void
}) {
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null)
  const [view,          setView]          = useState<'categories' | 'context'>('categories')
  const meta = VERDICT_META[verdict]

  const filtered = rows.filter(r => r.evalVerdict === verdict)

  // Build category → items map
  const themeMap = new Map<string, EvalRow[]>()
  for (const r of filtered) {
    const key = r.themeTag ?? 'Uncategorized'
    if (!themeMap.has(key)) themeMap.set(key, [])
    themeMap.get(key)!.push(r)
  }
  const themes = [...themeMap.entries()]
    .map(([theme, items]) => ({ theme, count: items.length, items }))
    .sort((a, b) => b.count - a.count)

  // Build context sub-themes: category → themeDetail frequency
  const contextMap = new Map<string, Map<string, number>>()
  for (const r of filtered) {
    const cat = r.themeTag ?? 'Uncategorized'
    if (!contextMap.has(cat)) contextMap.set(cat, new Map())
    if (r.themeDetail) {
      const m = contextMap.get(cat)!
      m.set(r.themeDetail, (m.get(r.themeDetail) ?? 0) + 1)
    }
  }
  const contextGroups = themes
    .filter(t => t.theme !== 'Uncategorized')
    .map(({ theme, count }) => ({
      theme,
      total: count,
      details: [...(contextMap.get(theme) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
    }))
  const hasDetails   = filtered.some(r => r.themeDetail)
  const pendingCount = contextGroups.filter(g => g.details.length === 0).length

  const maxCount = themes[0]?.count ?? 1
  const themed   = filtered.filter(r => r.themeTag).length
  const unthemed = filtered.length - themed

  // Reset expanded state when switching views
  useEffect(() => { setExpandedTheme(null) }, [view])

  // Keyboard close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 20,
          border: '1.5px solid rgba(0,0,0,0.09)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
          width: '100%', maxWidth: 620,
          maxHeight: '80vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(0,0,0,0.07)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                  padding: '3px 10px', borderRadius: 100,
                  background: meta.bg, color: meta.color,
                }}>
                  {meta.label}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                  {filtered.length} response{filtered.length !== 1 ? 's' : ''} in period
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', marginBottom: 4 }}>
                    {view === 'categories' ? 'Theme Breakdown' : 'Context Themes'}
                  </h2>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
                    {view === 'categories' ? meta.desc : 'Specific situations driving each category — expand to see sub-themes'}
                  </p>
                </div>
                {/* Categories / Context toggle */}
                <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2, flexShrink: 0 }}>
                  {([
                    { id: 'categories' as const, label: 'Categories' },
                    { id: 'context'    as const, label: 'Context'    },
                  ]).map(t => (
                    <button key={t.id} onClick={() => setView(t.id)} style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: view === t.id ? 500 : 400,
                      padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      background: view === t.id ? '#000' : 'transparent',
                      color:      view === t.id ? '#fff' : '#58595B',
                      boxShadow:  view === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 18, lineHeight: 1,
                color: 'rgba(0,0,0,0.3)', background: 'none', border: 'none',
                cursor: 'pointer', padding: '2px 6px', borderRadius: 6,
                transition: 'all 0.15s', flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#000')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(0,0,0,0.3)')}
            >×</button>
          </div>
          {unthemed > 0 && themed > 0 && (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 8 }}>
              {themed} of {filtered.length} responses have theme data · {unthemed} not yet scored
            </p>
          )}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>

          {/* ── Categories view ─────────────────────────────────────────────── */}
          {view === 'categories' && (
            <>
              {themes.length === 0 && (
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)', textAlign: 'center', padding: '24px 0' }}>
                  No theme data yet — run the quality backfill to populate themes.
                </p>
              )}
              {themes.map(({ theme, count, items }) => {
                const barWidth = Math.round((count / maxCount) * 100)
                const isExp    = expandedTheme === theme
                const isUncat  = theme === 'Uncategorized'
                return (
                  <div key={theme}>
                    <div
                      onClick={() => setExpandedTheme(isExp ? null : theme)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        background: isExp ? meta.bg : 'transparent', transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = isExp ? meta.bg : 'transparent' }}
                    >
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: isUncat ? 'rgba(0,0,0,0.3)' : '#000', minWidth: 160, flexShrink: 0 }}>
                        {isUncat ? 'Not yet themed' : theme}
                      </span>
                      <div style={{ flex: 1, height: 6, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                        <div style={{ width: `${barWidth}%`, height: '100%', borderRadius: 100, background: isUncat ? 'rgba(0,0,0,0.15)' : meta.color, opacity: isUncat ? 0.4 : 1, transition: 'width 0.4s ease' }} />
                      </div>
                      <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: isUncat ? 'rgba(0,0,0,0.25)' : meta.color, minWidth: 28, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                      {!isUncat && <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.25)', flexShrink: 0, transition: 'transform 0.15s', transform: isExp ? 'rotate(180deg)' : 'none' }}>▼</span>}
                    </div>
                    {isExp && !isUncat && (
                      <div style={{ marginLeft: 12, marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {items.slice(0, 4).map(r => (
                          <div key={r.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.07)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9B59D0', fontWeight: 500 }}>#{r.ticketNumber}</span>
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>{r.agentName}</span>
                              {r.evalVerdict && (
                                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 100, background: meta.bg, color: meta.color }}>{r.evalVerdict}</span>
                              )}
                            </div>
                            {r.customerInput && (
                              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5, marginBottom: 4, fontStyle: 'italic' }}>
                                "{r.customerInput.length > 120 ? r.customerInput.slice(0, 120) + '…' : r.customerInput}"
                              </p>
                            )}
                            {r.evalReasoning && (
                              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.45)', lineHeight: 1.5 }}>
                                {r.evalReasoning.length > 160 ? r.evalReasoning.slice(0, 160) + '…' : r.evalReasoning}
                              </p>
                            )}
                          </div>
                        ))}
                        {items.length > 4 && (
                          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', paddingLeft: 12 }}>
                            +{items.length - 4} more in this theme
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* ── Context view ────────────────────────────────────────────────── */}
          {view === 'context' && !hasDetails && (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)', textAlign: 'center', padding: '28px 0' }}>
              Context themes populate as new issues are scored — run a backfill to generate for existing data.
            </p>
          )}
          {view === 'context' && hasDetails && (
            <>
              {contextGroups.filter(g => g.details.length > 0).map(group => {
                const isExp     = expandedTheme === group.theme
                const detailMax = group.details[0]?.[1] ?? 1
                return (
                  <div key={group.theme}>
                    <div
                      onClick={() => setExpandedTheme(isExp ? null : group.theme)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        background: isExp ? meta.bg : 'transparent', transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = isExp ? meta.bg : 'transparent' }}
                    >
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', minWidth: 160, flexShrink: 0 }}>{group.theme}</span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', flex: 1 }}>{group.details.length} situation{group.details.length !== 1 ? 's' : ''}</span>
                      <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: meta.color, minWidth: 28, textAlign: 'right', flexShrink: 0 }}>{group.total}</span>
                      <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.25)', flexShrink: 0, transition: 'transform 0.15s', transform: isExp ? 'rotate(180deg)' : 'none' }}>▼</span>
                    </div>
                    {isExp && (
                      <div style={{ marginLeft: 12, marginBottom: 6, padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {group.details.map(([detail, count]) => (
                          <div key={detail} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', flex: 1, minWidth: 0, lineHeight: 1.3 }}>{detail}</span>
                            <div style={{ width: 80, height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)', flexShrink: 0 }}>
                              <div style={{ width: `${(count / detailMax) * 100}%`, height: '100%', borderRadius: 100, background: meta.color, opacity: 0.6, transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 600, color: meta.color, width: 18, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {pendingCount > 0 && (
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.28)', textAlign: 'center', marginTop: 8 }}>
                  +{pendingCount} categor{pendingCount > 1 ? 'ies' : 'y'} awaiting backfill
                </p>
              )}
            </>
          )}
        </div>
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

// ── Shared pagination ───────────────────────────────────────────────────────

const PAGE_SIZE = 25

function Paginator({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE)
  if (totalPages <= 1) return null
  const from = (page - 1) * PAGE_SIZE + 1
  const to   = Math.min(page * PAGE_SIZE, total)

  // Build page list with ellipsis markers (-1)
  const allPages: number[] = Array.from({ length: totalPages }, (_, i) => i + 1)
  const visible = allPages.filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
  const withEllipsis: (number | -1)[] = []
  for (let i = 0; i < visible.length; i++) {
    if (i > 0 && visible[i] - visible[i - 1] > 1) withEllipsis.push(-1)
    withEllipsis.push(visible[i])
  }

  const btnBase: React.CSSProperties = {
    fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 400,
    width: 30, height: 30, borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)',
    background: '#fff', color: '#58595B', cursor: 'pointer', transition: 'all 0.15s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
        Showing {from}–{to} of <strong style={{ fontWeight: 500, color: '#000' }}>{total}</strong>
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => onPage(page - 1)} disabled={page === 1} style={{ ...btnBase, opacity: page === 1 ? 0.35 : 1, cursor: page === 1 ? 'default' : 'pointer' }}>←</button>
        {withEllipsis.map((p, i) =>
          p === -1 ? (
            <span key={`ell-${i}`} style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.3)', width: 20, textAlign: 'center' }}>…</span>
          ) : (
            <button key={p} onClick={() => onPage(p)} style={{
              ...btnBase,
              background: page === p ? '#000' : '#fff',
              color:      page === p ? '#fff' : '#58595B',
              border:     page === p ? 'none' : '1.5px solid rgba(0,0,0,0.12)',
              fontWeight: page === p ? 500 : 400,
              boxShadow:  page === p ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
            }}>{p}</button>
          )
        )}
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages} style={{ ...btnBase, opacity: page === totalPages ? 0.35 : 1, cursor: page === totalPages ? 'default' : 'pointer' }}>→</button>
      </div>
    </div>
  )
}

// ── Accuracy Ticket-Level View ──────────────────────────────────────────────

function AccuracyTicketLevelView({ rows, onReviewUpdate }: {
  rows: EvalRow[]
  onReviewUpdate?: (id: string, update: ReviewUpdate) => void
}) {
  const { user }                       = useAuth()
  const isAdmin                        = user?.role === 'admin'
  const [promoted, setPromoted]        = useState<Set<string>>(new Set())
  const [expanded,         setExpanded]         = useState<string | null>(null)
  const [page,             setPage]             = useState(1)
  const [errorClassFilter, setErrorClassFilter] = useState<'P1A' | 'P1B' | 'P2' | ''>('')

  const tickets = useMemo(() => {
    const map = new Map<string, EvalRow[]>()
    for (const row of rows) {
      const key = row.ticketNumber ?? row.id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return Array.from(map.entries()).map(([ticketNumber, issues]) => {
      const errorClasses = [...new Set(issues.map(i => i.accuracyErrorClass).filter(c => c && c !== 'NONE'))] as string[]
      const pendingReview = issues.filter(i =>
        i.accuracyErrorClass && i.accuracyErrorClass !== 'NONE' &&
        (!i.reviewStatus || i.reviewStatus === 'pending')
      ).length
      const latestDate = issues.reduce((max, i) => {
        const d = i.accuracyRanAt ?? ''
        return d > max ? d : max
      }, '')
      return { ticketNumber, issues, errorClasses, pendingReview, latestDate,
        agent: issues[0]?.agentName ?? '', category: issues[0]?.category ?? '' }
    }).sort((a, b) => {
      if (a.pendingReview > 0 && b.pendingReview === 0) return -1
      if (a.pendingReview === 0 && b.pendingReview > 0) return 1
      return b.latestDate.localeCompare(a.latestDate)
    })
  }, [rows])

  const filtered = errorClassFilter
    ? tickets.filter(t => t.errorClasses.includes(errorClassFilter))
    : tickets

  const colTemplate = '100px 1fr 140px 200px 110px 90px'
  const cols        = ['Ticket', 'Agent', 'Category', 'Errors', 'Pending', 'Date']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {([
          { key: 'P1A', label: 'P1A', color: '#e53e3e', bg: 'rgba(229,62,62,0.08)' },
          { key: 'P1B', label: 'P1B', color: '#c05621', bg: 'rgba(192,86,33,0.08)' },
          { key: 'P2',  label: 'P2',  color: '#854d0e', bg: 'rgba(133,77,14,0.08)' },
        ] as const).map(({ key, label, color, bg }) => {
          const active = errorClassFilter === key
          return (
            <button key={key} onClick={() => { setErrorClassFilter(active ? '' : key); setPage(1) }} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
              padding: '4px 10px', borderRadius: 100, cursor: 'pointer', transition: 'all 0.15s',
              border: `1.5px solid ${active ? color : 'rgba(0,0,0,0.12)'}`,
              background: active ? bg : '#fff', color: active ? color : '#58595B',
            }}>{label}</button>
          )
        })}
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginLeft: 4 }}>
          {filtered.length} ticket{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
          {cols.map(h => <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>)}
        </div>
        {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(t => {
          const isExp = expanded === t.ticketNumber
          return (
            <div key={t.ticketNumber} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div onClick={() => setExpanded(isExp ? null : t.ticketNumber)}
                style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '11px 20px', alignItems: 'center', cursor: 'pointer', gap: 8, background: isExp ? 'rgba(206,164,255,0.04)' : 'transparent', transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.04)' : 'transparent' }}
              >
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{t.ticketNumber}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{t.agent}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.category || '—'}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {t.errorClasses.length === 0
                    ? <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: 'rgba(22,101,52,0.08)', color: '#166534' }}>Clean</span>
                    : t.errorClasses.map(ec => <AccuracyBadge key={ec} cls={ec as AccuracyClass} small />)
                  }
                </div>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: t.pendingReview > 0 ? '#e53e3e' : '#166534' }}>
                  {t.pendingReview > 0 ? `${t.pendingReview} pending` : 'Done'}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>
                  {t.latestDate ? new Date(t.latestDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}
                </span>
              </div>
              {isExp && (
                <div style={{ padding: '0 0 12px 0' }}>
                  {t.issues.map((r, idx) => (
                    <div key={r.id} style={{ margin: '8px 16px 0', padding: '14px 16px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.07)', background: idx % 2 === 0 ? '#fafafa' : '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <AccuracyBadge cls={(r.accuracyErrorClass ?? 'NONE') as AccuracyClass} />
                        {r.themeTag && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, padding: '2px 8px', borderRadius: 100, background: 'rgba(155,89,208,0.08)', color: '#9B59D0', border: '1px solid rgba(155,89,208,0.15)' }}>{r.themeTag}</span>}
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
                          {r.accuracyRanAt ? new Date(r.accuracyRanAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                      </div>
                      {r.accuracyReasoning && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5, marginBottom: 10 }}>{r.accuracyReasoning}</p>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {[{ label: 'Player message', value: r.customerInput }, { label: 'gameLM suggested', value: r.suggestedResponse }].map(box => (
                          <div key={box.label} style={{ padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.09)' }}>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{box.label}</p>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#000', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{box.value || '—'}</p>
                          </div>
                        ))}
                      </div>
                      {(r.accuracyErrorClass && r.accuracyErrorClass !== 'NONE') && (
                        <ReviewActions row={r} onUpdate={onReviewUpdate} confirmLabel="Confirm error" dismissLabel="Override error" verdictOptions={['P1A', 'P1B', 'P2', 'NONE']} />
                      )}
                      {isAdmin && r.accuracyRanAt && (
                        <div style={{ marginTop: 10 }}>
                          {promoted.has(r.id) ? (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0' }}>✓ Added to gold set</span>
                          ) : (
                            <button
                              onClick={async () => {
                                const { error } = await supabase.from('eval_gold_cases').upsert({
                                  eval_type:            'accuracy',
                                  ticket_issue_id:      r.id,
                                  expected_error_class: r.accuracyErrorClass ?? 'NONE',
                                  player_input:         r.customerInput,
                                  suggested_response:   r.suggestedResponse,
                                  notes:                r.accuracyReasoning,
                                }, { onConflict: 'ticket_issue_id,eval_type' })
                                if (!error) setPromoted(p => new Set([...p, r.id]))
                              }}
                              style={{
                                fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                                color: '#9B59D0', background: 'rgba(155,89,208,0.07)',
                                border: '1px solid rgba(155,89,208,0.2)', borderRadius: 8,
                                padding: '4px 12px', cursor: 'pointer', transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.12)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.07)')}
                            >
                              ★ Promote to gold set
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.3)' }}>No tickets found for this filter</p>
          </div>
        )}
        <Paginator page={page} total={filtered.length} onPage={p => { setPage(p); setExpanded(null) }} />
      </div>
    </div>
  )
}

// ── Response Accuracy tab ───────────────────────────────────────────────────

function ResponseAccuracyView({ rows, agentFilter, priorRows, onReviewUpdate }: {
  rows: EvalRow[]
  agentFilter?: string
  priorRows?: EvalRow[]
  onReviewUpdate?: (id: string, update: ReviewUpdate) => void
}) {
  const [expanded,         setExpanded]         = useState<string | null>(null)
  const [viewMode,         setViewMode]         = useState<'issue' | 'ticket'>('issue')
  const [subTab,           setSubTab]           = useState<'queue' | 'all'>('queue')
  const [categoryFilter,   setCategoryFilter]   = useState('')
  const [agentFil,         setAgentFil]         = useState('')
  const [errorClassFilter, setErrorClassFilter] = useState<'P1A' | 'P1B' | 'P2' | ''>('')
  const [page,             setPage]             = useState(1)

  // Reset page when the active list changes
  useEffect(() => { setPage(1); setExpanded(null) }, [subTab, categoryFilter, agentFil, errorClassFilter, viewMode])

  const scoped = (() => {
    let r = agentFilter ? rows.filter(x => x.agentName === agentFilter) : rows
    if (categoryFilter)   r = r.filter(x => x.category === categoryFilter)
    if (agentFil)         r = r.filter(x => x.agentName === agentFil)
    if (errorClassFilter) r = r.filter(x => x.accuracyErrorClass === errorClassFilter)
    return r
  })()

  const withEval    = scoped.filter(r => r.accuracyRanAt !== null)
  const total       = withEval.length
  const p1a         = withEval.filter(r => r.accuracyErrorClass === 'P1A').length
  const p1b         = withEval.filter(r => r.accuracyErrorClass === 'P1B').length
  const p2          = withEval.filter(r => r.accuracyErrorClass === 'P2').length
  const errorRate   = total ? Math.round(((p1a + p1b + p2) / total) * 100) : 0
  // Review queue: any flagged error not yet reviewed by a human
  const reviewQueue = withEval.filter(r =>
    r.accuracyErrorClass && r.accuracyErrorClass !== 'NONE' &&
    (!r.reviewStatus || r.reviewStatus === 'pending')
  )
  const allResults  = withEval

  // ── Prior-period accuracy metrics (for TrendPip) ────────────────────────────
  const priorWithEval  = (priorRows ?? []).filter(r => r.accuracyRanAt !== null)
  const priorTotal     = priorWithEval.length || null
  const priorP1a       = priorWithEval.length ? priorWithEval.filter(r => r.accuracyErrorClass === 'P1A').length : null
  const priorP1b       = priorWithEval.length ? priorWithEval.filter(r => r.accuracyErrorClass === 'P1B').length : null
  const priorP2        = priorWithEval.length ? priorWithEval.filter(r => r.accuracyErrorClass === 'P2').length : null
  const priorErrorRate = (priorTotal && priorP1a !== null && priorP1b !== null && priorP2 !== null)
    ? Math.round(((priorP1a + priorP1b + priorP2) / priorTotal) * 100)
    : null

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
      {(r.accuracyErrorClass && r.accuracyErrorClass !== 'NONE') && (
        <ReviewActions
          row={r}
          onUpdate={onReviewUpdate}
          confirmLabel="Confirm error"
          dismissLabel="Override error"
          verdictOptions={['P1A', 'P1B', 'P2', 'NONE']}
        />
      )}
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

  const AccuracyViewToggle = () => (
    <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
      {([
        { id: 'issue'  as const, label: 'Issue Level' },
        { id: 'ticket' as const, label: 'Ticket Level' },
      ]).map(t => (
        <button key={t.id} onClick={() => setViewMode(t.id)} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: viewMode === t.id ? 500 : 400,
          padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          background: viewMode === t.id ? '#000' : 'transparent',
          color: viewMode === t.id ? '#fff' : '#58595B',
          boxShadow: viewMode === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
        }}>{t.label}</button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><AccuracyViewToggle /></div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Evals run',          value: total.toString(),      color: '#9B59D0',                                                    note: 'responses scored',
            pip: <TrendPip curr={total} prev={priorTotal} isPositiveGood fmt={n => `${n}`} /> },
          { label: 'Error rate',         value: `${errorRate}%`,       color: errorRate > 10 ? '#e53e3e' : errorRate > 5 ? '#854d0e' : '#166534', note: 'P1A + P1B + P2',
            pip: <TrendPip curr={errorRate} prev={priorErrorRate} isPositiveGood={false} fmt={n => `${n}pp`} /> },
          { label: 'P1A — Regulatory',   value: p1a.toString(),        color: p1a > 0 ? '#e53e3e' : '#166534',                             note: p1a > 0 ? 'Action required' : 'None detected',
            pip: <TrendPip curr={p1a} prev={priorP1a} isPositiveGood={false} fmt={n => `${n}`} /> },
          { label: 'P1B — Hallucination', value: p1b.toString(),        color: p1b > 0 ? '#c05621' : '#166534',                             note: p1b > 0 ? 'Human review required' : 'None detected',
            pip: <TrendPip curr={p1b} prev={priorP1b} isPositiveGood={false} fmt={n => `${n}`} /> },
          { label: 'P2 — Data error',    value: p2.toString(),          color: p2 > 0 ? '#854d0e' : '#166534',                             note: p2 > 0 ? 'Account data claims' : 'None detected',
            pip: <TrendPip curr={p2} prev={priorP2} isPositiveGood={false} fmt={n => `${n}`} /> },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 2 }}>{k.note}</p>
            {k.pip}
          </div>
        ))}
      </div>

      <ThemeDistribution rows={withEval} />

      {viewMode === 'ticket' && (
        <AccuracyTicketLevelView rows={withEval} onReviewUpdate={onReviewUpdate} />
      )}
      {viewMode === 'issue' && (<>
      {/* Sub-tab bar + filters + export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
          {([
            { id: 'queue' as const, label: `Human Review Queue (${reviewQueue.length})` },
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
          {/* Error class filter pills */}
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              { key: 'P1A', label: 'P1A', color: '#e53e3e', bg: 'rgba(229,62,62,0.08)' },
              { key: 'P1B', label: 'P1B', color: '#c05621', bg: 'rgba(192,86,33,0.08)' },
              { key: 'P2',  label: 'P2',  color: '#854d0e', bg: 'rgba(133,77,14,0.08)'  },
            ] as const).map(({ key, label, color, bg }) => {
              const active = errorClassFilter === key
              return (
                <button key={key} onClick={() => setErrorClassFilter(active ? '' : key)} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                  padding: '4px 10px', borderRadius: 100, cursor: 'pointer', transition: 'all 0.15s',
                  border: `1.5px solid ${active ? color : 'rgba(0,0,0,0.12)'}`,
                  background: active ? bg : '#fff',
                  color: active ? color : '#58595B',
                }}>
                  {label}
                </button>
              )
            })}
          </div>
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
              {reviewQueue.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(r => <TableRow key={r.id} r={r} />)}
              <Paginator page={page} total={reviewQueue.length} onPage={p => { setPage(p); setExpanded(null) }} />
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
          {allResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(r => <TableRow key={r.id} r={r} />)}
          <Paginator page={page} total={allResults.length} onPage={p => { setPage(p); setExpanded(null) }} />
        </div>
      )}
      </>)}
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

function ResponseQualityView({ rows, agentFilter, priorRows, onReviewUpdate }: {
  rows: EvalRow[]
  agentFilter?: string
  priorRows?: EvalRow[]
  onReviewUpdate?: (id: string, update: ReviewUpdate) => void
}) {
  const [expanded,       setExpanded]       = useState<string | null>(null)
  const [viewMode,       setViewMode]       = useState<'issue' | 'ticket'>('issue')
  const [subTab,         setSubTab]         = useState<'below' | 'passing'>('below')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [agentFil,       setAgentFil]       = useState('')
  const [page,           setPage]           = useState(1)

  // Reset page when the active list changes
  useEffect(() => { setPage(1); setExpanded(null) }, [subTab, categoryFilter, agentFil, viewMode])

  const scoped = (() => {
    let r = agentFilter ? rows.filter(x => x.agentName === agentFilter) : rows
    if (categoryFilter) r = r.filter(x => x.category === categoryFilter)
    if (agentFil)       r = r.filter(x => x.agentName === agentFil)
    return r
  })()

  const withEval = scoped.filter(r => r.qualityRanAt !== null && r.qualityScore !== null)

  // ── Issue-level aggregates ──────────────────────────────────────────────────
  const iTotal    = withEval.length
  const iAvgScore = avgOf(withEval, 'qualityScore')
  const iAboveBar = withEval.filter(r => (r.qualityScore ?? 0) >= 3.5).length
  const iFlagged  = withEval.filter(r => r.qualityFlag === true).length
  const belowBar  = withEval.filter(r => (r.qualityScore ?? 0) < 3.5)
  const passing   = withEval.filter(r => (r.qualityScore ?? 0) >= 3.5)
  const exportRows = subTab === 'below' ? belowBar : passing

  // ── Ticket-level aggregates ─────────────────────────────────────────────────
  const ticketGroups = useMemo(() => {
    const map = new Map<string, EvalRow[]>()
    for (const r of withEval) {
      const key = r.ticketNumber ?? r.id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return [...map.values()]
  }, [withEval])

  const tTotal    = ticketGroups.length
  const tScored   = ticketGroups.filter(g => g.some(r => r.qualityScore !== null))
  const tAvgScore = tScored.length
    ? parseFloat((tScored.reduce((sum, g) => {
        const scores = g.map(r => r.qualityScore).filter((s): s is number => s !== null)
        return sum + scores.reduce((a, b) => a + b, 0) / scores.length
      }, 0) / tScored.length).toFixed(2))
    : null
  const tAboveBar = ticketGroups.filter(g => {
    const scores = g.map(r => r.qualityScore).filter((s): s is number => s !== null)
    return scores.length > 0 && scores.reduce((a, b) => a + b, 0) / scores.length >= 3.5
  }).length
  const tFlagged  = ticketGroups.filter(g => g.some(r => r.qualityFlag === true)).length

  // ── Prior-period quality metrics (for TrendPip) ──────────────────────────────
  const priorWithEval  = (priorRows ?? []).filter(r => r.qualityRanAt !== null && r.qualityScore !== null)
  const priorITotal    = priorWithEval.length || null
  const priorIAvgScore = priorWithEval.length ? avgOf(priorWithEval, 'qualityScore') : null
  const priorIAboveBar = priorWithEval.length ? priorWithEval.filter(r => (r.qualityScore ?? 0) >= 3.5).length : null
  const priorIAbovePct = (priorITotal && priorIAboveBar !== null) ? pct(priorIAboveBar, priorITotal) : null
  const priorIFlagged  = priorWithEval.length ? priorWithEval.filter(r => r.qualityFlag === true).length : null

  // Deduplicated rows for ticket-level theme distribution (one entry per ticket×theme)
  const themeRows = useMemo(() => {
    if (viewMode === 'issue') return withEval
    const seen = new Set<string>()
    return withEval.filter(r => {
      if (!r.themeTag) return false
      const key = `${r.ticketNumber ?? r.id}__${r.themeTag}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [viewMode, withEval])

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
            <ReviewActions row={r} onUpdate={onReviewUpdate} />
          </div>
        )}
      </div>
    )
  }

  // ── KPI values swap based on view mode ──────────────────────────────────────
  const kpis = viewMode === 'issue'
    ? [
        { label: 'Responses scored',  value: iTotal.toString(),                                color: '#9B59D0', note: 'individual responses',
          pip: <TrendPip curr={iTotal} prev={priorITotal} isPositiveGood fmt={n => `${n}`} /> },
        { label: 'Avg quality score', value: iAvgScore !== null ? iAvgScore.toFixed(2) : '—', color: scoreColor(iAvgScore), note: 'target ≥ 3.50',
          pip: iAvgScore !== null ? <TrendPip curr={iAvgScore} prev={priorIAvgScore} isPositiveGood fmt={n => `${n.toFixed(2)}`} /> : null },
        { label: 'Above bar (≥3.5)',  value: iTotal ? `${pct(iAboveBar, iTotal)}%` : '—',     color: '#166534', note: `${iAboveBar} / ${iTotal} responses`,
          pip: <TrendPip curr={iTotal ? pct(iAboveBar, iTotal) : 0} prev={priorIAbovePct} isPositiveGood fmt={n => `${n}pp`} /> },
        { label: 'Flagged (any cat=1)', value: iFlagged.toString(),                            color: iFlagged > 0 ? '#e53e3e' : '#166534', note: iFlagged > 0 ? 'Minimum quality fail' : 'None this period',
          pip: <TrendPip curr={iFlagged} prev={priorIFlagged} isPositiveGood={false} fmt={n => `${n}`} /> },
      ]
    : [
        { label: 'Tickets scored',   value: tTotal.toString(),                                color: '#9B59D0', note: 'unique tickets',
          pip: null },
        { label: 'Avg ticket score', value: tAvgScore !== null ? tAvgScore.toFixed(2) : '—',  color: scoreColor(tAvgScore), note: 'avg of per-ticket averages',
          pip: null },
        { label: 'Above bar (≥3.5)', value: tTotal ? `${pct(tAboveBar, tTotal)}%` : '—',      color: '#166534', note: `${tAboveBar} / ${tTotal} tickets`,
          pip: null },
        { label: 'Tickets flagged',  value: tFlagged.toString(),                               color: tFlagged > 0 ? '#e53e3e' : '#166534', note: tFlagged > 0 ? '≥1 flagged response' : 'None this period',
          pip: null },
      ]

  // ── Toggle pill ─────────────────────────────────────────────────────────────
  const ViewToggle = () => (
    <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
      {([
        { id: 'issue'  as const, label: 'Issue Level' },
        { id: 'ticket' as const, label: 'Ticket Level' },
      ]).map(t => (
        <button key={t.id} onClick={() => setViewMode(t.id)} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: viewMode === t.id ? 500 : 400,
          padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          background: viewMode === t.id ? '#000' : 'transparent',
          color: viewMode === t.id ? '#fff' : '#58595B',
          boxShadow: viewMode === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
        }}>{t.label}</button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Toggle sits right-aligned above the KPI row, over the Flagged card */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ViewToggle />
      </div>

      {/* KPI row — values swap with view mode */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: -4 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 2 }}>{k.note}</p>
            {k.pip}
          </div>
        ))}
      </div>

      {/* Category averages — always response-level (same data regardless of view) */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 20px' }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', marginBottom: 14 }}>Category Averages</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {QUALITY_CATEGORIES.map(cat => {
            const avg = avgOf(withEval, cat.key)
            const color = scoreColor(avg)
            const fill = avg !== null ? ((avg - 1) / 4) * 100 : 0
            return (
              <div key={cat.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B' }}>{cat.label}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.3)' }}>{cat.weight}</span>
                </div>
                <div style={{ height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                  <div style={{ width: `${fill}%`, height: '100%', borderRadius: 100, background: color, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color }}>{avg !== null ? avg.toFixed(2) : '—'}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Theme distribution — deduplicated per-ticket in ticket mode */}
      <ThemeDistribution rows={themeRows} />

      {/* Issue mode controls: sub-tabs + filters + export */}
      {viewMode === 'issue' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
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
      )}

      {/* Ticket level view */}
      {viewMode === 'ticket' && <TicketLevelView rows={withEval} agentFilter={agentFilter} />}

      {/* Issue level table */}
      {viewMode === 'issue' && (() => {
        const displayRows = subTab === 'below' ? belowBar : passing
        if (displayRows.length === 0) return null
        return (
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
            {displayRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(r => <QualityTableRow key={r.id} r={r} />)}
            <Paginator page={page} total={displayRows.length} onPage={p => { setPage(p); setExpanded(null) }} />
          </div>
        )
      })()}
    </div>
  )
}

// ── Edit Eval Ticket-Level View ─────────────────────────────────────────────

function EditEvalTicketLevelView({ rows, onReviewUpdate }: {
  rows: EvalRow[]
  onReviewUpdate?: (id: string, update: ReviewUpdate) => void
}) {
  const { user }                  = useAuth()
  const isAdmin                   = user?.role === 'admin'
  const [promoted, setPromoted]   = useState<Set<string>>(new Set())
  const [expanded,       setExpanded]       = useState<string | null>(null)
  const [page,           setPage]           = useState(1)
  const [verdictFilter,  setVerdictFilter]  = useState<Verdict | 'NONE' | ''>('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const evalRows = rows.filter(r => r.evalVerdict !== null)

  const categories = useMemo(() => [...new Set(evalRows.map(r => r.category).filter(Boolean))].sort(), [evalRows])

  const tickets = useMemo(() => {
    const map = new Map<string, EvalRow[]>()
    for (const row of evalRows) {
      const key = row.ticketNumber ?? row.id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return Array.from(map.entries()).map(([ticketNumber, issues]) => {
      const corrections  = issues.filter(i => i.evalVerdict === 'CORRECTION').length
      const enhancements = issues.filter(i => i.evalVerdict === 'ENHANCEMENT').length
      const preferences  = issues.filter(i => i.evalVerdict === 'PREFERENCE').length
      const agents       = [...new Set(issues.map(i => i.agentName).filter(Boolean))]
      const avgConf      = issues.length ? Math.round(issues.reduce((s, i) => s + (i.evalConfidence ?? 0), 0) / issues.length) : 0
      const latestDate   = issues.reduce((max, i) => { const d = i.evalRanAt ?? ''; return d > max ? d : max }, '')
      return { ticketNumber, issues, corrections, enhancements, preferences, agents,
        avgConf, category: issues[0]?.category ?? '', latestDate }
    }).sort((a, b) => b.latestDate.localeCompare(a.latestDate))
  }, [evalRows])

  const filtered = useMemo(() => {
    let r = tickets
    if (verdictFilter)  r = r.filter(t => t.issues.some(i => i.evalVerdict === verdictFilter))
    if (categoryFilter) r = r.filter(t => t.category === categoryFilter)
    return r
  }, [tickets, verdictFilter, categoryFilter])

  useEffect(() => { setPage(1); setExpanded(null) }, [verdictFilter, categoryFilter])

  const VERDICT_PILLS: { key: Verdict | 'NONE'; label: string; color: string; bg: string }[] = [
    { key: 'CORRECTION',  label: 'Corrections',  color: '#e53e3e', bg: 'rgba(229,62,62,0.08)' },
    { key: 'ENHANCEMENT', label: 'Enhancements', color: '#c05621', bg: 'rgba(192,86,33,0.08)' },
    { key: 'PREFERENCE',  label: 'Preferences',  color: '#0369a1', bg: 'rgba(3,105,161,0.08)' },
    { key: 'NONE',        label: 'None',          color: '#166534', bg: 'rgba(22,101,52,0.08)' },
  ]

  const colTemplate = '100px 1fr 150px 70px 110px 120px 110px 90px'
  const cols        = ['Ticket', 'Agent(s)', 'Category', 'Evals', 'Corrections', 'Enhancements', 'Preferences', 'Date']

  const exportTicketCSV = () => {
    const header = cols.join(',')
    const body = filtered.map(t =>
      [t.ticketNumber, `"${t.agents.join('; ')}"`, `"${t.category}"`, t.issues.length, t.corrections, t.enhancements, t.preferences,
       t.latestDate ? new Date(t.latestDate).toLocaleDateString() : ''].join(',')
    )
    const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv' })
    const a    = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'eval_tickets.csv'; a.click()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {VERDICT_PILLS.map(({ key, label, color, bg }) => {
            const active = verdictFilter === key
            return (
              <button key={key} onClick={() => { setVerdictFilter(active ? '' : key); setPage(1) }} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                padding: '4px 10px', borderRadius: 100, cursor: 'pointer', transition: 'all 0.15s',
                border: `1.5px solid ${active ? color : 'rgba(0,0,0,0.12)'}`,
                background: active ? bg : '#fff', color: active ? color : '#58595B',
              }}>{label}</button>
            )
          })}
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }} style={{ ...filterSelectStyle, minWidth: 140 }}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{filtered.length} ticket{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={exportTicketCSV} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer' }}>Export CSV</button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '9px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
          {cols.map(h => <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>)}
        </div>
        {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(t => {
          const isExp = expanded === t.ticketNumber
          return (
            <div key={t.ticketNumber} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div onClick={() => setExpanded(isExp ? null : t.ticketNumber)}
                style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '11px 20px', alignItems: 'center', cursor: 'pointer', gap: 4, background: isExp ? 'rgba(206,164,255,0.04)' : 'transparent', transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.04)' : 'transparent' }}
              >
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>#{t.ticketNumber}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.agents.join(', ') || '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.category || '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{t.issues.length}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: t.corrections > 0 ? '#e53e3e' : 'rgba(0,0,0,0.3)' }}>{t.corrections > 0 ? t.corrections : '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: t.enhancements > 0 ? '#c05621' : 'rgba(0,0,0,0.3)' }}>{t.enhancements > 0 ? t.enhancements : '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: t.preferences > 0 ? '#0369a1' : 'rgba(0,0,0,0.3)' }}>{t.preferences > 0 ? t.preferences : '—'}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>
                  {t.latestDate ? new Date(t.latestDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}
                </span>
              </div>
              {isExp && (
                <div style={{ padding: '0 0 12px 0' }}>
                  {t.issues.map((r, idx) => (
                    <div key={r.id} style={{ margin: '8px 16px 0', padding: '14px 16px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.07)', background: idx % 2 === 0 ? '#fafafa' : '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        {r.evalVerdict && <VerdictBadge verdict={r.evalVerdict} />}
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{r.agentName}</span>
                        <ConfidencePip value={r.evalConfidence} />
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
                          {r.evalRanAt ? new Date(r.evalRanAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                      </div>
                      {r.evalReasoning && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5, marginBottom: 10 }}>{r.evalReasoning}</p>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        {[
                          { label: 'Player message', value: r.customerInput },
                          { label: 'gameLM suggested', value: r.suggestedResponse },
                          { label: 'Agent edit', value: r.finalEdits },
                        ].map(box => (
                          <div key={box.label} style={{ padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.09)' }}>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{box.label}</p>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#000', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{box.value || '—'}</p>
                          </div>
                        ))}
                      </div>
                      <ReviewActions row={r} onUpdate={onReviewUpdate} confirmLabel="Confirm" dismissLabel="Dismiss" verdictOptions={['CORRECTION', 'ENHANCEMENT', 'PREFERENCE', 'NONE']} />
                      {isAdmin && r.evalVerdict !== null && (
                        <div style={{ marginTop: 10 }}>
                          {promoted.has(r.id) ? (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0' }}>✓ Added to gold set</span>
                          ) : (
                            <button
                              onClick={async () => {
                                const { error } = await supabase.from('eval_gold_cases').upsert({
                                  eval_type:         'edit',
                                  ticket_issue_id:   r.id,
                                  expected_verdict:  r.reviewCorrectVerdict ?? r.evalVerdict,
                                  player_input:      r.customerInput,
                                  suggested_response: r.suggestedResponse,
                                  final_edits:       r.finalEdits,
                                  agent_reasoning:   r.reasoning,
                                  notes:             r.evalReasoning,
                                }, { onConflict: 'ticket_issue_id,eval_type' })
                                if (!error) setPromoted(p => new Set([...p, r.id]))
                              }}
                              style={{
                                fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                                color: '#9B59D0', background: 'rgba(155,89,208,0.07)',
                                border: '1px solid rgba(155,89,208,0.2)', borderRadius: 8,
                                padding: '4px 12px', cursor: 'pointer', transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.12)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.07)')}
                            >
                              ★ Promote to gold set
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.3)' }}>No tickets found for this filter</p>
          </div>
        )}
        <Paginator page={page} total={filtered.length} onPage={p => { setPage(p); setExpanded(null) }} />
      </div>
    </div>
  )
}

// ── Agent Drilldown ────────────────────────────────────────────────────────────

function AgentDrilldown({ rows, tickets, agentName, onBack, onReviewUpdate }: { rows: EvalRow[]; tickets: TicketRow[]; agentName: string; onBack: () => void; onReviewUpdate?: (id: string, update: ReviewUpdate) => void }) {
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
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Edit Evaluations</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>Click any row to review — QA feedback exports to JSONL / CSV</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => exportEditEvalCSV(rows, `edit_evals_${agentName.replace(/\s+/g, '_')}.csv`)}
              style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#CEA4FF'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'}
            >Export CSV</button>
            <button
              onClick={() => exportEditEvalJSONL(rows, `edit_evals_${agentName.replace(/\s+/g, '_')}.jsonl`)}
              style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >Export JSONL</button>
          </div>
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
                  <ReviewActions
                    row={r}
                    onUpdate={onReviewUpdate}
                    confirmLabel="Confirm verdict"
                    dismissLabel="Override verdict"
                    verdictOptions={['CORRECTION', 'ENHANCEMENT', 'PREFERENCE']}
                  />
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
        <ResponseAccuracyView rows={rows} agentFilter={agentName} onReviewUpdate={onReviewUpdate} />
      )}

      {/* Response Quality tab */}
      {activeTab === 'quality' && (
        <ResponseQualityView rows={rows} agentFilter={agentName} onReviewUpdate={onReviewUpdate} />
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

function TicketLevelView({ rows, agentFilter }: { rows: EvalRow[], agentFilter?: string }) {
  const [expanded,       setExpanded]       = useState<string | null>(null)
  const [subTab,         setSubTab]         = useState<'below' | 'passing'>('below')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [agentFil,       setAgentFil]       = useState('')
  const [page,           setPage]           = useState(1)

  useEffect(() => { setPage(1); setExpanded(null) }, [subTab, categoryFilter, agentFil])

  // Apply filters then group by ticket
  const allTickets = useMemo(() => {
    let r = agentFilter ? rows.filter(x => x.agentName === agentFilter) : rows
    if (categoryFilter) r = r.filter(x => x.category === categoryFilter)
    if (agentFil)       r = r.filter(x => x.agentName === agentFil)

    const map = new Map<string, { ticketNumber: string; agentName: string; category: string; issues: EvalRow[] }>()
    for (const row of r) {
      const key = row.ticketNumber ?? row.id
      if (!map.has(key)) map.set(key, { ticketNumber: row.ticketNumber ?? '—', agentName: row.agentName, category: row.category, issues: [] })
      map.get(key)!.issues.push(row)
    }
    return [...map.values()].map(t => ({
      ...t,
      issues: [...t.issues].sort((a, b) => (a.qualityRanAt ?? '').localeCompare(b.qualityRanAt ?? '')),
      avgQuality: (() => {
        const scored = t.issues.filter(i => i.qualityScore !== null)
        return scored.length ? parseFloat((scored.reduce((s, i) => s + (i.qualityScore ?? 0), 0) / scored.length).toFixed(2)) : null
      })(),
    })).sort((a, b) => (a.avgQuality ?? 0) - (b.avgQuality ?? 0))
  }, [rows, agentFilter, categoryFilter, agentFil])

  const belowTickets  = allTickets.filter(t => t.avgQuality === null || t.avgQuality < 3.5)
  const passingTickets = allTickets.filter(t => t.avgQuality !== null && t.avgQuality >= 3.5)
  const displayTickets = subTab === 'below' ? belowTickets : passingTickets

  // Export helpers — flatten ticket groups to issue rows
  const exportRows = displayTickets.flatMap(t => t.issues)

  if (allTickets.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 6 }}>No scored tickets yet</p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>Run the backfill to populate ticket-level data.</p>
      </div>
    )
  }

  const pagedTickets = displayTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Sub-tab bar + filters + export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
          {([
            { id: 'below'   as const, label: `Below Threshold (${belowTickets.length})` },
            { id: 'passing' as const, label: `Passing (${passingTickets.length})` },
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
            <DiagnosticFilters rows={rows} categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter}
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

      {/* Ticket list */}
      {displayTickets.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '32px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.3)' }}>
            No {subTab === 'below' ? 'below-threshold' : 'passing'} tickets for this filter
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 16, border: subTab === 'below' && belowTickets.length > 0 ? '1.5px solid rgba(229,62,62,0.15)' : '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: subTab === 'below' ? 'rgba(229,62,62,0.02)' : 'rgba(0,0,0,0.015)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>
              {subTab === 'below' ? 'Below Threshold' : 'Passing Tickets'}
            </p>
            {subTab === 'below' && belowTickets.length > 0 && (
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(229,62,62,0.09)', color: '#e53e3e' }}>
                {belowTickets.length} below 3.5
              </span>
            )}
          </div>

          {pagedTickets.map(ticket => {
            const isExp = expanded === ticket.ticketNumber
            const hasP1 = ticket.issues.some(i => i.accuracyErrorClass === 'P1A' || i.accuracyErrorClass === 'P1B')
            const themes = [...new Set(ticket.issues.map(i => i.themeTag).filter(Boolean))]

            return (
              <div key={ticket.ticketNumber} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                {/* Ticket header row */}
                <div onClick={() => setExpanded(isExp ? null : ticket.ticketNumber)} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px',
                  cursor: 'pointer', transition: 'background 0.15s',
                  background: isExp ? 'rgba(206,164,255,0.04)' : 'transparent',
                  borderBottom: isExp ? '1px solid rgba(0,0,0,0.07)' : 'none',
                }}
                  onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = isExp ? 'rgba(206,164,255,0.04)' : 'transparent' }}
                >
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#9B59D0', minWidth: 76 }}>#{ticket.ticketNumber}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.agentName}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', minWidth: 60 }}>
                    {ticket.issues.length} response{ticket.issues.length !== 1 ? 's' : ''}
                  </span>
                  {ticket.avgQuality !== null
                    ? <QualityScore score={ticket.avgQuality} small />
                    : <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.25)' }}>—</span>
                  }
                  {hasP1 && (
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(229,62,62,0.1)', color: '#e53e3e', flexShrink: 0 }}>P1</span>
                  )}
                  {themes.slice(0, 2).map(t => (
                    <span key={t} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 100, background: 'rgba(155,89,208,0.07)', color: '#9B59D0', border: '1px solid rgba(155,89,208,0.15)', flexShrink: 0 }}>{t}</span>
                  ))}
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto', flexShrink: 0 }}>
                    {isExp ? '▲' : '▼'}
                  </span>
                </div>

                {/* Expanded: full conversation thread */}
                {isExp && (
                  <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, background: 'rgba(206,164,255,0.02)' }}>
                    {ticket.issues.map((issue, idx) => (
                      <div key={issue.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                          Turn {idx + 1} {issue.agentName && `· ${issue.agentName}`}
                        </p>
                        {issue.customerInput && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', minWidth: 52, paddingTop: 2 }}>Player</span>
                            <div style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.07)' }}>
                              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{issue.customerInput}</p>
                            </div>
                          </div>
                        )}
                        {issue.suggestedResponse && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#9B59D0', minWidth: 52, paddingTop: 2 }}>Agent</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(155,89,208,0.04)', border: '1px solid rgba(155,89,208,0.12)', marginBottom: 6 }}>
                                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{issue.suggestedResponse}</p>
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                {issue.accuracyErrorClass && <AccuracyBadge cls={issue.accuracyErrorClass} small />}
                                {issue.qualityScore !== null && <QualityScore score={issue.qualityScore} small />}
                                {issue.qualityFlag && (
                                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: 'rgba(229,62,62,0.09)', color: '#e53e3e' }}>Flagged</span>
                                )}
                                {issue.themeTag && (
                                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, padding: '2px 7px', borderRadius: 100, background: 'rgba(155,89,208,0.07)', color: '#9B59D0', border: '1px solid rgba(155,89,208,0.15)' }}>{issue.themeTag}</span>
                                )}
                                {issue.accuracyEvidence && issue.accuracyEvidence !== 'None' && (
                                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#e53e3e' }}>"{issue.accuracyEvidence}"</span>
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

          <Paginator page={page} total={displayTickets.length} onPage={p => { setPage(p); setExpanded(null) }} />
        </div>
      )}
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
  const [topTab, setTopTab]               = useState<TopTab>('dashboard')
  const [evalsViewMode, setEvalsViewMode] = useState<'agents' | 'tickets'>('agents')
  const [verdictModal, setVerdictModal]   = useState<Verdict | null>(null)

  // Update local state when a review action is saved
  const handleReviewUpdate = (id: string, update: ReviewUpdate) => {
    const patch = (r: EvalRow) => r.id === id
      ? { ...r,
          reviewStatus:         update.status,
          reviewNotes:          update.notes || null,
          reviewCorrectVerdict: update.correctVerdict,
          reviewContext:        update.context,
          reviewedBy:           user?.email ?? null,
          reviewedAt:           new Date().toISOString(),
        }
      : r
    setAllRows(prev       => prev.map(patch))
    setAllScoredRows(prev => prev.map(patch))
  }

  useEffect(() => {
    const opId  = operator?.id ?? null
    const since = sinceDate(range)
    setLoading(true)
    Promise.all([
      fetchAllEvals(opId, since),
      fetchTicketCompleteness(opId, since),
      fetchAllScoredIssues(opId, since),
    ]).then(([evals, tickets, scored]) => {
      setAllRows(evals)
      setTicketRows(tickets)
      setAllScoredRows(scored)
      setLoading(false)
    })
  }, [operator?.id, range])

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

  // ── Prior period (same duration, immediately before current window) ──────────
  const priorRows = useMemo(() => {
    if (range === 'allTime') return []
    const days = rangeDays(range)
    const cutEnd   = new Date(); cutEnd.setDate(cutEnd.getDate() - days)
    const cutStart = new Date(); cutStart.setDate(cutStart.getDate() - days * 2)
    return allRows.filter(r => { const d = rowDate(r); return d >= cutStart && d < cutEnd })
  }, [allRows, range])

  // Prior window for scored rows (accuracy + quality tabs — separate dataset from allRows)
  const priorScoredRows = useMemo(() => {
    if (range === 'allTime') return []
    const days = rangeDays(range)
    const cutEnd   = new Date(); cutEnd.setDate(cutEnd.getDate() - days)
    const cutStart = new Date(); cutStart.setDate(cutStart.getDate() - days * 2)
    return allScoredRows.filter(r => { const d = rowDate(r); return d >= cutStart && d < cutEnd })
  }, [allScoredRows, range])

  const priorTickets = useMemo(() => {
    if (range === 'allTime') return []
    const days = rangeDays(range)
    const cutEnd   = new Date(); cutEnd.setDate(cutEnd.getDate() - days)
    const cutStart = new Date(); cutStart.setDate(cutStart.getDate() - days * 2)
    return ticketRows.filter(t => { const d = new Date(t.createdAt); return d >= cutStart && d < cutEnd })
  }, [ticketRows, range])

  const priorTotal       = priorRows.length
  const priorCorrection  = priorRows.filter(r => r.evalVerdict === 'CORRECTION').length
  const priorEnhancement = priorRows.filter(r => r.evalVerdict === 'ENHANCEMENT').length
  const priorPreference  = priorRows.filter(r => r.evalVerdict === 'PREFERENCE').length

  const priorTicketsWithRes = priorTickets.filter(t => t.zdResolutionMinutes !== null)
  const priorAvgResolutionMins = priorTicketsWithRes.length
    ? Math.round(priorTicketsWithRes.reduce((s, t) => s + (t.zdResolutionMinutes ?? 0), 0) / priorTicketsWithRes.length)
    : null
  const priorTicketsWithFcr = priorTickets.filter(t => t.zdFcr !== null)
  const priorFcrPct = priorTicketsWithFcr.length
    ? pct(priorTicketsWithFcr.filter(t => t.zdFcr).length, priorTicketsWithFcr.length)
    : null
  const priorCompliments = priorTickets.filter(t => t.zdPlayerSentiment === 'COMPLIMENT').length

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
        <AgentDrilldown rows={agentRows} tickets={agentTickets} agentName={selected} onBack={() => setSelected(null)} onReviewUpdate={handleReviewUpdate} />
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
          { id: 'dashboard' as TopTab, label: 'Dashboard'         },
          { id: 'evals'     as TopTab, label: 'Edit Evaluations'  },
          { id: 'accuracy'  as TopTab, label: 'Response Accuracy' },
          { id: 'quality'   as TopTab, label: 'Response Quality'  },
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

      {/* ── Dashboard tab ── */}
      {topTab === 'dashboard' && (() => {
        // Accuracy metrics from scoredRows
        const accWithEval   = scoredRows.filter(r => r.accuracyRanAt !== null)
        const accTotal      = accWithEval.length
        const accP1a        = accWithEval.filter(r => r.accuracyErrorClass === 'P1A').length
        const accP1b        = accWithEval.filter(r => r.accuracyErrorClass === 'P1B').length
        const accP2         = accWithEval.filter(r => r.accuracyErrorClass === 'P2').length
        const accErrorRate  = accTotal ? Math.round(((accP1a + accP1b + accP2) / accTotal) * 100) : 0
        const accRatioDenom = accErrorRate > 0 ? Math.round(100 / accErrorRate) : null

        // Prior accuracy
        const priorAccWithEval  = priorScoredRows.filter(r => r.accuracyRanAt !== null)
        const priorAccTotal     = priorAccWithEval.length || null
        const priorAccP1a       = priorAccWithEval.length ? priorAccWithEval.filter(r => r.accuracyErrorClass === 'P1A').length : null
        const priorAccP1b       = priorAccWithEval.length ? priorAccWithEval.filter(r => r.accuracyErrorClass === 'P1B').length : null
        const priorAccP2        = priorAccWithEval.length ? priorAccWithEval.filter(r => r.accuracyErrorClass === 'P2').length : null
        const priorAccErrorRate = (priorAccTotal && priorAccP1a !== null && priorAccP1b !== null && priorAccP2 !== null)
          ? Math.round(((priorAccP1a + priorAccP1b + priorAccP2) / priorAccTotal) * 100)
          : null

        // Quality metrics from scoredRows
        const qualWithEval  = scoredRows.filter(r => r.qualityRanAt !== null && r.qualityScore !== null)
        const qualTotal     = qualWithEval.length
        const qualAvgScore  = qualTotal ? avgOf(qualWithEval, 'qualityScore') : null
        const qualAboveBar  = qualWithEval.filter(r => (r.qualityScore ?? 0) >= 3.5).length
        const qualAbovePct  = qualTotal ? pct(qualAboveBar, qualTotal) : null

        // Prior quality
        const priorQualWithEval = priorScoredRows.filter(r => r.qualityRanAt !== null && r.qualityScore !== null)
        const priorQualAvgScore = priorQualWithEval.length ? avgOf(priorQualWithEval, 'qualityScore') : null
        const priorQualAbovePct = priorQualWithEval.length ? pct(priorQualWithEval.filter(r => (r.qualityScore ?? 0) >= 3.5).length, priorQualWithEval.length) : null

        // Edit eval rates
        const corrPct  = teamTotal ? pct(teamCorrection,  teamTotal) : 0
        const enhPct   = teamTotal ? pct(teamEnhancement, teamTotal) : 0
        const prefPct  = teamTotal ? pct(teamPreference,  teamTotal) : 0
        const priorCorrPct  = priorTotal ? pct(priorCorrection,  priorTotal) : null
        const priorEnhPct   = priorTotal ? pct(priorEnhancement, priorTotal) : null
        const priorPrefPct  = priorTotal ? pct(priorPreference,  priorTotal) : null

        const qualScoreColor = (s: number | null) => s === null ? '#aaa' : s >= 4 ? '#166534' : s >= 3.5 ? '#854d0e' : '#e53e3e'

        const SectionHeader = ({ label }: { label: string }) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{label}</p>
            <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.07)' }} />
          </div>
        )

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* ── Ops ── */}
            <SectionHeader label="Operations" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {/* Avg resolution time */}
              <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Avg Resolution Time</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: '#000' }}>{fmtMinutes(avgResolutionMins)}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>
                  {ticketsWithRes.length ? `across ${ticketsWithRes.length} resolved tickets` : 'Run ZD backfill to populate'}
                </p>
                {range !== 'allTime' && avgResolutionMins !== null && <TrendPip curr={avgResolutionMins} prev={priorAvgResolutionMins} isPositiveGood={false} fmt={n => fmtMinutes(n)} />}
              </div>
              {/* FCR rate */}
              <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>FCR Rate</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: teamFcrPct === null ? '#aaa' : teamFcrPct >= 80 ? '#166534' : teamFcrPct >= 60 ? '#854d0e' : '#e53e3e' }}>
                  {teamFcrPct !== null ? `${teamFcrPct}%` : '—'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>First contact resolution — no reopens</p>
                {range !== 'allTime' && teamFcrPct !== null && <TrendPip curr={teamFcrPct} prev={priorFcrPct} isPositiveGood fmt={n => `${n}pp`} />}
              </div>
              {/* Player compliments — clickable */}
              <div
                onClick={() => teamCompliments > 0 && setShowWins(true)}
                style={{
                  background: '#fff', borderRadius: 14, padding: '16px 18px',
                  border: teamCompliments > 0 ? '1.5px solid rgba(22,101,52,0.25)' : '1.5px solid rgba(0,0,0,0.09)',
                  cursor: teamCompliments > 0 ? 'pointer' : 'default', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (teamCompliments > 0) e.currentTarget.style.background = 'rgba(22,101,52,0.03)' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
              >
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Player Compliments</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: teamCompliments > 0 ? '#166534' : 'rgba(0,0,0,0.25)' }}>
                  {teamCompliments > 0 ? `+${teamCompliments}` : '—'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: teamCompliments > 0 ? '#166534' : 'rgba(0,0,0,0.3)', marginTop: 4 }}>
                  {teamCompliments > 0 ? 'Click to view all →' : 'Genuine positive feedback detected'}
                </p>
                {range !== 'allTime' && <TrendPip curr={teamCompliments} prev={priorCompliments} isPositiveGood fmt={n => `${n}`} />}
              </div>
            </div>

            {/* ── Edit Evaluations ── */}
            <SectionHeader label="Edit Evaluations" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { label: 'Corrections',  value: `${corrPct}%`, color: '#e53e3e',  note: 'Response needed rewriting',    curr: corrPct, prev: priorCorrPct,  good: false },
                { label: 'Enhancements', value: `${enhPct}%`,  color: '#854d0e',  note: 'Response improved upon',       curr: enhPct,  prev: priorEnhPct,   good: true  },
                { label: 'Preferences',  value: `${prefPct}%`, color: '#58595B',  note: 'Agent chose own wording',      curr: prefPct, prev: priorPrefPct,  good: false },
              ].map(k => (
                <div key={k.label} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{k.label}</p>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, color: k.color, lineHeight: 1 }}>{k.value}</p>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>{k.note}</p>
                  {range !== 'allTime' && <TrendPip curr={k.curr} prev={k.prev} isPositiveGood={k.good} fmt={n => `${n}pp`} />}
                </div>
              ))}
            </div>

            {/* ── Response Accuracy ── */}
            <SectionHeader label="Response Accuracy" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Error Rate</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: accErrorRate > 10 ? '#e53e3e' : accErrorRate > 5 ? '#854d0e' : '#166534' }}>
                  {accTotal ? `${accErrorRate}%` : '—'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>P1A + P1B + P2 errors</p>
                {range !== 'allTime' && <TrendPip curr={accErrorRate} prev={priorAccErrorRate} isPositiveGood={false} fmt={n => `${n}pp`} />}
              </div>
              <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Error Ratio</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: accErrorRate > 10 ? '#e53e3e' : accErrorRate > 5 ? '#854d0e' : '#166534' }}>
                  {accTotal && accRatioDenom !== null ? `1:${accRatioDenom}` : accTotal && accErrorRate === 0 ? 'None' : '—'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>
                  {accRatioDenom !== null ? `1 error per ${accRatioDenom} responses` : accErrorRate === 0 ? 'No errors this period' : 'No data yet'}
                </p>
              </div>
            </div>

            {/* ── Response Quality ── */}
            <SectionHeader label="Response Quality" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Avg Quality Score</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: qualScoreColor(qualAvgScore) }}>
                  {qualAvgScore !== null ? qualAvgScore.toFixed(2) : '—'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>target ≥ 3.50 · out of 5</p>
                {range !== 'allTime' && qualAvgScore !== null && <TrendPip curr={qualAvgScore} prev={priorQualAvgScore} isPositiveGood fmt={n => `${n.toFixed(2)}`} />}
              </div>
              <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Passing Score Rate</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 600, lineHeight: 1, color: '#166534' }}>
                  {qualAbovePct !== null ? `${qualAbovePct}%` : '—'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>{qualAboveBar} / {qualTotal} responses ≥ 3.5</p>
                {range !== 'allTime' && <TrendPip curr={qualAbovePct ?? 0} prev={priorQualAbovePct} isPositiveGood fmt={n => `${n}pp`} />}
              </div>
            </div>

          </div>
        )
      })()}

      {/* ── Response Accuracy tab ── */}
      {topTab === 'accuracy' && <ResponseAccuracyView rows={scoredRows} priorRows={range !== 'allTime' ? priorScoredRows : undefined} onReviewUpdate={handleReviewUpdate} />}

      {/* ── Response Quality tab ── */}
      {topTab === 'quality' && <ResponseQualityView rows={scoredRows} priorRows={range !== 'allTime' ? priorScoredRows : undefined} onReviewUpdate={handleReviewUpdate} />}

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
          {range !== 'allTime' && (
            <div style={{ marginTop: 8 }}>
              <TrendPip curr={teamTotal} prev={priorTotal} isPositiveGood fmt={n => `${n}`} />
            </div>
          )}
        </div>

        {[
          { label: 'Corrections',  currPct: pct(teamCorrection, teamTotal),  priorPct: pct(priorCorrection, priorTotal),  isPositiveGood: false, color: '#e53e3e', note: 'gameLM had an error',  verdict: 'CORRECTION'  as Verdict },
          { label: 'Enhancements', currPct: pct(teamEnhancement, teamTotal), priorPct: pct(priorEnhancement, priorTotal), isPositiveGood: true,  color: '#854d0e', note: 'Agent added value',    verdict: 'ENHANCEMENT' as Verdict },
          { label: 'Preferences',  currPct: pct(teamPreference, teamTotal),  priorPct: pct(priorPreference, priorTotal),  isPositiveGood: false, color: '#58595B', note: 'Stylistic only',       verdict: 'PREFERENCE'  as Verdict },
        ].map(k => (
          <div
            key={k.label}
            onClick={() => setVerdictModal(k.verdict)}
            style={{
              background: '#fff', borderRadius: 14, padding: '16px 18px', cursor: 'pointer',
              border: '1.5px solid rgba(0,0,0,0.09)', transition: 'all 0.15s',
              position: 'relative',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.border = `1.5px solid ${k.color}40`
              e.currentTarget.style.boxShadow = `0 4px 16px rgba(0,0,0,0.07)`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.border = '1.5px solid rgba(0,0,0,0.09)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: k.color }}>{k.currPct}%</p>
            {range !== 'allTime' && (
              <div style={{ marginBottom: 4 }}>
                <TrendPip curr={k.currPct} prev={k.priorPct} isPositiveGood={k.isPositiveGood} fmt={n => `${n}pp`} />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>{k.note}</p>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: k.color, opacity: 0.6 }}>View themes →</span>
            </div>
          </div>
        ))}
      </div>

      {/* Per-agent / ticket-level toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
          {([
            { id: 'agents'  as const, label: 'Agent View'  },
            { id: 'tickets' as const, label: 'Ticket View' },
          ]).map(t => (
            <button key={t.id} onClick={() => setEvalsViewMode(t.id)} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: evalsViewMode === t.id ? 500 : 400,
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: evalsViewMode === t.id ? '#000' : 'transparent',
              color: evalsViewMode === t.id ? '#fff' : '#58595B',
              boxShadow: evalsViewMode === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {evalsViewMode === 'tickets' && (
        <EditEvalTicketLevelView rows={rows} onReviewUpdate={handleReviewUpdate} />
      )}

      {evalsViewMode === 'agents' && (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>Agent Breakdown</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => exportEditEvalCSV(rows, 'edit_evals_all.csv')}
              style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#CEA4FF'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'}
            >Export CSV</button>
            <button
              onClick={() => exportEditEvalJSONL(rows, 'edit_evals_all.jsonl')}
              style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >Export JSONL</button>
          </div>
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
      )}
      <div style={{ height: 8 }} />

      </> /* end topTab === 'evals' */}

      {/* Verdict theme modal */}
      {verdictModal && (
        <VerdictThemeModal
          verdict={verdictModal}
          rows={rows}
          onClose={() => setVerdictModal(null)}
        />
      )}
    </div>
  )
}
