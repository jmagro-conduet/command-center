import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

interface DBBulletin {
  id: string
  bulletin_date: string
  created_by_email: string
  highlights: string | null
  current_issues: string | null
  hot_events: string | null
  tips_and_tricks: string | null
  is_published: boolean
  last_7_days_metrics: { ticketsLogged?: number; teamAvg?: number; vsPrevious?: number } | null
  created_at: string
}

type View = 'list' | 'create' | 'edit'

interface QuickStats {
  perfect: number
  noResponse: number
  partialEdit: number
  majorityEdit: number
  ticketsLogged: number
  avgPerAgent: number
  vsPrev: number
}

const EMPTY_FORM = {
  bulletin_date: new Date().toISOString().split('T')[0],
  highlights: '',
  current_issues: '',
  hot_events: '',
  tips_and_tricks: '',
  last_7_days_metrics: null as QuickStats | null,
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '10px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s', background: '#fff', width: '100%',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}


export default function Bulletin() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [bulletins, setBulletins] = useState<DBBulletin[]>([])
  const [selected, setSelected]   = useState<DBBulletin | null>(null)
  const [loading, setLoading]     = useState(true)
  const [view, setView]           = useState<View>('list')
  const [form, setForm]           = useState(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<DBBulletin | null>(null)
  const [saving, setSaving]         = useState(false)
  const [viewedIds, setViewedIds]   = useState<Set<string>>(new Set())
  const [quickStats, setQuickStats] = useState<QuickStats | null>(null)
  const [quickLoading, setQuickLoading] = useState(false)

  useEffect(() => {
    loadBulletins()
    if (user) loadViewedIds()
  }, [])

  async function loadBulletins() {
    setLoading(true)
    let q = supabase.from('daily_bulletins').select('*').order('bulletin_date', { ascending: false })
    if (!isAdmin) q = (q as any).eq('is_published', true)
    const { data } = await q
    const rows = data ?? []
    setBulletins(rows)
    if (rows.length > 0 && !isAdmin) setSelected(rows[0])
    setLoading(false)
  }

  async function loadViewedIds() {
    if (!user) return
    const { data } = await supabase
      .from('bulletin_views')
      .select('bulletin_id')
      .eq('user_email', user.email)
    setViewedIds(new Set((data ?? []).map((r: any) => r.bulletin_id)))
  }

  async function markViewed(bulletinId: string) {
    if (!user || isAdmin || viewedIds.has(bulletinId)) return
    await supabase.from('bulletin_views').upsert({ bulletin_id: bulletinId, user_email: user.email }, { onConflict: 'bulletin_id,user_email' })
    setViewedIds(s => new Set([...s, bulletinId]))
  }

  function handleSelectBulletin(b: DBBulletin) {
    setSelected(b)
    if (!isAdmin && b.is_published) markViewed(b.id)
  }

  async function loadQuickStats() {
    setQuickLoading(true)
    const now   = new Date()
    const since = new Date(now); since.setDate(since.getDate() - 7)
    const prevStart = new Date(since); prevStart.setDate(prevStart.getDate() - 7)

    const [{ data: curr }, { data: prev }, { count: agentCount }] = await Promise.all([
      supabase
        .from('ticket_issues')
        .select('issue_type, tickets!inner(ticket_number)')
        .gte('logged_at', since.toISOString()),
      supabase
        .from('ticket_issues')
        .select('tickets!inner(ticket_number)')
        .gte('logged_at', prevStart.toISOString())
        .lt('logged_at', since.toISOString()),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'agent'),
    ])

    const currRows = curr ?? []
    const tickets  = new Set(currRows.map((r: any) => r.tickets?.ticket_number).filter(Boolean))
    const counts: Record<string, number> = {}
    for (const r of currRows) counts[r.issue_type] = (counts[r.issue_type] ?? 0) + 1

    const prevTickets = new Set((prev ?? []).map((r: any) => r.tickets?.ticket_number).filter(Boolean))
    const vsPrev = prevTickets.size > 0
      ? parseFloat(((tickets.size - prevTickets.size) / prevTickets.size * 100).toFixed(1))
      : 0

    const agents = agentCount ?? 1
    setQuickStats({
      perfect:     counts['Perfect']       ?? 0,
      noResponse:  counts['No response']   ?? 0,
      partialEdit: counts['Partial edit']  ?? 0,
      majorityEdit:counts['Majority edit'] ?? 0,
      ticketsLogged: tickets.size,
      avgPerAgent: parseFloat((tickets.size / agents).toFixed(1)),
      vsPrev,
    })
    setQuickLoading(false)
  }

  async function handleSave(publish: boolean) {
    if (!user) return
    setSaving(true)
    const payload = {
      ...form,
      is_published: publish,
      created_by_email: user.email,
    }
    let err: string | null = null
    if (editTarget) {
      const { error } = await supabase.from('daily_bulletins').update(payload).eq('id', editTarget.id)
      err = error?.message ?? null
    } else {
      const { error } = await supabase.from('daily_bulletins').insert([payload])
      err = error?.message ?? null
    }
    setSaving(false)
    if (err) { alert(err); return }
    setView('list')
    setEditTarget(null)
    setForm(EMPTY_FORM)
    loadBulletins()
  }

  async function handleTogglePublish(b: DBBulletin) {
    await supabase.from('daily_bulletins').update({ is_published: !b.is_published }).eq('id', b.id)
    setBulletins(bs => bs.map(x => x.id === b.id ? { ...x, is_published: !x.is_published } : x))
    if (selected?.id === b.id) setSelected(prev => prev ? { ...prev, is_published: !prev.is_published } : prev)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this bulletin?')) return
    await supabase.from('daily_bulletins').delete().eq('id', id)
    if (selected?.id === id) setSelected(null)
    setBulletins(bs => bs.filter(b => b.id !== id))
  }

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setQuickStats(null)
    setView('create')
    loadQuickStats()
  }

  function openEdit(b: DBBulletin) {
    setEditTarget(b)
    setForm({
      bulletin_date: b.bulletin_date,
      highlights: b.highlights ?? '',
      current_issues: b.current_issues ?? '',
      hot_events: b.hot_events ?? '',
      tips_and_tricks: b.tips_and_tricks ?? '',
      last_7_days_metrics: b.last_7_days_metrics as any ?? null,
    })
    setQuickStats(null)
    setView('edit')
    loadQuickStats()
  }

  function formatBulletinDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  function formatShortDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  }

  if (view === 'create' || view === 'edit') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
              {view === 'edit' ? 'Edit Bulletin' : 'Create Daily Bulletin'}
            </h1>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
              Create a daily bulletin for the CS team with important updates and insights
            </p>
          </div>
          <button
            onClick={() => { setView('list'); setEditTarget(null) }}
            style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              padding: '9px 16px', borderRadius: 10,
              border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000', cursor: 'pointer',
            }}
          >
            Back to Bulletins
          </button>
        </div>

        {/* Quick Insert panel */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(206,164,255,0.4)', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000' }}>
                Quick Insert — Automated Data
              </p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 2 }}>
                Based on the last 7 days of logged tickets
              </p>
            </div>
            {quickStats && (
              <button
                onClick={() => setForm(f => ({
                  ...f,
                  last_7_days_metrics: {
                    ticketsLogged: quickStats.ticketsLogged,
                    teamAvg:       quickStats.avgPerAgent,
                    vsPrevious:    quickStats.vsPrev,
                  } as any,
                }))}
                style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                  padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(155,89,208,0.3)',
                  background: 'rgba(155,89,208,0.06)', color: '#9B59D0',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.06)')}
              >
                Use metrics in viewer
              </button>
            )}
          </div>

          {quickLoading ? (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading data…</p>
          ) : !quickStats ? null : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Team Metrics strip */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
                padding: '12px 16px', borderRadius: 10, background: 'rgba(0,0,0,0.02)',
                border: '1px solid rgba(0,0,0,0.07)',
              }}>
                {[
                  { label: 'Tickets logged', value: quickStats.ticketsLogged.toString() },
                  { label: 'Avg / agent',    value: `${quickStats.avgPerAgent}` },
                  { label: 'vs prev week',   value: `${quickStats.vsPrev >= 0 ? '+' : ''}${quickStats.vsPrev}%`, color: quickStats.vsPrev >= 0 ? '#166534' : '#e53e3e' },
                ].map(s => (
                  <div key={s.label}>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{s.label}</p>
                    <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: s.color ?? '#000' }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Trending issues */}
              <div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Trending Issues
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { emoji: '🔥', label: 'Perfect',      count: quickStats.perfect },
                    { emoji: '🚫', label: 'No response',  count: quickStats.noResponse },
                    { emoji: '◑',  label: 'Partial edit', count: quickStats.partialEdit },
                    { emoji: '⚫', label: 'Majority edit',count: quickStats.majorityEdit },
                  ].filter(r => r.count > 0).map(r => (
                    <div key={r.label} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 8,
                      border: '1px solid rgba(0,0,0,0.07)', background: '#fafafa',
                    }}>
                      <span style={{ fontSize: 14 }}>{r.emoji}</span>
                      <span style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000' }}>
                        {r.label}
                      </span>
                      <span style={{
                        fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600,
                        color: '#58595B', minWidth: 36, textAlign: 'right',
                      }}>
                        {r.count}
                      </span>
                      <button
                        onClick={() => setForm(f => ({
                          ...f,
                          current_issues: f.current_issues
                            ? `${f.current_issues}\n${r.label}: ${r.count} occurrences`
                            : `${r.label}: ${r.count} occurrences`,
                        }))}
                        style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500,
                          padding: '4px 10px', borderRadius: 6,
                          border: '1.5px solid rgba(0,0,0,0.1)', background: '#fff', color: '#58595B',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f0')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                      >
                        Insert
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>Bulletin Date</label>
            <input
              type="date"
              value={form.bulletin_date}
              onChange={e => setForm(f => ({ ...f, bulletin_date: e.target.value }))}
              style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <FormField label="Highlights" hint="Positive achievements, wins, and notable successes"
            value={form.highlights} rows={4}
            onChange={v => setForm(f => ({ ...f, highlights: v }))} />

          <FormField label="Current Issues" hint="Major ongoing issues or concerns"
            value={form.current_issues} rows={4}
            onChange={v => setForm(f => ({ ...f, current_issues: v }))} />

          <FormField label="Hot Events" hint="Upcoming events that may impact ticket volume"
            value={form.hot_events} rows={2}
            onChange={v => setForm(f => ({ ...f, hot_events: v }))} />

          <FormField label="Tips & Tricks" hint="Optional tips for the team"
            value={form.tips_and_tricks} rows={2}
            onChange={v => setForm(f => ({ ...f, tips_and_tricks: v }))} />

          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button
              disabled={saving}
              onClick={() => handleSave(true)}
              style={{
                background: '#000', color: '#fff',
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                padding: '10px 20px', borderRadius: 10, border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => !saving && (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={e => (e.currentTarget.style.opacity = saving ? '0.6' : '1')}
            >
              {saving ? 'Saving…' : 'Publish bulletin'}
            </button>
            <button
              disabled={saving}
              onClick={() => handleSave(false)}
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                padding: '10px 20px', borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
              }}
            >
              Save as draft
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
            Daily Bulletin Board
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            {isAdmin ? 'Manage daily bulletins for your CS team' : 'Stay up to date with the latest team updates'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            style={{
              background: '#000', color: '#fff',
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              padding: '10px 18px', borderRadius: 10, border: 'none',
              cursor: 'pointer', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            + Create Bulletin
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'flex-start' }}>
          {/* Left list */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 20 }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#000', marginBottom: 14 }}>
              {isAdmin ? 'All Bulletins' : 'Published Bulletins'}
            </p>
            {bulletins.length === 0 ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)', textAlign: 'center', padding: '20px 0' }}>
                No bulletins yet
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bulletins.map(b => {
                  const isViewed = viewedIds.has(b.id)
                  return (
                    <button
                      key={b.id}
                      onClick={() => handleSelectBulletin(b)}
                      style={{
                        textAlign: 'left', padding: 14, borderRadius: 12, cursor: 'pointer',
                        border: selected?.id === b.id ? '1.5px solid #CEA4FF' : '1.5px solid rgba(0,0,0,0.08)',
                        background: selected?.id === b.id ? 'rgba(206,164,255,0.06)' : '#fff',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 600, color: '#9B59D0' }}>
                          {formatShortDate(b.bulletin_date)}
                        </span>
                        <span style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600,
                          padding: '2px 8px', borderRadius: 100,
                          background: b.is_published ? 'rgba(22,101,52,0.1)' : 'rgba(0,0,0,0.06)',
                          color: b.is_published ? '#166534' : '#58595B',
                        }}>
                          {b.is_published ? 'PUBLISHED' : 'DRAFT'}
                        </span>
                      </div>
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', marginBottom: isAdmin ? 8 : 0 }}>
                        {`Bulletin – ${new Date(b.bulletin_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}`}
                        {!isAdmin && !isViewed && b.is_published && (
                          <span style={{ marginLeft: 6, width: 7, height: 7, borderRadius: '50%', background: '#9B59D0', display: 'inline-block', verticalAlign: 'middle' }} />
                        )}
                      </p>
                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 5 }}>
                          {[
                            { label: 'Edit', action: (e: React.MouseEvent) => { e.stopPropagation(); openEdit(b) } },
                            { label: b.is_published ? 'Unpublish' : 'Publish', action: (e: React.MouseEvent) => { e.stopPropagation(); handleTogglePublish(b) } },
                            { label: 'Delete', action: (e: React.MouseEvent) => { e.stopPropagation(); handleDelete(b.id) }, danger: true },
                          ].map(a => (
                            <button key={a.label} onClick={a.action} style={{
                              fontFamily: 'Inter, sans-serif', fontSize: 11, cursor: 'pointer',
                              padding: '3px 8px', borderRadius: 6,
                              border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
                              color: (a as any).danger ? '#e53e3e' : '#58595B',
                              transition: 'all 0.15s',
                            }}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right viewer */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', minHeight: 400 }}>
            {!selected ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
                  Select a bulletin to view its contents
                </p>
              </div>
            ) : (
              <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 20, fontWeight: 600, color: '#000' }}>
                  {formatBulletinDate(selected.bulletin_date)}
                </h2>

                {selected.last_7_days_metrics && (
                  <div style={{
                    padding: '18px 20px', borderRadius: 12,
                    border: '1.5px solid rgba(0,0,0,0.09)',
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
                  }}>
                    <Stat label="Tickets logged" value={(selected.last_7_days_metrics.ticketsLogged ?? 0).toString()} />
                    <Stat label="Team average" value={`${(selected.last_7_days_metrics.teamAvg ?? 0).toFixed(1)} tickets/agent`} />
                    <Stat label="vs previous week"
                      value={`↑ ${(selected.last_7_days_metrics.vsPrevious ?? 0).toFixed(1)}%`}
                      valueColor="#166534"
                    />
                  </div>
                )}

                {selected.highlights && (
                  <BulletinSection title="Highlights">
                    {selected.highlights.split('\n').filter(Boolean).map((line, i) => (
                      <p key={i} style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B' }}>{line}</p>
                    ))}
                  </BulletinSection>
                )}

                {selected.current_issues && (
                  <BulletinSection title="Current Issues">
                    {selected.current_issues.split('\n').filter(Boolean).map((line, i) => (
                      <p key={i} style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B' }}>{line}</p>
                    ))}
                  </BulletinSection>
                )}

                {selected.hot_events && (
                  <BulletinSection title="Hot Events">
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B' }}>{selected.hot_events}</p>
                  </BulletinSection>
                )}

                {selected.tips_and_tricks && (
                  <BulletinSection title="Tips & Tricks">
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B' }}>{selected.tips_and_tricks}</p>
                  </BulletinSection>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FormField({ label, hint, value, rows, onChange }: {
  label: string; hint?: string; value: string; rows: number; onChange: (v: string) => void
}) {
  return (
    <div>
      <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 5 }}>
        {label}{hint && <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 6 }}>{hint}</span>}
      </label>
      <textarea
        value={value} rows={rows}
        onChange={e => onChange(e.target.value)}
        style={{
          border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
          padding: '10px 12px', fontSize: 13, color: '#000',
          outline: 'none', resize: 'vertical', transition: 'border-color 0.15s',
          width: '100%', fontFamily: 'Inter, sans-serif', minHeight: rows * 24 + 20, boxSizing: 'border-box',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
        onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
      />
    </div>
  )
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
        {label}
      </p>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: valueColor ?? '#000' }}>
        {value}
      </p>
    </div>
  )
}

function BulletinSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', borderRadius: 12, borderLeft: '3px solid #CEA4FF', background: 'rgba(206,164,255,0.04)' }}>
      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', marginBottom: 8 }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  )
}
