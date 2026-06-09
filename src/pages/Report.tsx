import { useState, useEffect } from 'react'
import { supabase, authClient } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'
import { getDailyTarget } from '../lib/settings'

const PERIODS = ['Last 7 days', 'Last 30 days', 'Last quarter', 'All time']
const AUDIENCES = [
  'Executive (CPO/COO/CTO)',
  'Operations Manager',
  'CS Team Lead',
  'Client / Operator',
]
const FOCUS_AREAS = [
  'Balanced overview',
  'Agent performance',
  'gameLM quality',
  'Category breakdown',
  'Event impact',
]
const EXPORT_FORMATS = ['PDF (.pdf)', 'CSV (.csv)', 'Markdown (.md)']

interface DBReport {
  id: string
  period: string
  audience: string
  focus_area: string | null
  issue_count: number
  report_content: string
  created_at: string
  generated_by_email: string | null
}

export default function Report() {
  const { user } = useAuth()
  const { selectedOperator } = useOperator()
  const isAdmin = user?.role === 'admin'

  const [period,       setPeriod]       = useState(PERIODS[0])
  const [audience,     setAudience]     = useState(AUDIENCES[0])
  const [focusArea,    setFocusArea]    = useState(FOCUS_AREAS[0])
  const [exportFormat, setExportFormat] = useState(EXPORT_FORMATS[0])
  const [output,       setOutput]       = useState<string | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [showHistory,  setShowHistory]  = useState(false)
  const [history,      setHistory]      = useState<DBReport[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (showHistory) loadHistory()
  }, [showHistory])

  async function loadHistory() {
    setHistoryLoading(true)
    let q = supabase
      .from('report_history')
      .select('id, period, audience, focus_area, issue_count, report_content, created_at, generated_by_email')
      .order('created_at', { ascending: false })
      .limit(20)
    const { data } = await q
    setHistory(data ?? [])
    setHistoryLoading(false)
  }

  function getPeriodDays(): number {
    if (period === 'Last 7 days') return 7
    if (period === 'Last 30 days') return 30
    if (period === 'Last quarter') return 90
    return 3650
  }

  async function runReport() {
    setLoading(true)
    setOutput(null)

    const days = getPeriodDays()
    const since = new Date()
    since.setDate(since.getDate() - days)
    const dailyTarget = getDailyTarget()

    // ── Fetch raw data ────────────────────────────────────────────────────
    let issueQ = supabase
      .from('ticket_issues')
      .select('issue_type, logged_at, tickets!inner(ticket_number, agent_name, ticket_category, created_at)')
      .gte('logged_at', since.toISOString())
      .order('logged_at', { ascending: false })
    if (selectedOperator?.id) issueQ = issueQ.eq('operator_id', selectedOperator.id)
    const { data: issues } = await issueQ

    const rows = issues ?? []
    const total    = rows.length
    const perfect  = rows.filter((r: any) => r.issue_type === 'Perfect').length
    const noResp   = rows.filter((r: any) => r.issue_type === 'No response').length
    const majEdit  = rows.filter((r: any) => r.issue_type === 'Majority edit').length
    const partEdit = rows.filter((r: any) => r.issue_type === 'Partial edit').length
    const pct = (n: number) => total ? ((n / total) * 100).toFixed(1) + '%' : '–'

    const ticketNums  = new Set(rows.map((r: any) => r.tickets?.ticket_number).filter(Boolean))
    const ticketCount = ticketNums.size

    // ── Agent summary ─────────────────────────────────────────────────────
    const agentMap = new Map<string, { total: number; perfect: number }>()
    for (const r of rows) {
      const agent: string = (r as any).tickets?.agent_name ?? 'Unknown'
      const prev = agentMap.get(agent) ?? { total: 0, perfect: 0 }
      agentMap.set(agent, {
        total:   prev.total + 1,
        perfect: prev.perfect + (r.issue_type === 'Perfect' ? 1 : 0),
      })
    }
    const topAgents = [...agentMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([name, s]) => ({
        name,
        tickets: s.total,
        perfectRate: s.total ? ((s.perfect / s.total) * 100).toFixed(0) + '%' : '0%',
      }))

    // ── Category summary ──────────────────────────────────────────────────
    const catMap = new Map<string, { total: number; perfect: number; noResp: number }>()
    for (const r of rows) {
      const cat: string = (r as any).tickets?.ticket_category ?? 'Other'
      const prev = catMap.get(cat) ?? { total: 0, perfect: 0, noResp: 0 }
      catMap.set(cat, {
        total:   prev.total + 1,
        perfect: prev.perfect + (r.issue_type === 'Perfect' ? 1 : 0),
        noResp:  prev.noResp  + (r.issue_type === 'No response' ? 1 : 0),
      })
    }
    const categoryBreakdown = [...catMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([name, s]) => {
        const perfectPct = s.total ? ((s.perfect / s.total) * 100).toFixed(0) + '%' : '0%'
        const noRespPct  = s.total ? ((s.noResp  / s.total) * 100).toFixed(0) + '%' : '0%'
        const pctNum     = s.total ? (s.perfect / s.total) * 100 : 0
        const status     = s.total < 10 ? 'Low data' : pctNum >= 90 ? 'Autopilot ready' : pctNum >= 75 ? 'Almost ready' : 'Not ready'
        return { name, vol: s.total, perfectPct, noRespPct, status }
      })

    // ── Call Edge Function for AI narrative ───────────────────────────────
    let reportText = ''
    try {
      const { data: fnData, error: fnError } = await authClient.functions.invoke('generate-report', {
        body: {
          period,
          audience,
          focusArea,
          metrics: {
            ticketCount,
            totalResponses: total,
            avgPerTicket:   ticketCount ? (total / ticketCount).toFixed(1) : '0',
            avgPerDay:      ticketCount ? (ticketCount / days).toFixed(1)  : '0',
            perfectPct:     pct(perfect),
            majorityPct:    pct(majEdit),
            partialPct:     pct(partEdit),
            noRespPct:      pct(noResp),
            targetRange:    `${dailyTarget.min}–${dailyTarget.max}`,
          },
          topAgents,
          categoryBreakdown,
        },
      })

      if (fnError) throw new Error(fnError.message)
      reportText = fnData?.report ?? ''
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setOutput(`**Error generating report:** ${msg}\n\nCheck that the \`generate-report\` Edge Function is deployed and \`ANTHROPIC_API_KEY\` is set in Supabase secrets.`)
      setLoading(false)
      return
    }

    setOutput(reportText)

    // ── Save to history ───────────────────────────────────────────────────
    if (user) {
      try {
        const { data: { session } } = await authClient.auth.getSession()
        if (session?.user?.id) {
          await supabase.from('report_history').insert([{
            user_id:             session.user.id,
            period,
            audience,
            focus_area:          focusArea,
            issue_count:         total,
            report_content:      reportText,
            generated_by_email:  user.email,
          }])
        }
      } catch (_) { /* non-critical */ }
    }

    setLoading(false)
  }

  function exportReport(content: string, format: string) {
    const date = new Date().toISOString().split('T')[0]
    if (format.startsWith('PDF')) {
      // Open a minimal print window with the rendered content
      const html = `<!DOCTYPE html><html><head><title>gameLM Report ${date}</title>
        <style>body{font-family:Inter,sans-serif;max-width:800px;margin:40px auto;color:#000;line-height:1.7}
        h2{font-family:Manrope,sans-serif;font-size:1.4em;margin-top:1.8em}
        h3{font-family:Manrope,sans-serif;font-size:1.1em;margin-top:1.4em}
        table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px 12px;font-size:0.9em}
        th{background:#f5f5f5;font-weight:600}hr{border:none;border-top:1px solid #eee}
        </style></head><body>${markdownToHtml(content)}<script>window.print();window.onafterprint=()=>window.close()</script></body></html>`
      const w = window.open('', '_blank')
      if (w) { w.document.write(html); w.document.close() }
    } else if (format.startsWith('CSV')) {
      // Extract tables from markdown and export as CSV
      const lines = content.split('\n')
      const csvRows: string[] = []
      for (const line of lines) {
        if (line.startsWith('|') && !line.match(/^\|[-|\s]+$/)) {
          const cells = line.split('|').filter(Boolean).map(c => `"${c.trim().replace(/"/g, '""')}"`)
          csvRows.push(cells.join(','))
        } else if (line.trim() && !line.startsWith('#') && !line.startsWith('**')) {
          csvRows.push(`"${line.trim().replace(/\*\*/g, '').replace(/"/g, '""')}"`)
        }
      }
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `gamelm-report-${date}.csv`; a.click()
    } else {
      // Markdown
      const blob = new Blob([content], { type: 'text/markdown' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `gamelm-report-${date}.md`; a.click()
    }
  }

  function markdownToHtml(md: string): string {
    return md
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^---$/gm, '<hr>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\|(.+)\|$/gm, (line) => {
        if (line.match(/^\|[-|\s]+\|$/)) return ''
        const cells = line.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('')
        return `<tr>${cells}</tr>`
      })
      .replace(/(<tr>.*<\/tr>\n?)+/g, m => `<table>${m}</table>`)
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ol>${m}</ol>`)
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hto]|<\/|<li|<ol|<ul)(.+)$/gm, '$1')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Report</h1>

      {/* Settings card */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000' }}>
            Report Settings
          </h2>
          <button
            onClick={() => setShowHistory(h => !h)}
            style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              padding: '7px 14px', borderRadius: 10, cursor: 'pointer',
              border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
          >
            {showHistory ? 'Hide history' : 'View history'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <SelectField label="Period"        value={period}       options={PERIODS}         onChange={setPeriod} />
          <SelectField label="Audience"      value={audience}     options={AUDIENCES}       onChange={setAudience} />
          <SelectField label="Focus Area"    value={focusArea}    options={FOCUS_AREAS}     onChange={setFocusArea} />
          <SelectField label="Export Format" value={exportFormat} options={EXPORT_FORMATS}  onChange={setExportFormat} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={runReport}
            disabled={loading}
            style={{
              background: loading ? 'rgba(0,0,0,0.1)' : '#000',
              color: loading ? 'rgba(0,0,0,0.35)' : '#fff',
              fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
              padding: '10px 22px', borderRadius: 10, border: 'none',
              transition: 'opacity 0.15s',
              cursor: loading ? 'default' : 'pointer',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.8' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            {loading ? 'Generating…' : 'Run report'}
          </button>
          {output && (
            <button
              onClick={() => exportReport(output, exportFormat)}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
                padding: '10px 22px', borderRadius: 10, cursor: 'pointer',
                border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              Export as {exportFormat.split(' ')[0]}
            </button>
          )}
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
          <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 14 }}>
            Report History {isAdmin && <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#aaa' }}>(all users)</span>}
          </h2>
          {historyLoading ? (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading…</p>
          ) : history.length === 0 ? (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>No reports generated yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map(h => (
                <div
                  key={h.id}
                  onClick={() => { setOutput(h.report_content); setShowHistory(false) }}
                  style={{
                    padding: '14px 16px', borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.08)',
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
                    transition: 'background 0.15s', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.02)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      {[h.period, h.audience, h.focus_area].filter(Boolean).map(tag => (
                        <span key={tag!} style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500,
                          padding: '2px 8px', borderRadius: 100,
                          background: 'rgba(206,164,255,0.15)', color: '#6b21a8',
                        }}>
                          {tag}
                        </span>
                      ))}
                      {h.issue_count > 0 && (
                        <span style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500,
                          padding: '2px 8px', borderRadius: 100,
                          background: 'rgba(0,0,0,0.06)', color: '#58595B',
                        }}>
                          {h.issue_count.toLocaleString()} responses
                        </span>
                      )}
                    </div>
                    <p style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {h.report_content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').split('\n').find(l => l.trim()) ?? ''}
                    </p>
                    {isAdmin && h.generated_by_email && (
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 3 }}>
                        by {h.generated_by_email}
                      </p>
                    )}
                  </div>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', flexShrink: 0 }}>
                    {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Output card */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 24px', borderBottom: '1px solid rgba(0,0,0,0.07)', background: 'rgba(0,0,0,0.015)' }}>
          <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>
            Report output
          </span>
        </div>

        <div style={{ padding: 24, minHeight: 220 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#9B59D0', opacity: 0.3,
                    animation: 'bounce 1.2s ease-in-out infinite',
                    animationDelay: `${i * 0.2}s`,
                  }} />
                ))}
              </div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', fontWeight: 500 }}>
                Claude is analysing your data…
              </p>
              <style>{`@keyframes bounce { 0%,80%,100%{opacity:0.3;transform:scale(1)} 40%{opacity:1;transform:scale(1.3)} }`}</style>
            </div>
          ) : output ? (
            <ReportMarkdown content={output} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180 }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
                Configure settings above and click "Run report" to generate analysis.
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ height: 8 }} />
    </div>
  )
}

function ReportMarkdown({ content }: { content: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {content.split('\n\n').map((block, i) => {
        if (block.startsWith('## ')) {
          return <h2 key={i} style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>{block.replace('## ', '')}</h2>
        }
        if (block.startsWith('### ')) {
          return <h3 key={i} style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginTop: 4 }}>{block.replace('### ', '')}</h3>
        }
        if (block.startsWith('---')) {
          return <hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)' }} />
        }
        if (block.includes('|')) {
          const rows = block.split('\n').filter(r => !r.match(/^\|[-|\s]+$/))
          const colCount = rows[0]?.split('|').filter(Boolean).length ?? 2
          return (
            <div key={i} style={{ borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
              {rows.map((row, ri) => {
                const cells = row.split('|').filter(Boolean).map(c => c.trim())
                return (
                  <div key={ri} style={{
                    display: 'grid', gridTemplateColumns: `repeat(${colCount}, 1fr)`,
                    padding: '9px 14px',
                    background: ri === 0 ? 'rgba(0,0,0,0.03)' : 'transparent',
                    borderBottom: ri < rows.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                  }}>
                    {cells.map((cell, ci) => (
                      <span key={ci} style={{
                        fontFamily: 'Inter, sans-serif', fontSize: 13,
                        fontWeight: ri === 0 ? 600 : 400,
                        color: ri === 0 ? '#58595B' : '#000',
                      }}>{cell}</span>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        }
        if (block.match(/^\d+\./m)) {
          return (
            <ol key={i} style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {block.split('\n').filter(Boolean).map((line, li) => (
                <li key={li} style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', lineHeight: 1.6 }}>
                  {line.replace(/^\d+\.\s/, '')}
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={i} style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', lineHeight: 1.7 }}>
            {block.replace(/\*\*(.*?)\*\*/g, '$1')}
          </p>
        )
      })}
    </div>
  )
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
          padding: '9px 12px', fontSize: 13, color: '#000',
          outline: 'none', background: '#fff', transition: 'border-color 0.15s',
          fontFamily: 'Inter, sans-serif',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
        onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
      >
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}
