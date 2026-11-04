import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Chunk, Proj, Quarter, StatusKey, ViewData } from '../../lib/roadmap/logic'
import { STATUS } from '../../lib/roadmap/logic'
import type { Writer } from '../../lib/roadmap/useRoadmap'

export type TabKey = 'overview' | 'board' | 'next' | 'news'
export type DrawerState =
  | { kind: 'chunk' | 'project' | 'cand' | 'news'; id: string }
  | { kind: 'sprint' }
  | null

// Everything a tab or drawer needs, built once per render in Roadmap.tsx.
export interface Ctx {
  v: ViewData
  q: Quarter
  P: Proj[]
  C: Chunk[]
  canEdit: boolean       // false in snapshot views
  realCanEdit: boolean   // the user's true permission
  editing: boolean       // Edit toggle on (inline controls)
  isLive: boolean
  writer: Writer
  toast: (msg: string) => void
  open: (d: NonNullable<DrawerState>) => void
  closeDrawer: () => void
  goTab: (t: TabKey) => void
  boardChunk: string
  setBoardChunk: (id: string) => void
}

export const StatusChip = ({ s }: { s: StatusKey }) => <span className={`rm-st rm-st-${s}`}>{STATUS[s]}</span>

export function Modal({ eyebrow, title, onClose, children }: { eyebrow?: string; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="rm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="rm-modal-head">
          <div>
            {eyebrow && <div className="rm-eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="rm-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const ExtLink = ({ href, children }: { href: string; children: ReactNode }) =>
  <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
