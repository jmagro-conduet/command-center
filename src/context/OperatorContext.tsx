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
}

interface OperatorContextValue {
  operators: Operator[]
  selectedOperator: Operator | null
  setSelectedOperator: (op: Operator) => void
  loading: boolean
}

const OperatorContext = createContext<OperatorContextValue | null>(null)

const STORAGE_KEY = 'conduet_selected_operator'

function mapOperator(o: any): Operator {
  return { id: o.id, name: o.name, slug: o.slug, logoUrl: o.logo_url ?? null, zendeskBrandId: o.zendesk_brand_id ?? null }
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
        const { data } = await supabase.from('operators').select('id, name, slug, logo_url, zendesk_brand_id').order('name')
        ops = (data ?? []).map(mapOperator)
      } else if (user!.role === 'operator') {
        // External client logins — always exactly their one operator, never extra
        // access even if something were ever granted to them.
        const { data } = await supabase.from('operators').select('id, name, slug, logo_url, zendesk_brand_id').eq('id', user!.operatorId ?? '')
        ops = (data ?? []).map(mapOperator)
      } else {
        // Agent / QA — their home operator, plus anything a SuperAdmin has granted
        // via user_operator_access (e.g. a QA person covering RSI on top of BetSaracen).
        const [{ data: home }, { data: grants }] = await Promise.all([
          user!.operatorId
            ? supabase.from('operators').select('id, name, slug, logo_url, zendesk_brand_id').eq('id', user!.operatorId)
            : Promise.resolve({ data: [] as any[] }),
          supabase.from('user_operator_access').select('operator_id').eq('user_id', user!.id),
        ])
        const homeOps = (home ?? []).map(mapOperator)
        const homeIds = new Set(homeOps.map(o => o.id))
        const grantedIds = (grants ?? []).map((g: any) => g.operator_id).filter((id: string) => !homeIds.has(id))

        let grantedOps: Operator[] = []
        if (grantedIds.length > 0) {
          const { data: gOps } = await supabase.from('operators').select('id, name, slug, logo_url, zendesk_brand_id').in('id', grantedIds)
          grantedOps = (gOps ?? []).map(mapOperator)
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
