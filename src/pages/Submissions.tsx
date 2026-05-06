import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const ISSUE_CONFIG: Record<string, { bg: string; color: string }> = {
  'Perfect':       { bg: 'rgba(22,101,52,0.09)',  color: '#166534' },
  'Majority edit': { bg: 'rgba(234,179,8,0.12)',  color: '#854d0e' },
  'Partial edit':  { bg: 'rgba(206,164,255,0.2)', color: '#6b21a8' },
  'No response':   { bg: 'rgba(229,62,62,0.09)',  color: '#e53e3e' },
}

const ISSUE_TYPES = ['All issue types', 'Perfect', 'Majority edit', 'Partial edit', 'No response']
const PAGE_SIZE = 25

interface Row {
  id: string
  issueType: string
  ticket: string
  agent: string
  agentEmail: string
  agentTeam: string
  category: string
  date: string
  loggedAt: string | null
  customerInput: string
  suggestedResponse: string
  reasoning: string
  finalEdits: string
  notes: string
}

// All timestamps are displayed in AEST (Australia/Sydney, UTC+10/+11)
// to match the Bolt app and reflect when agents actually did the work.
const AEST = 'Australia/Sydney'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: AEST,
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// Matches the Google Forms export format used as our source CSV:
// "5/5/2026, 2:52:55 PM"  — kept in AEST to match agent working hours
function formatSourceTimestamp(iso: string): string {
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = { timeZone: AEST, hour12: true }
  const parts = new Intl.DateTimeFormat('en-AU', {
    ...opts, month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('month')}/${get('day')}/${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')}`
}

function csvField(val: unknown): string {
  const s = val == null ? '' : String(val)
  return `"${s.replace(/"/g, '""')}"`
}

export default function Submissions() {
  const [rows,        setRows]        = useState<Row[]>([])
  const [total,       setTotal]       = useState(0)
  const [ticketCount, setTicketCount] = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [page,        setPage]        = useState(1)

  const [search,    setSearch]    = useState('')
  const [agent,     setAgent]     = useState('All agents')
  const [category,  setCategory]  = useState('All categories')
  const [issueType, setIssueType] = useState('All issue types')

  const [agentOptions,    setAgentOptions]    = useState<string[]>(['All agents'])
  const [categoryOptions, setCategoryOptions] = useState<string[]>(['All categories'])

  const [selected, setSelected] = useState<Row | null>(null)

  // Load distinct filter options once
  useEffect(() => {
    async function loadFilters() {
      const [{ data: agentData }, { data: catData }] = await Promise.all([
        supabase.from('tickets').select('agent_name').order('agent_name'),
        supabase.from('tickets').select('ticket_category').order('ticket_category'),
      ])
      const agents = [...new Set(agentData?.map(r => r.agent_name).filter(Boolean))] as string[]
      const cats   = [...new Set(catData?.map(r => r.ticket_category).filter(Boolean))] as string[]
      setAgentOptions(['All agents', ...agents])
      setCategoryOptions(['All categories', ...cats])
    }
    loadFilters()
  }, [])

  const buildQuery = useCallback((paginate: boolean) => {
    let q = supabase
      .from('ticket_issues')
      .select(
        `id, issue_type, logged_at, customer_input, suggested_response, reasoning, final_edits, issue_comment,
         tickets!inner ( ticket_number, agent_name, agent_email, agent_team, ticket_category )`,
        { count: 'exact' }
      )

    if (issueType !== 'All issue types') q = q.eq('issue_type', issueType)
    if (agent     !== 'All agents')      q = (q as any).eq('tickets.agent_name', agent)
    if (category  !== 'All categories')  q = (q as any).eq('tickets.ticket_category', category)
    if (search.trim())                   q = (q as any).ilike('tickets.ticket_number', `%${search.trim()}%`)

    q = q.order('logged_at', { ascending: false })

    if (paginate) {
      const from = (page - 1) * PAGE_SIZE
      q = q.range(from, from + PAGE_SIZE - 1)
    }

    return q
  }, [page, search, agent, category, issueType])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    // Distinct ticket count — same source as Analytics (ticket_issues join),
    // same filters applied, then count unique ticket_numbers client-side
    let tcQ = supabase
      .from('ticket_issues')
      .select('tickets!inner(ticket_number, agent_name, ticket_category)')

    if (issueType !== 'All issue types') tcQ = tcQ.eq('issue_type', issueType)
    if (agent     !== 'All agents')      tcQ = (tcQ as any).eq('tickets.agent_name', agent)
    if (category  !== 'All categories')  tcQ = (tcQ as any).eq('tickets.ticket_category', category)
    if (search.trim())                   tcQ = (tcQ as any).ilike('tickets.ticket_number', `%${search.trim()}%`)

    Promise.all([buildQuery(true), tcQ]).then(([{ data, count, error }, { data: tcData }]) => {
      if (cancelled) return
      if (error) { console.error(error); setLoading(false); return }

      const mapped: Row[] = (data ?? []).map((ti: any) => ({
        id:                ti.id,
        issueType:         ti.issue_type ?? '',
        ticket:            ti.tickets?.ticket_number ?? '',
        agent:             ti.tickets?.agent_name ?? '',
        agentEmail:        ti.tickets?.agent_email ?? '',
        agentTeam:         ti.tickets?.agent_team ?? '',
        category:          ti.tickets?.ticket_category ?? '',
        date:              ti.logged_at ? formatDate(ti.logged_at) : '',
        loggedAt:          ti.logged_at ?? null,
        customerInput:     ti.customer_input ?? '',
        suggestedResponse: ti.suggested_response ?? '',
        reasoning:         ti.reasoning ?? '',
        finalEdits:        ti.final_edits ?? '',
        notes:             ti.issue_comment ?? '',
      }))

      const uniqueTickets = new Set((tcData ?? []).map((ti: any) => ti.tickets?.ticket_number))

      setRows(mapped)
      setTotal(count ?? 0)
      setTicketCount(uniqueTickets.size)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [buildQuery])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, agent, category, issueType])

  const hasFilters = agent !== 'All agents' || category !== 'All categories' ||
                     issueType !== 'All issue types' || search.trim()

  function clearFilters() {
    setSearch(''); setAgent('All agents')
    setCategory('All categories'); setIssueType('All issue types')
  }

  async function exportCSV() {
    // Paginate through all matching rows (Supabase has a 1000-row server cap)
    const PAGE = 1000
    const all: any[] = []
    let from = 0
    while (true) {
      let q = supabase
        .from('ticket_issues')
        .select(`
          issue_type, logged_at, customer_input, suggested_response, reasoning, final_edits, issue_comment,
          tickets!inner ( ticket_number, agent_name, agent_email, agent_team, ticket_category )
        `)
      if (issueType !== 'All issue types') q = q.eq('issue_type', issueType)
      if (agent     !== 'All agents')      q = (q as any).eq('tickets.agent_name', agent)
      if (category  !== 'All categories')  q = (q as any).eq('tickets.ticket_category', category)
      if (search.trim())                   q = (q as any).ilike('tickets.ticket_number', `%${search.trim()}%`)
      const { data, error } = await q.order('logged_at', { ascending: false }).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      all.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }

    // Match the source CSV column order exactly (12 cols)
    const header = [
      'Timestamp', 'Agent', 'Email', 'Team', 'Ticket', 'Category', 'Issue type',
      'Customer Input', 'Suggested Response', 'Reasoning', 'Final Edits', 'Notes',
    ].map(csvField).join(',')

    const csvRows = all.map((ti: any) => {
      const t = ti.tickets ?? {}
      return [
        ti.logged_at ? formatSourceTimestamp(ti.logged_at) : '',
        t.agent_name,
        t.agent_email,
        t.agent_team,
        t.ticket_number,
        t.ticket_category,
        ti.issue_type,
        ti.customer_input,
        ti.suggested_response,
        ti.reasoning,
        ti.final_edits,
        ti.issue_comment,
      ].map(csvField).join(',')
    })

    const blob = new Blob(['﻿' + [header, ...csvRows].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `gamelm_feedback_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
            Submissions
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            View and manage all ticket submissions
          </p>
        </div>
        <button
          onClick={exportCSV}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '9px 16px', borderRadius: 10,
            border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000',
            transition: 'all 0.15s', cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{
        background: '#fff', borderRadius: 16,
        border: '1.5px solid rgba(0,0,0,0.09)', padding: '16px 20px',
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search ticket number…"
          style={{
            border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
            padding: '8px 12px', fontSize: 13, color: '#000',
            outline: 'none', width: 200, transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
          onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
        />
        {[
          { value: agent,     options: agentOptions,    setter: setAgent },
          { value: category,  options: categoryOptions, setter: setCategory },
          { value: issueType, options: ISSUE_TYPES,     setter: setIssueType },
        ].map((f, i) => (
          <select
            key={i}
            value={f.value}
            onChange={e => f.setter(e.target.value)}
            style={{
              border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
              padding: '8px 12px', fontSize: 13, color: '#58595B',
              outline: 'none', background: '#fff', transition: 'border-color 0.15s',
              cursor: 'pointer',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          >
            {f.options.map(o => <option key={o}>{o}</option>)}
          </select>
        ))}
        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0',
              fontWeight: 500, background: 'none', border: 'none', padding: '4px 2px',
              transition: 'opacity 0.15s', cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Count */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        {loading ? (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading…</p>
        ) : (
          <>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
              <span style={{ fontWeight: 600, color: '#000' }}>{ticketCount.toLocaleString()}</span>
              {' '}{hasFilters ? 'matching tickets' : 'total tickets'}
            </p>
            <span style={{ color: 'rgba(0,0,0,0.15)', fontSize: 16 }}>·</span>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
              <span style={{ fontWeight: 600, color: '#000' }}>{total.toLocaleString()}</span>
              {' '}{hasFilters ? 'matching submissions' : 'total submissions'}
            </p>
          </>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '130px 1fr 160px 180px 1fr',
          padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.07)',
          background: 'rgba(0,0,0,0.015)',
        }}>
          {['Ticket', 'Agent', 'Issue type', 'Category', 'Date'].map(h => (
            <span key={h} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
              color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              {h}
            </span>
          ))}
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{
                height: 20, borderRadius: 6,
                background: `rgba(0,0,0,${0.04 + (i % 2) * 0.02})`,
                animation: 'pulse 1.4s ease-in-out infinite',
              }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
              No submissions match your filters
            </p>
          </div>
        ) : (
          rows.map((s, i) => {
            const cfg = ISSUE_CONFIG[s.issueType] ?? { bg: 'rgba(0,0,0,0.06)', color: '#58595B' }
            return (
              <div
                key={s.id}
                onClick={() => setSelected(s)}
                style={{
                  display: 'grid', gridTemplateColumns: '130px 1fr 160px 180px 1fr',
                  padding: '13px 20px', alignItems: 'center',
                  borderBottom: i < rows.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                  transition: 'background 0.1s', cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(206,164,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  color: '#9B59D0', textDecoration: 'underline',
                  textDecorationColor: 'rgba(155,89,208,0.3)',
                }}>
                  {s.ticket}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>
                  {s.agent}
                </span>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                  padding: '3px 9px', borderRadius: 100, width: 'fit-content',
                  background: cfg.bg, color: cfg.color,
                }}>
                  {s.issueType}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
                  {s.category}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>
                  {s.date}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <PageBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</PageBtn>
          {paginationRange(page, totalPages).map((n, i) =>
            n === '…' ? (
              <span key={`ellipsis-${i}`} style={{ width: 32, textAlign: 'center', color: '#aaa', fontSize: 13 }}>…</span>
            ) : (
              <PageBtn key={n} active={n === page} onClick={() => setPage(n as number)}>
                {n}
              </PageBtn>
            )
          )}
          <PageBtn disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>→</PageBtn>
        </div>
      )}

      <div style={{ height: 8 }} />

      {selected && <SubmissionModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function SubmissionModal({ row, onClose }: { row: Row; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cfg = ISSUE_CONFIG[row.issueType] ?? { bg: 'rgba(0,0,0,0.06)', color: '#58595B' }

  const meta: { label: string; value: string }[] = [
    { label: 'Ticket',    value: row.ticket },
    { label: 'Agent',     value: row.agent },
    { label: 'Email',     value: row.agentEmail },
    { label: 'Team',      value: row.agentTeam },
    { label: 'Category',  value: row.category },
    { label: 'Timestamp', value: row.loggedAt ? formatDate(row.loggedAt) : '—' },
  ]

  const sections: { label: string; value: string }[] = [
    { label: 'Customer Input',     value: row.customerInput },
    { label: 'Suggested Response', value: row.suggestedResponse },
    { label: 'Reasoning',          value: row.reasoning },
    { label: 'Final Edits',        value: row.finalEdits },
    { label: 'Notes',              value: row.notes },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 20, width: '100%', maxWidth: 720,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>
                Ticket {row.ticket}
              </h2>
              <span style={{
                fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                padding: '3px 10px', borderRadius: 100,
                background: cfg.bg, color: cfg.color,
              }}>
                {row.issueType}
              </span>
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 3 }}>
              {row.category} · {row.loggedAt ? formatDate(row.loggedAt) : 'No timestamp'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#000')}
            onMouseLeave={e => (e.currentTarget.style.color = '#aaa')}
          >
            ×
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Metadata grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 24px',
            padding: '14px 16px', background: 'rgba(0,0,0,0.02)',
            borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)',
          }}>
            {meta.map(m => (
              <div key={m.label}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                  {m.label}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', wordBreak: 'break-word' }}>
                  {m.value || <span style={{ color: '#aaa' }}>—</span>}
                </p>
              </div>
            ))}
          </div>

          {/* Long-form text sections */}
          {sections.map(s => (
            <div key={s.label}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {s.label}
              </p>
              {s.value ? (
                <p style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.55,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: '#fafafa', border: '1px solid rgba(0,0,0,0.06)',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  {s.value}
                </p>
              ) : (
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa', fontStyle: 'italic' }}>
                  Not provided
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function paginationRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  if (current > 3) pages.push('…')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

function PageBtn({ children, onClick, disabled, active }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32, height: 32, borderRadius: 8, fontSize: 13,
        fontFamily: 'Inter, sans-serif', fontWeight: active ? 600 : 400,
        background: active ? '#9B59D0' : '#fff',
        color: active ? '#fff' : disabled ? 'rgba(0,0,0,0.25)' : '#58595B',
        border: '1.5px solid rgba(0,0,0,0.09)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}
