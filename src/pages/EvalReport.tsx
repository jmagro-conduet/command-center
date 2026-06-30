import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOperator } from '../context/OperatorContext'
import { useAuth } from '../context/AuthContext'

// Engineering triage report — one focused LLM analysis per eval section, generated
// on demand (no cost/load unless a SuperAdmin clicks Generate). Lives in the
// Admin Settings → Report tab; fully separate from the Report Card.

type SectionKey = 'corrections' | 'enhancements' | 'accuracy' | 'quality'

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
  generatedAt?: string; generatedBy?: string | null; aggregates?: any; synthesis?: Synthesis
}
interface Drill {
  section: SectionKey; finding: Finding
  loading: boolean; error: string | null; rows: any[]
}

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

export default function EvalReport() {
  const { selectedOperator } = useOperator()
  const { user } = useAuth()
  const [results, setResults] = useState<Record<SectionKey, SectionResult>>(EMPTY_RESULTS)
  const [loadingStored, setLoadingStored] = useState(false)
  const [drill, setDrill] = useState<Drill | null>(null)

  // Load the last shared snapshot for this operator — fast, no LLM call. Every SuperAdmin
  // sees the same stored report until someone regenerates it.
  useEffect(() => {
    const op = selectedOperator?.id
    setResults(EMPTY_RESULTS)
    setDrill(null)
    if (!op) return
    let cancelled = false
    setLoadingStored(true)
    ;(async () => {
      const { data } = await supabase
        .from('eval_triage_reports')
        .select('section,aggregates,synthesis,generated_at,generated_by')
        .eq('operator_id', op)
      if (cancelled) return
      if (data?.length) {
        setResults(prev => {
          const next = { ...prev }
          for (const row of data) {
            if (row.section in next) next[row.section as SectionKey] = {
              loading: false, error: null, aggregates: row.aggregates,
              synthesis: row.synthesis, generatedAt: row.generated_at, generatedBy: row.generated_by,
            }
          }
          return next
        })
      }
      setLoadingStored(false)
    })()
    return () => { cancelled = true }
  }, [selectedOperator?.id])

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

  async function generate(section: SectionKey) {
    if (!selectedOperator?.id) {
      setResults(r => ({ ...r, [section]: { loading: false, error: 'Select an operator first.' } }))
      return
    }
    setResults(r => ({ ...r, [section]: { ...r[section], loading: true, error: null } }))
    const { data, error } = await supabase.functions.invoke('eval-triage-report', {
      body: { operator_id: selectedOperator.id, section, generated_by: user?.name ?? user?.email ?? null },
    })
    if (error || data?.error) {
      setResults(r => ({ ...r, [section]: { ...r[section], loading: false, error: data?.error ?? error?.message ?? 'Generation failed.' } }))
      return
    }
    setResults(r => ({ ...r, [section]: { loading: false, error: null, generatedAt: data.generated_at, generatedBy: data.generated_by, aggregates: data.aggregates, synthesis: data.synthesis } }))
  }

  if (drill) return <DrillView drill={drill} onBack={() => setDrill(null)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 4 }}>
          Engineering Triage Report — {selectedOperator?.name ?? 'no operator selected'}
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.6 }}>
          A focused LLM analysis per eval section: the patterns, likely root causes, and what to investigate to drive failures down.
          The last generated report is shared across all SuperAdmins — regenerate any section to refresh it against recent data.
          Hand this to engineering alongside the Report Card numbers.
        </p>
        {loadingStored && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0', marginTop: 8 }}>Loading saved reports…</p>
        )}
      </div>

      {SECTIONS.map(s => {
        const res = results[s.key]
        const syn = res.synthesis
        return (
          <div key={s.key} style={card}>
            {/* Section header + generate */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: syn || res.error || res.aggregates ? 16 : 0 }}>
              <div>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>{s.label}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 3 }}>{s.blurb}</p>
                {res.generatedAt && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 4 }}>
                    Last generated {new Date(res.generatedAt).toLocaleString()}{res.generatedBy ? ` · by ${res.generatedBy}` : ''}
                  </p>
                )}
              </div>
              <button
                onClick={() => generate(s.key)}
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

            {res.error && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>❌ {res.error}</p>
            )}
            {res.loading && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0' }}>Reading the eval data and synthesizing… (10–30s)</p>
            )}

            {/* Deterministic layer — always shown once data is in, even if synthesis failed */}
            {res.aggregates && !res.loading && (
              <div style={{ marginBottom: syn ? 14 : 0 }}><AggregateStrip section={s.key} agg={res.aggregates} /></div>
            )}

            {syn && !res.loading && (
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
