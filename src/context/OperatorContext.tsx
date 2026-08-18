import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export interface Operator {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  // null = this operator doesn't use Zendesk — pages should skip ZD adoption
  // tracking entirely rather than showing a cross-brand-contaminated number.
  zendeskBrandId: string | null
  // True only while an operator is in QA/UAT testing (e.g. RSI right now).
  // Duplicate placeholder ticket numbers are expected in that mode, so ticket-
  // counting logic falls back to the real per-row id instead of ticket_number
  // — production operators are unaffected, this is always false for them.
  isQaMode: boolean
  // True for operators being migrated toward the production Full Auto
  // dashboard — shows a second "Full Auto" tab on Executive Summary with
  // manually-entered preview data. False (default) hides it entirely.
  fullAutoEnabled: boolean
}

interface OperatorContextValue {
  operators: Operator[]
  selectedOperator: Operator | null
  setSelectedOperator: (op: Operator) => void
  loading: boolean
}

const OperatorContext = createContext<OperatorContextValue | null>(null)

const STORAGE_KEY = 'raphie_selected_operator'

function mapOperator(o: any): Operator {
  return {
    id: o.id, name: o.name, slug: o.slug, logoUrl: o.logo_url ?? null,
    zendeskBrandId: o.zendesk_brand_id ?? null, isQaMode: !!o.is_qa_mode,
    fullAutoEnabled: !!o.full_auto_enabled,
  }
}

const OPERATOR_COLS = 'id, name, slug, logo_url, zendesk_brand_id, is_qa_mode, full_auto_enabled'
const OPERATOR_COLS_PRE_MIGRATION = 'id, name, slug, logo_url, zendesk_brand_id, is_qa_mode'

// Falls back to the pre-migration column list if `full_auto_enabled` doesn't
// exist yet on `operators` -- otherwise a single unknown-column error would
// fail this query entirely and no operator would ever load app-wide.
async function selectOperators(applyFilter: (q: any) => any): Promise<any[]> {
  const first = await applyFilter(supabase.from('operators').select(OPERATOR_COLS))
  if (!first.error) return first.data ?? []
  const fallback = await applyFilter(supabase.from('operators').select(OPERATOR_COLS_PRE_MIGRATION))
  return fallback.data ?? []
}

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [operators, setOperators]           = useState<Operator[]>([])
  const [selectedOperator, setSelected]     = useState<Operator | null>(null)
  const [loading, setLoading]               = useState(true)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    let cancelled = false

    async function load() {
      let ops: Operator[] = []

      if (user!.role === 'admin') {
        // Admins/SuperAdmins can switch between every operator.
        ops = (await selectOperators(q => q.order('name'))).map(mapOperator)
      } else if (user!.role === 'operator') {
        // External client logins — always exactly their one operator, never extra
        // access even if something were ever granted to them.
        ops = (await selectOperators(q => q.eq('id', user!.operatorId ?? ''))).map(mapOperator)
      } else {
        // Agent / QA — their home operator, plus anything a SuperAdmin has granted
        // via user_operator_access (e.g. a QA person covering RSI on top of BetSaracen).
        const [home, { data: grants }] = await Promise.all([
          user!.operatorId ? selectOperators(q => q.eq('id', user!.operatorId)) : Promise.resolve([]),
          supabase.from('user_operator_access').select('operator_id').eq('user_id', user!.id),
        ])
        const homeOps = home.map(mapOperator)
        const homeIds = new Set(homeOps.map(o => o.id))
        const grantedIds = (grants ?? []).map((g: any) => g.operator_id).filter((id: string) => !homeIds.has(id))

        let grantedOps: Operator[] = []
        if (grantedIds.length > 0) {
          grantedOps = (await selectOperators(q => q.in('id', grantedIds))).map(mapOperator)
        }
        ops = [...homeOps, ...grantedOps]
      }

      if (cancelled) return
      setOperators(ops)

      if (ops.length === 0) { setLoading(false); return }

      if (ops.length > 1) {
        // More than one available (admin, or a QA/agent granted extra access) —
        // restore the last selection so a switch persists across reloads.
        const savedId = localStorage.getItem(STORAGE_KEY)
        const savedOp = savedId ? ops.find(o => o.id === savedId) : null
        setSelected(savedOp ?? ops[0])
      } else {
        setSelected(ops[0])
      }

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [user])

  function setSelectedOperator(op: Operator) {
    setSelected(op)
    if (operators.length > 1) {
      localStorage.setItem(STORAGE_KEY, op.id)
    }
  }

  return (
    <OperatorContext.Provider value={{ operators, selectedOperator, setSelectedOperator, loading }}>
      {children}
    </OperatorContext.Provider>
  )
}

export function useOperator() {
  const ctx = useContext(OperatorContext)
  if (!ctx) throw new Error('useOperator must be used within OperatorProvider')
  return ctx
}
