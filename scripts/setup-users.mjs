import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const TEMP_PASSWORD     = 'Conduet2026!'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const USERS = [
  // Admins
  { name: 'John Magro',           email: 'john.magro@conduet.com',      role: 'admin', team: null },
  { name: 'Test Account',         email: 'test@conduet.com',            role: 'agent', team: null },
  // Agents from CSV
  { name: 'Brandon Ebanks',       email: 'brandon.ebanks@conduet.com',  role: 'agent', team: 'BetSaracen' },
  { name: 'Mark Pagaduan',        email: 'mark.pagaduan@conduet.cx',    role: 'agent', team: 'BetSaracen' },
  { name: 'Daniel Bestritsky',    email: 'daniel.bestritsky@conduet.com', role: 'agent', team: 'BetSaracen' },
  { name: 'Rocelle Ostia',        email: 'rocelle.ostia@conduet.cx',    role: 'agent', team: 'BetSaracen' },
  { name: 'Michael Ryan',         email: 'michael.ryan@conduet.com',    role: 'agent', team: 'BetSaracen' },
  { name: 'Giovanni Nieves',      email: 'giovanni.nieves@conduet.com', role: 'agent', team: 'BetSaracen' },
  { name: 'Michael Joven',        email: 'michael.joven@conduet.cx',    role: 'agent', team: 'BetSaracen' },
  { name: 'Riley Kitts',          email: 'riley.kitts@conduet.com',     role: 'agent', team: 'BetSaracen' },
  { name: 'Jomare Leonardia',     email: 'jomare.leonardia@conduet.cx', role: 'agent', team: 'BetSaracen' },
  { name: 'Luke Tyler',           email: 'luke.tyler@conduet.com',      role: 'agent', team: 'BetSaracen' },
  { name: 'Reynold Laurente',     email: 'reynold.laurente@conduet.cx', role: 'agent', team: 'BetSaracen' },
]

async function run() {
  console.log(`Creating ${USERS.length} users...\n`)

  // Seed operator_teams table
  await supabase.from('operator_teams').insert({ name: 'BetSaracen', active: true }).select()

  let created = 0, skipped = 0, errors = 0

  for (const u of USERS) {
    // 1. Create Supabase Auth account
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: u.email,
      password: TEMP_PASSWORD,
      email_confirm: true,
    })

    if (authErr) {
      if (authErr.message.includes('already been registered')) {
        process.stdout.write(`  ⚠  ${u.email} — auth account already exists, skipping\n`)
        skipped++
        continue
      }
      process.stdout.write(`  ✗  ${u.email} — auth error: ${authErr.message}\n`)
      errors++
      continue
    }

    const authId = authData.user.id

    // 2. Insert into public.users
    const { error: dbErr } = await supabase.from('users').insert({
      name:          u.name,
      email:         u.email,
      role:          u.role,
      auth_id:       authId,
      operator_team: u.team,
    })

    if (dbErr) {
      process.stdout.write(`  ✗  ${u.email} — DB error: ${dbErr.message}\n`)
      errors++
      continue
    }

    process.stdout.write(`  ✓  ${u.email} (${u.role})\n`)
    created++
  }

  console.log('\n── Setup complete ─────────────────────')
  console.log(`  Created: ${created}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Errors:  ${errors}`)
  console.log('───────────────────────────────────────')
  console.log(`\n  Temp password for all accounts: ${TEMP_PASSWORD}`)
  console.log('  Share with agents — they can change it in Settings.\n')
}

run().catch(console.error)
