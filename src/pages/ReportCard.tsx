import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

type TimeRange = 'last7' | 'last14' | 'last30' | 'allTime'
type Verdict   = 'CORRECTION' | 'ENHANCEMENT' | 'PREFERENCE'

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
}

interface TicketRow {
  id:               string
  ticketNumber:     string
  agentName:        string
  agentEmail:       string
  zdMessageCount:   number | null
  issueCount:       number   // filled in after join
  createdAt:        string
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
      .select('id,ticket_number,agent_name,agent_email,zd_message_count,created_at')
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
    id:             t.id,
    ticketNumber:   t.ticket_number,
    agentName:      t.agent_name ?? '',
    agentEmail:     t.agent_email ?? '',
    zdMessageCount: t.zd_message_count,
    issueCount:     issueCounts.get(t.id) ?? 0,
    createdAt:      t.created_at ?? '',
  }))
}

async function fetchAllEvals(): Promise<EvalRow[]> {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('ticket_issues')
      .select('id,issue_type,eval_verdict,eval_confidence,eval_reasoning,eval_ran_at,customer_input,suggested_response,final_edits,reasoning,logged_at,created_at,tickets!inner(ticket_number,agent_name,agent_email,ticket_category,created_at)')
      .not('eval_verdict', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all.map((r: any) => ({
    id:                r.id,
    issueType:         r.issue_type ?? '',
    evalVerdict:       r.eval_verdict as Verdict,
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
  }))
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

// ── Agent Drilldown ────────────────────────────────────────────────────────────

function AgentDrilldown({ rows, tickets, agentName, onBack }: { rows: EvalRow[]; tickets: TicketRow[]; agentName: string; onBack: () => void }) {
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'evals' | 'completeness'>('evals')

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
        const completenessVal  = ticketsWithData.length
          ? `${pct(completeTickets, ticketsWithData.length)}%`
          : '—'
        const completenessColor = ticketsWithData.length === 0 ? '#aaa'
          : pct(completeTickets, ticketsWithData.length) >= 80 ? '#166534'
          : pct(completeTickets, ticketsWithData.length) >= 60 ? '#854d0e'
          : '#e53e3e'
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
            {[
              { label: 'Total evals',    value: total.toString(),                   color: '#9B59D0' },
              { label: 'Corrections',    value: `${pct(correction, total)}%`,       color: '#e53e3e' },
              { label: 'Enhancements',   value: `${pct(enhancement, total)}%`,      color: '#854d0e' },
              { label: 'Preferences',    value: `${pct(preference, total)}%`,       color: '#58595B' },
              { label: 'Avg confidence', value: `${avgConf}%`,                      color: avgConf >= 80 ? '#166534' : '#854d0e' },
              { label: 'Completeness',   value: completenessVal,                    color: completenessColor,
                note: ticketsWithData.length ? `${completeTickets}/${ticketsWithData.length} tickets` : 'No ZD data yet' },
            ].map(k => (
              <div key={k.label} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.09)', padding: '14px 16px' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{k.label}</p>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: k.color }}>{k.value}</p>
                {'note' in k && k.note && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 2 }}>{k.note}</p>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.09)', padding: 3, alignSelf: 'flex-start' }}>
        {([
          { id: 'evals',        label: 'Edit Evaluations',      count: rows.length },
          { id: 'completeness', label: 'Logging Completeness',  count: tickets.length },
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
            const exact       = !underLogged && !overLogged
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
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function ReportCard() {
  const [allRows, setAllRows]         = useState<EvalRow[]>([])
  const [ticketRows, setTicketRows]   = useState<TicketRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [range, setRange]             = useState<TimeRange>('last30')
  const [selected, setSelected]       = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchAllEvals(), fetchTicketCompleteness()]).then(([evals, tickets]) => {
      setAllRows(evals)
      setTicketRows(tickets)
      setLoading(false)
    })
  }, [])

  const rows = useMemo(() => filterByRange(allRows, range), [allRows, range])

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
  const teamTotal      = rows.length
  const teamCorrection = rows.filter(r => r.evalVerdict === 'CORRECTION').length
  const teamEnhancement = rows.filter(r => r.evalVerdict === 'ENHANCEMENT').length
  const teamPreference = rows.filter(r => r.evalVerdict === 'PREFERENCE').length

  // "Added today" — always counted from all evals regardless of time range filter
  const todayStr = new Date().toISOString().slice(0, 10)
  const addedToday = allRows.filter(r => (r.evalRanAt ?? '').slice(0, 10) === todayStr).length

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
    const agentTickets = ticketRows.filter(t => t.agentName === selected)
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

  // Team overview
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Report Card</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>AI evaluation of agent edit validity — click an agent to drill down</p>
        </div>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

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
    </div>
  )
}
