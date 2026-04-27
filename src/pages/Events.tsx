import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

type EventFilter = 'upcoming' | 'all' | 'past'
type Severity = 'high' | 'medium' | 'low'

interface HotEvent {
  id: string
  name: string
  event_type: string
  start_date: string
  end_date: string
  severity: Severity
  primary_department: 'verifications' | 'payments' | 'both'
  pto_blackout: boolean
  notes: string | null
}

const SEVERITY_STYLES: Record<Severity, { bg: string; color: string }> = {
  high:   { bg: 'rgba(229,62,62,0.12)',   color: '#e53e3e' },
  medium: { bg: 'rgba(234,179,8,0.15)',   color: '#854d0e' },
  low:    { bg: 'rgba(0,0,0,0.07)',       color: '#58595B' },
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  super_bowl:    'Super Bowl',
  nfl_playoffs:  'NFL Playoffs',
  march_madness: 'March Madness',
  nfl_regular:   'NFL Regular Season',
  cfb_regular:   'College Football',
  world_cup:     'World Cup',
  nba_playoffs:  'NBA Playoffs',
  mlb_playoffs:  'MLB Playoffs',
  nhl_playoffs:  'NHL Playoffs',
}

const DEPT_LABELS: Record<string, string> = {
  verifications: 'Verifications',
  payments:      'Payments',
  both:          'Verifications & Payments',
}

const EMPTY_FORM = {
  name: '',
  event_type: 'nfl_regular',
  start_date: '',
  end_date: '',
  severity: 'medium' as Severity,
  primary_department: 'both' as 'verifications' | 'payments' | 'both',
  pto_blackout: false,
  notes: '',
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((new Date(dateStr).getTime() - today.getTime()) / 86400000)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '9px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s', background: '#fff', width: '100%',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', marginBottom: 5, display: 'block',
}

export default function Events() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [events, setEvents]     = useState<HotEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<EventFilter>('upcoming')
  const [showModal, setShowModal]   = useState(false)
  const [editTarget, setEditTarget] = useState<HotEvent | null>(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => { fetchEvents() }, [filter])

  async function fetchEvents() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    let q = supabase.from('hot_events').select('*').order('start_date', { ascending: true })
    if (filter === 'upcoming') q = (q as any).gte('start_date', today)
    if (filter === 'past')     q = (q as any).lt('end_date', today)
    const { data } = await q
    setEvents(data ?? [])
    setLoading(false)
  }

  function openAdd() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowModal(true)
  }

  function openEdit(evt: HotEvent) {
    setEditTarget(evt)
    setForm({
      name: evt.name,
      event_type: evt.event_type,
      start_date: evt.start_date,
      end_date: evt.end_date,
      severity: evt.severity,
      primary_department: evt.primary_department,
      pto_blackout: evt.pto_blackout,
      notes: evt.notes ?? '',
    })
    setError(null)
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    const payload = { ...form }
    let err: string | null = null
    if (editTarget) {
      const { error: e2 } = await supabase.from('hot_events').update(payload).eq('id', editTarget.id)
      err = e2?.message ?? null
    } else {
      const { error: e2 } = await supabase.from('hot_events').insert([payload])
      err = e2?.message ?? null
    }
    setSaving(false)
    if (err) { setError(err); return }
    setShowModal(false)
    fetchEvents()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return
    await supabase.from('hot_events').delete().eq('id', id)
    fetchEvents()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
            Events Calendar
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            High-volume events requiring additional support coverage
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.09)', padding: 3 }}>
            {(['upcoming', 'all', 'past'] as EventFilter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: filter === f ? 500 : 400,
                padding: '6px 14px', borderRadius: 8,
                background: filter === f ? '#000' : 'transparent',
                color: filter === f ? '#fff' : '#58595B',
                border: 'none', transition: 'all 0.15s', cursor: 'pointer',
              }}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {isAdmin && (
            <button
              onClick={openAdd}
              style={{
                background: '#000', color: '#fff',
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                padding: '9px 16px', borderRadius: 10, border: 'none',
                cursor: 'pointer', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              + Add event
            </button>
          )}
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
        </div>
      ) : events.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No {filter} events</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {events.map(evt => <EventCard key={evt.id} evt={evt} isAdmin={isAdmin} onEdit={() => openEdit(evt)} onDelete={() => handleDelete(evt.id)} />)}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 520,
              maxHeight: '90vh', overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000' }}>
                {editTarget ? 'Edit event' : 'Add event'}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ color: '#aaa', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Event name</label>
                <input
                  required value={form.name} placeholder="e.g. Super Bowl LXI"
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Event type</label>
                  <select
                    value={form.event_type}
                    onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  >
                    {Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Severity</label>
                  <select
                    value={form.severity}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value as Severity }))}
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Start date</label>
                  <input type="date" required value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>End date</label>
                  <input type="date" required value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Primary department</label>
                <select
                  value={form.primary_department}
                  onChange={e => setForm(f => ({ ...f, primary_department: e.target.value as typeof form.primary_department }))}
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                >
                  <option value="verifications">Verifications</option>
                  <option value="payments">Payments</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter, sans-serif', fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={form.pto_blackout}
                  onChange={e => setForm(f => ({ ...f, pto_blackout: e.target.checked }))}
                  style={{ accentColor: '#9B59D0', width: 15, height: 15 }}
                />
                PTO blackout period
              </label>

              <div>
                <label style={labelStyle}>Notes</label>
                <textarea
                  value={form.notes} rows={3}
                  placeholder="Additional context…"
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>

              {error && (
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{error}</p>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
                }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={{
                  background: '#000', color: '#fff',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '9px 16px', borderRadius: 10, border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}>
                  {saving ? 'Saving…' : (editTarget ? 'Update event' : 'Save event')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function EventCard({ evt, isAdmin, onEdit, onDelete }: {
  evt: HotEvent; isAdmin: boolean
  onEdit: () => void; onDelete: () => void
}) {
  const sev    = SEVERITY_STYLES[evt.severity]
  const days   = daysUntil(evt.start_date)
  const isPast = new Date(evt.end_date) < new Date()

  return (
    <div style={{
      background: '#fff', borderRadius: 16,
      border: '1.5px solid rgba(0,0,0,0.09)', padding: 22,
      display: 'flex', flexDirection: 'column', gap: 14,
      opacity: isPast ? 0.7 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', marginBottom: 3 }}>
            {evt.name}
          </p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>
            {EVENT_TYPE_LABELS[evt.event_type] ?? evt.event_type}
            {evt.pto_blackout && (
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                background: 'rgba(229,62,62,0.1)', color: '#e53e3e',
                padding: '2px 6px', borderRadius: 100,
              }}>PTO BLACKOUT</span>
            )}
          </p>
        </div>
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700,
          padding: '4px 10px', borderRadius: 100, flexShrink: 0, letterSpacing: '0.06em',
          textTransform: 'uppercase',
          background: sev.bg, color: sev.color,
        }}>
          {evt.severity}
        </span>
      </div>

      {/* Dates */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row label="Start:" value={formatDate(evt.start_date)} />
        <Row label="End:"   value={formatDate(evt.end_date)} />
      </div>

      {/* Countdown */}
      <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
        <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>
          {isPast ? 'Event concluded' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days until event`}
        </span>
      </div>

      {/* Department */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
        <Row label="Primary Focus:" value={DEPT_LABELS[evt.primary_department] ?? evt.primary_department} />
      </div>

      {evt.notes && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5 }}>
          {evt.notes}
        </p>
      )}

      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button onClick={onEdit} style={{
            flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
            padding: '7px 0', borderRadius: 8, cursor: 'pointer',
            border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#000',
            transition: 'all 0.15s',
          }}>
            Edit
          </button>
          <button onClick={onDelete} style={{
            flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
            padding: '7px 0', borderRadius: 8, cursor: 'pointer',
            border: '1.5px solid rgba(229,62,62,0.3)', background: 'rgba(229,62,62,0.06)', color: '#e53e3e',
            transition: 'all 0.15s',
          }}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B' }}>{label}</span>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#000' }}>{value}</span>
    </div>
  )
}
