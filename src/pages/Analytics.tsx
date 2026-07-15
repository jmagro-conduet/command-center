import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { getDailyTarget } from '../lib/settings'
import { useOperator } from '../context/OperatorContext'
import { useAuth } from '../context/AuthContext'

type Tab       = 'team' | 'agent' | 'events' | 'category'
type TimeRange = 'last7' | 'last30' | 'lastQuarter' | 'allTime' | 'custom'
// yyyy-mm-dd strings, inclusive on both ends — matches <input type="date"> value format
interface CustomRange { start: string; end: string }

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

interface DataRow {
  issueType:    string
  loggedAt:     string | null   // ticket_issues.logged_at  (set for live tickets)
  issuedAt:     string | null   // ticket_issues.created_at (set for imported tickets)
  ticketNumber: string
  ticketId:     string          // real tickets.id -- used instead of ticketNumber in QA mode
  agentName:    string
  agentEmail:   string
  category:     string
  createdAt:    string          // tickets.created_at (last-resort fallback)
}

// In QA mode, duplicate placeholder ticket numbers are expected -- this picks
// the real per-row id instead so distinct test submissions aren't collapsed
// into one. Production operators are unaffected (isQaMode is always false).
function ticketKey(r: DataRow, isQaMode: boolean): string {
  return isQaMode ? r.ticketId : r.ticketNumber
}

// ticket_issues.created_at (issuedAt) is always set — it's the historical date for imports
// and matches logged_at for live tickets. Use it as the primary date source.
function rowDate(r: DataRow): Date {
  return new Date(r.issuedAt ?? r.loggedAt ?? r.createdAt)
}

interface HotEvent {
  id: string; name: string; event_type: string
  start_date: string; end_date: string
  severity: string; notes: string | null
}

function rangeDays(range: TimeRange) {
  return range === 'last7' ? 7 : range === 'last30' ? 30 : range === 'lastQuarter' ? 90 : 0
}

function cutoff(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days); return d
}

function filterByRange(rows: DataRow[], range: TimeRange, customRange?: CustomRange | null) {
  if (range === 'custom' && customRange) {
    const start = new Date(`${customRange.start}T00:00:00`)
    const end   = new Date(`${customRange.end}T23:59:59.999`)
    return rows.filter(r => { const d = rowDate(r); return d >= start && d <= end })
  }
  if (range === 'allTime') return rows
  const c = cutoff(rangeDays(range))
  return rows.filter(r => rowDate(r) >= c)
}

function effectiveDays(rows: DataRow[], range: TimeRange, customRange?: CustomRange | null): number {
  if (range === 'custom' && customRange) {
    const start = new Date(`${customRange.start}T00:00:00`)
    const end   = new Date(`${customRange.end}T00:00:00`)
    return Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1, 1)
  }
  if (range !== 'allTime') return rangeDays(range)
  if (rows.length === 0) return 30
  const oldest = rows.reduce((min, r) => {
    const d = rowDate(r)
    return d < min ? d : min
  }, new Date())
  // +1 so the chart loop (which goes from days-1 down to 0) includes the oldest day
  return Math.max(Math.ceil((Date.now() - oldest.getTime()) / 86_400_000) + 1, 1)
}

// Anchors the day-by-day chart loop — "today" for every preset, but the custom
// range's own end date so a past custom window doesn't render as if it ended today.
function rangeEndDate(range: TimeRange, customRange: CustomRange | null): Date {
  if (range === 'custom' && customRange) return new Date(`${customRange.end}T00:00:00`)
  return new Date()
}

function rangeLabel(range: TimeRange, customRange: CustomRange | null): string {
  if (range === 'custom' && customRange) {
    return customRange.start === customRange.end
      ? fmtShortDateStr(customRange.start)
      : `${fmtShortDateStr(customRange.start)} – ${fmtShortDateStr(customRange.end)}`
  }
  return range === 'last7' ? 'Last 7 Days' : range === 'last30' ? 'Last 30 Days' : range === 'lastQuarter' ? 'Last 90 Days' : 'All Time'
}

function pct(n: number, total: number) {
  if (!total) return 0
  return parseFloat(((n / total) * 100).toFixed(1))
}

// Canonical category names — merges case-variant duplicates written by agents
// (e.g. "Bet dispute" → "Bet Dispute"). Add entries here whenever a new variant appears.
const CATEGORY_CANONICAL: Record<string, string> = {
  'bet dispute':         'Bet Dispute',
  'bet placement issue': 'Bet Placement Issue',
  'bonus/promotion':     'Bonus/promotion',
  'kyc/verification':    'KYC/verification',
  'deposit/withdrawal':  'Deposit/withdrawal',
  'account access':      'Account access',
  'technical issue':     'Technical issue',
  'game dispute':        'Game dispute',
  'responsible gaming':  'Responsible gaming',
  'tax / w2':            'Tax / W2',
  'tax/w2':              'Tax / W2',
  'win-loss statement':  'Win-Loss Statement',
  'win loss statement':  'Win-Loss Statement',
  'uncategorized':       'Other',
  'other':               'Other',
}

function normalizeCategory(raw: string): string {
  if (!raw) return ''
  const key = raw.trim().toLowerCase()
  return CATEGORY_CANONICAL[key] ?? raw.trim()
}

function buildMetricTrendData(rows: DataRow[], days: number, issueType: string, endDate: Date = new Date()) {
  const byDate = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const label = rowDate(r).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (!byDate.has(label)) byDate.set(label, { total: 0, count: 0 })
    const entry = byDate.get(label)!
    entry.total++
    if (r.issueType === issueType) entry.count++
  }
  const result: { date: string; fullDate: string; pct: number; movingAvg: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate); d.setDate(d.getDate() - i)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const entry = byDate.get(label) ?? { total: 0, count: 0 }
    result.push({ date: label, fullDate: toDateStr(d), pct: entry.total > 0 ? parseFloat(((entry.count / entry.total) * 100).toFixed(1)) : 0, movingAvg: 0 })
  }
  return result.map((pt, i) => {
    const win = result.slice(Math.max(0, i - 6), i + 1).filter(p => p.pct > 0)
    const avg = win.length ? parseFloat((win.reduce((a, b) => a + b.pct, 0) / win.length).toFixed(1)) : 0
    return { ...pt, movingAvg: avg }
  })
}

function buildChartData(
  rows: DataRow[], days: number, target: number, endDate: Date = new Date(),
  windowSize: number = 7, isQaMode: boolean = false
) {
  const byDate = new Map<string, Set<string>>()
  for (const r of rows) {
    const label = rowDate(r).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (!byDate.has(label)) byDate.set(label, new Set())
    byDate.get(label)!.add(ticketKey(r, isQaMode))
  }
  const result: { date: string; fullDate: string; count: number; movingAvg: number; target: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate); d.setDate(d.getDate() - i)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    result.push({ date: label, fullDate: toDateStr(d), count: byDate.get(label)?.size ?? 0, movingAvg: 0, target })
  }
  return result.map((pt, i) => {
    const win = result.slice(Math.max(0, i - (windowSize - 1)), i + 1)
    return { ...pt, movingAvg: Math.round(win.reduce((a, b) => a + b.count, 0) / win.length) }
  })
}

// rosterRows = all-time rows (for building the full agent list)
// periodRows = time-filtered rows (for computing stats)
function agentStats(periodRows: DataRow[], rosterRows: DataRow[], days: number, isQaMode: boolean = false) {
  // Identity key = email (case-insensitive) when present, else name. Keying by
  // email prevents two distinct agents who share a display name from merging into
  // one row — important as the roster grows across operators.
  const keyOf = (r: DataRow) => (r.agentEmail?.trim().toLowerCase()) || r.agentName

  // 1. Build full roster from all-time data so inactive agents still appear
  const roster = new Map<string, { name: string; email: string }>() // key -> display info
  for (const r of rosterRows) {
    if (!r.agentName && !r.agentEmail) continue
    const k = keyOf(r)
    if (k && !roster.has(k)) roster.set(k, { name: r.agentName, email: r.agentEmail })
  }

  // 2. Compute period stats (keyed by the same identity)
  const statsMap = new Map<string, { tickets: Set<string>; counts: Record<string, number> }>()
  for (const r of periodRows) {
    const k = keyOf(r)
    if (!k) continue
    if (!statsMap.has(k)) statsMap.set(k, { tickets: new Set(), counts: {} })
    const entry = statsMap.get(k)!
    entry.tickets.add(ticketKey(r, isQaMode))
    entry.counts[r.issueType] = (entry.counts[r.issueType] ?? 0) + 1
  }

  // 3. Merge: every roster agent gets stats (zeros if inactive this period)
  return [...roster.entries()].map(([k, { name, email }]) => {
    const s       = statsMap.get(k)
    const tickets = s?.tickets ?? new Set<string>()
    const counts  = s?.counts  ?? {}
    const total    = Object.values(counts).reduce((a, b) => a + b, 0)
    const perfect  = counts['Perfect']       ?? 0
    const majority = counts['Majority edit'] ?? 0
    const partial  = counts['Partial edit']  ?? 0
    const noResp   = counts['No response']   ?? 0
    const qd = perfect + majority + partial
    return {
      name, email, total: tickets.size, issueTotal: total,
      avg: parseFloat((tickets.size / days).toFixed(1)),
      perfect:  pct(perfect, qd),
      majority: pct(majority, qd),
      partial:  pct(partial, qd),
      noResp:   pct(noResp, total),
    }
  }).sort((a, b) => b.total - a.total)
}

function categoryStats(rows: DataRow[], isQaMode: boolean = false) {
  const map = new Map<string, { counts: Record<string, number>; tickets: Set<string>; noRespTickets: Set<string> }>()
  for (const r of rows) {
    const cat = r.category || 'Uncategorized'
    if (!map.has(cat)) map.set(cat, { counts: {}, tickets: new Set(), noRespTickets: new Set() })
    const entry = map.get(cat)!
    entry.counts[r.issueType] = (entry.counts[r.issueType] ?? 0) + 1
    entry.tickets.add(ticketKey(r, isQaMode))
    if (r.issueType === 'No response') entry.noRespTickets.add(ticketKey(r, isQaMode))
  }
  return [...map.entries()].map(([name, { counts, tickets, noRespTickets }]) => {
    const perfect  = counts['Perfect']       ?? 0
    const majority = counts['Majority edit'] ?? 0
    const partial  = counts['Partial edit']  ?? 0
    const noResp   = counts['No response']   ?? 0
    const vol          = perfect + majority + partial + noResp  // total issue rows (for volume display)
    const qualityDenom = perfect + majority + partial           // excludes No Response

    // Quality %s: how well gameLM responds when it does respond — sums to 100%
    const perfectPct  = pct(perfect,  qualityDenom)
    const majorityPct = pct(majority, qualityDenom)
    const partialPct  = pct(partial,  qualityDenom)

    // Escalation rate: tickets with ≥1 No Response / total tickets (ticket-level signal)
    const escalationRate = pct(noRespTickets.size, tickets.size)

    const status = vol < 10 ? 'low-data' : perfectPct >= 80 ? 'ready' : perfectPct >= 70 ? 'almost' : 'not-ready'
    let blocker = 'Need more data'
    if (vol >= 10) {
      if (escalationRate > 20 && perfectPct < 70) blocker = 'Quality + Escalation'
      else if (escalationRate > 20) blocker = 'High escalation rate'
      else if (perfectPct < 70) blocker = 'Response quality'
      else blocker = 'On track'
    }
    return { name, vol, tickets: tickets.size, perfect: perfectPct, majority: majorityPct, partial: partialPct, escalationRate, status, blocker }
  }).sort((a, b) => b.vol - a.vol)
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Supabase PostgREST has a server-side max-rows cap (default 1000).
// Paginate in chunks so we always retrieve all records regardless of that cap.
async function fetchAllIssues(operatorId: string | null) {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    let q = supabase
      .from('ticket_issues')
      .select('issue_type, logged_at, created_at, tickets!inner(id, ticket_number, agent_name, agent_email, ticket_category, created_at)')
      .order('created_at', { ascending: false })   // created_at is never NULL — safe for pagination
      .range(from, from + PAGE - 1)
    if (operatorId) q = q.eq('operator_id', operatorId)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// Org-team (e.g. "Manila") a lead can filter to — scoped to one operator.
interface OrgTeam { id: string; name: string }

export default function Analytics() {
  const { selectedOperator } = useOperator()
  const { user } = useAuth()
  const isSuperAdmin = !!user?.isSuperAdmin
  const [tab, setTab]         = useState<Tab>('team')
  const [allRows, setAllRows] = useState<DataRow[]>([])
  const [events, setEvents]   = useState<HotEvent[]>([])
  const [loading, setLoading] = useState(true)

  // Org-teams — only teams the current user leads (or, for SuperAdmins, every
  // team for this operator) show up as filter options. Applies across every tab.
  const [orgTeams, setOrgTeams] = useState<OrgTeam[]>([])
  const [myLeadTeamIds, setMyLeadTeamIds] = useState<Set<string>>(new Set())
  const [team, setTeam]         = useState('All teams')
  const [teamMemberEmails, setTeamMemberEmails] = useState<string[] | null>(null)
  const teamOptions = isSuperAdmin ? orgTeams : orgTeams.filter(t => myLeadTeamIds.has(t.id))
  const showTeamFilter = teamOptions.length > 0

  useEffect(() => {
    async function loadOrgTeams() {
      let q = supabase.from('org_teams').select('id, name')
      if (selectedOperator?.id) q = q.eq('operator_id', selectedOperator.id)
      const { data } = await q.order('name')
      setOrgTeams(data ?? [])
    }
    async function loadMyLeadTeams() {
      if (!user?.id) { setMyLeadTeamIds(new Set()); return }
      const { data } = await supabase.from('org_team_leads').select('team_id').eq('user_id', user.id)
      setMyLeadTeamIds(new Set((data ?? []).map((r: any) => r.team_id)))
    }
    loadOrgTeams()
    loadMyLeadTeams()
    setTeam('All teams')
  }, [selectedOperator?.id, user?.id])

  useEffect(() => {
    async function loadTeamMembers() {
      if (team === 'All teams') { setTeamMemberEmails(null); return }
      const found = orgTeams.find(t => t.name === team)
      if (!found) { setTeamMemberEmails(null); return }
      const { data } = await supabase.from('users').select('email').eq('org_team_id', found.id)
      setTeamMemberEmails((data ?? []).map((u: any) => (u.email ?? '').toLowerCase()).filter(Boolean))
    }
    loadTeamMembers()
  }, [team, orgTeams])

  const scopedRows = useMemo(() => {
    if (!teamMemberEmails) return allRows
    const set = new Set(teamMemberEmails)
    return allRows.filter(r => set.has((r.agentEmail ?? '').toLowerCase()))
  }, [allRows, teamMemberEmails])

  useEffect(() => {
    setLoading(true)
    async function load() {
      const [issues, { data: evts }] = await Promise.all([
        fetchAllIssues(selectedOperator?.id ?? null),
        supabase.from('hot_events').select('*').order('start_date', { ascending: false }),
      ])

      const rows: DataRow[] = issues.map((ti: any) => ({
        issueType:    ti.issue_type ?? '',
        loggedAt:     ti.logged_at  ?? null,
        issuedAt:     ti.created_at ?? null,   // ticket_issues.created_at — set for all rows
        ticketNumber: ti.tickets?.ticket_number ?? '',
        ticketId:     ti.tickets?.id ?? '',
        agentName:    ti.tickets?.agent_name  ?? '',
        agentEmail:   ti.tickets?.agent_email ?? '',
        category:     normalizeCategory(ti.tickets?.ticket_category ?? ''),
        createdAt:    ti.tickets?.created_at ?? '',
      }))

      setAllRows(rows)
      setEvents(evts ?? [])
      setLoading(false)
    }
    load()
  }, [selectedOperator?.id])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'team',     label: 'Team View'           },
    { id: 'agent',    label: 'Per Agent'            },
    { id: 'events',   label: 'Event Analytics'      },
    { id: 'category', label: 'Category Performance' },
  ]

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Analytics</h1>
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading analytics…</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Analytics</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {showTeamFilter && (
            <select
              value={team}
              onChange={e => setTeam(e.target.value)}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000',
                padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                border: '1.5px solid rgba(0,0,0,0.09)', outline: 'none', background: '#fff',
              }}
            >
              <option value="All teams">All teams</option>
              {teamOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.09)', padding: 3 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 13,
                fontWeight: tab === t.id ? 500 : 400,
                padding: '6px 14px', borderRadius: 8,
                background: tab === t.id ? '#000' : 'transparent',
                color: tab === t.id ? '#fff' : '#58595B',
                border: 'none', transition: 'all 0.15s', cursor: 'pointer',
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {tab === 'team'     && <TeamView     allRows={scopedRows} />}
      {tab === 'agent'    && <PerAgent     allRows={scopedRows} />}
      {tab === 'events'   && <EventAnalyticsTab allRows={scopedRows} events={events} />}
      {tab === 'category' && <CategoryPerformance allRows={scopedRows} />}
    </div>
  )
}

// ── Team View ─────────────────────────────────────────────────────────────────

const METRIC_CONFIG: Record<string, { color: string; goalDir: 'up' | 'down'; refValue?: number }> = {
  'Perfect':       { color: '#166534', goalDir: 'up',   refValue: 80 },
  'Majority edit': { color: '#854d0e', goalDir: 'down'               },
  'Partial edit':  { color: '#6b21a8', goalDir: 'down'               },
  'No response':   { color: '#e53e3e', goalDir: 'down'               },
}

function rangeToDateParams(range: TimeRange, customRange: CustomRange | null) {
  if (range === 'custom' && customRange) return { start: customRange.start, end: customRange.end }
  const end   = new Date()
  const start = new Date()
  if      (range === 'last7')        start.setDate(start.getDate() - 7)
  else if (range === 'last30')       start.setDate(start.getDate() - 30)
  else if (range === 'lastQuarter')  start.setDate(start.getDate() - 90)
  else                               start.setFullYear(start.getFullYear() - 3)
  return { start: toDateStr(start), end: toDateStr(end) }
}

function TeamView({ allRows }: { allRows: DataRow[] }) {
  const { selectedOperator } = useOperator()
  // ZD adoption only applies to operators with a real Zendesk brand configured —
  // skip the fetch entirely for everyone else rather than showing a number
  // contaminated by agents' unrelated work on other brands.
  const zendeskBrandId = selectedOperator?.zendeskBrandId ?? null
  const tracksZd = !!zendeskBrandId
  const isQaMode = !!selectedOperator?.isQaMode
  const agentTableColumns = tracksZd
    ? ['Agent', 'Tickets', 'Avg/Day', 'Perfect %', 'Majority %', 'Partial %', 'ZD Tickets', 'Adoption %', 'Status']
    : ['Agent', 'Tickets', 'Avg/Day', 'Perfect %', 'Majority %', 'Partial %', 'Status']
  const agentTableGridCols = tracksZd
    ? '1.5fr 100px 85px 95px 95px 95px 80px 80px 85px'
    : '1.5fr 100px 85px 95px 95px 95px 85px'
  const [range, setRange]             = useState<TimeRange>('last30')
  const [customRange, setCustomRange] = useState<CustomRange | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null)
  const [zdAgents, setZdAgents]       = useState<{ email: string; count: number }[] | null>(null)
  const [zdLoading, setZdLoading]     = useState(false)
  const [zdError, setZdError]         = useState<string | null>(null)

  // Team ZD total = sum of per-agent counts (only tickets our agents handled,
  // not all ZD native-messaging tickets across all brands / unassigned)
  const zdCount = useMemo(
    () => zdAgents ? zdAgents.reduce((s, a) => s + a.count, 0) : null,
    [zdAgents]
  )
  const dailyTarget = getDailyTarget()

  // Stable key of all-time agent emails — only changes when new agents appear in the DB
  const rosterEmailsKey = useMemo(
    () => [...new Set(allRows.map(r => r.agentEmail).filter(Boolean))].sort().join(','),
    [allRows]
  )

  useEffect(() => {
    if (!tracksZd) { setZdAgents(null); setZdError(null); setZdLoading(false); return }
    const agentEmails = rosterEmailsKey ? rosterEmailsKey.split(',') : []
    if (agentEmails.length === 0) return   // wait until agent roster is loaded

    let cancelled = false
    async function fetchZd() {
      setZdLoading(true)
      setZdError(null)
      try {
        const { start, end } = rangeToDateParams(range, customRange)
        const { data, error } = await supabase.functions.invoke('zendesk-tickets', {
          body: { start_date: start, end_date: end, agent_emails: agentEmails, brand_id: zendeskBrandId },
        })
        if (!cancelled) {
          if (error) {
            setZdAgents(null)
            setZdError(error.message ?? 'Edge function error')
          } else if (Array.isArray(data?.agents)) {
            setZdAgents(data.agents)
            if (data?.error) setZdError(data.error)
          } else {
            setZdAgents(null)
            setZdError(data?.error ?? 'No data returned')
          }
        }
      } catch (e: any) {
        if (!cancelled) { setZdAgents(null); setZdError(e?.message ?? 'Fetch failed') }
      } finally {
        if (!cancelled) setZdLoading(false)
      }
    }
    fetchZd()
    return () => { cancelled = true }
  }, [range, customRange, rosterEmailsKey, tracksZd, zendeskBrandId])

  const rows = useMemo(() => filterByRange(allRows, range, customRange), [allRows, range, customRange])
  const days = useMemo(() => effectiveDays(rows, range, customRange), [rows, range, customRange])
  const chartEndDate = useMemo(() => rangeEndDate(range, customRange), [range, customRange])

  const agents = useMemo(() => agentStats(rows, allRows, days, isQaMode), [rows, allRows, days, isQaMode])

  const kpis = useMemo(() => {
    const tickets = new Set(rows.map(r => ticketKey(r, isQaMode)))
    const total   = rows.length
    const perfect = rows.filter(r => r.issueType === 'Perfect').length
    const majority = rows.filter(r => r.issueType === 'Majority edit').length
    const partial  = rows.filter(r => r.issueType === 'Partial edit').length
    const noResp   = rows.filter(r => r.issueType === 'No response').length
    const qd = perfect + majority + partial
    return {
      tickets: tickets.size,
      issues:  total,
      avgPerTicket: tickets.size ? (total / tickets.size).toFixed(1) : '0',
      avgPerDay:    (tickets.size / days).toFixed(1),
      perfectPct:  pct(perfect, qd).toFixed(1),
      majorityPct: pct(majority, qd).toFixed(1),
      partialPct:  pct(partial, qd).toFixed(1),
      noRespPct:   pct(noResp, total).toFixed(1),
    }
  }, [rows, days, isQaMode])

  const agentRows = useMemo(() => {
    if (!selectedAgent) return rows
    return rows.filter(r => r.agentName === selectedAgent)
  }, [rows, selectedAgent])

  const chartData = useMemo(() => buildChartData(agentRows, days, dailyTarget.max, chartEndDate, 7, isQaMode), [agentRows, days, dailyTarget.max, chartEndDate, isQaMode])
  const metricChartData = useMemo(
    () => selectedMetric ? buildMetricTrendData(agentRows, days, selectedMetric, chartEndDate) : [],
    [agentRows, days, selectedMetric, chartEndDate]
  )

  // Clicking a node (day) on either chart pins the view to that single day —
  // lets a lead drill straight into an agent's good/bad day. Recharts 3's onClick
  // payload has no activePayload (that's a recharts@2-ism) — it gives activeLabel,
  // the XAxis dataKey value ("date") of the clicked point, which we match back
  // against the same array driving the chart to recover its ISO fullDate.
  function onChartNodeClick(e: any, sourceData: { date: string; fullDate: string }[]) {
    const match = sourceData.find(d => d.date === e?.activeLabel)
    if (!match) return
    setCustomRange({ start: match.fullDate, end: match.fullDate })
    setRange('custom')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {/* Row 1: Tickets | Responses | ZD Live Chat */}
        {[
          { label: `Tickets (${range === 'custom' ? rangeLabel(range, customRange) : rangeLabel(range, customRange).toLowerCase()})`, value: kpis.tickets.toString() },
          { label: 'Responses', value: kpis.issues.toString() },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#9B59D0' }}>{k.value}</p>
          </div>
        ))}

        {/* ZD card — row 1, position 3. Only for operators with a Zendesk brand configured. */}
        {tracksZd && (
          <div style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>ZD Live Chat Tickets</p>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 100, background: 'rgba(243,156,18,0.12)', color: '#b45309', letterSpacing: '0.05em' }}>ZENDESK</span>
            </div>
            {zdLoading ? (
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: 'rgba(0,0,0,0.2)' }}>…</p>
            ) : zdError ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e53e3e', marginTop: 4 }}>{zdError}</p>
            ) : zdCount !== null ? (
              <>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#b45309' }}>
                  {zdCount.toLocaleString()}
                </p>
                {zdCount > 0 && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 3 }}>
                    <span style={{ fontWeight: 500, color: '#b45309' }}>
                      {((kpis.tickets / zdCount) * 100).toFixed(1)}%
                    </span>
                    {' '}of ZD tickets logged
                  </p>
                )}
              </>
            ) : (
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: 'rgba(0,0,0,0.2)' }}>—</p>
            )}
          </div>
        )}

        {/* Row 2: Avg responses/ticket | Team avg/day | Target range */}
        {[
          { label: 'Avg responses / ticket', value: kpis.avgPerTicket },
          { label: 'Team avg tickets / day', value: kpis.avgPerDay },
          { label: 'Target range / agent',   value: `${dailyTarget.min}–${dailyTarget.max}` },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#9B59D0' }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Perfect rate',  issueKey: 'Perfect',       value: `${kpis.perfectPct}%`,  color: '#166534' },
          { label: 'Majority edit', issueKey: 'Majority edit', value: `${kpis.majorityPct}%`, color: '#854d0e' },
          { label: 'Partial edit',  issueKey: 'Partial edit',  value: `${kpis.partialPct}%`,  color: '#6b21a8' },
          { label: 'No response',   issueKey: 'No response',   value: `${kpis.noRespPct}%`,   color: '#e53e3e' },
        ].map(k => {
          const isActive = selectedMetric === k.issueKey
          return (
            <div key={k.label}
              onClick={() => setSelectedMetric(s => s === k.issueKey ? null : k.issueKey)}
              style={{
                background: isActive ? `${k.color}08` : '#fff',
                borderRadius: 14,
                border: isActive ? `1.5px solid ${k.color}` : '1.5px solid rgba(0,0,0,0.09)',
                padding: '16px 18px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                position: 'relative',
              }}
            >
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: k.color }}>{k.value}</p>
              {isActive && (
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: k.color, marginTop: 4, opacity: 0.8 }}>↓ Trend below</p>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: selectedMetric ? `1.5px solid ${METRIC_CONFIG[selectedMetric]?.color ?? 'rgba(0,0,0,0.09)'}40` : '1.5px solid rgba(0,0,0,0.09)', padding: 24, transition: 'border-color 0.2s' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            {selectedMetric ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>
                    {selectedMetric} — Daily Trend
                  </p>
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600,
                    padding: '2px 8px', borderRadius: 100,
                    background: `${METRIC_CONFIG[selectedMetric]?.color}15`,
                    color: METRIC_CONFIG[selectedMetric]?.color,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {METRIC_CONFIG[selectedMetric]?.goalDir === 'up' ? '↑ Higher is better' : '↓ Lower is better'}
                  </span>
                </div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
                  {rangeLabel(range, customRange)} — click a day on the chart to drill in, or a metric card again to dismiss
                </p>
              </>
            ) : (
              <>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>
                  {selectedAgent ? `${selectedAgent} – Tickets Logged` : 'Team Performance'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
                  {rangeLabel(range, customRange)}
                  <span style={{ color: '#aaa' }}> — click a day on the chart to drill in{!selectedAgent ? ', or a metric card above to see its trend' : ''}</span>
                </p>
              </>
            )}
          </div>
          <TimeRangeFilter value={range} onChange={setRange} customRange={customRange} onCustomChange={setCustomRange} />
        </div>

        {selectedMetric ? (() => {
          const mc = METRIC_CONFIG[selectedMetric]
          const data = metricChartData
          const avgPct = data.filter(d => d.pct > 0).reduce((s, d) => s + d.pct, 0) / (data.filter(d => d.pct > 0).length || 1)
          return (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data} margin={{ top: 4, right: 28, left: -20, bottom: 0 }} onClick={e => onChartNodeClick(e, data)} style={{ cursor: 'pointer' }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="date" tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} interval={Math.floor(data.length / 6)} />
                <YAxis tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ fontFamily: 'Inter', fontSize: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  formatter={(val, name) => [`${val ?? 0}%`, name === 'pct' ? 'Daily %' : '7-Day Avg'] as [string, string]}
                />
                {mc?.refValue && (
                  <ReferenceLine y={mc.refValue} stroke={mc.color} strokeDasharray="5 5" strokeWidth={1.5}
                    label={{ value: `${mc.refValue}% goal`, position: 'right', fontSize: 11, fill: mc.color, fontFamily: 'Inter' }} />
                )}
                <ReferenceLine y={parseFloat(avgPct.toFixed(1))} stroke="rgba(0,0,0,0.2)" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: `avg ${avgPct.toFixed(1)}%`, position: 'right', fontSize: 10, fill: '#aaa', fontFamily: 'Inter' }} />
                <Line type="monotone" dataKey="pct" stroke={mc?.color ?? '#9B59D0'} strokeWidth={2} dot={{ r: 3, fill: mc?.color ?? '#9B59D0' }} activeDot={{ r: 5 }} name="pct" />
                <Line type="monotone" dataKey="movingAvg" stroke={mc?.color ?? '#CEA4FF'} strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="movingAvg" opacity={0.6} />
              </LineChart>
            </ResponsiveContainer>
          )
        })() : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }} onClick={e => onChartNodeClick(e, chartData)} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="date" tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ fontFamily: 'Inter', fontSize: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
              <ReferenceLine y={dailyTarget.max} stroke="#CEA4FF" strokeDasharray="5 5" strokeWidth={1.5} label={{ value: 'Target', position: 'right', fontSize: 11, fill: '#9B59D0', fontFamily: 'Inter' }} />
              <Line type="monotone" dataKey="count" stroke="#9B59D0" strokeWidth={2} dot={{ r: 3, fill: '#9B59D0' }} activeDot={{ r: 5 }} name="Daily Count" />
              <Line type="monotone" dataKey="movingAvg" stroke="#CEA4FF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="7-Day Avg" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>Agent Performance Summary</p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>Click an agent row to view their chart above</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: agentTableGridCols, padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
          {agentTableColumns.map(h => (
            <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
          ))}
        </div>
        {agents.map((a, i) => {
          const onTrack = a.avg >= dailyTarget.min
          const almost  = !onTrack && a.avg >= dailyTarget.min * 0.5
          const statusLabel = onTrack ? 'ON TRACK' : almost ? 'ALMOST' : 'OFF TRACK'
          const statusColor = onTrack ? '#166534' : almost ? '#854d0e' : '#854d0e'
          const statusBg    = onTrack ? 'rgba(22,101,52,0.09)' : 'rgba(234,179,8,0.12)'

          // ZD data is now keyed by email — direct lookup, no name matching needed
          const zdMatch = zdAgents?.find(z =>
            a.email && z.email && a.email.toLowerCase() === z.email.toLowerCase()
          )
          const zdTickets   = zdMatch?.count ?? null
          const rawAdoption = zdTickets && zdTickets > 0
            ? (a.total / zdTickets) * 100
            : null
          // Show real adoption % — values above 100 indicate gameLM was logged on tickets
          // not counted under this agent in ZD (cross-assignment, group routing, etc.)
          const adoptionPct = rawAdoption !== null
            ? rawAdoption.toFixed(1)
            : null

          return (
            <div key={a.email || a.name} onClick={() => setSelectedAgent(s => s === a.name ? null : a.name)}
              style={{
                display: 'grid', gridTemplateColumns: agentTableGridCols,
                padding: '12px 20px', alignItems: 'center', cursor: 'pointer',
                borderBottom: i < agents.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                background: selectedAgent === a.name ? 'rgba(206,164,255,0.07)' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (selectedAgent !== a.name) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
              onMouseLeave={e => { e.currentTarget.style.background = selectedAgent === a.name ? 'rgba(206,164,255,0.07)' : 'transparent' }}
            >
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{a.name}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{a.total}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{a.avg}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534', fontWeight: 500 }}>{a.perfect}%</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#854d0e' }}>{a.majority}%</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#6b21a8' }}>{a.partial}%</span>
              {tracksZd && (
                <>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: zdLoading ? 'rgba(0,0,0,0.2)' : '#b45309' }}>
                    {zdLoading ? '…' : zdTickets !== null ? zdTickets : '—'}
                  </span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 13,
                    color: zdLoading ? 'rgba(0,0,0,0.2)'
                      : adoptionPct !== null && parseFloat(adoptionPct) > 100 ? '#e53e3e'
                      : adoptionPct !== null ? '#b45309'
                      : '#aaa',
                    fontWeight: adoptionPct !== null ? 500 : 400,
                  }}>
                    {zdLoading ? '…' : adoptionPct !== null ? `${adoptionPct}%` : '—'}
                  </span>
                </>
              )}
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 100, background: statusBg, color: statusColor }}>{statusLabel}</span>
            </div>
          )
        })}
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ── Per Agent ─────────────────────────────────────────────────────────────────

function PerAgent({ allRows }: { allRows: DataRow[] }) {
  const { selectedOperator } = useOperator()
  const isQaMode = !!selectedOperator?.isQaMode
  const [range, setRange]             = useState<TimeRange>('last30')
  const [customRange, setCustomRange] = useState<CustomRange | null>(null)
  const dailyTarget = getDailyTarget()
  const rows  = useMemo(() => filterByRange(allRows, range, customRange), [allRows, range, customRange])
  const days  = useMemo(() => effectiveDays(rows, range, customRange), [rows, range, customRange])
  const chartEndDate = useMemo(() => rangeEndDate(range, customRange), [range, customRange])
  const agents = useMemo(() => agentStats(rows, allRows, days, isQaMode), [rows, allRows, days, isQaMode])

  const [selected, setSelected] = useState('')
  const activeAgent = useMemo(() => agents[0]?.name ?? '', [agents])
  const agentName   = selected || activeAgent

  const agent = useMemo(() => agents.find(a => a.name === agentName) ?? agents[0], [agents, agentName])

  const agentRows  = useMemo(() => rows.filter(r => r.agentName === agentName), [rows, agentName])
  // 5-day window, not 7 — agents work a 5-day week, so a 7-day trailing
  // average gets diluted by their off days (team-level trend stays 7-day).
  const chartData  = useMemo(() => buildChartData(agentRows, days, dailyTarget.max, chartEndDate, 5, isQaMode), [agentRows, days, dailyTarget.max, chartEndDate, isQaMode])

  // Clicking a node (day) on the chart pins the view to that single day —
  // lets a lead drill straight into this agent's good/bad day. Recharts 3's
  // onClick payload has no activePayload (that's a recharts@2-ism) — match
  // activeLabel (the "date" XAxis value) back against chartData for fullDate.
  function onChartNodeClick(e: any) {
    const match = chartData.find(d => d.date === e?.activeLabel)
    if (!match) return
    setCustomRange({ start: match.fullDate, end: match.fullDate })
    setRange('custom')
  }

  if (!agent) return null

  const onTrack = agent.avg >= dailyTarget.min
  const statusLabel = onTrack ? 'On Track' : agent.avg >= dailyTarget.min * 0.5 ? 'Almost' : 'Off Track'
  const statusColor = onTrack ? '#166534' : '#854d0e'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {agents.map(a => (
          <button key={a.email || a.name} onClick={() => setSelected(a.name)} style={{
            background: '#fff', borderRadius: 14, textAlign: 'left',
            border: agentName === a.name ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.09)',
            padding: '14px 16px', transition: 'all 0.15s', cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{a.name}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: a.avg >= dailyTarget.min ? 'rgba(22,101,52,0.09)' : 'rgba(234,179,8,0.12)', color: a.avg >= dailyTarget.min ? '#166534' : '#854d0e' }}>
                {a.avg >= dailyTarget.min ? 'ON TRACK' : 'OFF TRACK'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg/day</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>{a.avg}</p>
              </div>
              <div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tickets</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>{a.total}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 16 }}>
          {agent.name} – Performance Details
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
          {[
            { label: 'Tickets',           value: agent.total.toString(),  color: '#9B59D0' },
            { label: 'Avg Tickets/Day',   value: agent.avg.toString(),    color: '#9B59D0' },
            { label: 'Perfect Rate',      value: `${agent.perfect}%`,     color: '#166534' },
            { label: `Status vs Target (${dailyTarget.min}–${dailyTarget.max})`, value: statusLabel, color: statusColor },
          ].map(k => (
            <div key={k.label} style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>
            {rangeLabel(range, customRange)} — click a day on the chart to pin the range to it
          </p>
          <TimeRangeFilter value={range} onChange={setRange} customRange={customRange} onCustomChange={setCustomRange} />
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }} onClick={onChartNodeClick} style={{ cursor: 'pointer' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="date" tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} interval={Math.floor(chartData.length / 6)} />
            <YAxis tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ fontFamily: 'Inter', fontSize: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)' }} />
            <ReferenceLine y={dailyTarget.max} stroke="#CEA4FF" strokeDasharray="5 5" strokeWidth={1.5} />
            <Line type="monotone" dataKey="count" stroke="#9B59D0" strokeWidth={2} dot={{ r: 3, fill: '#9B59D0' }} activeDot={{ r: 5 }} name="Daily" />
            <Line type="monotone" dataKey="movingAvg" stroke="#CEA4FF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="5-Day Avg" />
          </LineChart>
        </ResponsiveContainer>

        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(206,164,255,0.06)', border: '1px solid rgba(206,164,255,0.2)' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#9B59D0', marginBottom: 4 }}>Insights</p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.6 }}>
            {agent.name} is logging {agent.avg} tickets/day vs target of {dailyTarget.min}–{dailyTarget.max}.{' '}
            {onTrack
              ? 'Volume is on track. '
              : `Volume is below target — averaging ${agent.avg}/day against a ${dailyTarget.min}–${dailyTarget.max} range. `}
            {agent.perfect < 60
              ? 'Perfect rate is below 60% — consider a review session on gameLM response quality.'
              : 'Perfect rate is solid.'}
            {agent.noResp > 20 ? ` No-response rate of ${agent.noResp}% is elevated — coverage gaps may need product attention.` : ''}
          </p>
        </div>
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ── Event Analytics ───────────────────────────────────────────────────────────

function EventAnalyticsTab({ allRows, events }: { allRows: DataRow[]; events: HotEvent[] }) {
  const { selectedOperator } = useOperator()
  const isQaMode = !!selectedOperator?.isQaMode
  const now = new Date()

  const eventsWithStats = useMemo(() => events.map(evt => {
    const start = new Date(evt.start_date)
    const end   = new Date(evt.end_date); end.setHours(23, 59, 59)
    const evtRows = allRows.filter(r => {
      const d = rowDate(r)
      return d >= start && d <= end
    })
    const tickets = new Set(evtRows.map(r => ticketKey(r, isQaMode))).size
    const total   = evtRows.length
    const perfect = evtRows.filter(r => r.issueType === 'Perfect').length
    return {
      ...evt,
      tickets,
      issues:      total,
      perfectPct:  pct(perfect, total),
      noRespPct:   pct(evtRows.filter(r => r.issueType === 'No response').length, total),
      isPast:      new Date(evt.end_date) < now,
    }
  }), [allRows, events, isQaMode])

  const past     = eventsWithStats.filter(e => e.isPast)
  const upcoming = eventsWithStats.filter(e => !e.isPast)

  const severityColor = (s: string) =>
    s === 'high' ? '#e53e3e' : s === 'medium' ? '#854d0e' : '#58595B'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {past.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>Past Events — Actual Performance</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>Ticket volume and quality metrics logged during each event window</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 120px 100px 90px 110px 110px', padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
            {['Event', 'Dates', 'Severity', 'Tickets', 'Perfect %', 'No Resp %'].map(h => (
              <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
            ))}
          </div>
          {past.map((e, i) => (
            <div key={e.id} style={{
              display: 'grid', gridTemplateColumns: '1.8fr 120px 100px 90px 110px 110px',
              padding: '14px 20px', alignItems: 'center',
              borderBottom: i < past.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
              transition: 'background 0.15s',
            }}
              onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(0,0,0,0.02)')}
              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{e.name}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>
                {new Date(e.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(e.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 100, width: 'fit-content', background: `${severityColor(e.severity)}15`, color: severityColor(e.severity), textTransform: 'capitalize' }}>
                {e.severity}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{e.tickets || '—'}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534', fontWeight: 500 }}>{e.issues ? `${e.perfectPct}%` : '—'}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: e.noRespPct > 20 ? '#e53e3e' : '#58595B' }}>{e.issues ? `${e.noRespPct}%` : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>Upcoming Events</p>
          </div>
          {upcoming.map((e, i) => (
            <div key={e.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 20px',
              borderBottom: i < upcoming.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
            }}>
              <div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500, color: '#000' }}>{e.name}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', marginTop: 2 }}>
                  {new Date(e.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(e.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 100, background: `${severityColor(e.severity)}15`, color: severityColor(e.severity), textTransform: 'capitalize' }}>
                {e.severity}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 8 }} />
    </div>
  )
}

// ── Category Performance ──────────────────────────────────────────────────────

function CategoryPerformance({ allRows }: { allRows: DataRow[] }) {
  const { selectedOperator } = useOperator()
  const isQaMode = !!selectedOperator?.isQaMode
  const [range, setRange]             = useState<TimeRange>('last7')
  const [customRange, setCustomRange] = useState<CustomRange | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)

  const rows = useMemo(() => filterByRange(allRows, range, customRange), [allRows, range, customRange])
  const days = useMemo(() => effectiveDays(rows, range, customRange), [rows, range, customRange])
  const cats = useMemo(() => categoryStats(rows, isQaMode), [rows, isQaMode])

  const ready    = cats.filter(c => c.status === 'ready').length
  const almost   = cats.filter(c => c.status === 'almost').length
  const notReady = cats.filter(c => c.status === 'not-ready').length
  const lowData  = cats.filter(c => c.status === 'low-data').length
  const total    = cats.length

  const qualityIssues = rows.filter(r => r.issueType !== 'No response').length
  const overallPerfect  = qualityIssues ? Math.round(rows.filter(r => r.issueType === 'Perfect').length      / qualityIssues * 100) : 0
  const overallMajority = qualityIssues ? Math.round(rows.filter(r => r.issueType === 'Majority edit').length / qualityIssues * 100) : 0
  const overallPartial  = qualityIssues ? Math.round(rows.filter(r => r.issueType === 'Partial edit').length  / qualityIssues * 100) : 0
  // Escalation rate: tickets with ≥1 No Response / all tickets (ticket-level, not issue-level)
  const allTicketNums        = new Set(rows.map(r => ticketKey(r, isQaMode)))
  const escalatedTicketNums  = new Set(rows.filter(r => r.issueType === 'No response').map(r => ticketKey(r, isQaMode)))
  const overallEscalationRate = allTicketNums.size ? Math.round(escalatedTicketNums.size / allTicketNums.size * 100) : 0

  const totalVol = cats.reduce((s, c) => s + c.vol, 0)

  const pieData = [
    { name: 'Autopilot Ready', value: ready,    color: '#166534' },
    { name: 'Almost (70%+)',   value: almost,   color: '#854d0e' },
    { name: 'Not Ready',       value: notReady, color: '#e53e3e' },
    { name: 'Low Data',        value: lowData,  color: '#d1d5db' },
  ].filter(d => d.value > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showInfo ? 16 : 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000' }}>Autopilot Readiness</p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
                Track each category toward the 80% perfect rate needed for full gameLM automation
              </p>
            </div>
            <button
              onClick={() => setShowInfo(s => !s)}
              title="How to read this"
              style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                border: showInfo ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.15)',
                background: showInfo ? 'rgba(155,89,208,0.08)' : 'transparent',
                color: showInfo ? '#9B59D0' : '#58595B',
                fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginTop: 2,
              }}
            >
              ⓘ
            </button>
          </div>
          <TimeRangeFilter value={range} onChange={setRange} customRange={customRange} onCustomChange={setCustomRange} />
        </div>

        {showInfo && (
          <div style={{
            marginBottom: 20, padding: 16, borderRadius: 12,
            background: 'rgba(155,89,208,0.04)', border: '1.5px solid rgba(155,89,208,0.15)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {[
                {
                  title: 'Perfect / Majority / Partial',
                  color: '#166534',
                  body: 'These three always sum to 100%. They measure how well gameLM responded on interactions it actually attempted — No Response is excluded from the denominator. The 80% Perfect threshold is the Full Auto readiness target.',
                },
                {
                  title: 'Escalation Rate',
                  color: '#e53e3e',
                  body: 'Ticket-level metric: the % of tickets in this category where at least one interaction got No Response — meaning gameLM had no answer and a human had to step in. Note: because categories are set at the ticket level, a small % of escalations may belong to a different topic that slipped into the ticket.',
                },
                {
                  title: 'Full Auto Readiness',
                  color: '#9B59D0',
                  body: 'A category needs both signals healthy before going live: quality score ≥ 80% and a low escalation rate. High quality + high escalation means gameLM is strong on what it knows but still hits too many gaps. Both must clear the bar.',
                },
              ].map(s => (
                <div key={s.title}>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: s.color, marginBottom: 5 }}>{s.title}</p>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.6 }}>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <PieChart width={110} height={110}>
              <Pie data={pieData.length ? pieData : [{ name: 'empty', value: 1, color: '#e5e5e5' }]}
                cx={50} cy={50} innerRadius={32} outerRadius={50} dataKey="value" paddingAngle={2}>
                {(pieData.length ? pieData : [{ color: '#e5e5e5' }]).map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 700, color: '#000', lineHeight: 1 }}>{ready}/{total}</p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#aaa' }}>Ready</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { label: 'Autopilot Ready', color: '#166534', count: ready    },
              { label: 'Almost (70%+)',   color: '#854d0e', count: almost   },
              { label: 'Not Ready',       color: '#e53e3e', count: notReady },
              { label: 'Low Data',        color: '#d1d5db', count: lowData  },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{l.count} {l.label}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 1, flex: 1, borderLeft: '1px solid rgba(0,0,0,0.07)', paddingLeft: 32 }}>
            {[
              { label: 'Perfect rate',    value: `${overallPerfect}%`,         color: overallPerfect >= 80 ? '#166534' : overallPerfect >= 70 ? '#854d0e' : '#e53e3e', note: 'of responses' },
              { label: 'Majority edit',   value: `${overallMajority}%`,        color: '#854d0e',                                                                        note: 'of responses' },
              { label: 'Partial edit',    value: `${overallPartial}%`,         color: '#f97316',                                                                        note: 'of responses' },
              { label: 'Escalation rate', value: `${overallEscalationRate}%`,  color: overallEscalationRate > 20 ? '#e53e3e' : '#58595B',                              note: 'of tickets' },
            ].map(k => (
              <div key={k.label} style={{ flex: 1, padding: '0 16px', borderRight: '1px solid rgba(0,0,0,0.07)' }}>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: k.color }}>{k.value}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 1 }}>{k.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 60px 80px 90px 90px 90px 80px 1fr', padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
          {['Category', 'Vol', '% of Total', 'Perfect', 'Majority', 'Partial', 'Escalation', 'Progress to 80%'].map(h => (
            <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
          ))}
        </div>

        {cats.map(cat => {
          const isExpanded = expanded === cat.name
          const gap = Math.max(0, Math.round(80 - cat.perfect))
          const barColor = cat.perfect >= 80 ? '#166534' : cat.perfect >= 70 ? '#854d0e' : cat.perfect >= 50 ? '#f97316' : '#e53e3e'

          // Per-agent breakdown for this category — roster must be built from THIS
          // category's rows, not allRows, otherwise every agent in the system is
          // listed under every category with 0 issues / 0% (padding the breakdown).
          const catAgentRows = rows.filter(r => (r.category || 'Uncategorized') === cat.name)
          const catAgents = agentStats(catAgentRows, catAgentRows, days, isQaMode)

          return (
            <div key={cat.name}>
              <div onClick={() => setExpanded(isExpanded ? null : cat.name)}
                style={{
                  display: 'grid', gridTemplateColumns: '1.6fr 60px 80px 90px 90px 90px 80px 1fr',
                  padding: '12px 20px', alignItems: 'center', cursor: 'pointer',
                  borderBottom: '1px solid rgba(0,0,0,0.05)',
                  background: isExpanded ? 'rgba(206,164,255,0.06)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isExpanded ? 'rgba(206,164,255,0.06)' : 'transparent' }}
              >
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#9B59D0', fontSize: 10 }}>{isExpanded ? '▼' : '▶'}</span>{cat.name}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{cat.vol}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{totalVol ? (cat.vol / totalVol * 100).toFixed(1) : '0.0'}%</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: barColor }}>{cat.perfect}%</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: cat.majority > 10 ? '#e53e3e' : '#58595B' }}>{cat.majority}%</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: cat.partial > 10 ? '#e53e3e' : '#58595B' }}>{cat.partial}%</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: cat.escalationRate > 20 ? '#e53e3e' : '#58595B' }}>{cat.escalationRate}%</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 100, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (cat.perfect / 80) * 100)}%`, height: '100%', background: barColor, borderRadius: 100, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: gap === 0 ? '#166534' : '#e53e3e', fontWeight: 500, flexShrink: 0 }}>{gap === 0 ? '✓ Ready' : `−${gap}pp`}</span>
                </div>
              </div>

              {isExpanded && catAgents.length > 0 && (
                <div style={{ padding: '0 20px 16px', background: 'rgba(206,164,255,0.03)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', padding: '14px 0 10px' }}>
                    Agent breakdown — {cat.name}
                  </p>
                  <div style={{ borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 100px 90px 90px 1fr', padding: '8px 14px', background: 'rgba(0,0,0,0.03)', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                      {['Agent', 'Issues', 'Perfect', 'Majority', 'Partial', 'Progress'].map(h => (
                        <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
                      ))}
                    </div>
                    {catAgents.map((a, ai) => {
                      const agentGap = Math.max(0, Math.round(80 - a.perfect))
                      const agentBarColor = a.perfect >= 80 ? '#166534' : a.perfect >= 70 ? '#854d0e' : a.perfect >= 50 ? '#f97316' : '#e53e3e'
                      return (
                        <div key={a.email || a.name} style={{
                          display: 'grid', gridTemplateColumns: '1.5fr 80px 100px 90px 90px 1fr',
                          padding: '10px 14px', alignItems: 'center',
                          borderBottom: ai < catAgents.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                        }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{a.name}</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{a.issueTotal}</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: agentBarColor, fontWeight: 500 }}>{a.perfect}%</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: a.majority > 10 ? '#e53e3e' : '#58595B' }}>{a.majority}%</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: a.partial > 10 ? '#e53e3e' : '#58595B' }}>{a.partial}%</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 5, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                              <div style={{ width: `${Math.min(100, (a.perfect / 80) * 100)}%`, height: '100%', background: agentBarColor, borderRadius: 100 }} />
                            </div>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: agentGap === 0 ? '#166534' : '#e53e3e', flexShrink: 0 }}>{agentGap === 0 ? '✓' : `−${agentGap}pp`}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Perfect rate:</span>
            {[
              { color: '#166534', label: 'Ready', range: '80%+' },
              { color: '#854d0e', label: 'Almost', range: '70–80%' },
              { color: '#f97316', label: 'Getting there', range: '50–70%' },
              { color: '#e53e3e', label: 'Not ready', range: '<50%' },
            ].map(l => (
              <span key={l.label} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, display: 'inline-block', flexShrink: 0 }} />
                <strong style={{ color: l.color }}>{l.label}</strong> {l.range}
              </span>
            ))}
          </div>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', fontStyle: 'italic' }}>
            * Quality % excludes No Response. Categories are assigned at the ticket level — a small margin of error exists where a ticket may contain inputs across multiple categories.
          </span>
        </div>
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function fmtShortDateStr(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function TimeRangeFilter({ value, onChange, customRange, onCustomChange }: {
  value: TimeRange
  onChange: (v: TimeRange) => void
  customRange: CustomRange | null
  onCustomChange: (r: CustomRange) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(customRange?.start ?? toDateStr(new Date()))
  const [draftEnd,   setDraftEnd]   = useState(customRange?.end   ?? toDateStr(new Date()))

  const opts: { id: TimeRange; label: string }[] = [
    { id: 'last7',       label: 'Last 7'       },
    { id: 'last30',      label: 'Last 30'      },
    { id: 'lastQuarter', label: 'Last Quarter' },
    { id: 'allTime',     label: 'All Time'     },
  ]

  function openPicker() {
    setDraftStart(customRange?.start ?? toDateStr(new Date()))
    setDraftEnd(customRange?.end ?? toDateStr(new Date()))
    setPickerOpen(o => !o)
  }

  function apply() {
    if (!draftStart || !draftEnd) return
    const start = draftStart <= draftEnd ? draftStart : draftEnd
    const end   = draftStart <= draftEnd ? draftEnd : draftStart
    onCustomChange({ start, end })
    onChange('custom')
    setPickerOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
        {opts.map(o => (
          <button key={o.id} onClick={() => { onChange(o.id); setPickerOpen(false) }} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: value === o.id ? 500 : 400,
            padding: '5px 12px', borderRadius: 6,
            background: value === o.id ? '#fff' : 'transparent',
            color: value === o.id ? '#000' : '#58595B',
            border: 'none', transition: 'all 0.15s', cursor: 'pointer',
            boxShadow: value === o.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
          }}>
            {o.label}
          </button>
        ))}
        <button onClick={openPicker} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: value === 'custom' ? 500 : 400,
          padding: '5px 12px', borderRadius: 6, whiteSpace: 'nowrap',
          background: value === 'custom' || pickerOpen ? '#fff' : 'transparent',
          color: value === 'custom' ? '#9B59D0' : '#58595B',
          border: 'none', transition: 'all 0.15s', cursor: 'pointer',
          boxShadow: value === 'custom' || pickerOpen ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
        }}>
          {value === 'custom' && customRange ? `${fmtShortDateStr(customRange.start)} – ${fmtShortDateStr(customRange.end)}` : 'Custom'}
        </button>
      </div>

      {pickerOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
          background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 14,
          display: 'flex', flexDirection: 'column', gap: 10, minWidth: 230,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', display: 'block', marginBottom: 4 }}>From</label>
              <input type="date" value={draftStart} max={draftEnd} onChange={e => setDraftStart(e.target.value)} style={{
                width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '6px 8px',
                borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', boxSizing: 'border-box',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', display: 'block', marginBottom: 4 }}>To</label>
              <input type="date" value={draftEnd} min={draftStart} onChange={e => setDraftEnd(e.target.value)} style={{
                width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '6px 8px',
                borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.12)', boxSizing: 'border-box',
              }} />
            </div>
          </div>
          <button onClick={apply} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
            padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#000', color: '#fff', transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >Apply</button>
        </div>
      )}
    </div>
  )
}
