import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

const TICKET_MAX = 20
// Short by design -- a scannable tag for checking test variety/volume across
// many rows in Submissions, not a description. A textarea invites a
// paragraph that reads fine one at a time but doesn't scan or export well.
const SCENARIO_MAX = 60
const SCENARIO_TYPES = [
  { value: 'happy_path',    label: 'Happy path' },
  { value: 'edge_case',     label: 'Edge case' },
  { value: 'out_of_scope',  label: 'Out of Scope' },
  { value: 'cross_cutting', label: 'Cross-cutting' },
]
const SUCCESS_OPTIONS = [
  { value: 'fully_automated',       label: 'Fully Automated' },
  { value: 'escalated_successfully', label: 'Escalated Successfully' },
]
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
  // Pinned to whichever operator was active when this tab was created — a tab
  // keeps submitting to that operator no matter what the global switcher does
  // afterward, so an agent flipping between operators to work multiple tickets
  // in parallel can't have one silently submit under the wrong operator.
  operatorId: string | null
  operatorName: string | null
  // Full Auto has no "draft a human reviews and edits" step, so it doesn't
  // carry any of the CoPilot fields below (customer input, suggested
  // response, issue type/edit grading, final edits) -- it's deliberately
  // just a submission record (ticket number, category, optional unique id).
  mode: 'copilot' | 'full_auto'
  fullAutoExternalId: string
  // What kind of test case this represents -- alongside the Scenario tag,
  // the other half of checking variety/volume across submissions.
  scenarioType: string
  // Optional -- did this go well either way (gameLM handled it fully on its
  // own, or correctly escalated)? Left blank when that's not a clean yes.
  success: string
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

// Full Auto-only if that's the ONLY mode this operator has enabled;
// CoPilot in every other case (both enabled, or — defensively — neither).
function defaultModeFor(operator?: { copilotEnabled: boolean; fullAutoEnabled: boolean } | null): 'copilot' | 'full_auto' {
  return operator?.fullAutoEnabled && !operator.copilotEnabled ? 'full_auto' : 'copilot'
}

function newTab(id: number, operator?: { id: string; name: string; copilotEnabled: boolean; fullAutoEnabled: boolean } | null): TabState {
  return {
    id,
    operatorId: operator?.id ?? null,
    operatorName: operator?.name ?? null,
    mode: defaultModeFor(operator), fullAutoExternalId: '', scenarioType: '', success: '',
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

  const active = allTabs.find(t => t.id === activeTabId) ?? allTabs[0]

  // Pin any tab that doesn't have an operator yet (a brand-new tab created
  // before selectedOperator finished loading, or a draft restored from
  // localStorage from before this field existed) to whatever operator is
  // active right now. This only ever fills a gap — a tab that's already
  // pinned never changes just because the global switcher does. Depends on
  // allTabs (not just selectedOperator) so it also catches tabs that show up
  // *after* selectedOperator already loaded (e.g. the localStorage-restore
  // effect below firing later and replacing the initial tab set) — bails out
  // to the same array reference when nothing needs backfilling, so this
  // can't loop or cause extra renders on ordinary edits.
  useEffect(() => {
    if (!selectedOperator) return
    setAllTabs(tabs => tabs.every(t => t.operatorId) ? tabs : tabs.map(t =>
      t.operatorId ? t : { ...t, operatorId: selectedOperator.id, operatorName: selectedOperator.name }
    ))
  }, [selectedOperator?.id, allTabs])

  // Corrects any tab whose mode isn't actually allowed for its own pinned
  // operator -- covers a draft restored from localStorage set under a
  // different operator's config, and an operator whose CoPilot/Full Auto
  // toggles changed after the tab was created. Compares each tab against
  // selectedOperator only when it's actually that tab's own operator (an
  // inactive background tab for a DIFFERENT operator is left alone, same
  // principle as the operator-scoping elsewhere on this page).
  useEffect(() => {
    if (!selectedOperator) return
    setAllTabs(tabs => {
      let changed = false
      const next = tabs.map(t => {
        if (t.operatorId !== selectedOperator.id) return t
        const allowed = t.mode === 'full_auto' ? selectedOperator.fullAutoEnabled : selectedOperator.copilotEnabled
        if (allowed) return t
        changed = true
        return { ...t, mode: defaultModeFor(selectedOperator) }
      })
      return changed ? next : tabs
    })
  }, [selectedOperator?.id, selectedOperator?.copilotEnabled, selectedOperator?.fullAutoEnabled, allTabs])

  // Tabs for other operators stay open in the background, not visible or
  // reachable while you're on a different one — switching operators is
  // switching workspaces, not just changing what a submit button targets.
  const visibleTabs = allTabs.filter(t => t.operatorId === selectedOperator?.id)

  // When the global operator changes, make sure there's something to land on:
  // reuse this operator's existing tabs if any, or start one fresh. Also
  // depends on allTabs so it self-corrects once the backfill effect above
  // lands (it deliberately no-ops while a tab is still an orphan pending
  // that backfill, so the two effects can't race into creating a duplicate).
  useEffect(() => {
    if (!selectedOperator) return
    const visible = allTabs.filter(t => t.operatorId === selectedOperator.id)
    if (visible.length === 0) {
      const pendingBackfill = allTabs.some(t => !t.operatorId)
      if (pendingBackfill) return
      const id = nextId.current++
      setAllTabs(tabs => [...tabs, newTab(id, selectedOperator)])
      setActiveTabId(id)
      return
    }
    if (!visible.some(t => t.id === activeTabId)) {
      setActiveTabId(visible[visible.length - 1].id)
    }
  }, [selectedOperator?.id, allTabs])

  const categoryOperatorId = active.operatorId ?? selectedOperator?.id ?? null
  useEffect(() => {
    if (!categoryOperatorId) { setOpCategories([]); return }
    setCatsLoading(true)
    supabase.from('operator_issue_categories')
      .select('id, main_category, sub_category, detail')
      .eq('operator_id', categoryOperatorId)
      .eq('active', true)
      .order('main_category').order('sub_category', { nullsFirst: true }).order('detail', { nullsFirst: true })
      .then(({ data }) => { setOpCategories(data ?? []); setCatsLoading(false) })
  }, [categoryOperatorId])

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
          // Backfill fields that didn't exist in older saved drafts.
          const restored: TabState[] = d.allTabs.map((t: any) => ({
            mode: 'copilot', fullAutoExternalId: '', scenarioType: '', success: '', ...t,
          }))
          setAllTabs(restored)
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

  // Full Auto operators without a real backing ticket system (e.g. no
  // Kustomer/Zendesk instance, like Furlong) have no source of truth for
  // ticket numbers -- agents typing their own risk collisions. Millisecond
  // epoch time plus a random 3-digit suffix is unique enough in practice
  // (16 digits, comfortably under TICKET_MAX) without needing a DB
  // round-trip or a uniqueness constraint. Purely numeric so it passes
  // straight through the digit-only stripping above.
  function generateTicketNumber() {
    const generated = `${Date.now()}${Math.floor(100 + Math.random() * 900)}`.slice(0, TICKET_MAX)
    updateActive({ ticketNumber: generated })
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
    setAllTabs(tabs => [...tabs, newTab(id, selectedOperator)])
    setActiveTabId(id)
  }

  function closeTab(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (visibleTabs.length === 1) return
    // If the tab has any data, ask for confirmation first
    const tab = allTabs.find(t => t.id === id)
    const hasData = tab && (tab.ticketNumber.trim() || tab.responses.length > 0)
    if (hasData) { setClosePending(id); return }
    doCloseTab(id)
  }

  function doCloseTab(id: number) {
    const remaining = allTabs.filter(t => t.id !== id)
    setAllTabs(remaining)
    if (activeTabId === id) {
      const remainingVisible = remaining.filter(t => t.operatorId === selectedOperator?.id)
      setActiveTabId(remainingVisible[remainingVisible.length - 1].id)
    }
    setClosePending(null)
  }

  async function handleSubmit() {
    const validationErr = validateTicketNumber(active.ticketNumber)
    const isFullAuto = active.mode === 'full_auto'
    if (validationErr || !active.category || (!isFullAuto && active.responses.length === 0)) return

    setSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    // Pinned to this tab, not the live global selector — that's the whole
    // point: a ticket submits to the operator it was started under, even if
    // the agent has since switched operators to work a different tab.
    const submitOperatorId = active.operatorId ?? selectedOperator?.id ?? user?.operatorId ?? null

    const ticketPayload: Record<string, unknown> = {
      ticket_number:          active.ticketNumber.trim(),
      ticket_category:        active.category,
      other_category_detail:  active.category === 'Other' ? active.otherDetail.trim() : null,
      agent_name:             user?.name ?? '',
      agent_email:            user?.email ?? '',
      agent_team:             user?.operatorTeam ?? null,
      notes:                  active.notes.trim(),
      operator_id:            submitOperatorId,
      mode:                   active.mode,
      external_ticket_id:     isFullAuto ? (active.fullAutoExternalId.trim() || null) : null,
      scenario_type:          isFullAuto ? (active.scenarioType || null) : null,
      success:                isFullAuto ? (active.success || null) : null,
    }
    let { data: ticket, error: ticketErr } = await supabase.from('tickets').insert(ticketPayload).select('id').single()
    // scenario_type/success are newer columns -- if either migration hasn't
    // run yet, retry without them rather than losing the whole submission
    // over one field (same lesson as Learn's content_preview outage).
    if (ticketErr) {
      const { scenario_type, success, ...withoutNewerFields } = ticketPayload
      const retry = await supabase.from('tickets').insert(withoutNewerFields).select('id').single()
      ticket = retry.data
      ticketErr = retry.error
    }

    if (ticketErr || !ticket) {
      setSubmitError(ticketErr?.message ?? 'Failed to save ticket.')
      setSubmitting(false)
      return
    }

    // Full Auto has no draft-to-edit step, so there's nothing to log into
    // ticket_issues (that table — and every page reading it — is built
    // entirely around CoPilot's edit-grading model). The ticket row alone
    // is the whole submission.
    if (!isFullAuto) {
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
          operator_id:        submitOperatorId,
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
    }

    setSubmitting(false)
    setSubmitSuccess(true)

    // Fire-and-forget: fetch ZD ticket details (created_at + player message count)
    // Runs in background — does not block or affect the submission UX
    supabase.functions.invoke('zd-ticket-details', {
      body: { tickets: [{ supabase_id: ticket.id, ticket_number: active.ticketNumber.trim() }] },
    }).catch(() => {}) // intentionally swallow — non-critical enrichment

    // Remove the submitted tab; if it was this operator's last one, replace
    // with a fresh tab for the SAME operator — other operators' tabs are
    // untouched either way, never collapsed into this reset.
    const remaining = allTabs.filter(t => t.id !== activeTabId)
    const remainingVisible = remaining.filter(t => t.operatorId === selectedOperator?.id)
    if (remainingVisible.length === 0) {
      const freshId = nextId.current++
      setAllTabs([...remaining, newTab(freshId, selectedOperator)])
      setActiveTabId(freshId)
    } else {
      setAllTabs(remaining)
      setActiveTabId(remainingVisible[remainingVisible.length - 1].id)
    }

    setTimeout(() => setSubmitSuccess(false), 4000)
  }

  const ticketValid    = validateTicketNumber(active.ticketNumber) === null
  const canAddResponse = active.draftCustomer.trim() && active.draftSuggested.trim() &&
    active.draftIssueType && (!needsReasoning || active.draftReasoning.trim())
  const otherDetailRequired = active.category === 'Other'
  const canSubmit      = ticketValid && active.category &&
    (!otherDetailRequired || active.otherDetail.trim().length > 0) &&
    (active.mode === 'full_auto'
      ? active.notes.trim().length > 0 && !!active.scenarioType && active.fullAutoExternalId.trim().length > 0
      : active.responses.length > 0) &&
    !!active.operatorId && !operatorLoading
  const operatorMismatch = !!active.operatorId && !!selectedOperator && active.operatorId !== selectedOperator.id

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
          Log ticket
        </h1>
        {active.operatorName && (
          <span style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            color: operatorMismatch ? '#b45309' : '#58595B',
            background: operatorMismatch ? 'rgba(243,156,18,0.1)' : 'transparent',
            padding: operatorMismatch ? '4px 10px' : 0, borderRadius: 8,
          }}>
            Logging for: <strong>{active.operatorName}</strong>
            {operatorMismatch && ` — you're currently viewing ${selectedOperator?.name}`}
          </span>
        )}
      </div>

      {/* Tab bar — only this operator's tabs; other operators' tabs stay open
          in the background and reappear when you switch back to them. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1.5px solid rgba(0,0,0,0.09)' }}>
        {visibleTabs.map(tab => (
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
            {visibleTabs.length > 1 && (
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
          {/* Only shown when this operator actually has both modes enabled
              (Settings -> operator config) -- an operator scoped to just one
              mode goes straight to that mode's fields, no choice to make. */}
          {!!selectedOperator?.copilotEnabled && !!selectedOperator?.fullAutoEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>Mode</label>
              <div style={{ display: 'flex', gap: 8, maxWidth: 320 }}>
                {(['copilot', 'full_auto'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => updateActive({ mode: m })}
                    style={{
                      flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                      padding: '9px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                      border: active.mode === m ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.12)',
                      background: active.mode === m ? 'rgba(155,89,208,0.06)' : '#fff',
                      color: active.mode === m ? '#9B59D0' : '#58595B',
                    }}
                  >{m === 'copilot' ? 'CoPilot' : 'Full Auto'}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: active.mode === 'full_auto' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
                Ticket number <span style={{ color: '#e53e3e' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
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
                {/* Full Auto only -- operators with no real backing ticket
                    system (no Kustomer/Zendesk) have nothing to type here
                    that's guaranteed unique otherwise. */}
                {active.mode === 'full_auto' && (
                  <button
                    type="button"
                    onClick={generateTicketNumber}
                    title="Generate a guaranteed-unique placeholder number"
                    style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                      padding: '0 14px', borderRadius: 10, border: '1.5px solid rgba(155,89,208,0.35)',
                      background: 'rgba(155,89,208,0.06)', color: '#9B59D0', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(155,89,208,0.06)')}
                  >
                    Auto-generate
                  </button>
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
            {active.mode === 'full_auto' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}>
                  Ticket ID <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <input
                  value={active.fullAutoExternalId}
                  onChange={e => updateActive({ fullAutoExternalId: e.target.value })}
                  placeholder="gameLM conversation / ticket ID…"
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
            )}
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

      {/* Add gameLM response — CoPilot only; Full Auto has no draft-to-edit
          step, so there's nothing here to grade (see the Mode toggle above). */}
      {active.mode === 'copilot' && (
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
      )}

      {/* Responses logged — CoPilot only, see above */}
      {active.mode === 'copilot' && (
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
      )}

      {/* Scenario — Full Auto's equivalent of CoPilot's Issue Type: there's no
          draft to grade, so instead of a fixed edit-distance taxonomy, this
          is a short tag for what happened. Deliberately a single-line,
          capped input rather than a textarea -- a paragraph doesn't scan
          across many rows in Submissions or group meaningfully once
          exported, which is the actual point of this field (checking test
          variety/volume, not documenting one ticket in depth). Reuses the
          same `notes` field CoPilot's Supporting detail card writes to
          (below), just surfaced here as the primary, required field. */}
      {active.mode === 'full_auto' && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #CEA4FF', padding: 24 }}>
          <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 20 }}>
            Scenario
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 180px', gap: 16 }}>
            <Field label="What happened — a short tag, not a description" required>
              <div style={{ position: 'relative' }}>
                <input
                  value={active.notes}
                  onChange={e => updateActive({ notes: e.target.value.slice(0, SCENARIO_MAX) })}
                  placeholder="e.g. Trustly redemption error, AMOE question…"
                  maxLength={SCENARIO_MAX}
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
                {active.notes.length > 0 && (
                  <span style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)',
                    pointerEvents: 'none',
                  }}>
                    {active.notes.length}/{SCENARIO_MAX}
                  </span>
                )}
              </div>
            </Field>
            <Field label="Scenario type" required>
              <select
                value={active.scenarioType}
                onChange={e => updateActive({ scenarioType: e.target.value })}
                style={{ ...inputStyle, color: active.scenarioType ? '#000' : '#aaa', cursor: 'pointer' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              >
                <option value="">Select type</option>
                {SCENARIO_TYPES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Success">
              <select
                value={active.success}
                onChange={e => updateActive({ success: e.target.value })}
                style={{ ...inputStyle, color: active.success ? '#000' : '#aaa', cursor: 'pointer' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              >
                <option value="">— optional —</option>
                {SUCCESS_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      )}

      {/* Supporting detail — CoPilot only; Full Auto's Scenario card above
          already collects `notes` as its primary field. */}
      {active.mode === 'copilot' && (
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
      )}

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
