/**
 * Add a single new user to the command-center app.
 *
 * Creates:
 *   1. A Supabase Auth account (email + temp password, confirmed)
 *   2. A row in public.users (name, email, role, operator_team)
 *
 * Usage:
 *   node scripts/add-user.cjs "Full Name" "email@conduet.com" [role] [team]
 *
 * Defaults:
 *   role  → agent
 *   team  → BetSaracen
 *
 * Examples:
 *   node scripts/add-user.cjs "Jane Doe" "jane.doe@conduet.com"
 *   node scripts/add-user.cjs "Jane Doe" "jane.doe@conduet.com" agent BetSaracen
 *   node scripts/add-user.cjs "John Magro" "john.magro@conduet.com" admin
 */

const fs   = require('fs')
const path = require('path')
const { createClient } = require('../node_modules/@supabase/supabase-js')

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const TEMP_PASSWORD    = 'Conduet2026!'
// ─────────────────────────────────────────────────────────────────────────────

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  const [,, name, email, role = 'agent', team = 'BetSaracen'] = process.argv

  if (!name || !email) {
    console.error('Usage: node scripts/add-user.cjs "Full Name" "email@conduet.com" [role] [team]')
    console.error('  role defaults to "agent", team defaults to "BetSaracen"')
    process.exit(1)
  }

  if (!email.includes('@')) {
    console.error(`Invalid email: ${email}`)
    process.exit(1)
  }

  console.log(`\nAdding user: ${name} <${email}>  role=${role}  team=${team}`)
  console.log('─'.repeat(55))

  // ── 1. Create Supabase Auth account ──────────────────────────────────────────
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email,
    password:      TEMP_PASSWORD,
    email_confirm: true,
  })

  if (authErr) {
    if (authErr.message.toLowerCase().includes('already')) {
      console.log(`⚠  Auth account already exists for ${email}`)
      console.log('   Attempting to find existing auth ID and upsert public.users row...')

      // Try to list users and find by email
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 })
      const existing = list?.users?.find(u => u.email === email)
      if (!existing) {
        console.error('✗  Could not find existing auth user. Aborting.')
        process.exit(1)
      }
      await upsertDbUser(existing.id, name, email, role, team)
      return
    }
    console.error(`✗  Auth error: ${authErr.message}`)
    process.exit(1)
  }

  const authId = authData.user.id
  console.log(`✓  Auth account created  (id: ${authId})`)

  // ── 2. Insert into public.users ───────────────────────────────────────────────
  await upsertDbUser(authId, name, email, role, team)
}

async function upsertDbUser(authId, name, email, role, team) {
  // Check if a public.users row already exists
  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle()

  if (existing) {
    console.log(`⚠  public.users row already exists for ${email} — skipping DB insert`)
  } else {
    const { error: dbErr } = await sb.from('users').insert({
      name,
      email,
      role,
      auth_id:       authId,
      operator_team: team === 'none' ? null : team,
    })

    if (dbErr) {
      console.error(`✗  DB insert error: ${dbErr.message}`)
      process.exit(1)
    }
    console.log(`✓  public.users row created`)
  }

  console.log('\n── Done ───────────────────────────────────────────────')
  console.log(`  Name  : ${name}`)
  console.log(`  Email : ${email}`)
  console.log(`  Role  : ${role}`)
  console.log(`  Team  : ${team}`)
  console.log(`\n  Temp password: ${TEMP_PASSWORD}`)
  console.log('  Share with the agent — they can change it in Settings.')
  console.log('──────────────────────────────────────────────────────\n')
}

main().catch(err => { console.error(err); process.exit(1) })
