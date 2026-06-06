import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export interface Operator {
  id: string
  name: string
  slug: string
  logoUrl: string | null
}

interface OperatorContextValue {
  operators: Operator[]
  selectedOperator: Operator | null
  setSelectedOperator: (op: Operator) => void
  loading: boolean
}

const OperatorContext = createContext<OperatorContextValue | null>(null)

const STORAGE_KEY = 'conduet_selected_operator'

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [operators, setOperators]           = useState<Operator[]>([])
  const [selectedOperator, setSelected]     = useState<Operator | null>(null)
  const [loading, setLoading]               = useState(true)

  useEffect(() => {
    if (!user) { setLoading(false); return }

    supabase
      .from('operators')
      .select('id, name, slug, logo_url')
      .order('name')
      .then(({ data }) => {
        const ops: Operator[] = (data ?? []).map((o: any) => ({
          id:      o.id,
          name:    o.name,
          slug:    o.slug,
          logoUrl: o.logo_url ?? null,
        }))
        setOperators(ops)

        if (ops.length === 0) { setLoading(false); return }

        if (user.role === 'admin') {
          // Admins can switch — restore last selection from localStorage
          const savedId   = localStorage.getItem(STORAGE_KEY)
          const savedOp   = savedId ? ops.find(o => o.id === savedId) : null
          setSelected(savedOp ?? ops[0])
        } else {
          // Agents are locked to their own operator
          const agentOp = user.operatorId ? ops.find(o => o.id === user.operatorId) : null
          setSelected(agentOp ?? ops[0])
        }

        setLoading(false)
      })
  }, [user])

  function setSelectedOperator(op: Operator) {
    setSelected(op)
    if (user?.role === 'admin') {
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
