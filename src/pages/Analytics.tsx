import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { getDailyTarget } from '../lib/settings'

type Tab       = 'team' | 'agent' | 'events' | 'category'
type TimeRange = 'last7' | 'last30' | 'lastQuarter' | 'allTime'

interface DataRow {
  issueType:    string
  loggedAt:     string | null   // ticket_issues.logged_at  (set for live tickets)
  issuedAt:     string | null   // ticket_issues.created_at (set for imported tickets)
  ticketNumber: string
  agentName:    string
  category:     string
  createdAt:    string          // tickets.created_at (last-resort fallback)
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

function filterByRange(rows: DataRow[], range: TimeRange) {
  if (range === 'allTime') return rows
  const c = cutoff(rangeDays(range))
  return rows.filter(r => rowDate(r) >= c)
}

function effectiveDays(rows: DataRow[], range: TimeRange): number {
  if (range !== 'allTime') return rangeDays(range)
  if (rows.length === 0) return 30
  const oldest = rows.reduce((min, r) => {
    const d = rowDate(r)
    return d < min ? d : min
  }, new Date())
  // +1 so the chart loop (which goes from days-1 down to 0) includes the oldest day
  return Math.max(Math.ceil((Date.now() - oldest.getTime()) / 86_400_000) + 1, 1)
}

function pct(n: number, total: number) {
  if (!total) return 0
  return parseFloat(((n / total) * 100).toFixed(1))
}

function buildMetricTrendData(rows: DataRow[], days: number, issueType: string) {
  const byDate = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const label = rowDate(r).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (!byDate.has(label)) byDate.set(label, { total: 0, count: 0 })
    const entry = byDate.get(label)!
    entry.total++
    if (r.issueType === issueType) entry.count++
  }
  const result: { date: string; pct: number; movingAvg: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const entry = byDate.get(label) ?? { total: 0, count: 0 }
    result.push({ date: label, pct: entry.total > 0 ? parseFloat(((entry.count / entry.total) * 100).toFixed(1)) : 0, movingAvg: 0 })
  }
  return result.map((pt, i) => {
    const win = result.slice(Math.max(0, i - 6), i + 1).filter(p => p.pct > 0)
    const avg = win.length ? parseFloat((win.reduce((a, b) => a + b.pct, 0) / win.length).toFixed(1)) : 0
    return { ...pt, movingAvg: avg }
  })
}

function buildChartData(rows: DataRow[], days: number, target: number) {
  const byDate = new Map<string, Set<string>>()
  for (const r of rows) {
    const label = rowDate(r).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (!byDate.has(label)) byDate.set(label, new Set())
    byDate.get(label)!.add(r.ticketNumber)
  }
  const result: { date: string; count: number; movingAvg: number; target: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    result.push({ date: label, count: byDate.get(label)?.size ?? 0, movingAvg: 0, target })
  }
  return result.map((pt, i) => {
    const win = result.slice(Math.max(0, i - 6), i + 1)
    return { ...pt, movingAvg: Math.round(win.reduce((a, b) => a + b.count, 0) / win.length) }
  })
}

function agentStats(rows: DataRow[], days: number) {
  const map = new Map<string, { tickets: Set<string>; counts: Record<string, number> }>()
  for (const r of rows) {
    if (!map.has(r.agentName)) map.set(r.agentName, { tickets: new Set(), counts: {} })
    const entry = map.get(r.agentName)!
    entry.tickets.add(r.ticketNumber)
    entry.counts[r.issueType] = (entry.counts[r.issueType] ?? 0) + 1
  }
  return [...map.entries()].map(([name, { tickets, counts }]) => {
    const total    = Object.values(counts).reduce((a, b) => a + b, 0)
    const perfect  = counts['Perfect'] ?? 0
    const majority = counts['Majority edit'] ?? 0
    const partial  = counts['Partial edit'] ?? 0
    const noResp   = counts['No response'] ?? 0
    return {
      name, total: tickets.size, issueTotal: total,
      avg: parseFloat((tickets.size / days).toFixed(1)),
      perfect:  pct(perfect, total),
      majority: pct(majority, total),
      partial:  pct(partial, total),
      noResp:   pct(noResp, total),
    }
  }).sort((a, b) => b.total - a.total)
}

function categoryStats(rows: DataRow[]) {
  const map = new Map<string, { counts: Record<string, number>; tickets: Set<string> }>()
  for (const r of rows) {
    const cat = r.category || 'Uncategorized'
    if (!map.has(cat)) map.set(cat, { counts: {}, tickets: new Set() })
    const entry = map.get(cat)!
    entry.counts[r.issueType] = (entry.counts[r.issueType] ?? 0) + 1
    entry.tickets.add(r.ticketNumber)
  }
  return [...map.entries()].map(([name, { counts, tickets }]) => {
    const total    = Object.values(counts).reduce((a, b) => a + b, 0)
    const perfect  = counts['Perfect'] ?? 0
    const majority = counts['Majority edit'] ?? 0
    const partial  = counts['Partial edit'] ?? 0
    const noResp   = counts['No response'] ?? 0
    const perfectPct = pct(perfect, total)
    const editPct    = pct(majority + partial, total)
    const noRespPct  = pct(noResp, total)
    const status = total < 10 ? 'low-data' : perfectPct >= 90 ? 'ready' : perfectPct >= 75 ? 'almost' : 'not-ready'
    let blocker = 'Need more data'
    if (total >= 10) {
      if (noRespPct > 20 && editPct > 20) blocker = 'Product + Coverage'
      else if (noRespPct > 20) blocker = 'Coverage gap'
      else if (editPct > 25) blocker = 'Product quality'
      else blocker = 'On track'
    }
    return { name, vol: total, tickets: tickets.size, perfect: perfectPct, edit: editPct, noResp: noRespPct, status, blocker }
  }).sort((a, b) => b.vol - a.vol)
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Supabase PostgREST has a server-side max-rows cap (default 1000).
// Paginate in chunks so we always retrieve all records regardless of that cap.
async function fetchAllIssues() {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('ticket_issues')
      .select('issue_type, logged_at, created_at, tickets!inner(ticket_number, agent_name, ticket_category, created_at)')
      .order('created_at', { ascending: false })   // created_at is never NULL — safe for pagination
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export default function Analytics() {
  const [tab, setTab]         = useState<Tab>('team')
  const [allRows, setAllRows] = useState<DataRow[]>([])
  const [events, setEvents]   = useState<HotEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [issues, { data: evts }] = await Promise.all([
        fetchAllIssues(),
        supabase.from('hot_events').select('*').order('start_date', { ascending: false }),
      ])

      const rows: DataRow[] = issues.map((ti: any) => ({
        issueType:    ti.issue_type ?? '',
        loggedAt:     ti.logged_at  ?? null,
        issuedAt:     ti.created_at ?? null,   // ticket_issues.created_at — set for all rows
        ticketNumber: ti.tickets?.ticket_number ?? '',
        agentName:    ti.tickets?.agent_name ?? '',
        category:     ti.tickets?.ticket_category ?? '',
        createdAt:    ti.tickets?.created_at ?? '',
      }))

      setAllRows(rows)
      setEvents(evts ?? [])
      setLoading(false)
    }
    load()
  }, [])

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Analytics</h1>
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
      {tab === 'team'     && <TeamView     allRows={allRows} />}
      {tab === 'agent'    && <PerAgent     allRows={allRows} />}
      {tab === 'events'   && <EventAnalyticsTab allRows={allRows} events={events} />}
      {tab === 'category' && <CategoryPerformance allRows={allRows} />}
    </div>
  )
}

// ── Team View ─────────────────────────────────────────────────────────────────

const METRIC_CONFIG: Record<string, { color: string; goalDir: 'up' | 'down'; refValue?: number }> = {
  'Perfect':       { color: '#166534', goalDir: 'up',   refValue: 90 },
  'Majority edit': { color: '#854d0e', goalDir: 'down'               },
  'Partial edit':  { color: '#6b21a8', goalDir: 'down'               },
  'No response':   { color: '#e53e3e', goalDir: 'down'               },
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function rangeToDateParams(range: TimeRange) {
  const end   = new Date()
  const start = new Date()
  if      (range === 'last7')        start.setDate(start.getDate() - 7)
  else if (range === 'last30')       start.setDate(start.getDate() - 30)
  else if (range === 'lastQuarter')  start.setDate(start.getDate() - 90)
  else                               start.setFullYear(start.getFullYear() - 3)
  return { start: toDateStr(start), end: toDateStr(end) }
}

function TeamView({ allRows }: { allRows: DataRow[] }) {
  const [range, setRange]             = useState<TimeRange>('last30')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null)
  const [zdCount, setZdCount]         = useState<number | null>(null)
  const [zdLoading, setZdLoading]     = useState(false)
  const [zdError, setZdError]         = useState<string | null>(null)
  const dailyTarget = getDailyTarget()

  useEffect(() => {
    let cancelled = false
    async function fetchZd() {
      setZdLoading(true)
      setZdError(null)
      try {
        const { start, end } = rangeToDateParams(range)
        const { data, error } = await supabase.functions.invoke('zendesk-tickets', {
          body: { start_date: start, end_date: end },
        })
        if (!cancelled) {
          if (error) {
            setZdCount(null)
            setZdError(error.message ?? 'Edge function error')
          } else if (typeof data?.count === 'number') {
            setZdCount(data.count)
          } else {
            setZdCount(null)
            setZdError(data?.error ?? 'No data returned')
          }
        }
      } catch (e: any) {
        if (!cancelled) { setZdCount(null); setZdError(e?.message ?? 'Fetch failed') }
      } finally {
        if (!cancelled) setZdLoading(false)
      }
    }
    fetchZd()
    return () => { cancelled = true }
  }, [range])

  const rows = useMemo(() => filterByRange(allRows, range), [allRows, range])
  const days = useMemo(() => effectiveDays(rows, range), [rows, range])

  const agents = useMemo(() => agentStats(rows, days), [rows, days])

  const kpis = useMemo(() => {
    const tickets = new Set(rows.map(r => r.ticketNumber))
    const total   = rows.length
    const perfect = rows.filter(r => r.issueType === 'Perfect').length
    const majority = rows.filter(r => r.issueType === 'Majority edit').length
    const partial  = rows.filter(r => r.issueType === 'Partial edit').length
    const noResp   = rows.filter(r => r.issueType === 'No response').length
    return {
      tickets: tickets.size,
      issues:  total,
      avgPerTicket: tickets.size ? (total / tickets.size).toFixed(1) : '0',
      avgPerDay:    (tickets.size / days).toFixed(1),
      perfectPct:  pct(perfect, total).toFixed(1),
      majorityPct: pct(majority, total).toFixed(1),
      partialPct:  pct(partial, total).toFixed(1),
      noRespPct:   pct(noResp, total).toFixed(1),
    }
  }, [rows, days])

  const agentRows = useMemo(() => {
    if (!selectedAgent) return rows
    return rows.filter(r => r.agentName === selectedAgent)
  }, [rows, selectedAgent])

  const chartData = useMemo(() => buildChartData(agentRows, days, dailyTarget.max), [agentRows, days, dailyTarget.max])
  const metricChartData = useMemo(
    () => selectedMetric ? buildMetricTrendData(agentRows, days, selectedMetric) : [],
    [agentRows, days, selectedMetric]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {/* Row 1: Tickets | Responses | ZD Live Chat */}
        {[
          { label: `Tickets (${range === 'last7' ? 'last 7 days' : range === 'last30' ? 'last 30 days' : range === 'lastQuarter' ? 'last 90 days' : 'all time'})`, value: kpis.tickets.toString() },
          { label: 'Responses', value: kpis.issues.toString() },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 18px' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#9B59D0' }}>{k.value}</p>
          </div>
        ))}

        {/* ZD card — row 1, position 3 */}
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
                  {range === 'last7' ? 'Last 7 Days' : range === 'last30' ? 'Last 30 Days' : range === 'lastQuarter' ? 'Last 90 Days' : 'All Time'} — click a metric card again to dismiss
                </p>
              </>
            ) : (
              <>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>
                  {selectedAgent ? `${selectedAgent} – Tickets Logged` : 'Team Performance'}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
                  {range === 'last7' ? 'Last 7 Days' : range === 'last30' ? 'Last 30 Days' : range === 'lastQuarter' ? 'Last 90 Days' : 'All Time'}
                  {!selectedAgent && <span style={{ color: '#aaa' }}> — click a metric card above to see its trend</span>}
                </p>
              </>
            )}
          </div>
          <TimeRangeFilter value={range} onChange={setRange} />
        </div>

        {selectedMetric ? (() => {
          const mc = METRIC_CONFIG[selectedMetric]
          const data = metricChartData
          const avgPct = data.filter(d => d.pct > 0).reduce((s, d) => s + d.pct, 0) / (data.filter(d => d.pct > 0).length || 1)
          return (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data} margin={{ top: 4, right: 28, left: -20, bottom: 0 }}>
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
            <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 120px 100px 110px 110px 110px 90px', padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.01)' }}>
          {['Agent', 'Tickets', 'Avg/Day', 'Perfect %', 'Majority %', 'Partial %', 'Status'].map(h => (
            <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
          ))}
        </div>
        {agents.map((a, i) => {
          const onTrack = a.avg >= dailyTarget.min
          const almost  = !onTrack && a.avg >= dailyTarget.min * 0.5
          const statusLabel = onTrack ? 'ON TRACK' : almost ? 'ALMOST' : 'OFF TRACK'
          const statusColor = onTrack ? '#166534' : almost ? '#854d0e' : '#854d0e'
          const statusBg    = onTrack ? 'rgba(22,101,52,0.09)' : 'rgba(234,179,8,0.12)'
          return (
            <div key={a.name} onClick={() => setSelectedAgent(s => s === a.name ? null : a.name)}
              style={{
                display: 'grid', gridTemplateColumns: '1.5fr 120px 100px 110px 110px 110px 90px',
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
  const [range, setRange] = useState<TimeRange>('last30')
  const dailyTarget = getDailyTarget()
  const rows  = useMemo(() => filterByRange(allRows, range), [allRows, range])
  const days  = useMemo(() => effectiveDays(rows, range), [rows, range])
  const agents = useMemo(() => agentStats(rows, days), [rows, days])

  const [selected, setSelected] = useState('')
  const activeAgent = useMemo(() => agents[0]?.name ?? '', [agents])
  const agentName   = selected || activeAgent

  const agent = useMemo(() => agents.find(a => a.name === agentName) ?? agents[0], [agents, agentName])

  const agentRows  = useMemo(() => rows.filter(r => r.agentName === agentName), [rows, agentName])
  const chartData  = useMemo(() => buildChartData(agentRows, days, dailyTarget.max), [agentRows, days, dailyTarget.max])

  if (!agent) return null

  const onTrack = agent.avg >= dailyTarget.min
  const statusLabel = onTrack ? 'On Track' : agent.avg >= dailyTarget.min * 0.5 ? 'Almost' : 'Off Track'
  const statusColor = onTrack ? '#166534' : '#854d0e'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {agents.map(a => (
          <button key={a.name} onClick={() => setSelected(a.name)} style={{
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

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12 }}>
          <TimeRangeFilter value={range} onChange={setRange} />
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="date" tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} interval={Math.floor(chartData.length / 6)} />
            <YAxis tick={{ fontFamily: 'Inter', fontSize: 11, fill: '#aaa' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ fontFamily: 'Inter', fontSize: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)' }} />
            <ReferenceLine y={dailyTarget.max} stroke="#CEA4FF" strokeDasharray="5 5" strokeWidth={1.5} />
            <Line type="monotone" dataKey="count" stroke="#9B59D0" strokeWidth={2} dot={{ r: 3, fill: '#9B59D0' }} activeDot={{ r: 5 }} name="Daily" />
            <Line type="monotone" dataKey="movingAvg" stroke="#CEA4FF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="7-Day Avg" />
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
  const now = new Date()

  const eventsWithStats = useMemo(() => events.map(evt => {
    const start = new Date(evt.start_date)
    const end   = new Date(evt.end_date); end.setHours(23, 59, 59)
    const evtRows = allRows.filter(r => {
      const d = rowDate(r)
      return d >= start && d <= end
    })
    const tickets = new Set(evtRows.map(r => r.ticketNumber)).size
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
  }), [allRows, events])

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
  const [range, setRange]       = useState<TimeRange>('last30')
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(() => filterByRange(allRows, range), [allRows, range])
  const days = useMemo(() => effectiveDays(rows, range), [rows, range])
  const cats = useMemo(() => categoryStats(rows), [rows])

  const ready    = cats.filter(c => c.status === 'ready').length
  const almost   = cats.filter(c => c.status === 'almost').length
  const notReady = cats.filter(c => c.status === 'not-ready').length
  const lowData  = cats.filter(c => c.status === 'low-data').length
  const total    = cats.length

  const totalIssues = rows.length
  const overallPerfect  = totalIssues ? Math.round(rows.filter(r => r.issueType === 'Perfect').length / totalIssues * 100) : 0
  const overallMajority = totalIssues ? Math.round(rows.filter(r => r.issueType === 'Majority edit').length / totalIssues * 100) : 0
  const overallPartial  = totalIssues ? Math.round(rows.filter(r => r.issueType === 'Partial edit').length / totalIssues * 100) : 0
  const overallNoResp   = totalIssues ? Math.round(rows.filter(r => r.issueType === 'No response').length / totalIssues * 100) : 0

  const totalVol = cats.reduce((s, c) => s + c.vol, 0)

  const pieData = [
    { name: 'Autopilot Ready', value: ready,    color: '#166534' },
    { name: 'Almost (75%+)',   value: almost,   color: '#854d0e' },
    { name: 'Not Ready',       value: notReady, color: '#e53e3e' },
    { name: 'Low Data',        value: lowData,  color: '#d1d5db' },
  ].filter(d => d.value > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000' }}>Autopilot Readiness</p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
              Track each category toward the 90% perfect rate needed for full gameLM automation
            </p>
          </div>
          <TimeRangeFilter value={range} onChange={setRange} />
        </div>

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
              { label: 'Almost (75%+)',   color: '#854d0e', count: almost   },
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
              { label: 'Perfect rate',   value: `${overallPerfect}%`,  color: overallPerfect >= 90 ? '#166534' : overallPerfect >= 75 ? '#854d0e' : '#e53e3e' },
              { label: 'Majority edit',  value: `${overallMajority}%`, color: '#854d0e' },
              { label: 'Partial edit',   value: `${overallPartial}%`,  color: '#f97316' },
              { label: 'No response',    value: `${overallNoResp}%`,   color: overallNoResp > 20 ? '#e53e3e' : '#58595B' },
            ].map(k => (
              <div key={k.label} style={{ flex: 1, padding: '0 16px', borderRight: '1px solid rgba(0,0,0,0.07)' }}>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: k.color }}>{k.value}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 60px 80px 100px 1fr 90px 80px', padding: '10px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
          {['Category', 'Vol', '% of Total', 'Perfect', 'Progress to 90%', 'Edit Rate', 'No Resp'].map(h => (
            <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
          ))}
        </div>

        {cats.map(cat => {
          const isExpanded = expanded === cat.name
          const gap = Math.max(0, Math.round(90 - cat.perfect))
          const barColor = cat.perfect >= 90 ? '#166534' : cat.perfect >= 75 ? '#854d0e' : cat.perfect >= 50 ? '#f97316' : '#e53e3e'

          // Per-agent breakdown for this category
          const catAgentRows = rows.filter(r => (r.category || 'Uncategorized') === cat.name)
          const catAgents = agentStats(catAgentRows, days)

          return (
            <div key={cat.name}>
              <div onClick={() => setExpanded(isExpanded ? null : cat.name)}
                style={{
                  display: 'grid', gridTemplateColumns: '1.6fr 60px 80px 100px 1fr 90px 80px',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 100, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (cat.perfect / 90) * 100)}%`, height: '100%', background: barColor, borderRadius: 100, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: gap === 0 ? '#166534' : '#e53e3e', fontWeight: 500, flexShrink: 0 }}>{gap === 0 ? '✓ Ready' : `−${gap}pp`}</span>
                </div>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{cat.edit}%</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: cat.noResp > 20 ? '#e53e3e' : '#58595B' }}>{cat.noResp}%</span>
              </div>

              {isExpanded && catAgents.length > 0 && (
                <div style={{ padding: '0 20px 16px', background: 'rgba(206,164,255,0.03)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', padding: '14px 0 10px' }}>
                    Agent breakdown — {cat.name}
                  </p>
                  <div style={{ borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 100px 100px 90px 1fr', padding: '8px 14px', background: 'rgba(0,0,0,0.03)', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                      {['Agent', 'Issues', 'Perfect', 'No Resp', 'Progress'].map(h => (
                        <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
                      ))}
                    </div>
                    {catAgents.map((a, ai) => {
                      const agentGap = Math.max(0, Math.round(90 - a.perfect))
                      const agentBarColor = a.perfect >= 90 ? '#166534' : a.perfect >= 75 ? '#854d0e' : a.perfect >= 50 ? '#f97316' : '#e53e3e'
                      return (
                        <div key={a.name} style={{
                          display: 'grid', gridTemplateColumns: '1.5fr 100px 100px 90px 1fr',
                          padding: '10px 14px', alignItems: 'center',
                          borderBottom: ai < catAgents.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                        }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{a.name}</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{a.issueTotal}</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: agentBarColor, fontWeight: 500 }}>{a.perfect}%</span>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{a.noResp}%</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 5, borderRadius: 100, background: 'rgba(0,0,0,0.07)' }}>
                              <div style={{ width: `${Math.min(100, (a.perfect / 90) * 100)}%`, height: '100%', background: agentBarColor, borderRadius: 100 }} />
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

        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Perfect rate:</span>
          {[
            { color: '#166534', label: 'Ready', range: '90%+' },
            { color: '#854d0e', label: 'Almost', range: '75–90%' },
            { color: '#f97316', label: 'Getting there', range: '50–75%' },
            { color: '#e53e3e', label: 'Not ready', range: '<50%' },
          ].map(l => (
            <span key={l.label} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, display: 'inline-block', flexShrink: 0 }} />
              <strong style={{ color: l.color }}>{l.label}</strong> {l.range}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function TimeRangeFilter({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  const opts: { id: TimeRange; label: string }[] = [
    { id: 'last7',       label: 'Last 7'       },
    { id: 'last30',      label: 'Last 30'      },
    { id: 'lastQuarter', label: 'Last Quarter' },
    { id: 'allTime',     label: 'All Time'     },
  ]
  return (
    <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: 2 }}>
      {opts.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
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
    </div>
  )
}
