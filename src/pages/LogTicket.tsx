import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

const TICKET_MAX = 20
const draftKey = (email: string) => `logticket_draft_v2_${email}`

function validateTicketNumber(t: string): string | null {
  const v = t.trim()
  if (!v) return 'Ticket number is required'
  return null
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

interface OpCategory {
  id: string
  main_category: string
  sub_category: string | null
  detail: string | null
}

const ISSUE_TYPES = [
  { value: 'perfect',  label: 'Perfect/no edits', dbLabel: 'Perfect',       emoji: '🔥' },
  { value: 'majority', label: 'Majority edit',     dbLabel: 'Majority edit', emoji: '⚫' },
  { value: 'partial',  label: 'Partial edit',      dbLabel: 'Partial edit',  emoji: '◑' },
  { value: 'none',     label: 'No response',       dbLabel: 'No response',   emoji: '🚫' },
]

interface GamLMResponse {
  id: number
  ticketId: string
  customerInput: string
  suggestedResponse: string
  issueType: string
  reasoning: string
  finalEdits: string
  enhancementNote: string
  loggedAt: string
}

interface TabState {
  id: number
  ticketNumber: string
  category: string
  otherDetail: string
  notes: string
  responses: GamLMResponse[]
  draftTicketId: string
  draftCustomer: string
  draftSuggested: string
  draftIssueType: string
  draftReasoning: string
  draftFinalEdits: string
  draftEnhancementNote: string
}

function newTab(id: number): TabState {
  return {
    id,
    ticketNumber: '', category: '', otherDetail: '', notes: '', responses: [],
    draftTicketId: '', draftCustomer: '', draftSuggested: '', draftIssueType: '',
    draftReasoning: '', draftFinalEdits: '', draftEnhancementNote: '',
  }
}

export default function LogTicket() {
  const { user } = useAuth()
  const { selectedOperator, loading: operatorLoading } = useOperator()

  const nextId = useRef(2)
  const [allTabs, setAllTabs]       = useState<TabState[]>([newTab(1)])
  const [activeTabId, setActiveTabId] = useState(1)
  const [responsesExpanded, setResponsesExpanded] = useState(true)
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [closePending, setClosePending] = useState<number | null>(null)
  const [opCategories,  setOpCategories]  = useState<OpCategory[]>([])
  const [catsLoading,   setCatsLoading]   = useState(false)

  useEffect(() => {
    if (!selectedOperator) { setOpCategories([]); return }
    setCatsLoading(true)
    supabase.from('operator_issue_categories')
      .select('id, main_category, sub_category, detail')
      .eq('operator_id', selectedOperator.id)
      .eq('active', true)
      .order('main_category').order('sub_category', { nullsFirst: true }).order('detail', { nullsFirst: true })
      .then(({ data }) => { setOpCategories(data ?? []); setCatsLoading(false) })
  }, [selectedOperator?.id])

  const active = allTabs.find(t => t.id === activeTabId) ?? allTabs[0]

  function updateActive(patch: Partial<TabState>) {
    setAllTabs(tabs => tabs.map(t => t.id === activeTabId ? { ...t, ...patch } : t))
  }

  // Restore all tabs from localStorage on mount (scoped to this user)
  useEffect(() => {
    if (!user?.email) return
    try {
      const saved = localStorage.getItem(draftKey(user.email))
      if (saved) {
        const d = JSON.parse(saved)
        if (Array.isArray(d.allTabs) && d.allTabs.length > 0) {
          setAllTabs(d.allTabs)
          setActiveTabId(d.activeTabId ?? d.allTabs[0].id)
          nextId.current = Math.max(...d.allTabs.map((t: TabState) => t.id)) + 1
        }
      }
    } catch { /* ignore corrupt draft */ }
  }, [user?.email])

  // Save all tabs to localStorage on every change (scoped to this user)
  useEffect(() => {
    if (!user?.email) return
    try {
      localStorage.setItem(draftKey(user.email), JSON.stringify({ allTabs, activeTabId }))
    } catch { /* ignore */ }
  }, [allTabs, activeTabId, user?.email])

  const needsReasoning      = ['majority', 'partial', 'none'].includes(active.draftIssueType)
  const needsFinalEdits     = ['majority', 'partial'].includes(active.draftIssueType)
  const showEnhancementNote = active.draftIssueType === 'perfect'

  function handleTicketNumberChange(raw: string) {
    // Strip non-digits and enforce max length
    const val = raw.replace(/\D/g, '').slice(0, TICKET_MAX)
    updateActive({ ticketNumber: val })
  }

  function addResponse() {
    if (!active.draftCustomer || !active.draftSuggested || !active.draftIssueType) return
    updateActive({
      responses: [...active.responses, {
        id:                Date.now(),
        ticketId:          active.draftTicketId,
        customerInput:     active.draftCustomer,
        suggestedResponse: active.draftSuggested,
        issueType:         active.draftIssueType,
        reasoning:         active.draftReasoning,
        finalEdits:        active.draftFinalEdits,
        enhancementNote:   active.draftEnhancementNote,
        loggedAt:          new Date().toISOString(),
      }],
      draftTicketId: '', draftCustomer: '', draftSuggested: '', draftIssueType: '',
      draftReasoning: '', draftFinalEdits: '', draftEnhancementNote: '',
    })
  }

  function removeResponse(responseId: number) {
    updateActive({ responses: active.responses.filter(r => r.id !== responseId) })
  }

  function addTab() {
    const id = nextId.current++
    setAllTabs(tabs => [...tabs, newTab(id)])
    setActiveTabId(id)
  }

  function closeTab(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (allTabs.length === 1) return
    // If the tab has any data, ask for confirmation first
    const tab = allTabs.find(t => t.id === id)
    const hasData = tab && (tab.ticketNumber.trim() || tab.responses.length > 0)
    if (hasData) { setClosePending(id); return }
    doCloseTab(id)
  }

  function doCloseTab(id: number) {
    const remaining = allTabs.filter(t => t.id !== id)
    setAllTabs(remaining)
    if (activeTabId === id) setActiveTabId(remaining[remaining.length - 1].id)
    setClosePending(null)
  }

  async function handleSubmit() {
    const validationErr = validateTicketNumber(active.ticketNumber)
    if (validationErr || !active.category || active.responses.length === 0) return

    setSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .insert({
        ticket_number:          active.ticketNumber.trim(),
        ticket_category:        active.category,
        other_category_detail:  active.category === 'Other' ? active.otherDetail.trim() : null,
        agent_name:             user?.name ?? '',
        agent_email:            user?.email ?? '',
        agent_team:             user?.operatorTeam ?? null,
        notes:                  active.notes.trim(),
        // Fall back to the user's own operator if no operator is actively selected.
        // (DB trigger is the final backstop, deriving from agent_team.)
        operator_id:            selectedOperator?.id ?? user?.operatorId ?? null,
      })
      .select('id')
      .single()

    if (ticketErr || !ticket) {
      setSubmitError(ticketErr?.message ?? 'Failed to save ticket.')
      setSubmitting(false)
      return
    }

    const issues = active.responses.map(r => {
      const type = ISSUE_TYPES.find(t => t.value === r.issueType)
      return {
        ticket_id:          ticket.id,
        external_ticket_id: r.ticketId?.trim() || null,
        issue_type:         type?.dbLabel ?? r.issueType,
        customer_input:     r.customerInput,
        suggested_response: r.suggestedResponse || null,
        reasoning:          r.reasoning || null,
        final_edits:        r.finalEdits || null,
        enhancement_note:   r.enhancementNote || null,
        logged_at:          r.loggedAt,
        operator_id:        selectedOperator?.id ?? user?.operatorId ?? null,
      }
    })

    const { data: insertedIssues, error: issuesErr } = await supabase
      .from('ticket_issues')
      .insert(issues)
      .select('id, issue_type, final_edits, suggested_response')
    if (issuesErr) {
      setSubmitError(issuesErr.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    setSubmitSuccess(true)

    // Fire-and-forget: fetch ZD ticket details (created_at + player message count)
    // Runs in background — does not block or affect the submission UX
    supabase.functions.invoke('zd-ticket-details', {
      body: { tickets: [{ supabase_id: ticket.id, ticket_number: active.ticketNumber.trim() }] },
    }).catch(() => {}) // intentionally swallow — non-critical enrichment

    // Fire-and-forget: run edit validity eval on Majority/Partial edits with final_edits
    const evalIds = (insertedIssues ?? [])
      .filter((r: any) => (r.issue_type === 'Majority edit' || r.issue_type === 'Partial edit') && r.final_edits)
      .map((r: any) => r.id)
    if (evalIds.length > 0) {
      supabase.functions.invoke('eval-issue-v2', {
        body: { ids: evalIds },
      }).catch(() => {})
    }

    // Fire-and-forget: run accuracy + quality evals on all issues that have a suggested response
    // (Perfect, Majority edit, Partial edit — excludes "No response")
    const accuracyQualityIds = (insertedIssues ?? [])
      .filter((r: any) => r.issue_type !== 'No response' && r.suggested_response)
      .map((r: any) => r.id)
    if (accuracyQualityIds.length > 0) {
      supabase.functions.invoke('eval-accuracy', {
        body: { ids: accuracyQualityIds },
      }).catch(() => {})
      supabase.functions.invoke('eval-quality', {
        body: { ids: accuracyQualityIds },
      }).catch(() => {})
    }

    // Remove the submitted tab; if it was the last one, replace with a fresh tab
    const remaining = allTabs.filter(t => t.id !== activeTabId)
    if (remaining.length === 0) {
      const freshId = nextId.current++
      setAllTabs([newTab(freshId)])
      setActiveTabId(freshId)
    } else {
      setAllTabs(remaining)
      setActiveTabId(remaining[remaining.length - 1].id)
    }

    setTimeout(() => setSubmitSuccess(false), 4000)
  }

  const ticketValid    = validateTicketNumber(active.ticketNumber) === null
  const canAddResponse = active.draftCustomer.trim() && active.draftSuggested.trim() &&
    active.draftIssueType && (!needsReasoning || active.draftReasoning.trim())
  const otherDetailRequired = active.category === 'Other'
  const canSubmit      = ticketValid && active.category &&
    (!otherDetailRequired || active.otherDetail.trim().length > 0) &&
    active.responses.length > 0 &&
    !!selectedOperator && !operatorLoading

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
        Log ticket
      </h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1.5px solid rgba(0,0,0,0.09)' }}>
        {allTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'Inter, sans-serif', fontSize: 13,
              fontWeight: activeTabId === tab.id ? 500 : 400,
              color: activeTabId === tab.id ? '#9B59D0' : '#58595B',
              padding: '8px 12px',
              borderBottom: activeTabId === tab.id ? '2px solid #9B59D0' : '2px solid transparent',
              marginBottom: -1.5,
              background: 'none',
              transition: 'all 0.15s',
            }}
          >
            {tab.ticketNumber || 'New ticket'}
            {allTabs.length > 1 && (
              <span
                onClick={e => closeTab(tab.id, e)}
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: '#aaa', cursor: 'pointer',
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
            fontSize: 16, color: '#58595B', transition: 'background 0.15s',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
                Ticket number <span style={{ color: '#e53e3e' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  value={active.ticketNumber}
                  onChange={e => handleTicketNumberChange(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 10482"
                  maxLength={TICKET_MAX}
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
                {active.ticketNumber.length > 0 && (
                  <span style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)',
                    pointerEvents: 'none',
                  }}>
                    {active.ticketNumber.length}/{TICKET_MAX}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
                Contact / ticket category <span style={{ color: '#e53e3e' }}>*</span>
              </label>
              <select
                value={active.category}
                onChange={e => updateActive({ category: e.target.value, otherDetail: '' })}
                style={{ ...inputStyle, color: active.category ? '#000' : '#aaa' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                disabled={catsLoading}
              >
                <option value="">{catsLoading ? 'Loading…' : 'Select category'}</option>
                {(() => {
                  const grouped: Record<string, OpCategory[]> = {}
                  opCategories.forEach(c => {
                    if (!grouped[c.main_category]) grouped[c.main_category] = []
                    grouped[c.main_category].push(c)
                  })
                  return Object.keys(grouped).sort().map(main => {
                    const items = grouped[main]
                    const hasSub = items.some(c => c.sub_category)
                    if (!hasSub) {
                      return <option key={main} value={main}>{main}</option>
                    }
                    return (
                      <optgroup key={main} label={main}>
                        {items.map(c => {
                          const value = [c.main_category, c.sub_category, c.detail].filter(Boolean).join(' › ')
                          const label = [c.sub_category, c.detail].filter(Boolean).join(' › ')
                          return <option key={c.id} value={value}>{label}</option>
                        })}
                      </optgroup>
                    )
                  })
                })()}
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          {/* "Other" detail — required when Other is selected */}
          {active.category === 'Other' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
                Please describe what this ticket is about <span style={{ color: '#e53e3e' }}>*</span>
              </label>
              <input
                value={active.otherDetail}
                onChange={e => updateActive({ otherDetail: e.target.value })}
                placeholder="e.g. Settlement delay inquiry, wager cancellation request…"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>
                This helps us identify new use cases and improve categorisation over time.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Add gameLM response */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #CEA4FF', padding: 24 }}>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 20 }}>
          Add gameLM response
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
                Ticket ID
              </label>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>Optional</span>
            </div>
            <input
              value={active.draftTicketId ?? ''}
              onChange={e => updateActive({ draftTicketId: e.target.value })}
              placeholder="gameLM ticket / conversation ID for this response…"
              style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <Field label="Customer input" required>
            <textarea
              value={active.draftCustomer}
              onChange={e => updateActive({ draftCustomer: e.target.value })}
              placeholder="Paste the original customer message or query…"
              rows={4}
              style={textareaStyle}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </Field>

          <Field label="gameLM suggested response" required>
            <textarea
              value={active.draftSuggested}
              onChange={e => updateActive({ draftSuggested: e.target.value })}
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
                const selected = active.draftIssueType === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => updateActive({ draftIssueType: opt.value })}
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
                value={active.draftReasoning}
                onChange={e => updateActive({ draftReasoning: e.target.value })}
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
                value={active.draftFinalEdits}
                onChange={e => updateActive({ draftFinalEdits: e.target.value })}
                placeholder="Paste the final response you sent to the customer…"
                rows={3}
                style={textareaStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </Field>
          )}

          {showEnhancementNote && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
                  Suggested improvements
                </label>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>Optional</span>
              </div>
              <textarea
                value={active.draftEnhancementNote}
                onChange={e => updateActive({ draftEnhancementNote: e.target.value })}
                placeholder="Even though the response was good, what could have made it better? e.g. tone, specificity, phrasing…"
                rows={3}
                style={textareaStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', lineHeight: 1.45 }}>
                This helps us reduce the urge to tweak good responses — your feedback trains gameLM to get there on its own.
              </span>
            </div>
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
          <span>
            gameLM responses logged
            {active.responses.length > 0 && (
              <span style={{
                marginLeft: 8, background: '#9B59D0', color: '#fff',
                borderRadius: 100, fontSize: 11, fontWeight: 600,
                padding: '1px 7px', fontFamily: 'Inter, sans-serif',
              }}>
                {active.responses.length}
              </span>
            )}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            style={{ transform: responsesExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6" stroke="#58595B" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {responsesExpanded && (
          <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
            {active.responses.length === 0 ? (
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
                {active.responses.map((r, i) => {
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
                          {r.ticketId?.trim() && (
                            <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.5)', marginLeft: 6 }}>
                              · ID {r.ticketId.trim()}
                            </span>
                          )}
                          {r.loggedAt && (
                            <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)', marginLeft: 6 }}>
                              · Added {formatTime(r.loggedAt)}
                            </span>
                          )}
                        </div>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.customerInput}
                        </p>
                      </div>
                      <button
                        onClick={() => removeResponse(r.id)}
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
            value={active.notes}
            onChange={e => updateActive({ notes: e.target.value })}
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

    {/* ── Close-tab confirmation modal ─────────────────────────────────────── */}
    {closePending !== null && (() => {
      const pendingTab = allTabs.find(t => t.id === closePending)
      const label = pendingTab?.ticketNumber?.trim() ? `#${pendingTab.ticketNumber.trim()}` : 'this ticket'
      return (
        <div
          onClick={() => setClosePending(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16,
              border: '1.5px solid rgba(0,0,0,0.09)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
              width: '100%', maxWidth: 380,
              padding: '24px 24px 20px',
            }}
          >
            <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 8 }}>
              Close {label}?
            </p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', lineHeight: 1.5, marginBottom: 20 }}>
              Any unsaved work on this ticket will be lost. Make sure you've submitted before closing.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setClosePending(null)}
                style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '8px 18px', borderRadius: 10,
                  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff',
                  color: '#58595B', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
              >
                Keep open
              </button>
              <button
                onClick={() => doCloseTab(closePending)}
                style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  padding: '8px 18px', borderRadius: 10,
                  border: 'none', background: '#e53e3e',
                  color: '#fff', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                Close ticket
              </button>
            </div>
          </div>
        </div>
      )
    })()}
    </>
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
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '10px 12px', fontSize: 13, color: '#000',
  outline: 'none', resize: 'vertical', transition: 'border-color 0.15s',
  width: '100%', fontFamily: 'Inter, sans-serif',
}
