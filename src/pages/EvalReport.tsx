import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOperator } from '../context/OperatorContext'

// Engineering triage report — one focused LLM analysis per eval section, generated
// on demand (no cost/load unless a SuperAdmin clicks Generate). Lives in the
// Admin Settings → Report tab; fully separate from the Report Card.

type SectionKey = 'corrections' | 'accuracy' | 'quality'

interface Finding {
  title: string; theme: string; severity: string
  evidence: string; likely_root_cause: string; recommended_investigation: string
}
interface Priority { rank: number; issue: string; why_it_matters: string; suggested_fix: string }
interface Synthesis {
  headline?: string; executive_summary?: string
  findings?: Finding[]; top_priorities?: Priority[]
  parse_error?: boolean; raw?: string; error?: string
}
interface SectionResult {
  loading: boolean; error: string | null
  generatedAt?: string; aggregates?: any; synthesis?: Synthesis
}

const SECTIONS: { key: SectionKey; label: string; blurb: string }[] = [
  { key: 'corrections', label: 'Corrections & Enhancements', blurb: 'Where human agents had to fix or improve gameLM’s suggestion (Edit eval).' },
  { key: 'accuracy',    label: 'Response Accuracy',          blurb: 'Regulatory (P1A), hallucination (P1B), and account-data (P2) errors.' },
  { key: 'quality',     label: 'Response Quality',           blurb: 'The five quality dimensions — what drags scores below bar.' },
]

const SEV: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: 'rgba(229,62,62,0.1)',   color: '#c53030', label: 'Critical' },
  high:     { bg: 'rgba(234,88,12,0.1)',    color: '#c2410c', label: 'High' },
  medium:   { bg: 'rgba(202,138,4,0.12)',   color: '#854d0e', label: 'Medium' },
  low:      { bg: 'rgba(0,0,0,0.06)',       color: '#58595B', label: 'Low' },
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 22 }

export default function EvalReport() {
  const { selectedOperator } = useOperator()
  const [results, setResults] = useState<Record<SectionKey, SectionResult>>({
    corrections: { loading: false, error: null },
    accuracy:    { loading: false, error: null },
    quality:     { loading: false, error: null },
  })

  async function generate(section: SectionKey) {
    if (!selectedOperator?.id) {
      setResults(r => ({ ...r, [section]: { loading: false, error: 'Select an operator first.' } }))
      return
    }
    setResults(r => ({ ...r, [section]: { loading: true, error: null } }))
    const { data, error } = await supabase.functions.invoke('eval-triage-report', {
      body: { operator_id: selectedOperator.id, section },
    })
    if (error || data?.error) {
      setResults(r => ({ ...r, [section]: { loading: false, error: data?.error ?? error?.message ?? 'Generation failed.' } }))
      return
    }
    setResults(r => ({ ...r, [section]: { loading: false, error: null, generatedAt: data.generated_at, aggregates: data.aggregates, synthesis: data.synthesis } }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 4 }}>
          Engineering Triage Report — {selectedOperator?.name ?? 'no operator selected'}
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.6 }}>
          A focused LLM analysis per eval section: the patterns, likely root causes, and what to investigate to drive failures down.
          Generated on demand — each section is independent. Hand this to engineering alongside the Report Card numbers.
        </p>
      </div>

      {SECTIONS.map(s => {
        const res = results[s.key]
        const syn = res.synthesis
        return (
          <div key={s.key} style={card}>
            {/* Section header + generate */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: syn || res.error ? 16 : 0 }}>
              <div>
                <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>{s.label}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 3 }}>{s.blurb}</p>
                {res.generatedAt && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 4 }}>
                    Generated {new Date(res.generatedAt).toLocaleString()}
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

            {syn && !res.loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {syn.parse_error && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#c2410c' }}>⚠ The model returned malformed output — try Regenerate.</p>}
                {syn.error && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e53e3e' }}>{syn.error}</p>}

                {/* Aggregates strip */}
                {res.aggregates && <AggregateStrip section={s.key} agg={res.aggregates} />}

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
                  return (
                    <div key={i} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 100, background: sev.bg, color: sev.color }}>{sev.label}</span>
                        <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13.5, fontWeight: 600, color: '#000' }}>{f.title}</span>
                        {f.theme && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9B59D0', background: 'rgba(155,89,208,0.08)', padding: '2px 8px', borderRadius: 100 }}>{f.theme}</span>}
                      </div>
                      <FieldLine label="Evidence" value={f.evidence} />
                      <FieldLine label="Likely root cause" value={f.likely_root_cause} />
                      <FieldLine label="Investigate" value={f.recommended_investigation} accent />
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
  if (section === 'corrections' && agg.byVerdict) {
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
