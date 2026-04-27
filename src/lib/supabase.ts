import { createClient } from '@supabase/supabase-js'

const url            = import.meta.env.VITE_SUPABASE_URL as string
const anonKey        = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string

// Auth operations (sign in / sign out / session)
export const authClient = createClient(url, anonKey)

// Data operations — service role bypasses RLS for this internal ops tool
export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
})
