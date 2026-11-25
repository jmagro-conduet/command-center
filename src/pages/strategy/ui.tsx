import type { ReactNode } from 'react'
import type { Code, Data, Plan, StatusCode } from '../../lib/strategy/logic'
import { STATUS_CODES, STATUS_LABEL } from '../../lib/strategy/logic'
import type { StrategyWriter } from '../../lib/strategy/useStrategy'

export type TabKey = 'home' | 'elt' | 'actions' | 'admin' | 'guide'
export type EltStage = 'before' | 'after'
export interface ActionFilter { status: 'open' | 'done' | 'all'; owner: string; scope: string }

// Everything a tab needs, built once per render in Strategy.tsx.
export interface Ctx {
  data: Data
  plan: Plan
  writer: StrategyWriter
  me: string | null          // signed-in user's email (stored on check-ins, comments)
  canEdit: boolean           // can write AND not previewing the viewer view
  realCanEdit: boolean       // the user's true permission
  currentId: string | null
  toast: (msg: string) => void
  goTab: (t: TabKey) => void
  openKr: (id: string, opts?: { session?: string; edit?: boolean }) => void
  asOf: string               // saved ELT id the dashboard is "as of", '' = latest
  setAsOf: (id: string) => void
  eltId: string
  setEltId: (id: string) => void
  eltStage: EltStage
  setEltStage: (s: EltStage) => void
  af: ActionFilter
  setAf: (f: ActionFilter) => void
  setViewPeriod: (id: string) => void
  viewPeriod: string
  previewViewer: boolean
  setPreviewViewer: (v: boolean) => void
}

export const StatusPill = ({ code, ai }: { code: Code; ai?: boolean }) =>
  <span className={`rm-st rm-st-${code}${ai ? ' ai' : ''}`}>{STATUS_LABEL[code]}</span>

export function StatusSelect({ value, onChange, id }: { value: StatusCode; onChange: (v: StatusCode) => void; id?: string }) {
  return (
    <select id={id} aria-label="Status" value={value} onChange={e => onChange(e.target.value as StatusCode)}>
      {STATUS_CODES.map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
    </select>
  )
}

export const Field = ({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) =>
  <label className="st-field" style={grow ? { flex: '1 1 100%' } : undefined}>{label}{children}</label>

export const Empty = ({ title, children }: { title?: string; children?: ReactNode }) =>
  <div className="rm-state">{title && <h2 style={{ marginBottom: 8, fontSize: 16 }}>{title}</h2>}{children}</div>
