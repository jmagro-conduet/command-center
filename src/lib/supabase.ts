import { createClient } from '@supabase/supabase-js'

const url            = import.meta.env.VITE_SUPABASE_URL as string
const anonKey        = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string

if (!url || !anonKey || !serviceRoleKey) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#F1F1F2;font-family:Inter,sans-serif">
      <div style="background:#fff;border-radius:16px;border:1.5px solid rgba(0,0,0,0.09);padding:32px;max-width:420px;text-align:center">
        <p style="font-size:15px;font-weight:600;color:#000;margin-bottom:8px">Missing environment variables</p>
        <p style="font-size:13px;color:#58595B">Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_SUPABASE_SERVICE_ROLE_KEY in your Vercel project settings, then redeploy.</p>
      </div>
    </div>`
  throw new Error('Missing Supabase environment variables')
}

// Auth operations (sign in / sign out / session)
export const authClient = createClient(url, anonKey)

// Data operations — service role bypasses RLS for this internal ops tool
export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
})
