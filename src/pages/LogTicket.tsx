import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = [
  'Account access',
  'Bet dispute',
  'Bet placement issue',
  'Bonus/promotion',
  'Deposit/withdrawal',
  'Game dispute',
  'KYC/verification',
  'Responsible gaming',
  'Technical issue',
  'Other',
]

const ISSUE_TYPES = [
  { value: 'perfect',  label: 'Perfect/no edits', dbLabel: 'Perfect',       emoji: '🔥' },
  { value: 'majority', label: 'Majority edit',     dbLabel: 'Majority edit', emoji: '⚫' },
  { value: 'partial',  label: 'Partial edit',      dbLabel: 'Partial edit',  emoji: '◑' },
  { value: 'none',     label: 'No response',       dbLabel: 'No response',   emoji: '🚫' },
]

interface GamLMResponse {
  id: number
  customerInput: string
  suggestedResponse: string
  issueType: string
  reasoning: string
  finalEdits: string
}

interface TicketTab {
  id: number
  ticketNumber: string
}

let nextTabId = 2

export default function LogTicket() {
  const { user } = useAuth()

  const [tabs, setTabs] = useState<TicketTab[]>([{ id: 1, ticketNumber: '' }])
  const [activeTab, setActiveTab] = useState(1)

  const [ticketNumber, setTicketNumber] = useState('')
  const [category, setCategory]         = useState('')
  const [notes, setNotes]               = useState('')

  const [responses, setResponses] = useState<GamLMResponse[]>([])
  const [draftCustomer, setDraftCustomer]     = useState('')
  const [draftSuggested, setDraftSuggested]   = useState('')
  const [draftIssueType, setDraftIssueType]   = useState('')
  const [draftReasoning, setDraftReasoning]   = useState('')
  const [draftFinalEdits, setDraftFinalEdits] = useState('')
  const [responsesExpanded, setResponsesExpanded] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const needsReasoning  = ['majority', 'partial', 'none'].includes(draftIssueType)
  const needsFinalEdits = ['majority', 'partial'].includes(draftIssueType)

  function addResponse() {
    if (!draftCustomer || !draftSuggested || !draftIssueType) return
    setResponses(r => [...r, {
      id: Date.now(),
      customerInput:   draftCustomer,
      suggestedResponse: draftSuggested,
      issueType:       draftIssueType,
      reasoning:       draftReasoning,
      finalEdits:      draftFinalEdits,
    }])
    setDraftCustomer('')
    setDraftSuggested('')
    setDraftIssueType('')
    setDraftReasoning('')
    setDraftFinalEdits('')
  }

  function resetForm() {
    setTicketNumber('')
    setCategory('')
    setNotes('')
    setResponses([])
    setDraftCustomer('')
    setDraftSuggested('')
    setDraftIssueType('')
    setDraftReasoning('')
    setDraftFinalEdits('')
  }

  async function handleSubmit() {
    if (!ticketNumber.trim() || !category || responses.length === 0) return
    setSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .insert({
        ticket_number:    ticketNumber.trim(),
        ticket_category:  category,
        agent_name:       user?.name ?? '',
        agent_email:      user?.email ?? '',
        agent_team:       user?.operatorTeam ?? null,
        notes:            notes.trim(),
      })
      .select('id')
      .single()

    if (ticketErr || !ticket) {
      setSubmitError(ticketErr?.message ?? 'Failed to save ticket.')
      setSubmitting(false)
      return
    }

    const now = new Date().toISOString()
    const issues = responses.map(r => {
      const type = ISSUE_TYPES.find(t => t.value === r.issueType)
      return {
        ticket_id:      ticket.id,
        issue_type:     type?.dbLabel ?? r.issueType,
        issue_comment:  r.suggestedResponse,
        customer_input: r.customerInput,
        reasoning:      r.reasoning || null,
        final_edits:    r.finalEdits || null,
        logged_at:      now,
      }
    })

    const { error: issuesErr } = await supabase.from('ticket_issues').insert(issues)

    if (issuesErr) {
      setSubmitError(issuesErr.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    setSubmitSuccess(true)
    resetForm()
    setTabs(t => t.map(tab => tab.id === activeTab ? { ...tab, ticketNumber: '' } : tab))
    setTimeout(() => setSubmitSuccess(false), 4000)
  }

  function addTab() {
    const id = nextTabId++
    setTabs(t => [...t, { id, ticketNumber: '' }])
    setActiveTab(id)
    setTicketNumber('')
    setCategory('')
    setNotes('')
    setResponses([])
    setDraftCustomer('')
    setDraftSuggested('')
    setDraftIssueType('')
  }

  function closeTab(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (tabs.length === 1) return
    const remaining = tabs.filter(t => t.id !== id)
    setTabs(remaining)
    if (activeTab === id) setActiveTab(remaining[remaining.length - 1].id)
  }

  function syncTabLabel(val: string) {
    setTicketNumber(val)
    setTabs(t => t.map(tab => tab.id === activeTab ? { ...tab, ticketNumber: val } : tab))
  }

  const canAddResponse = draftCustomer.trim() && draftSuggested.trim() && draftIssueType &&
    (!needsReasoning || draftReasoning.trim())
  const canSubmit = ticketNumber.trim() && category && responses.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
        Log ticket
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1.5px solid rgba(0,0,0,0.09)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'Inter, sans-serif', fontSize: 13,
              fontWeight: activeTab === tab.id ? 500 : 400,
              color: activeTab === tab.id ? '#9B59D0' : '#58595B',
              padding: '8px 12px',
              borderBottom: activeTab === tab.id ? '2px solid #9B59D0' : '2px solid transparent',
              marginBottom: -1.5,
              background: 'none',
              transition: 'all 0.15s',
            }}
          >
            {tab.ticketNumber || 'New ticket'}
            {tabs.length > 1 && (
              <span
                onClick={e => closeTab(tab.id, e)}
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: '#aaa',
                  cursor: 'pointer',
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          onClick={addTab}
          style={{
            width: 28, height: 28, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: '#58595B',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          +
        </button>
      </div>

      {/* Ticket details */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 20 }}>
          Ticket details
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
              Ticket number <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <input
              value={ticketNumber}
              onChange={e => syncTabLabel(e.target.value)}
              placeholder="e.g. ZD-10482"
              style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
              Contact / ticket category <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ ...inputStyle, color: category ? '#000' : '#aaa' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            >
              <option value="">Select category</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Add gameLM response */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #CEA4FF', padding: 24 }}>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 20 }}>
          Add gameLM response
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Customer input" required>
            <textarea
              value={draftCustomer}
              onChange={e => setDraftCustomer(e.target.value)}
              placeholder="Paste the original customer message or query…"
              rows={4}
              style={textareaStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </Field>

          <Field label="Suggested response" required>
            <textarea
              value={draftSuggested}
              onChange={e => setDraftSuggested(e.target.value)}
              placeholder="Paste the original gameLM response here…"
              rows={4}
              style={textareaStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
              Issue type <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {ISSUE_TYPES.map(opt => {
                const selected = draftIssueType === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setDraftIssueType(opt.value)}
                    style={{
                      border: selected ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.12)',
                      borderRadius: 10,
                      padding: '14px 8px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      background: selected ? 'rgba(155,89,208,0.06)' : '#fff',
                      fontFamily: 'Inter, sans-serif', fontSize: 12,
                      color: selected ? '#9B59D0' : '#58595B',
                      fontWeight: selected ? 500 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{opt.emoji}</span>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {needsReasoning && (
            <Field label="Reasoning" required>
              <textarea
                value={draftReasoning}
                onChange={e => setDraftReasoning(e.target.value)}
                placeholder="Why did gameLM require editing or fail to respond?"
                rows={3}
                style={textareaStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </Field>
          )}

          {needsFinalEdits && (
            <Field label="Final edits (your corrected response)">
              <textarea
                value={draftFinalEdits}
                onChange={e => setDraftFinalEdits(e.target.value)}
                placeholder="Paste the final response you sent to the customer…"
                rows={3}
                style={textareaStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </Field>
          )}

          <button
            onClick={addResponse}
            disabled={!canAddResponse}
            style={{
              background: canAddResponse ? '#9B59D0' : 'rgba(0,0,0,0.1)',
              color: canAddResponse ? '#fff' : 'rgba(0,0,0,0.35)',
              fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
              padding: '12px', borderRadius: 10, width: '100%',
              transition: 'opacity 0.15s',
              cursor: canAddResponse ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { if (canAddResponse) e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            + Add gameLM response
          </button>
        </div>
      </div>

      {/* Responses logged */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
        <button
          onClick={() => setResponsesExpanded(x => !x)}
          style={{
            width: '100%', padding: '16px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000',
            background: 'none', transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.02)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          gameLM responses logged
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            style={{ transform: responsesExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6" stroke="#58595B" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {responsesExpanded && (
          <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
            {responses.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>
                  No issues added yet.
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.25)', marginTop: 4 }}>
                  Fill in the issue description, select a type, and click "Add gameLM response".
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14 }}>
                {responses.map((r, i) => {
                  const type = ISSUE_TYPES.find(t => t.value === r.issueType)
                  return (
                    <div key={r.id} style={{
                      padding: '12px 14px', borderRadius: 10,
                      background: 'rgba(0,0,0,0.025)', border: '1px solid rgba(0,0,0,0.07)',
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{type?.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#9B59D0', marginBottom: 2 }}>
                          Response {i + 1} · {type?.label}
                        </div>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.customerInput}
                        </p>
                      </div>
                      <button
                        onClick={() => setResponses(rs => rs.filter(x => x.id !== r.id))}
                        style={{ color: '#aaa', fontSize: 16, flexShrink: 0, lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Supporting detail */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 24 }}>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 16 }}>
          Supporting detail
        </h2>
        <Field label="Notes / context">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional context or notes at the ticket level…"
            rows={3}
            style={textareaStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          />
        </Field>
      </div>

      {/* Submit */}
      {submitError && (
        <div style={{
          background: 'rgba(229,62,62,0.06)', border: '1px solid rgba(229,62,62,0.2)',
          borderRadius: 10, padding: '12px 16px',
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e',
        }}>
          {submitError}
        </div>
      )}

      {submitSuccess && (
        <div style={{
          background: 'rgba(22,101,52,0.07)', border: '1px solid rgba(22,101,52,0.2)',
          borderRadius: 10, padding: '12px 16px',
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534',
        }}>
          Ticket submitted successfully.
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        style={{
          background: canSubmit ? '#000' : 'rgba(0,0,0,0.2)', color: '#fff',
          fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
          padding: '13px', borderRadius: 10, width: '100%',
          transition: 'opacity 0.15s', cursor: canSubmit && !submitting ? 'pointer' : 'default',
          opacity: submitting ? 0.6 : 1,
        }}
        onMouseEnter={e => { if (canSubmit && !submitting) e.currentTarget.style.opacity = '0.8' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = submitting ? '0.6' : '1' }}
      >
        {submitting ? 'Submitting…' : 'Submit ticket'}
      </button>

      <div style={{ height: 8 }} />
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
        {label}{required && <span style={{ color: '#e53e3e' }}> *</span>}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '10px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s', background: '#fff', width: '100%',
}

const textareaStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '10px 12px', fontSize: 13, color: '#000',
  outline: 'none', resize: 'vertical', transition: 'border-color 0.15s',
  width: '100%', fontFamily: 'Inter, sans-serif',
}
