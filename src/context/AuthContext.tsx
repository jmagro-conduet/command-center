import { createContext, useContext, useEffect, useState } from 'react'
import { authClient, supabase } from '../lib/supabase'
import { fetchUserAccess } from '../lib/pageAccess'
import type { AccessMap } from '../lib/pageAccess'

export interface AppUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'agent' | 'qa' | 'operator'
  // SuperAdmins are the only role allowed into Admin Settings. They are a
  // superset of admin: we normalize role to 'admin' here so every existing
  // admin check keeps working, and expose isSuperAdmin for the Settings gate.
  isSuperAdmin: boolean
  operatorTeam: string | null
  operatorId: string | null
  // users.role as stored (agent | qa | admin | superadmin | operator). `role` above
  // normalizes superadmin to admin for the many in-page checks; this keeps the truth.
  baseRole: string
  // Effective access to every page (none | view | edit): the user's access profile
  // plus their per-page overrides. See lib/access/core.ts.
  access: AccessMap
}

function toAppUser(profile: any, access: AccessMap = {}): AppUser {
  const isSuperAdmin = profile.role === 'superadmin'
  return {
    id:           profile.id,
    email:        profile.email,
    name:         profile.name,
    role:         (isSuperAdmin ? 'admin' : profile.role) as AppUser['role'],
    isSuperAdmin,
    operatorTeam: profile.operator_team,
    operatorId:   profile.operator_id ?? null,
    baseRole:     profile.role,
    access,
  }
}

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  recoveryMode: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]             = useState<AppUser | null>(null)
  const [loading, setLoading]       = useState(true)
  const [recoveryMode, setRecoveryMode] = useState(false)

  async function loadUser(email: string) {
    const { data } = await supabase
      .from('users')
      .select('id, name, email, role, operator_team, operator_id')
      .eq('email', email)
      .single()
    return data
  }

  useEffect(() => {
    authClient.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.email) {
        const profile = await loadUser(session.user.email)
        if (profile) {
          setUser(toAppUser(profile, await fetchUserAccess(profile.id, profile.role)))
        }
      }
      setLoading(false)
    })

    const { data: { subscription } } = authClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) { setUser(null); setRecoveryMode(false); return }
      if (event === 'PASSWORD_RECOVERY') { setRecoveryMode(true); return }
      if (session.user.email) {
        const profile = await loadUser(session.user.email)
        if (profile) {
          setUser(toAppUser(profile, await fetchUserAccess(profile.id, profile.role)))
        }
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await authClient.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  async function signOut() {
    await authClient.auth.signOut()
    setUser(null)
  }

  async function updatePassword(newPassword: string) {
    const { error } = await authClient.auth.updateUser({ password: newPassword })
    if (error) return { error: error.message }
    setRecoveryMode(false)
    // Re-load user profile after password update
    const { data: { session } } = await authClient.auth.getSession()
    if (session?.user?.email) {
      const profile = await loadUser(session.user.email)
      if (profile) {
        setUser(toAppUser(profile, await fetchUserAccess(profile.id, profile.role)))
      }
    }
    return { error: null }
  }

  return (
    <AuthContext.Provider value={{ user, loading, recoveryMode, signIn, signOut, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
