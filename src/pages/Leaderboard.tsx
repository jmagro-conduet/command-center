import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

type TimeRange = 'last7' | 'last14' | 'last30' | 'lastQuarter'

interface DataRow {
  loggedAt:     string | null
  issuedAt:     string | null
  createdAt:    string
  issueType:    string
  ticketNumber: string
  agentName:    string
  agentEmail:   string
}

function rowDate(r: DataRow): Date {
  // Prefer logged_at (when the response was actually worked) over the DB
  // insert time (issuedAt/createdAt), so late-submitted drafts don't inflate
  // the current window and gameLM date windows align with ZD's.
  return new Date(r.loggedAt ?? r.issuedAt ?? r.createdAt)
}

function rangeDays(range: TimeRange) {
  return range === 'last7' ? 7 : range === 'last14' ? 14 : range === 'last30' ? 30 : 90
}

function cutoff(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days); return d
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

async function fetchAllIssues(operatorId: string | null) {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  // Server-side cap: the widest range selector is "Last Quarter" (90d), so fetch ~105d
  // (90 + buffer for logged_at vs created_at skew) instead of the entire table. The range
  // selector then filters this set client-side without re-fetching. Avoids pulling all
  // history on every load, which grew linearly with ticket volume.
  const sinceStr = cutoff(105).toISOString()
  while (true) {
    let q = supabase
      .from('ticket_issues')
      .select('issue_type, logged_at, created_at, tickets!inner(ticket_number, agent_name, agent_email, created_at)')
      .gte('created_at', sinceStr)
      .order('created_at', { ascending: false })
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

function matchZD(
  agentEmail: string,
  zdAgents: { email: string; count: number }[]
): number | null {
  if (!agentEmail) return null
  return zdAgents.find(z => z.email && z.email.toLowerCase() === agentEmail.toLowerCase())?.count ?? null
}

// ── Medal component ────────────────────────────────────────────────────────────
function Medal({ rank }: { rank: number }) {
  if (rank > 3) {
    return (
      <span style={{
        fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600,
        color: 'rgba(0,0,0,0.25)', width: 28, textAlign: 'center', display: 'inline-block',
      }}>
        {rank}
      </span>
    )
  }
  const configs = [
    { bg: 'linear-gradient(135deg, #F59E0B, #D97706)', shadow: 'rgba(245,158,11,0.4)', label: '1' },
    { bg: 'linear-gradient(135deg, #9CA3AF, #6B7280)', shadow: 'rgba(156,163,175,0.4)', label: '2' },
    { bg: 'linear-gradient(135deg, #C47722, #A36210)', shadow: 'rgba(196,119,34,0.4)', label: '3' },
  ]
  const c = configs[rank - 1]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 24, height: 24, borderRadius: '50%',
      background: c.bg,
      boxShadow: `0 2px 6px ${c.shadow}`,
      fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700, color: '#fff',
    }}>
      {c.label}
    </span>
  )
}

// ── Adoption pill ──────────────────────────────────────────────────────────────
function AdoptionPill({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.25)' }}>—</span>
    )
  }

  const clamped = Math.min(pct, 100)
  let bg: string, color: string, border: string
  if (pct > 100) {
    bg = 'rgba(229,62,62,0.08)'; color = '#e53e3e'; border = 'rgba(229,62,62,0.2)'
  } else if (clamped >= 80) {
    bg = 'rgba(22,101,52,0.08)'; color = '#166534'; border = 'rgba(22,101,52,0.2)'
  } else if (clamped >= 55) {
    bg = 'rgba(180,83,9,0.08)'; color = '#b45309'; border = 'rgba(180,83,9,0.2)'
  } else {
    bg = 'rgba(220,38,38,0.08)'; color = '#dc2626'; border = 'rgba(220,38,38,0.15)'
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 100,
      background: bg, border: `1px solid ${border}`,
      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color,
    }}>
      {pct.toFixed(1)}%
      {pct > 100 && <span style={{ fontSize: 10 }}>↑</span>}
    </span>
  )
}

// ── Team adoption progress bar ─────────────────────────────────────────────────
function TeamAdoptionCard({
  gameLMTotal, zdTotal, zdLoading, zdError, range,
}: {
  gameLMTotal: number
  zdTotal: number | null
  zdLoading: boolean
  zdError: string | null
  range: TimeRange
}) {
  const rangeLabel = range === 'last7' ? 'Last 7 days' : range === 'last14' ? 'Last 14 days' : range === 'last30' ? 'Last 30 days' : 'Last quarter'

  const adoptionPct = zdTotal && zdTotal > 0 ? (gameLMTotal / zdTotal) * 100 : null
  const clampedPct  = adoptionPct !== null ? Math.min(adoptionPct, 100) : 0
  const remaining   = zdTotal && zdTotal > 0 ? Math.max(0, zdTotal - gameLMTotal) : null

  let barColor = '#e53e3e'
  if (adoptionPct !== null) {
    if (adoptionPct >= 80) barColor = '#166534'
    else if (adoptionPct >= 55) barColor = '#b45309'
  }

  return (
    <div style={{
      background: '#fff',
      borderRadius: 20,
      border: '1.5px solid rgba(0,0,0,0.09)',
      padding: '24px 28px',
      display: 'flex',
      gap: 40,
      alignItems: 'center',
    }}>
      {/* Left: big number */}
      <div style={{ flexShrink: 0 }}>
        <p style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
          color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
        }}>
          Team Adoption Rate
        </p>
        {zdLoading ? (
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 40, fontWeight: 700, color: 'rgba(0,0,0,0.15)', lineHeight: 1 }}>—</p>
        ) : zdError ? (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{zdError}</p>
        ) : adoptionPct !== null ? (
          <p style={{
            fontFamily: 'Manrope, sans-serif', fontSize: 40, fontWeight: 700, lineHeight: 1,
            color: barColor,
          }}>
            {adoptionPct.toFixed(1)}%
          </p>
        ) : (
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 40, fontWeight: 700, color: 'rgba(0,0,0,0.15)', lineHeight: 1 }}>—</p>
        )}
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 6 }}>
          {gameLMTotal} logged of {zdTotal?.toLocaleString() ?? '…'} Zendesk chat tickets ({rangeLabel})
        </p>
      </div>

      {/* Center: progress bar */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa' }}>0%</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa' }}>100%</span>
        </div>
        <div style={{
          height: 10, borderRadius: 100,
          background: 'rgba(0,0,0,0.07)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${clampedPct}%`,
            background: barColor,
            borderRadius: 100,
            transition: 'width 0.6s ease',
          }} />
        </div>
        {remaining !== null && remaining > 0 && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: barColor, marginTop: 8, fontWeight: 500 }}>
            {remaining.toLocaleString()} more tickets to reach 100%
          </p>
        )}
        {remaining === 0 && adoptionPct !== null && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#166534', marginTop: 8, fontWeight: 500 }}>
            ✓ 100% adoption reached!
          </p>
        )}
      </div>

      {/* Right: stats */}
      <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 700, color: '#9B59D0', lineHeight: 1 }}>
            {gameLMTotal.toLocaleString()}
          </p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Logged</p>
        </div>
        <div style={{ width: 1, background: 'rgba(0,0,0,0.08)', alignSelf: 'stretch' }} />
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 26, fontWeight: 700, color: '#b45309', lineHeight: 1 }}>
            {zdLoading ? '…' : (zdTotal?.toLocaleString() ?? '—')}
          </p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Zendesk total</p>
        </div>
      </div>
    </div>
  )
}

// Org-team (e.g. "Manila") a lead can filter to — scoped to one operator.
interface OrgTeam { id: string; name: string; lead_user_id: string | null }

// ── Main export ────────────────────────────────────────────────────────────────
export default function Leaderboard() {
  const { user } = useAuth()
  const { selectedOperator } = useOperator()
  const isSuperAdmin = !!user?.isSuperAdmin
  const [range, setRange]       = useState<TimeRange>('last7')
  const [allRows, setAllRows]   = useState<DataRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [zdAgents, setZdAgents]   = useState<{ email: string; count: number }[] | null>(null)
  const [zdLoading, setZdLoading] = useState(false)
  const [zdError, setZdError]     = useState<string | null>(null)
  const [adminEmails, setAdminEmails] = useState<Set<string>>(new Set())

  // Org-teams — only teams the current user leads (or, for SuperAdmins, every
  // team for this operator) show up as filter options.
  const [orgTeams, setOrgTeams]     = useState<OrgTeam[]>([])
  const [team, setTeam]             = useState('All teams')
  const [teamMemberEmails, setTeamMemberEmails] = useState<string[] | null>(null)
  const teamOptions = isSuperAdmin ? orgTeams : orgTeams.filter(t => t.lead_user_id === user?.id)
  const showTeamFilter = teamOptions.length > 0

  useEffect(() => {
    async function loadOrgTeams() {
      let q = supabase.from('org_teams').select('id, name, lead_user_id')
      if (selectedOperator?.id) q = q.eq('operator_id', selectedOperator.id)
      const { data } = await q.order('name')
      setOrgTeams(data ?? [])
    }
    loadOrgTeams()
    setTeam('All teams')
  }, [selectedOperator?.id])

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

  // Team ZD total = sum of per-agent counts only (excludes other brands / unassigned)
  const zdCount = useMemo(
    () => zdAgents ? zdAgents.reduce((s, a) => s + a.count, 0) : null,
    [zdAgents]
  )

  // Fetch admin emails once — admins are excluded from the leaderboard roster
  // but their ticket submissions are retained in the DB and team totals.
  useEffect(() => {
    supabase
      .from('users')
      .select('email')
      .eq('role', 'admin')
      .then(({ data }) => {
        if (data) setAdminEmails(new Set(data.map((u: any) => u.email?.toLowerCase()).filter(Boolean)))
      })
  }, [])

  // Fetch gameLM data — re-runs when operator changes
  useEffect(() => {
    setLoading(true)
    fetchAllIssues(selectedOperator?.id ?? null).then(issues => {
      setAllRows(issues.map((ti: any) => ({
        issueType:    ti.issue_type ?? '',
        loggedAt:     ti.logged_at  ?? null,
        issuedAt:     ti.created_at ?? null,
        ticketNumber: ti.tickets?.ticket_number ?? '',
        agentName:    ti.tickets?.agent_name  ?? '',
        agentEmail:   ti.tickets?.agent_email ?? '',
        createdAt:    ti.tickets?.created_at ?? '',
      })))
      setLoading(false)
    })
  }, [selectedOperator?.id])

  // Team-scoped rows — every downstream roster/stat/ZD computation reads from
  // this instead of allRows, so selecting a team narrows the whole page.
  const scopedRows = useMemo(() => {
    if (!teamMemberEmails) return allRows
    const set = new Set(teamMemberEmails)
    return allRows.filter(r => set.has((r.agentEmail ?? '').toLowerCase()))
  }, [allRows, teamMemberEmails])

  // Stable key of all-time agent emails
  const rosterEmailsKey = useMemo(
    () => [...new Set(scopedRows.map(r => r.agentEmail).filter(Boolean))].sort().join(','),
    [scopedRows]
  )

  // Fetch ZD data — fires when range or agent roster changes
  useEffect(() => {
    const agentEmails = rosterEmailsKey ? rosterEmailsKey.split(',') : []
    if (agentEmails.length === 0) return

    let cancelled = false
    async function fetchZd() {
      setZdLoading(true); setZdError(null)
      const end   = new Date(); end.setDate(end.getDate() + 1) // +1 so ZD's date filter covers all of today
      const start = new Date(); start.setDate(start.getDate() - rangeDays(range))
      try {
        const { data, error } = await supabase.functions.invoke('zendesk-tickets', {
          body: { start_date: toDateStr(start), end_date: toDateStr(end), agent_emails: agentEmails },
        })
        if (!cancelled) {
          if (error) {
            setZdAgents(null); setZdError(error.message ?? 'ZD error')
          } else if (Array.isArray(data?.agents)) {
            setZdAgents(data.agents)
            if (data?.error) setZdError(data.error)
          } else {
            setZdAgents(null); setZdError(data?.error ?? 'No data returned')
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
  }, [range, rosterEmailsKey])

  // Filter to selected range
  const rows = useMemo(() => {
    const c = cutoff(rangeDays(range))
    return scopedRows.filter(r => rowDate(r) >= c)
  }, [scopedRows, range])

  const days = rangeDays(range)

  // Per-agent stats — roster built from allRows so inactive agents still appear.
  // Admins are excluded from the visible roster (their tickets still count toward team totals).
  const agents = useMemo(() => {
    // Full agent roster (all time), excluding admin accounts
    const roster = new Map<string, string>() // name -> email
    for (const r of scopedRows) {
      if (r.agentName && !roster.has(r.agentName) && !adminEmails.has(r.agentEmail?.toLowerCase())) {
        roster.set(r.agentName, r.agentEmail)
      }
    }

    // Period stats
    const statsMap = new Map<string, { tickets: Set<string>; counts: Record<string, number> }>()
    for (const r of rows) {
      if (!statsMap.has(r.agentName)) statsMap.set(r.agentName, { tickets: new Set(), counts: {} })
      const e = statsMap.get(r.agentName)!
      e.tickets.add(r.ticketNumber)
      e.counts[r.issueType] = (e.counts[r.issueType] ?? 0) + 1
    }

    const pct = (n: number, total: number) => total ? parseFloat(((n / total) * 100).toFixed(1)) : 0
    return [...roster.entries()].map(([name, email]) => {
      const s       = statsMap.get(name)
      const tickets = s?.tickets ?? new Set<string>()
      const counts  = s?.counts  ?? {}
      const total    = Object.values(counts).reduce((a, b) => a + b, 0)
      const perfect  = counts['Perfect']       ?? 0
      const majority = counts['Majority edit'] ?? 0
      const partial  = counts['Partial edit']  ?? 0
      const noResp   = counts['No response']   ?? 0
      return {
        name, email,
        tickets: tickets.size,
        avg: parseFloat((tickets.size / days).toFixed(1)),
        perfect:  pct(perfect, total),
        majority: pct(majority, total),
        partial:  pct(partial, total),
        noResp:   pct(noResp, total),
      }
    }).sort((a, b) => b.tickets - a.tickets)   // initial sort; re-ranked below once ZD data arrives
  }, [rows, scopedRows, days, adminEmails])

  // Agents ranked by adoption % (gameLM tickets / ZD tickets).
  // Falls back to ticket count sort when ZD data is unavailable.
  const rankedAgents = useMemo(() => {
    return [...agents]
      .map(a => {
        const zdTickets  = zdAgents ? matchZD(a.email, zdAgents) : null
        const adoptionPct = zdTickets && zdTickets > 0 ? (a.tickets / zdTickets) * 100 : null
        return { ...a, zdTickets, adoptionPct }
      })
      .sort((a, b) => {
        // Both have adoption %: sort descending
        if (a.adoptionPct !== null && b.adoptionPct !== null) return b.adoptionPct - a.adoptionPct
        // One has %, one doesn't: ranked agent wins
        if (a.adoptionPct !== null) return -1
        if (b.adoptionPct !== null) return 1
        // Neither has ZD data: fall back to ticket count
        return b.tickets - a.tickets
      })
  }, [agents, zdAgents])

  // Team totals
  const teamGameLM = useMemo(() => {
    const s = new Set(rows.map(r => r.ticketNumber).filter(Boolean))
    return s.size
  }, [rows])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600 }}>Leaderboard</h1>
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading leaderboard…</p>
        </div>
      </div>
    )
  }

  const rangeOpts: { id: TimeRange; label: string }[] = [
    { id: 'last7',       label: 'Last 7'       },
    { id: 'last14',      label: 'Last 14'      },
    { id: 'last30',      label: 'Last 30'      },
    { id: 'lastQuarter', label: 'Last Quarter' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
            Leaderboard
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 3 }}>
            Drive towards 100% adoption — log every Zendesk ticket
          </p>
        </div>

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

          {/* Range selector */}
          <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.09)', padding: 3 }}>
            {rangeOpts.map(o => (
              <button key={o.id} onClick={() => setRange(o.id)} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 13,
                fontWeight: range === o.id ? 500 : 400,
                padding: '6px 14px', borderRadius: 8,
                background: range === o.id ? '#000' : 'transparent',
                color: range === o.id ? '#fff' : '#58595B',
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Team adoption card ── */}
      <TeamAdoptionCard
        gameLMTotal={teamGameLM}
        zdTotal={zdCount}
        zdLoading={zdLoading}
        zdError={zdError}
        range={range}
      />

      {/* ── Leaderboard table ── */}
      <div style={{ background: '#fff', borderRadius: 20, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid rgba(0,0,0,0.07)',
          background: 'rgba(0,0,0,0.015)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>
              Agent Performance —{' '}
              <span style={{ color: '#9B59D0' }}>
                {range === 'last7' ? 'Last 7' : range === 'last14' ? 'Last 14' : range === 'last30' ? 'Last 30' : 'Last Quarter'}
              </span>
            </p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>
              Ranked by tickets logged
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 100, background: 'rgba(243,156,18,0.1)', color: '#b45309', letterSpacing: '0.04em' }}>
              ZENDESK
            </span>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa' }}>
              {zdLoading ? 'Loading ZD data…' : zdError ? 'ZD unavailable' : `${zdAgents?.length ?? 0} agents matched`}
            </span>
          </div>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '44px 1fr 90px 110px 90px 100px 90px 100px',
          padding: '10px 24px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(0,0,0,0.01)',
        }}>
          {['#', 'AGENT', 'TICKETS', 'ADOPTION', 'PERFECT', 'MAJORITY', 'PARTIAL', 'NO RESP'].map(h => (
            <span key={h} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600,
              color: '#aaa', letterSpacing: '0.08em',
            }}>
              {h}
            </span>
          ))}
        </div>

        {/* Agent rows */}
        {rankedAgents.map((a, i) => {
          const isMe = user?.name?.toLowerCase().trim() === a.name.toLowerCase().trim()
          const zdTickets  = a.zdTickets
          const adoptionRaw = a.adoptionPct

          return (
            <div
              key={a.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr 90px 110px 90px 100px 90px 100px',
                padding: '13px 24px',
                alignItems: 'center',
                borderBottom: i < rankedAgents.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                background: isMe
                  ? 'linear-gradient(90deg, rgba(206,164,255,0.10) 0%, rgba(206,164,255,0.04) 100%)'
                  : 'transparent',
                borderLeft: isMe ? '3px solid #9B59D0' : '3px solid transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!isMe) e.currentTarget.style.background = 'rgba(0,0,0,0.015)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = isMe
                  ? 'linear-gradient(90deg, rgba(206,164,255,0.10) 0%, rgba(206,164,255,0.04) 100%)'
                  : 'transparent'
              }}
            >
              {/* Rank */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Medal rank={i + 1} />
              </div>

              {/* Agent name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                  background: isMe ? '#9B59D0' : 'rgba(155,89,208,0.10)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 700,
                  color: isMe ? '#fff' : '#9B59D0',
                }}>
                  {a.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <p style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: isMe ? 600 : 500,
                    color: '#000', lineHeight: 1.2,
                  }}>
                    {a.name}
                  </p>
                  {isMe && (
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#9B59D0', fontWeight: 500 }}>You</p>
                  )}
                </div>
              </div>

              {/* Tickets */}
              <div>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 700, color: '#000', lineHeight: 1 }}>
                  {a.tickets}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#aaa', marginTop: 2 }}>
                  {a.avg}/day
                </p>
              </div>

              {/* Adoption % */}
              <div>
                {zdLoading ? (
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.2)' }}>…</span>
                ) : (
                  <AdoptionPill pct={adoptionRaw} />
                )}
                {zdTickets !== null && !zdLoading && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#aaa', marginTop: 3 }}>
                    of {zdTickets} ZD
                  </p>
                )}
              </div>

              {/* Quality metrics */}
              <QualityCell value={a.perfect}  type="perfect"  />
              <QualityCell value={a.majority} type="majority" />
              <QualityCell value={a.partial}  type="partial"  />
              <QualityCell value={a.noResp}   type="noResp"   />
            </div>
          )
        })}

        {agents.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
              No data for this time range
            </p>
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div style={{
        background: '#fff', borderRadius: 14, border: '1.5px solid rgba(0,0,0,0.09)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Adoption rate
        </p>
        {[
          { color: '#166534', bg: 'rgba(22,101,52,0.08)',   label: 'Great',   range: '80–100%' },
          { color: '#b45309', bg: 'rgba(180,83,9,0.08)',    label: 'Good',    range: '55–80%'  },
          { color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   label: 'Low',     range: '<55%'    },
          { color: '#e53e3e', bg: 'rgba(229,62,62,0.08)',   label: 'Overcounted', range: '>100%' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 100, background: l.bg, fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: l.color }}>
              {l.range}
            </span>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>{l.label}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 3, height: 18, background: '#9B59D0', borderRadius: 2 }} />
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>Highlighted row = you</span>
        </div>
      </div>

      <div style={{ height: 8 }} />
    </div>
  )
}

// ── Quality cell ───────────────────────────────────────────────────────────────
type QualityType = 'perfect' | 'majority' | 'partial' | 'noResp'
const QUALITY_COLORS: Record<QualityType, { good: string; bad: string; threshold: number; higherIsBetter: boolean }> = {
  perfect:  { good: '#166534', bad: '#58595B', threshold: 60,  higherIsBetter: true  },
  majority: { good: '#58595B', bad: '#854d0e', threshold: 25,  higherIsBetter: false },
  partial:  { good: '#58595B', bad: '#6b21a8', threshold: 20,  higherIsBetter: false },
  noResp:   { good: '#58595B', bad: '#e53e3e', threshold: 20,  higherIsBetter: false },
}

function QualityCell({ value, type }: { value: number; type: QualityType }) {
  const cfg = QUALITY_COLORS[type]
  const isBad = cfg.higherIsBetter ? value < cfg.threshold : value > cfg.threshold
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif', fontSize: 13,
      color: isBad ? cfg.bad : cfg.good,
      fontWeight: isBad ? 500 : 400,
    }}>
      {value}%
    </span>
  )
}
