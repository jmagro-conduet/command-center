import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useOperator } from '../context/OperatorContext'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Row {
  issueType:     string
  date:          Date
  ticketNumber:  string
  agentEmail:    string
  category:      string
  accClass:      string | null
  accRanAt:      string | null
  accVer:        string | null
  qScore:        number | null
  qRanAt:        string | null
  qVer:          string | null
  evalVerdict:   string | null   // AI auto-eval verdict
  reviewVerdict: string | null   // human QA override (takes precedence)
  themeTag:      string | null
}

// ── Category canonicalisation (mirror of Analytics) ─────────────────────────────
const CATEGORY_CANONICAL: Record<string, string> = {
  'bet dispute': 'Bet Dispute', 'bet placement issue': 'Bet Placement Issue',
  'bonus/promotion': 'Bonus/promotion', 'kyc/verification': 'KYC/verification',
  'deposit/withdrawal': 'Deposit/withdrawal', 'account access': 'Account access',
  'technical issue': 'Technical issue', 'game dispute': 'Game dispute',
  'responsible gaming': 'Responsible gaming', 'tax / w2': 'Tax / W2', 'tax/w2': 'Tax / W2',
  'win-loss statement': 'Win-Loss Statement', 'win loss statement': 'Win-Loss Statement',
  'uncategorized': 'Other', 'other': 'Other',
}
function normalizeCategory(raw: string): string {
  if (!raw) return 'Other'
  const key = raw.trim().toLowerCase()
  return CATEGORY_CANONICAL[key] ?? raw.trim()
}

const DAY = 86_400_000
const READY_THRESHOLD = 80   // perfect-rate % for autopilot readiness
const MIN_VOL = 10           // min issues before a category is judged

function pct(n: number, total: number) { return total ? Math.round((n / total) * 100) : 0 }

// Perfect-rate denominator excludes "No response" (matches Analytics / Category Performance)
// Projected rate counts edits that were PREFERENCE / AGENT_ERROR / ENHANCEMENT — i.e.
// gameLM was functionally correct; the agent could have sent the suggestion as-is.
function qualitySplit(rows: Row[]) {
  let perfect = 0, majority = 0, partial = 0, noResp = 0
  let prefEdits = 0, agentErrEdits = 0, enhEdits = 0
  for (const r of rows) {
    if (r.issueType === 'Perfect') perfect++
    else if (r.issueType === 'Majority edit' || r.issueType === 'Partial edit') {
      if (r.issueType === 'Majority edit') majority++; else partial++
      // Human QA override takes precedence; fall back to AI auto-eval verdict
      const v = r.reviewVerdict ?? r.evalVerdict
      if (v === 'PREFERENCE')   prefEdits++
      else if (v === 'AGENT_ERROR')  agentErrEdits++
      else if (v === 'ENHANCEMENT')  enhEdits++
    }
    else if (r.issueType === 'No response') noResp++
  }
  const qd = perfect + majority + partial
  const total = qd + noResp
  const projectedPerfect = perfect + prefEdits + agentErrEdits + enhEdits
  return {
    perfect, majority, partial, noResp, qualityDenom: qd,
    perfectRate: pct(perfect, qd),
    projectedPerfectRate: pct(projectedPerfect, qd),
    majorityRate: pct(majority, qd),
    partialRate: pct(partial, qd),
    editDependency: pct(majority + partial, qd),   // the COO's "edits reducing" metric
    noRespRate: pct(noResp, total),
    prefEdits, agentErrEdits, enhEdits,
  }
}

function categoryReadiness(rows: Row[]) {
  const m = new Map<string, Row[]>()
  for (const r of rows) {
    const c = r.category || 'Other'
    if (!m.has(c)) m.set(c, [])
    m.get(c)!.push(r)
  }
  return [...m.entries()].map(([name, rs]) => {
    const s = qualitySplit(rs)
    const vol = s.qualityDenom + s.noResp

    // Verdict distribution — why agents edited; human QA takes precedence over AI verdict
    let preferenceEdits = 0, correctionEdits = 0, enhancementEdits = 0
    for (const r of rs) {
      const v = r.reviewVerdict ?? r.evalVerdict
      if (v === 'PREFERENCE')  preferenceEdits++
      else if (v === 'CORRECTION')  correctionEdits++
      else if (v === 'ENHANCEMENT') enhancementEdits++
    }

    // Accuracy error class distribution (non-NONE only)
    const accClasses: Record<string, number> = {}
    for (const r of rs) {
      if (r.accClass && r.accClass !== 'NONE') {
        accClasses[r.accClass] = (accClasses[r.accClass] ?? 0) + 1
      }
    }

    const ready = vol >= MIN_VOL && s.perfectRate >= READY_THRESHOLD
    const status = vol < MIN_VOL ? 'low-data' : s.perfectRate >= READY_THRESHOLD ? 'ready' : s.perfectRate >= 70 ? 'almost' : 'not-ready'
    return {
      name, vol, perfectRate: s.perfectRate, projectedPerfectRate: s.projectedPerfectRate,
      editDependency: s.editDependency, noRespRate: s.noRespRate,
      ready, status,
      preferenceEdits, correctionEdits, enhancementEdits, accClasses,
    }
  }).sort((a, b) => b.vol - a.vol)
}

// Keep only rows scored under the newest prompt version for an eval type (honest metrics)
function latestVerRows(rows: Row[], verKey: 'accVer' | 'qVer', ranKey: 'accRanAt' | 'qRanAt') {
  const scored = rows.filter(r => r[ranKey])
  let latest: string | null = null
  for (const r of scored) { const v = r[verKey]; if (v && (latest === null || v > latest)) latest = v }
  return latest ? scored.filter(r => r[verKey] === latest) : scored
}

// ── Data fetch ──────────────────────────────────────────────────────────────────
async function fetchIssues(operatorId: string | null): Promise<Row[]> {
  const PAGE = 1000, all: any[] = []
  let from = 0
  while (true) {
    let q = supabase.from('ticket_issues')
      .select('issue_type, logged_at, created_at, accuracy_error_class, accuracy_ran_at, accuracy_prompt_version, quality_score, quality_ran_at, quality_prompt_version, eval_verdict, review_correct_verdict, theme_tag, tickets!inner(ticket_number, ticket_category, agent_email, created_at)')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (operatorId) q = q.eq('operator_id', operatorId)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all.map((ti: any) => ({
    issueType:   ti.issue_type ?? '',
    date:        new Date(ti.created_at ?? ti.logged_at ?? ti.tickets?.created_at),
    ticketNumber: ti.tickets?.ticket_number ?? '',
    agentEmail:  ti.tickets?.agent_email ?? '',
    category:    normalizeCategory(ti.tickets?.ticket_category ?? ''),
    accClass:      ti.accuracy_error_class ?? null,
    accRanAt:      ti.accuracy_ran_at ?? null,
    accVer:        ti.accuracy_prompt_version ?? null,
    qScore:        ti.quality_score ?? null,
    qRanAt:        ti.quality_ran_at ?? null,
    qVer:          ti.quality_prompt_version ?? null,
    evalVerdict:   ti.eval_verdict ?? null,
    reviewVerdict: ti.review_correct_verdict ?? null,
    themeTag:      ti.theme_tag ?? null,
  }))
}

// ── Small UI helpers ────────────────────────────────────────────────────────────
function Delta({ curr, prev, good, suffix = 'pp' }: { curr: number; prev: number | null; good: 'up' | 'down'; suffix?: string }) {
  if (prev === null) return null
  const d = curr - prev
  if (d === 0) return <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>— vs prior 30d</span>
  const up = d > 0
  const isGood = good === 'up' ? up : !up
  const color = isGood ? '#166534' : '#e53e3e'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color, marginTop: 2 }}>
      {up ? '↑' : '↓'} {Math.abs(d)}{suffix} vs prior 30d
    </span>
  )
}

function StatCard({ label, value, color, sub, delta }: {
  label: string; value: string; color: string; sub?: string; delta?: React.ReactNode
}) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: '18px 20px' }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{label}</p>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 30, fontWeight: 600, color, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 5 }}>{sub}</p>}
      {delta && <div style={{ marginTop: 3 }}>{delta}</div>}
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000' }}>{title}</p>
      {subtitle && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>{subtitle}</p>}
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = { ready: '#166534', almost: '#854d0e', 'not-ready': '#e53e3e', 'low-data': '#9ca3af' }

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ExecutiveSummary() {
  const { selectedOperator } = useOperator()
  const [rows, setRows]         = useState<Row[]>([])
  const [loading, setLoading]   = useState(true)
  const [zdTotal, setZdTotal]   = useState<number | null>(null)
  const [trendPeriod, setTrendPeriod]     = useState<'30d' | 'quarter'>('quarter')
  const [expandedCat, setExpandedCat]     = useState<string | null>(null)
  type TechBullet = { text: string; subs: string[] }
  const [insightsCache, setInsightsCache] = useState<Record<string, { ops: TechBullet[]; tech: TechBullet[]; loading: boolean; error?: string }>>({})

  const fetchInsights = async (cat: ReturnType<typeof categoryReadiness>[number]) => {
    const key = cat.name
    if (insightsCache[key] && !insightsCache[key].loading) return
    setInsightsCache(prev => ({ ...prev, [key]: { ops: [], tech: [], loading: true } }))
    try {
      const { data, error } = await supabase.functions.invoke('category-insights', {
        body: {
          category:         cat.name,
          vol:              cat.vol,
          perfectRate:      cat.perfectRate,
          editDependency:   cat.editDependency,
          noRespRate:       cat.noRespRate,
          preferenceEdits:  cat.preferenceEdits,
          correctionEdits:  cat.correctionEdits,
          enhancementEdits: cat.enhancementEdits,
          accClasses:       cat.accClasses,
        },
      })
      if (error || !data?.insights) throw new Error(error?.message ?? 'No insights returned')
      // Parse the two blocks from the response
      const text: string = data.insights
      const opsMatch  = text.match(/OPERATIONS\s*([\s\S]*?)(?=TECHNICAL|$)/i)
      const techMatch = text.match(/TECHNICAL\s*([\s\S]*?)$/i)
      const parseTech = (block: string): TechBullet[] => {
        const result: TechBullet[] = []
        let current: TechBullet | null = null
        for (const raw of block.split('\n')) {
          const isSub  = /^\s{1,}[-–]/.test(raw)
          const isMain = /^[•]/.test(raw.trim())
          if (isMain) {
            current = { text: raw.replace(/^[•]\s*/, '').trim(), subs: [] }
            result.push(current)
          } else if (isSub && current) {
            current.subs.push(raw.replace(/^\s*[-–]\s*/, '').trim())
          } else {
            const clean = raw.trim()
            if (clean) {
              current = { text: clean.replace(/^[•\-\*]\s*/, ''), subs: [] }
              result.push(current)
            }
          }
        }
        return result.filter(b => b.text)
      }

      setInsightsCache(prev => ({
        ...prev,
        [key]: {
          loading: false,
          ops:  parseTech(opsMatch?.[1] ?? ''),
          tech: parseTech(techMatch?.[1] ?? ''),
        },
      }))
    } catch (err) {
      setInsightsCache(prev => ({
        ...prev,
        [key]: { loading: false, ops: [], tech: [], error: 'Could not load insights. Try again.' },
      }))
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchIssues(selectedOperator?.id ?? null).then(r => { setRows(r); setLoading(false) })
  }, [selectedOperator?.id])

  const now = Date.now()
  const cur  = useMemo(() => rows.filter(r => now - r.date.getTime() <= 30 * DAY), [rows, now])
  const prev = useMemo(() => rows.filter(r => { const a = now - r.date.getTime(); return a > 30 * DAY && a <= 60 * DAY }), [rows, now])

  const curSplit  = useMemo(() => qualitySplit(cur), [cur])
  const prevSplit = useMemo(() => qualitySplit(prev), [prev])

  const curReady  = useMemo(() => categoryReadiness(cur), [cur])
  const prevReady = useMemo(() => categoryReadiness(prev), [prev])
  const readyCount = curReady.filter(c => c.ready).length
  const prevReadyCount = prevReady.filter(c => c.ready).length
  const trackedCats = curReady.filter(c => c.status !== 'low-data').length

  // Adoption (gameLM logged tickets / Zendesk chat tickets, last 30d)
  const loggedTickets = useMemo(() => new Set(cur.map(r => r.ticketNumber)).size, [cur])
  const rosterEmails = useMemo(() => [...new Set(cur.map(r => r.agentEmail).filter(Boolean))], [cur])
  const rosterKey = rosterEmails.slice().sort().join(',')
  useEffect(() => {
    if (rosterEmails.length === 0) { setZdTotal(null); return }
    let cancelled = false
    const end = new Date(); end.setDate(end.getDate() + 1)
    const start = new Date(); start.setDate(start.getDate() - 30)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    supabase.functions.invoke('zendesk-tickets', { body: { start_date: fmt(start), end_date: fmt(end), agent_emails: rosterEmails } })
      .then(({ data }) => { if (!cancelled && Array.isArray(data?.agents)) setZdTotal(data.agents.reduce((s: number, a: any) => s + (a.count || 0), 0)) })
      .catch(() => { if (!cancelled) setZdTotal(null) })
    return () => { cancelled = true }
  }, [rosterKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const adoption = zdTotal && zdTotal > 0 ? Math.min(100, Math.round((loggedTickets / zdTotal) * 100)) : null

  // Eval engine (latest prompt version only)
  const accRows = useMemo(() => latestVerRows(cur, 'accVer', 'accRanAt'), [cur])
  const accIssues = accRows.filter(r => r.accClass && r.accClass !== 'NONE').length
  const qualRows = useMemo(() => latestVerRows(cur, 'qVer', 'qRanAt'), [cur])
  const qualScored = qualRows.filter(r => r.qScore !== null)
  const avgQuality = qualScored.length ? (qualScored.reduce((s, r) => s + (r.qScore ?? 0), 0) / qualScored.length) : null

  // Trend chart — switches between 12-week (quarter) and 30-day (daily) views
  const trend = useMemo(() => {
    type TrendPoint = { week: string; perfect: number | null; edits: number | null; noResponse: number | null }
    const out: TrendPoint[] = []

    if (trendPeriod === 'quarter') {
      const WEEKS = 12
      const buckets = Array.from({ length: WEEKS }, () => [] as Row[])
      for (const r of rows) {
        const age = now - r.date.getTime()
        if (age < 0 || age >= WEEKS * 7 * DAY) continue
        buckets[Math.floor(age / (7 * DAY))].push(r)
      }
      for (let i = WEEKS - 1; i >= 0; i--) {
        const s = qualitySplit(buckets[i])
        const start = new Date(now); start.setDate(start.getDate() - (i + 1) * 7)
        out.push({
          week:       start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          perfect:    s.qualityDenom ? s.perfectRate : null,
          edits:      s.qualityDenom ? s.editDependency : null,
          noResponse: s.qualityDenom ? s.noRespRate : null,
        })
      }
    } else {
      // 30-day daily buckets
      const DAYS = 30
      const buckets = Array.from({ length: DAYS }, () => [] as Row[])
      for (const r of rows) {
        const age = now - r.date.getTime()
        if (age < 0 || age >= DAYS * DAY) continue
        buckets[Math.floor(age / DAY)].push(r)
      }
      for (let i = DAYS - 1; i >= 0; i--) {
        const s = qualitySplit(buckets[i])
        const d = new Date(now - i * DAY)
        out.push({
          week:       d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          perfect:    s.qualityDenom ? s.perfectRate : null,
          edits:      s.qualityDenom ? s.editDependency : null,
          noResponse: s.qualityDenom ? s.noRespRate : null,
        })
      }
    }
    return out
  }, [rows, now, trendPeriod])

  if (loading) {
    return <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', padding: 40 }}>Loading…</div>
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 24 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Executive Summary</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 2 }}>
            gameLM performance &amp; path to automation{selectedOperator?.name ? ` · ${selectedOperator.name}` : ''} · last 30 days · as of {today}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, padding: '8px 16px',
            borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
            cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#CEA4FF' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)' }}
        >
          ⎙ Export / Print
        </button>
      </div>

      {/* Headline band — the COO's three priorities + adoption */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {/* gameLM Perfect Rate — split actual vs projected */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: '18px 20px' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>gameLM Perfect Rate</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
            <div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: 'rgba(0,0,0,0.35)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actual</p>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 30, fontWeight: 600, color: curSplit.perfectRate >= 80 ? '#166534' : curSplit.perfectRate >= 70 ? '#854d0e' : '#e53e3e', lineHeight: 1 }}>{curSplit.perfectRate}%</p>
            </div>
            <div style={{ width: 1, height: 36, background: 'rgba(0,0,0,0.08)', flexShrink: 0 }} />
            <div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, color: 'rgba(0,0,0,0.35)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projected</p>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 30, fontWeight: 600, color: '#9B59D0', lineHeight: 1 }}>{curSplit.projectedPerfectRate}%</p>
            </div>
          </div>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', marginTop: 6, lineHeight: 1.4 }}>Projected adds preference, enhancement &amp; agent-error edits</p>
          <div style={{ marginTop: 4 }}><Delta curr={curSplit.perfectRate} prev={prev.length ? prevSplit.perfectRate : null} good="up" /></div>
        </div>

        {/* Edit Dependency — with majority / partial breakdown */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: '18px 20px' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Edit Dependency</p>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 30, fontWeight: 600, color: curSplit.editDependency <= 20 ? '#166534' : curSplit.editDependency <= 30 ? '#854d0e' : '#e53e3e', lineHeight: 1 }}>{curSplit.editDependency}%</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 7 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>
              <span style={{ fontWeight: 600, color: '#000' }}>{curSplit.majorityRate}%</span> majority
            </span>
            <span style={{ color: 'rgba(0,0,0,0.2)' }}>·</span>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>
              <span style={{ fontWeight: 600, color: '#000' }}>{curSplit.partialRate}%</span> partial
            </span>
          </div>
          <div style={{ marginTop: 4 }}><Delta curr={curSplit.editDependency} prev={prev.length ? prevSplit.editDependency : null} good="down" /></div>
        </div>
        <StatCard
          label="Autopilot-Ready Use Cases"
          value={`${readyCount} / ${trackedCats}`}
          color="#9B59D0"
          sub={`categories at ≥${READY_THRESHOLD}% perfect`}
          delta={<Delta curr={readyCount} prev={prev.length ? prevReadyCount : null} good="up" suffix="" />}
        />
        <StatCard
          label="Agent Adoption"
          value={adoption !== null ? `${adoption}%` : '—'}
          color="#166534"
          sub={adoption !== null ? `${loggedTickets} of ${zdTotal} chat tickets logged` : `${loggedTickets} interactions captured`}
        />
      </div>

      {/* Hero trend — responses improving / edits reducing */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionTitle
            title="Is gameLM improving?"
            subtitle={trendPeriod === 'quarter'
              ? 'Perfect rate climbing, edit dependency and no-response falling = the co-pilot is getting better. Weekly, last 12 weeks.'
              : 'Perfect rate climbing, edit dependency and no-response falling = the co-pilot is getting better. Daily, last 30 days.'}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Period toggle */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.05)', borderRadius: 8, padding: 3, gap: 2 }}>
              {(['quarter', '30d'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setTrendPeriod(p)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: 'Inter, sans-serif',
                    background: trendPeriod === p ? '#fff' : 'transparent',
                    color: trendPeriod === p ? '#000' : '#58595B',
                    border: trendPeriod === p ? '1px solid rgba(0,0,0,0.1)' : 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    boxShadow: trendPeriod === p ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  {p === 'quarter' ? 'Last quarter' : 'Last 30 days'}
                </button>
              ))}
            </div>
            <Legend color="#166534" label="Perfect rate" />
            <Legend color="#f97316" label="Edit dependency" />
            <Legend color="#e53e3e" label="No response" />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trend} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#58595B', fontFamily: 'Inter, sans-serif' }} tickLine={false} axisLine={{ stroke: 'rgba(0,0,0,0.1)' }} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#58595B', fontFamily: 'Inter, sans-serif' }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v: any) => v === null ? '—' : `${v}%`} contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: 12, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.1)' }} />
            <ReferenceLine y={READY_THRESHOLD} stroke="#166534" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'Auto-ready 80%', position: 'right', fontSize: 10, fill: '#166534' }} />
            <Line type="monotone" dataKey="perfect" name="Perfect rate" stroke="#166534" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
            <Line type="monotone" dataKey="edits" name="Edit dependency" stroke="#f97316" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
            <Line type="monotone" dataKey="noResponse" name="No response" stroke="#e53e3e" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Full-auto readiness */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 20 }}>
        <SectionTitle title="Path to Full Automation" subtitle={`Each use case toward the ${READY_THRESHOLD}% perfect-rate bar needed to go live. ${readyCount} of ${trackedCats} ready today.`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 60px 80px 90px 1.3fr 70px 32px', padding: '8px 4px', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
            {['Use case', 'Volume', 'Actual', 'Projected', 'Progress to 80%', 'Status', ''].map(h => (
              <span key={h} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: h === 'Projected' ? '#9B59D0' : '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
            ))}
          </div>
          {curReady.slice(0, 10).map(c => {
            const color = STATUS_COLOR[c.status]
            const isExpanded = expandedCat === c.name
            const insight = insightsCache[c.name]
            return (
              <div key={c.name}>
                {/* Main row */}
                <div
                  style={{ display: 'grid', gridTemplateColumns: '1.4fr 60px 80px 90px 1.3fr 70px 32px', padding: '10px 4px', alignItems: 'center', borderBottom: isExpanded ? 'none' : '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}
                  onClick={() => {
                    const next = isExpanded ? null : c.name
                    setExpandedCat(next)
                    if (next && !insightsCache[c.name]) fetchInsights(c)
                  }}
                >
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>{c.name}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>{c.vol}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color }}>{c.status === 'low-data' ? '—' : `${c.perfectRate}%`}</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: c.status === 'low-data' ? '#aaa' : '#9B59D0' }}>{c.status === 'low-data' ? '—' : `${c.projectedPerfectRate}%`}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 100, background: 'rgba(0,0,0,0.07)', overflow: 'hidden', position: 'relative' }}>
                      {/* Projected bar (behind) */}
                      <div style={{ position: 'absolute', top: 0, left: 0, width: `${Math.min(100, (c.projectedPerfectRate / READY_THRESHOLD) * 100)}%`, height: '100%', background: 'rgba(155,89,208,0.2)', borderRadius: 100 }} />
                      {/* Actual bar (front) */}
                      <div style={{ position: 'absolute', top: 0, left: 0, width: `${Math.min(100, (c.perfectRate / READY_THRESHOLD) * 100)}%`, height: '100%', background: color, borderRadius: 100, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color }}>
                    {c.status === 'ready' ? '✓ Ready' : c.status === 'low-data' ? 'Low data' : c.status === 'almost' ? 'Almost' : 'Not ready'}
                  </span>
                  {/* Expand chevron */}
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 5l4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </div>

                {/* Expanded insights panel */}
                {isExpanded && (
                  <div style={{ background: '#FAFAFA', border: '0.5px solid rgba(0,0,0,0.07)', borderRadius: '0 0 10px 10px', padding: '16px 16px 18px', marginBottom: 2, borderTop: 'none' }}>
                    {insight?.loading ? (
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="7" cy="7" r="5.5" stroke="#CEA4FF" strokeWidth="1.5" strokeDasharray="20 8"/>
                        </svg>
                        Analysing {c.name} patterns…
                      </div>
                    ) : insight?.error ? (
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e53e3e', margin: 0 }}>{insight.error}</p>
                    ) : insight ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        {/* Operations */}
                        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderLeft: '3px solid #f97316', borderRadius: 8, padding: '12px 14px' }}>
                          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Operations</p>
                          {insight.ops.length > 0 ? insight.ops.map((b, i) => (
                            <div key={i} style={{ marginBottom: 10 }}>
                              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#111', margin: '0 0 5px', lineHeight: 1.55, display: 'flex', gap: 6 }}>
                                <span style={{ color: '#f97316', flexShrink: 0 }}>•</span>{b.text}
                              </p>
                              {b.subs.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                                  {b.subs.map((s, j) => (
                                    <p key={j} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#666', margin: 0, lineHeight: 1.5, fontStyle: 'italic', display: 'flex', gap: 5, paddingLeft: 18 }}>
                                      <span style={{ color: '#fdba74', flexShrink: 0, fontSize: 9, marginTop: 3 }}>◦</span>{s}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )) : <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', margin: 0 }}>No operational patterns identified.</p>}
                        </div>
                        {/* Technical */}
                        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderLeft: '3px solid #3b82f6', borderRadius: 8, padding: '12px 14px' }}>
                          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Technical</p>
                          {insight.tech.length > 0 ? insight.tech.map((b, i) => (
                            <div key={i} style={{ marginBottom: 10 }}>
                              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#111', margin: '0 0 5px', lineHeight: 1.55, display: 'flex', gap: 6 }}>
                                <span style={{ color: '#3b82f6', flexShrink: 0 }}>•</span>{b.text}
                              </p>
                              {b.subs.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                                  {b.subs.map((s, j) => (
                                    <p key={j} style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#666', margin: 0, lineHeight: 1.5, fontStyle: 'italic', display: 'flex', gap: 5, paddingLeft: 18 }}>
                                      <span style={{ color: '#93c5fd', flexShrink: 0, fontSize: 9, marginTop: 3 }}>◦</span>{s}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )) : <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', margin: 0 }}>No technical patterns identified.</p>}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', fontStyle: 'italic', marginTop: 12 }}>
          A use case needs ≥{READY_THRESHOLD}% perfect rate (and ≥{MIN_VOL} interactions) before it's a candidate for full automation. · Projected rate includes preference, enhancement &amp; agent-error edits where gameLM was correct but the agent overrode it.
        </p>
      </div>

      {/* Quality & safety engine (eval system, business framing) */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 20 }}>
        <SectionTitle title="Quality &amp; Safety — automated evaluation" subtitle="Every gameLM suggestion is auto-graded so accuracy and regulatory risks surface fast — no extra headcount." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
          <MiniStat label="Responses auto-evaluated (30d)" value={`${accRows.length}`} color="#9B59D0" />
          <MiniStat label="Accuracy issues caught" value={`${accIssues}`} color={accIssues > 0 ? '#854d0e' : '#166534'} sub="P1/P2 flagged for human review" />
          <MiniStat label="Avg response quality" value={avgQuality !== null ? `${avgQuality.toFixed(2)} / 5` : '—'} color={avgQuality !== null && avgQuality >= 4 ? '#166534' : '#854d0e'} />
        </div>
      </div>

    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
      <span style={{ width: 14, height: 3, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function MiniStat({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.06)', padding: '14px 16px' }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', marginBottom: 6 }}>{label}</p>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>{sub}</p>}
    </div>
  )
}
