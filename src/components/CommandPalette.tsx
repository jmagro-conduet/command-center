import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'
import { PAGES, canOpen } from '../lib/access/core'
import type { Page } from './layout/Sidebar'

// Ctrl+K / Cmd+K: jump to any page you can open, or to an operator you can already access.
// It never lists anything the person could not reach through the sidebar: pages come from their
// resolved access, operators from the same list the operator switcher uses.

export const OPEN_SEARCH_EVENT = 'hub:open-search'

interface Hit { id: string; label: string; where: string; run: () => void }

// Pages where picking an operator is meaningful, in order of preference.
const OPERATOR_LANDING: Page[] = ['analytics', 'executive-summary', 'report-card', 'submissions']

export default function CommandPalette({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { user } = useAuth()
  const { operators, setSelectedOperator } = useOperator()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); setQ(''); setIdx(0) }
    }
    const onOpen = () => { setOpen(true); setQ(''); setIdx(0) }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_SEARCH_EVENT, onOpen) }
  }, [])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0) }, [open])

  const hits = useMemo<Hit[]>(() => {
    const go = (p: Page) => () => { setOpen(false); onNavigate(p) }
    const pages: Hit[] = [
      { id: 'home', label: 'Home', where: 'Page', run: go('home') },
      ...PAGES.filter(p => p.nav && canOpen(user?.access, p.key)).map(p => ({ id: p.key, label: p.label, where: p.group, run: go(p.key as Page) })),
      { id: 'settings', label: canOpen(user?.access, 'users') || canOpen(user?.access, 'admin-settings') ? 'Admin settings' : 'Settings', where: 'Page', run: go('settings') },
    ]
    const ops: Hit[] = operators.map(o => ({
      id: 'op-' + o.id, label: o.name, where: 'Operator',
      run: () => {
        setOpen(false); setSelectedOperator(o)
        const target = OPERATOR_LANDING.find(p => canOpen(user?.access, p))
        if (target) onNavigate(target)
      },
    }))
    const needle = q.trim().toLowerCase()
    const all = [...pages, ...ops]
    return (needle ? all.filter(h => h.label.toLowerCase().includes(needle) || h.where.toLowerCase().includes(needle)) : all).slice(0, 12)
  }, [q, user?.access, operators, onNavigate, setSelectedOperator])

  if (!open) return null
  const choose = (i: number) => hits[i]?.run()
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh', zIndex: 1200 }}>
      <div role="dialog" aria-modal="true" aria-label="Search"
        style={{ background: '#fff', borderRadius: 16, width: 'min(560px, 92vw)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input ref={inputRef} value={q} placeholder="Search pages and operators" aria-label="Search pages and operators"
            onChange={e => { setQ(e.target.value); setIdx(0) }}
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false)
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, hits.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); choose(idx) }
            }}
            style={{ flex: 1, border: 0, outline: 'none', fontSize: 15, fontFamily: 'var(--font-body)', background: 'transparent' }} />
          <span style={{ fontSize: 11, color: '#323232', background: 'rgba(0,0,0,0.06)', borderRadius: 6, padding: '2px 6px' }}>Esc</span>
        </div>
        <div role="listbox" style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {hits.length === 0 && <div style={{ padding: '14px 12px', fontSize: 13, color: '#323232' }}>Nothing matches that.</div>}
          {hits.map((h, i) => (
            <button key={h.id} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => choose(i)}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 10, border: 0, cursor: 'pointer', textAlign: 'left',
                background: i === idx ? '#cceef0' : 'transparent', color: '#000', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: i === idx ? 500 : 400 }}>
              <span>{h.label}</span><span style={{ fontSize: 12, color: '#323232' }}>{h.where}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
