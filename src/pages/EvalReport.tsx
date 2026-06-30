import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOperator } from '../context/OperatorContext'
import { useAuth } from '../context/AuthContext'

// Engineering triage report — one focused LLM analysis per eval section, generated
// on demand (no cost/load unless a SuperAdmin clicks Generate). Its own top-level page
// (moved out of Admin Settings → Report tab). Generate/Regenerate opens a modal to pick
// the date range to analyze (a preset or a custom from/to); History lists every past run
// for a section as one flat timeline, each tagged with the range it used — there's no
// separate "latest per window" lookup, just the newest row overall. Fully separate from
// the Report Card.

type SectionKey = 'corrections' | 'enhancements' | 'accuracy' | 'quality'
type PresetKey = 'today' | '7d' | '30d' | '90d' | 'all'

interface Finding {
  title: string; theme: string; severity: string
  evidence: string; likely_root_cause: string; recommended_investigation: string
  instance_filter?: { themes?: string[]; error_class?: string }
}
interface Priority { rank: number; issue: string; why_it_matters: string; suggested_fix: string }
interface Synthesis {
  headline?: string; executive_summary?: string
  findings?: Finding[]; top_priorities?: Priority[]
  error?: string
}
interface SectionResult {
  loading: boolean; error: string | null
  id?: string; rangeLabel?: string; isHistorical?: boolean
  generatedAt?: string; generatedBy?: string | null; aggregates?: any; synthesis?: Synthesis
}
interface Drill {
  section: SectionKey; finding: Finding
  loading: boolean; error: string | null; rows: any[]
}
interface HistoryEntry { id: string; generated_at: string; generated_by: string | null; range_label: string | null }
interface RangeSelection { preset: PresetKey | 'custom'; customFrom?: string; customTo?: string }

// Columns we pull for the drill-down instances (superset across sections).
// external_ticket_id = the logged gameLM Ticket ID, so engineers can trace each
// analyzed instance back to its source ticket.
const DRILL_COLS = 'id,created_at,theme_tag,external_ticket_id,customer_input,suggested_response,eval_verdict,reasoning,final_edits,accuracy_error_class,accuracy_evidence,accuracy_reasoning,quality_score,quality_flag_reason'

const SECTIONS: { key: SectionKey; label: string; blurb: string }[] = [
  { key: 'corrections',  label: 'Corrections (must-fix)',   blurb: 'Where gameLM was factually wrong and a human had to correct it — requires an engineering fix.' },
  { key: 'enhancements', label: 'Enhancements (nice-to-have)', blurb: 'Where gameLM was OK but incomplete and the agent added value — track as backlog, not bugs.' },
  { key: 'accuracy',     label: 'Response Accuracy',         blurb: 'Regulatory (P1A), hallucination (P1B), and account-data (P2) errors.' },
  { key: 'quality',      label: 'Response Quality',          blurb: 'The five quality dimensions — what drags scores below bar.' },
]

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d',    label: 'Last 7 days' },
  { key: '30d',   label: 'Last 30 days' },
  { key: '90d',   label: 'Last 90 days' },
  { key: 'all',   label: 'All time' },
]

const DEFAULT_SELECTION: RangeSelection = { preset: 'all' }

const SEV: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: 'rgba(229,62,62,0.1)',   color: '#c53030', label: 'Critical' },
  high:     { bg: 'rgba(234,88,12,0.1)',    color: '#c2410c', label: 'High' },
  medium:   { bg: 'rgba(202,138,4,0.12)',   color: '#854d0e', label: 'Medium' },
  low:      { bg: 'rgba(0,0,0,0.06)',       color: '#58595B', label: 'Low' },
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 22 }

const EMPTY_RESULTS: Record<SectionKey, SectionResult> = {
  corrections:  { loading: false, error: null },
  enhancements: { loading: false, error: null },
  accuracy:     { loading: false, error: null },
  quality:      { loading: false, error: null },
}

const EMPTY_FLAGS = { corrections: false, enhancements: false, accuracy: false, quality: false }
const EMPTY_HISTORY: Record<SectionKey, HistoryEntry[] | null> = { corrections: null, enhancements: null, accuracy: null, quality: null }
const DEFAULT_SELECTIONS: Record<SectionKey, RangeSelection> = {
  corrections: DEFAULT_SELECTION, enhancements: DEFAULT_SELECTION, accuracy: DEFAULT_SELECTION, quality: DEFAULT_SELECTION,
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Resolves a UI selection (preset or custom from/to) into concrete ISO bounds plus a
// display label that gets stored verbatim on the report row — so History always shows
// exactly what was analyzed, even if "Last 7 days" would resolve differently today.
function resolveRange(sel: RangeSelection): { start: string | null; end: string | null; label: string } {
  const now = new Date()
  if (sel.preset === 'custom') {
    const from = sel.customFrom ? new Date(`${sel.customFrom}T00:00:00`) : null
    const to = sel.customTo ? new Date(`${sel.customTo}T23:59:59.999`) : null
    const label = from && to ? `${fmtShort(from)} – ${fmtShort(to)}, ${to.getFullYear()}` : 'Custom range'
    return { start: from ? from.toISOString() : null, end: to ? to.toISOString() : null, label }
  }
  if (sel.preset === 'all') return { start: null, end: null, label: 'All time' }
  if (sel.preset === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    return { start: start.toISOString(), end: null, label: `Today (${fmtShort(now)})` }
  }
  const days = sel.preset === '7d' ? 7 : sel.preset === '30d' ? 30 : 90
  const start = new Date(now); start.setDate(start.getDate() - days); start.setHours(0, 0, 0, 0)
  const presetLabel = PRESETS.find(p => p.key === sel.preset)!.label
  return { start: start.toISOString(), end: null, label: `${presetLabel} (${fmtShort(start)} – ${fmtShort(now)})` }
}

export default function EvalReport() {
  const { selectedOperator } = useOperator()
  const { user } = useAuth()
  const [results, setResults] = useState<Record<SectionKey, SectionResult>>(EMPTY_RESULTS)
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    corrections: false, enhancements: false, accuracy: false, quality: false,
  })
  const [loadingStored, setLoadingStored] = useState(false)
  const [drill, setDrill] = useState<Drill | null>(null)
  const [historyOpen, setHistoryOpen] = useState<Record<SectionKey, boolean>>(EMPTY_FLAGS)
  const [historyLoading, setHistoryLoading] = useState<Record<SectionKey, boolean>>(EMPTY_FLAGS)
  const [historyLists, setHistoryLists] = useState<Record<SectionKey, HistoryEntry[] | null>>(EMPTY_HISTORY)
  const [genModal, setGenModal] = useState<{ section: SectionKey; selection: RangeSelection } | null>(null)
  const [lastSelection, setLastSelection] = useState<Record<SectionKey, RangeSelection>>(DEFAULT_SELECTIONS)

  const toggleSection = (k: SectionKey) => setCollapsed(c => ({ ...c, [k]: !c[k] }))

  // Load each section's single most recent report — fast, no LLM call, no window
  // filter (one flat timeline per section). Every SuperAdmin sees the same latest
  // snapshot until someone regenerates it.
  async function loadLatest() {
    const op = selectedOperator?.id
    if (!op) { setResults(EMPTY_RESULTS); return }
    setLoadingStored(true)
    const { data } = await supabase
      .from('eval_triage_reports')
      .select('id,section,aggregates,synthesis,generated_at,generated_by,range_label')
      .eq('operator_id', op)
      .order('generated_at', { ascending: false })
      .limit(100)
    const next = { ...EMPTY_RESULTS }
    const seen = new Set<string>()
    for (const row of data ?? []) {
      const k = row.section as SectionKey
      if (k in next && !seen.has(k)) {
        seen.add(k)
        next[k] = {
          loading: false, error: null, id: row.id, rangeLabel: row.range_label, isHistorical: false,
          aggregates: row.aggregates, synthesis: row.synthesis, generatedAt: row.generated_at, generatedBy: row.generated_by,
        }
      }
    }
    setResults(next)
    // Stored reports start collapsed so the page opens as a clean overview.
    setCollapsed(prev => {
      const c = { ...prev }
      for (const k of seen) if (k in c) c[k as SectionKey] = true
      return c
    })
    setHistoryOpen(EMPTY_FLAGS)
    setHistoryLists(EMPTY_HISTORY)
    setLoadingStored(false)
  }

  useEffect(() => {
    setDrill(null)
    loadLatest()
  }, [selectedOperator?.id])

  async function toggleHistory(section: SectionKey) {
    if (historyOpen[section]) { setHistoryOpen(h => ({ ...h, [section]: false })); return }
    setHistoryOpen(h => ({ ...h, [section]: true }))
    if (historyLists[section] || !selectedOperator?.id) return
    setHistoryLoading(h => ({ ...h, [section]: true }))
    const { data } = await supabase
      .from('eval_triage_reports')
      .select('id,generated_at,generated_by,range_label')
      .eq('operator_id', selectedOperator.id)
      .eq('section', section)
      .order('generated_at', { ascending: false })
      .limit(30)
    setHistoryLists(h => ({ ...h, [section]: data ?? [] }))
    setHistoryLoading(h => ({ ...h, [section]: false }))
  }

  async function viewHistoricalRow(section: SectionKey, id: string) {
    const { data } = await supabase
      .from('eval_triage_reports')
      .select('id,aggregates,synthesis,generated_at,generated_by,range_label')
      .eq('id', id)
      .single()
    if (!data) return
    setResults(r => ({
      ...r,
      [section]: {
        loading: false, error: null, id: data.id, rangeLabel: data.range_label, isHistorical: true,
        aggregates: data.aggregates, synthesis: data.synthesis, generatedAt: data.generated_at, generatedBy: data.generated_by,
      },
    }))
    setCollapsed(c => ({ ...c, [section]: false }))
    setHistoryOpen(h => ({ ...h, [section]: false }))
  }

  async function backToLatest(section: SectionKey) {
    if (!selectedOperator?.id) return
    const { data } = await supabase
      .from('eval_triage_reports')
      .select('id,aggregates,synthesis,generated_at,generated_by,range_label')
      .eq('operator_id', selectedOperator.id)
      .eq('section', section)
      .order('generated_at', { ascending: false })
      .limit(1)
    const row = data?.[0]
    setResults(r => ({
      ...r,
      [section]: row
        ? { loading: false, error: null, id: row.id, rangeLabel: row.range_label, isHistorical: false, aggregates: row.aggregates, synthesis: row.synthesis, generatedAt: row.generated_at, generatedBy: row.generated_by }
        : { loading: false, error: null },
    }))
  }

  async function openDrill(section: SectionKey, finding: Finding) {
    if (!selectedOperator?.id) return
    setDrill({ section, finding, loading: true, error: null, rows: [] })
    let q = supabase.from('ticket_issues').select(DRILL_COLS).eq('operator_id', selectedOperator.id)
    const themes = finding.instance_filter?.themes ?? []
    if (themes.length) q = q.in('theme_tag', themes)
    if (section === 'corrections') q = q.eq('eval_verdict', 'CORRECTION')
    else if (section === 'enhancements') q = q.eq('eval_verdict', 'ENHANCEMENT')
    else if (section === 'accuracy') {
      const ec = finding.instance_filter?.error_class
      q = ec ? q.eq('accuracy_error_class', ec) : q.in('accuracy_error_class', ['P1A', 'P1B', 'P2'])
    } else if (section === 'quality') q = q.lt('quality_score', 3.5)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(60)
    if (error) { setDrill(d => d && { ...d, loading: false, error: error.message }); return }
    setDrill(d => d && { ...d, loading: false, rows: data ?? [] })
  }

  function openGenerateModal(section: SectionKey) {
    setGenModal({ section, selection: lastSelection[section] ?? DEFAULT_SELECTION })
  }

  async function generate(section: SectionKey, selection: RangeSelection) {
    if (!selectedOperator?.id) {
      setResults(r => ({ ...r, [section]: { loading: false, error: 'Select an operator first.' } }))
      return
    }
    const range = resolveRange(selection)
    setLastSelection(s => ({ ...s, [section]: selection }))
    setResults(r => ({ ...r, [section]: { ...r[section], loading: true, error: null } }))
    const { data, error } = await supabase.functions.invoke('eval-triage-report', {
      body: {
        operator_id: selectedOperator.id, section,
        range_start: range.start, range_end: range.end, range_label: range.label,
        generated_by: user?.name ?? user?.email ?? null,
      },
    })
    if (error || data?.error) {
      setResults(r => ({ ...r, [section]: { ...r[section], loading: false, error: data?.error ?? error?.message ?? 'Generation failed.' } }))
      return
    }
    setResults(r => ({
      ...r,
      [section]: {
        loading: false, error: null, rangeLabel: data.range_label, isHistorical: false,
        generatedAt: data.generated_at, generatedBy: data.generated_by, aggregates: data.aggregates, synthesis: data.synthesis,
      },
    }))
    setCollapsed(c => ({ ...c, [section]: false })) // expand the section you just generated
    setHistoryOpen(h => ({ ...h, [section]: false }))
    setHistoryLists(h => ({ ...h, [section]: null })) // stale — will refetch next time History is opened
  }

  // Expand/collapse-all control state (only meaningful once a section is generated).
  const generatedKeys = SECTIONS.filter(s => results[s.key].synthesis).map(s => s.key)
  const allCollapsed = generatedKeys.length > 0 && generatedKeys.every(k => collapsed[k])
  const setAll = (val: boolean) => setCollapsed(c => {
    const next = { ...c }
    for (const k of generatedKeys) next[k] = val
    return next
  })

  if (drill) return <DrillView drill={drill} onBack={() => setDrill(null)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 4 }}>
          Eval Reports — {selectedOperator?.name ?? 'no operator selected'}
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.6 }}>
          A focused LLM analysis per eval section: the patterns, likely root causes, and what to investigate to drive failures down.
          Generate or Regenerate to pick a date range to analyze — the latest run is shared across all SuperAdmins; open History to browse every prior run.
          Hand this to engineering alongside the Report Card numbers.
        </p>

        {loadingStored && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0', marginTop: 8 }}>Loading saved reports…</p>
        )}
        {generatedKeys.length > 1 && (
          <button
            onClick={() => setAll(!allCollapsed)}
            style={{
              marginTop: 12, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#9B59D0',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {allCollapsed ? 'Expand all sections' : 'Collapse all sections'}
          </button>
        )}
      </div>

      {SECTIONS.map(s => {
        const res = results[s.key]
        const syn = res.synthesis
        const isCollapsed = !!syn && collapsed[s.key]
        const findingCount = syn?.findings?.length ?? 0
        return (
          <div key={s.key} style={card}>
            {/* Section header + generate */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: (syn && !isCollapsed) || res.error || (res.aggregates && !isCollapsed) ? 16 : 0 }}>
              <div
                onClick={syn ? () => toggleSection(s.key) : undefined}
                style={{ cursor: syn ? 'pointer' : 'default', flex: 1, minWidth: 0 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {syn && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: '#58595B', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}>
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>{s.label}</p>
                  {isCollapsed && findingCount > 0 && (
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#9B59D0', background: 'rgba(155,89,208,0.08)', padding: '2px 8px', borderRadius: 100 }}>
                      {findingCount} finding{findingCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 3 }}>{s.blurb}</p>
                {res.generatedAt && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 4 }}>
                    {res.isHistorical ? 'Generated' : 'Last generated'} {new Date(res.generatedAt).toLocaleString()}
                    {res.rangeLabel ? ` · ${res.rangeLabel}` : ''}{res.generatedBy ? ` · by ${res.generatedBy}` : ''}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                {res.generatedAt && (
                  <button
                    onClick={() => toggleHistory(s.key)}
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#58595B',
                      background: historyOpen[s.key] ? 'rgba(0,0,0,0.06)' : 'transparent',
                      padding: '8px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)',
                      whiteSpace: 'nowrap', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {historyOpen[s.key] ? 'Hide history' : 'History'}
                  </button>
                )}
                <button
                  onClick={() => openGenerateModal(s.key)}
                  disabled={res.loading}
                  style={{
                    flexShrink: 0, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                    padding: '8px 16px', borderRadius: 10, border: 'none', whiteSpace: 'nowrap',
                    background: res.loading ? 'rgba(0,0,0,0.1)' : '#000', color: res.loading ? 'rgba(0,0,0,0.4)' : '#fff',
                    cursor: res.loading ? 'default' : 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {res.loading ? 'Analyzing…' : syn ? '↻ Regenerate' : 'Generate analysis'}
                </button>
              </div>
            </div>

            {historyOpen[s.key] && (
              <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Past reports
                </p>
                {historyLoading[s.key] ? (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>Loading…</p>
                ) : !historyLists[s.key]?.length ? (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>No history yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {historyLists[s.key]!.map(h => {
                      const isCurrent = h.id === res.id
                      return (
                        <button
                          key={h.id}
                          onClick={() => !isCurrent && viewHistoricalRow(s.key, h.id)}
                          disabled={isCurrent}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                            fontFamily: 'Inter, sans-serif', fontSize: 12.5, padding: '6px 10px', borderRadius: 8,
                            border: 'none', background: isCurrent ? 'rgba(155,89,208,0.08)' : 'transparent',
                            color: isCurrent ? '#9B59D0' : '#000', cursor: isCurrent ? 'default' : 'pointer', textAlign: 'left',
                          }}
                          onMouseEnter={!isCurrent ? e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)') : undefined}
                          onMouseLeave={!isCurrent ? e => (e.currentTarget.style.background = 'transparent') : undefined}
                        >
                          <span>{new Date(h.generated_at).toLocaleString()}{h.range_label ? ` · ${h.range_label}` : ''}{h.generated_by ? ` · ${h.generated_by}` : ''}</span>
                          {isCurrent && <span style={{ fontSize: 11, fontWeight: 600, flexShrink: 0 }}>Viewing</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {res.error && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>❌ {res.error}</p>
            )}
            {res.loading && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0' }}>Reading the eval data and synthesizing… (10–30s)</p>
            )}

            {res.isHistorical && !res.loading && !isCollapsed && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 14px', borderRadius: 8, background: 'rgba(202,138,4,0.08)', border: '1px solid rgba(202,138,4,0.2)', marginBottom: 14 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: '#854d0e' }}>
                  Viewing a past report — not the latest.
                </span>
                <button
                  onClick={() => backToLatest(s.key)}
                  style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#9B59D0', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Back to latest →
                </button>
              </div>
            )}

            {/* Deterministic layer — shown once data is in (even if synthesis failed), hidden when collapsed */}
            {res.aggregates && !res.loading && !isCollapsed && (
              <div style={{ marginBottom: syn ? 14 : 0 }}><AggregateStrip section={s.key} agg={res.aggregates} /></div>
            )}

            {syn && !res.loading && !isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {syn.error && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#c2410c' }}>⚠ {syn.error} The numbers above are still accurate.</p>}

                {/* Headline + summary */}
                {syn.headline && (
                  <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', lineHeight: 1.5 }}>{syn.headline}</p>
                )}
                {syn.executive_summary && (
                  <div style={{ padding: '12px 16px', borderLeft: '3px solid #9B59D0', background: 'rgba(155,89,208,0.06)', borderRadius: '0 8px 8px 0' }}>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.7 }}>{syn.executive_summary}</p>
                  </div>
                )}

                {/* Findings */}
                {(syn.findings ?? []).map((f, i) => {
                  const sev = SEV[f.severity?.toLowerCase()] ?? SEV.low
                  const canDrill = (f.instance_filter?.themes?.length ?? 0) > 0
                  return (
                    <div
                      key={i}
                      onClick={canDrill ? () => openDrill(s.key, f) : undefined}
                      style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '12px 14px', cursor: canDrill ? 'pointer' : 'default', transition: 'all 0.15s' }}
                      onMouseEnter={canDrill ? e => { e.currentTarget.style.borderColor = '#CEA4FF'; e.currentTarget.style.background = 'rgba(155,89,208,0.03)' } : undefined}
                      onMouseLeave={canDrill ? e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'; e.currentTarget.style.background = 'transparent' } : undefined}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 100, background: sev.bg, color: sev.color }}>{sev.label}</span>
                        <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13.5, fontWeight: 600, color: '#000' }}>{f.title}</span>
                        {f.theme && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9B59D0', background: 'rgba(155,89,208,0.08)', padding: '2px 8px', borderRadius: 100 }}>{f.theme}</span>}
                      </div>
                      <FieldLine label="Evidence" value={f.evidence} />
                      <FieldLine label="Likely root cause" value={f.likely_root_cause} />
                      <FieldLine label="Investigate" value={f.recommended_investigation} accent />
                      {canDrill && (
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#9B59D0', marginTop: 8 }}>
                          View analyzed tickets ({f.instance_filter!.themes!.join(', ')}{f.instance_filter?.error_class ? ` · ${f.instance_filter.error_class}` : ''}) →
                        </p>
                      )}
                    </div>
                  )
                })}

                {/* Top priorities */}
                {(syn.top_priorities ?? []).length > 0 && (
                  <div>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Fix first</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {syn.top_priorities!.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: '#000', color: '#fff', fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.rank}</span>
                          <div>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{p.issue}</p>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.6, marginTop: 2 }}>{p.why_it_matters}</p>
                            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#166534', lineHeight: 1.6, marginTop: 2 }}><strong>Fix:</strong> {p.suggested_fix}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {genModal && (
        <GenerateModal
          sectionLabel={SECTIONS.find(s => s.key === genModal.section)!.label}
          selection={genModal.selection}
          onChange={sel => setGenModal(m => m && { ...m, selection: sel })}
          onConfirm={() => { generate(genModal.section, genModal.selection); setGenModal(null) }}
          onCancel={() => setGenModal(null)}
        />
      )}
    </div>
  )
}

function GenerateModal({ sectionLabel, selection, onChange, onConfirm, onCancel }: {
  sectionLabel: string; selection: RangeSelection
  onChange: (sel: RangeSelection) => void; onConfirm: () => void; onCancel: () => void
}) {
  const preview = resolveRange(selection)
  const customIncomplete = selection.preset === 'custom' && (!selection.customFrom || !selection.customTo)
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onCancel}
    >
      <div style={{ ...card, width: 420, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 4 }}>
          What data should this cover?
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: '#58595B', marginBottom: 14 }}>{sectionLabel}</p>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => onChange({ preset: p.key })}
              style={{
                fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 500, padding: '6px 14px', borderRadius: 100, cursor: 'pointer', transition: 'all 0.15s',
                border: `1.5px solid ${selection.preset === p.key ? '#9B59D0' : 'rgba(0,0,0,0.12)'}`,
                background: selection.preset === p.key ? 'rgba(155,89,208,0.08)' : '#fff',
                color: selection.preset === p.key ? '#9B59D0' : '#58595B',
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => onChange({ preset: 'custom', customFrom: selection.customFrom, customTo: selection.customTo })}
            style={{
              fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 500, padding: '6px 14px', borderRadius: 100, cursor: 'pointer', transition: 'all 0.15s',
              border: `1.5px solid ${selection.preset === 'custom' ? '#9B59D0' : 'rgba(0,0,0,0.12)'}`,
              background: selection.preset === 'custom' ? 'rgba(155,89,208,0.08)' : '#fff',
              color: selection.preset === 'custom' ? '#9B59D0' : '#58595B',
            }}
          >
            Custom range…
          </button>
        </div>

        {selection.preset === 'custom' && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: '#58595B', display: 'block', marginBottom: 4 }}>From</label>
              <input
                type="date" value={selection.customFrom ?? ''}
                onChange={e => onChange({ ...selection, customFrom: e.target.value })}
                style={{ width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '7px 10px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: '#58595B', display: 'block', marginBottom: 4 }}>To</label>
              <input
                type="date" value={selection.customTo ?? ''}
                onChange={e => onChange({ ...selection, customTo: e.target.value })}
                style={{ width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 13, padding: '7px 10px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        )}

        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: '#aaa', marginBottom: 18 }}>
          Will analyze: <strong style={{ color: '#58595B' }}>{customIncomplete ? 'pick both dates' : preview.label}</strong>
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#58595B', background: 'transparent', border: 'none', padding: '8px 14px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={customIncomplete}
            style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, padding: '8px 18px', borderRadius: 10, border: 'none',
              background: customIncomplete ? 'rgba(0,0,0,0.1)' : '#000', color: customIncomplete ? 'rgba(0,0,0,0.4)' : '#fff',
              cursor: customIncomplete ? 'default' : 'pointer', transition: 'all 0.15s',
            }}
          >
            Run analysis
          </button>
        </div>
      </div>
    </div>
  )
}

function DrillView({ drill, onBack }: { drill: Drill; onBack: () => void }) {
  const { section, finding, loading, error, rows } = drill
  const sev = SEV[finding.severity?.toLowerCase()] ?? SEV.low
  const ifl = finding.instance_filter
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <button
          onClick={onBack}
          style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#58595B', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}
        >← Back to report</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 100, background: sev.bg, color: sev.color }}>{sev.label}</span>
          <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000' }}>{finding.title}</span>
        </div>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: '#58595B', lineHeight: 1.6 }}>
          The analyzed tickets behind this finding — filtered by theme {(ifl?.themes ?? []).map(t => `“${t}”`).join(', ')}
          {ifl?.error_class ? ` and ${ifl.error_class}` : ''}. Validate that the pattern holds; if it doesn’t, the insight is off.
        </p>
        {!loading && !error && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', marginTop: 6 }}>
            {rows.length} ticket{rows.length === 1 ? '' : 's'}{rows.length === 60 ? ' (showing most recent 60)' : ''}
          </p>
        )}
      </div>

      {loading && <div style={card}><p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0' }}>Pulling the underlying tickets…</p></div>}
      {error && <div style={card}><p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>❌ {error}</p></div>}
      {!loading && !error && rows.length === 0 && (
        <div style={card}><p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>No matching tickets — the finding’s theme filter may not line up with the stored theme tags.</p></div>
      )}

      {!loading && rows.map(r => <InstanceCard key={r.id} section={section} r={r} />)}
    </div>
  )
}

function InstanceCard({ section, r }: { section: SectionKey; r: any }) {
  let badge = ''
  if (section === 'corrections' || section === 'enhancements') badge = r.eval_verdict
  else if (section === 'accuracy') badge = r.accuracy_error_class
  else if (section === 'quality') badge = `${r.quality_score}/5`
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {badge && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 100, background: 'rgba(155,89,208,0.1)', color: '#9B59D0' }}>{badge}</span>}
        {r.theme_tag && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', background: 'rgba(0,0,0,0.04)', padding: '2px 8px', borderRadius: 100 }}>{r.theme_tag}</span>}
        {r.external_ticket_id && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#9B59D0', background: 'rgba(155,89,208,0.08)', padding: '2px 8px', borderRadius: 100 }}>Ticket {r.external_ticket_id}</span>}
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
      </div>
      <TextBlock label="Player" value={r.customer_input} />
      <TextBlock label="gameLM suggested" value={r.suggested_response} />
      {(section === 'corrections' || section === 'enhancements') && <>
        <TextBlock label={section === 'corrections' ? 'Agent fix' : 'Agent addition'} value={r.final_edits} accent />
        <TextBlock label="Why the agent edited" value={r.reasoning} />
      </>}
      {section === 'accuracy' && <>
        <TextBlock label="Flagged text (evidence)" value={r.accuracy_evidence} accent />
        <TextBlock label="Eval reasoning" value={r.accuracy_reasoning} />
      </>}
      {section === 'quality' && <TextBlock label="Flag reason" value={r.quality_flag_reason} accent />}
    </div>
  )
}

function TextBlock({ label, value, accent }: { label: string; value?: string; accent?: boolean }) {
  if (!value) return null
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: accent ? '#9B59D0' : '#58595B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</p>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: accent ? 'rgba(155,89,208,0.05)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '8px 12px' }}>{value}</p>
    </div>
  )
}

function FieldLine({ label, value, accent }: { label: string; value?: string; accent?: boolean }) {
  if (!value) return null
  return (
    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, lineHeight: 1.6, color: '#000', marginTop: 4 }}>
      <span style={{ fontWeight: 600, color: accent ? '#9B59D0' : '#58595B' }}>{label}: </span>{value}
    </p>
  )
}

function AggregateStrip({ section, agg }: { section: SectionKey; agg: any }) {
  const stat = (label: string, value: React.ReactNode) => (
    <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>{label} </span>
      <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{value}</span>
    </div>
  )
  const items: React.ReactNode[] = []
  if ((section === 'corrections' || section === 'enhancements') && agg.byVerdict) {
    items.push(stat('Edited', agg.ran))
    for (const k of ['CORRECTION', 'ENHANCEMENT', 'PREFERENCE', 'AGENT_ERROR']) if (agg.byVerdict[k]) items.push(stat(k.toLowerCase(), agg.byVerdict[k]))
  } else if (section === 'accuracy' && agg.byClass) {
    const errs = (agg.byClass.P1A || 0) + (agg.byClass.P1B || 0) + (agg.byClass.P2 || 0)
    items.push(stat('Scored', agg.ran))
    items.push(stat('Error rate', `${agg.ran ? Math.round(100 * errs / agg.ran) : 0}%`))
    for (const k of ['P1A', 'P1B', 'P2']) if (agg.byClass[k]) items.push(stat(k, agg.byClass[k]))
  } else if (section === 'quality' && agg.dims) {
    items.push(stat('Avg', `${agg.avgScore}/5`))
    items.push(stat('Below bar', agg.below35))
    const weakest = Object.entries(agg.dims).filter(([, v]) => v != null).sort((a: any, b: any) => a[1] - b[1])[0]
    if (weakest) items.push(stat('Weakest', `${weakest[0]} ${weakest[1]}`))
  }
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{items}</div>
}
