import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const ISSUE_CONFIG: Record<string, { bg: string; color: string }> = {
  'Perfect':       { bg: 'rgba(22,101,52,0.09)',  color: '#166534' },
  'Majority edit': { bg: 'rgba(234,179,8,0.12)',  color: '#854d0e' },
  'Partial edit':  { bg: 'rgba(206,164,255,0.2)', color: '#6b21a8' },
  'No response':   { bg: 'rgba(229,62,62,0.09)',  color: '#e53e3e' },
}

const ISSUE_TYPES = ['All issue types', 'Perfect', 'Majority edit', 'Partial edit', 'No response']
const ISSUE_TYPE_VALUES = ['Perfect', 'Majority edit', 'Partial edit', 'No response']
const PAGE_SIZE = 25

// Canonical category names — merges case-variant duplicates (e.g. "Bet dispute" → "Bet Dispute")
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatSourceTimestamp(iso: string): string {
  const d = new Date(iso)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const y = d.getFullYear()
  let h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${m}/${day}/${y}, ${h}:${min}:${sec} ${ap}`
}

function csvField(val: unknown): string {
  const s = val == null ? '' : String(val)
  return `"${s.replace(/"/g, '""')}"`
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.75 7.5h6.5L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function Submissions() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [rows,        setRows]        = useState<Row[]>([])
  const [total,       setTotal]       = useState(0)
  const [ticketCount, setTicketCount] = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [page,        setPage]        = useState(1)
  const [refreshKey,  setRefreshKey]  = useState(0)

  const [search,    setSearch]    = useState('')
  const [agent,     setAgent]     = useState('All agents')
  const [category,  setCategory]  = useState('All categories')
  const [issueType, setIssueType] = useState('All issue types')

  const [agentOptions,    setAgentOptions]    = useState<string[]>(['All agents'])
  const [categoryOptions, setCategoryOptions] = useState<string[]>(['All categories'])

  const [selected,    setSelected]    = useState<Row | null>(null)
  const [hoveredId,   setHoveredId]   = useState<string | null>(null)

  // Load distinct filter options once
  useEffect(() => {
    async function loadFilters() {
      const [{ data: agentData }, { data: catData }] = await Promise.all([
        supabase.from('tickets').select('agent_name').order('agent_name'),
        supabase.from('tickets').select('ticket_category').order('ticket_category'),
      ])
      const agents = [...new Set(agentData?.map(r => r.agent_name).filter(Boolean))] as string[]
      const cats   = [...new Set(catData?.map(r => normalizeCategory(r.ticket_category)).filter(Boolean))].sort() as string[]
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
        category:          normalizeCategory(ti.tickets?.ticket_category ?? ''),
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
  }, [buildQuery, refreshKey])

  useEffect(() => { setPage(1) }, [search, agent, category, issueType])

  const hasFilters = agent !== 'All agents' || category !== 'All categories' ||
                     issueType !== 'All issue types' || search.trim()

  function clearFilters() {
    setSearch(''); setAgent('All agents')
    setCategory('All categories'); setIssueType('All issue types')
  }

  function refresh() { setRefreshKey(k => k + 1) }

  function handleUpdated(updated: Row) {
    setRows(prev => prev.map(r => r.id === updated.id ? updated : r))
    setSelected(updated)
  }

  function handleDeleted(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
    setTotal(t => t - 1)
    setSelected(null)
    refresh()
  }

  async function exportCSV() {
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

    const header = [
      'Timestamp', 'Agent', 'Email', 'Team', 'Ticket', 'Category', 'Issue type',
      'Customer Input', 'Suggested Response', 'Reasoning', 'Final Edits', 'Notes',
    ].map(csvField).join(',')

    const csvRows = all.map((ti: any) => {
      const t = ti.tickets ?? {}
      return [
        ti.logged_at ? formatSourceTimestamp(ti.logged_at) : '',
        t.agent_name, t.agent_email, t.agent_team, t.ticket_number, t.ticket_category,
        ti.issue_type, ti.customer_input, ti.suggested_response,
        ti.reasoning, ti.final_edits, ti.issue_comment,
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
            const isHovered = hoveredId === s.id
            return (
              <div
                key={s.id}
                onClick={() => setSelected(s)}
                onMouseEnter={() => setHoveredId(s.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  position: 'relative',
                  display: 'grid', gridTemplateColumns: '130px 1fr 160px 180px 1fr',
                  padding: '13px 20px', alignItems: 'center',
                  borderBottom: i < rows.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                  transition: 'background 0.1s', cursor: 'pointer',
                  background: isHovered ? 'rgba(206,164,255,0.06)' : 'transparent',
                }}
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

                {/* Admin row actions — appear on hover */}
                {isAdmin && isHovered && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                      display: 'flex', gap: 4,
                    }}
                  >
                    <RowActionBtn
                      title="Edit submission"
                      color="#58595B"
                      hoverColor="#000"
                      onClick={() => setSelected(s)}
                    >
                      <EditIcon />
                    </RowActionBtn>
                    <RowActionBtn
                      title="Delete submission"
                      color="#aaa"
                      hoverColor="#e53e3e"
                      onClick={async () => {
                        if (!window.confirm(`Delete submission for ticket ${s.ticket}? This cannot be undone.`)) return
                        const { error } = await supabase.from('ticket_issues').delete().eq('id', s.id)
                        if (!error) handleDeleted(s.id)
                      }}
                    >
                      <TrashIcon />
                    </RowActionBtn>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <PageBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</PageBtn>
          {paginationRange(page, totalPages).map((n, idx) =>
            n === '…' ? (
              <span key={`e-${idx}`} style={{ width: 32, textAlign: 'center', color: '#aaa', fontSize: 13 }}>…</span>
            ) : (
              <PageBtn key={n} active={n === page} onClick={() => setPage(n as number)}>{n}</PageBtn>
            )
          )}
          <PageBtn disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>→</PageBtn>
        </div>
      )}

      <div style={{ height: 8 }} />

      {selected && (
        <SubmissionModal
          row={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

// ── Row action button ──────────────────────────────────────────────────────────
function RowActionBtn({
  children, title, color, hoverColor, onClick,
}: {
  children: React.ReactNode
  title: string
  color: string
  hoverColor: string
  onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: 8,
        border: '1.5px solid rgba(0,0,0,0.09)',
        background: hov ? (hoverColor === '#e53e3e' ? 'rgba(229,62,62,0.06)' : 'rgba(0,0,0,0.04)') : '#fff',
        color: hov ? hoverColor : color,
        cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

// ── Submission modal ───────────────────────────────────────────────────────────
function SubmissionModal({
  row, isAdmin, onClose, onUpdated, onDeleted,
}: {
  row: Row
  isAdmin: boolean
  onClose: () => void
  onUpdated: (r: Row) => void
  onDeleted: (id: string) => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { if (mode !== 'view') setMode('view'); else onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mode])

  const cfg = ISSUE_CONFIG[row.issueType] ?? { bg: 'rgba(0,0,0,0.06)', color: '#58595B' }

  const meta: { label: string; value: string }[] = [
    { label: 'Ticket',    value: row.ticket },
    { label: 'Agent',     value: row.agent },
    { label: 'Email',     value: row.agentEmail },
    { label: 'Team',      value: row.agentTeam },
    { label: 'Category',  value: row.category },
    { label: 'Timestamp', value: row.loggedAt ? formatDate(row.loggedAt) : '—' },
  ]

  return (
    <div
      onClick={() => { if (mode !== 'view') return; onClose() }}
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
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.07)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>
                  {mode === 'edit' ? 'Edit Submission' : `Ticket ${row.ticket}`}
                </h2>
                {mode === 'view' && (
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                    padding: '3px 10px', borderRadius: 100,
                    background: cfg.bg, color: cfg.color,
                  }}>
                    {row.issueType}
                  </span>
                )}
              </div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 3 }}>
                {mode === 'edit'
                  ? `Ticket ${row.ticket} · ${row.agent}`
                  : `${row.category} · ${row.loggedAt ? formatDate(row.loggedAt) : 'No timestamp'}`}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Admin actions — only in view mode */}
              {isAdmin && mode === 'view' && (
                <>
                  <button
                    onClick={() => setMode('edit')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                      padding: '7px 13px', borderRadius: 10,
                      border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                  >
                    <EditIcon /> Edit
                  </button>
                  <button
                    onClick={() => setMode('confirmDelete')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                      padding: '7px 13px', borderRadius: 10,
                      border: '1.5px solid rgba(229,62,62,0.25)', background: 'rgba(229,62,62,0.04)', color: '#e53e3e',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(229,62,62,0.09)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(229,62,62,0.04)')}
                  >
                    <TrashIcon /> Delete
                  </button>
                </>
              )}
              <button
                onClick={() => { if (mode !== 'view') setMode('view'); else onClose() }}
                style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 1 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#000')}
                onMouseLeave={e => (e.currentTarget.style.color = '#aaa')}
              >
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Delete confirmation */}
        {mode === 'confirmDelete' && (
          <DeleteConfirm
            ticket={row.ticket}
            onCancel={() => setMode('view')}
            onConfirm={async () => {
              const { error } = await supabase.from('ticket_issues').delete().eq('id', row.id)
              if (!error) onDeleted(row.id)
            }}
          />
        )}

        {/* Edit form */}
        {mode === 'edit' && (
          <EditForm
            row={row}
            onCancel={() => setMode('view')}
            onSaved={updated => { onUpdated(updated); setMode('view') }}
          />
        )}

        {/* View mode body */}
        {mode === 'view' && (
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
            {[
              { label: 'Customer Input',     value: row.customerInput },
              { label: 'Suggested Response', value: row.suggestedResponse },
              { label: 'Reasoning',          value: row.reasoning },
              { label: 'Final Edits',        value: row.finalEdits },
              { label: 'Notes',              value: row.notes },
            ].map(s => (
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
        )}
      </div>
    </div>
  )
}

// ── Delete confirmation panel ──────────────────────────────────────────────────
function DeleteConfirm({
  ticket, onCancel, onConfirm,
}: {
  ticket: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true); setErr(null)
    try { await onConfirm() }
    catch (e: any) { setErr(e?.message ?? 'Delete failed'); setBusy(false) }
  }

  return (
    <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(229,62,62,0.05)', border: '1px solid rgba(229,62,62,0.15)', width: '100%' }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600, color: '#e53e3e', marginBottom: 6 }}>
          Delete this submission?
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.5 }}>
          This will permanently remove the submission for ticket <strong>{ticket}</strong>. The action cannot be undone.
        </p>
      </div>
      {err && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{err}</p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleConfirm}
          disabled={busy}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '8px 16px', borderRadius: 10,
            background: busy ? 'rgba(229,62,62,0.5)' : '#e53e3e', color: '#fff',
            border: 'none', cursor: busy ? 'default' : 'pointer', transition: 'all 0.15s',
          }}
        >
          {busy ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '8px 16px', borderRadius: 10,
            border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Edit form ──────────────────────────────────────────────────────────────────
function EditForm({
  row, onCancel, onSaved,
}: {
  row: Row
  onCancel: () => void
  onSaved: (updated: Row) => void
}) {
  const [issueType,         setIssueType]         = useState(row.issueType)
  const [customerInput,     setCustomerInput]     = useState(row.customerInput)
  const [suggestedResponse, setSuggestedResponse] = useState(row.suggestedResponse)
  const [reasoning,         setReasoning]         = useState(row.reasoning)
  const [finalEdits,        setFinalEdits]        = useState(row.finalEdits)
  const [notes,             setNotes]             = useState(row.notes)
  const [saving,            setSaving]            = useState(false)
  const [err,               setErr]               = useState<string | null>(null)

  async function handleSave() {
    setSaving(true); setErr(null)
    const { error } = await supabase.from('ticket_issues').update({
      issue_type:         issueType         || null,
      customer_input:     customerInput     || null,
      suggested_response: suggestedResponse || null,
      reasoning:          reasoning         || null,
      final_edits:        finalEdits        || null,
      issue_comment:      notes             || null,
    }).eq('id', row.id)

    if (error) { setErr(error.message); setSaving(false); return }

    onSaved({
      ...row,
      issueType, customerInput, suggestedResponse, reasoning, finalEdits, notes,
    })
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
    padding: '10px 12px', fontSize: 13, color: '#000',
    fontFamily: 'Inter, sans-serif', lineHeight: 1.5,
    outline: 'none', resize: 'vertical', transition: 'border-color 0.15s',
  }

  return (
    <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Issue type */}
      <div>
        <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
          Issue Type
        </label>
        <select
          value={issueType}
          onChange={e => setIssueType(e.target.value)}
          style={{ ...fieldStyle, resize: undefined, cursor: 'pointer' }}
          onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
          onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
        >
          {ISSUE_TYPE_VALUES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {/* Text fields */}
      {[
        { label: 'Customer Input',     value: customerInput,     setter: setCustomerInput,     rows: 3 },
        { label: 'Suggested Response', value: suggestedResponse, setter: setSuggestedResponse, rows: 4 },
        { label: 'Reasoning',          value: reasoning,         setter: setReasoning,         rows: 3 },
        { label: 'Final Edits',        value: finalEdits,        setter: setFinalEdits,        rows: 3 },
        { label: 'Notes',              value: notes,             setter: setNotes,             rows: 2 },
      ].map(f => (
        <div key={f.label}>
          <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
            {f.label}
          </label>
          <textarea
            value={f.value}
            onChange={e => f.setter(e.target.value)}
            rows={f.rows}
            placeholder={`Enter ${f.label.toLowerCase()}…`}
            style={fieldStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          />
        </div>
      ))}

      {err && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{err}</p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4, paddingBottom: 4 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '9px 20px', borderRadius: 10,
            background: saving ? 'rgba(0,0,0,0.4)' : '#000', color: '#fff',
            border: 'none', cursor: saving ? 'default' : 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.8' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '9px 16px', borderRadius: 10,
            border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Shared ─────────────────────────────────────────────────────────────────────
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
