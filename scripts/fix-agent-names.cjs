// fix-agent-names.cjs
// Normalizes agent_name in tickets table to match canonical names in users table
// Run: node scripts/fix-agent-names.cjs

const SUPABASE_URL = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'

const RENAMES = [
  { from: 'Luke T',                 to: 'Luke Tyler' },
  { from: 'Brandon Ebanks',         to: 'Brandon E.' },
  { from: 'Mark',                   to: 'Mark Pagaduan' },
  { from: 'Rocelle',                to: 'Rocelle Ostia' },
  { from: 'Reynold II A. Laurente', to: 'Reynold Laurente' },
]

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function countRows(agentName) {
  const url = `${SUPABASE_URL}/rest/v1/tickets?agent_name=eq.${encodeURIComponent(agentName)}&select=id`
  const res = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } })
  const count = res.headers.get('content-range')?.split('/')[1] ?? '?'
  return count
}

async function renameAgent(from, to) {
  const url = `${SUPABASE_URL}/rest/v1/tickets?agent_name=eq.${encodeURIComponent(from)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ agent_name: to }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res
}

async function main() {
  console.log('Agent name normalization script\n')

  for (const { from, to } of RENAMES) {
    try {
      const count = await countRows(from)
      console.log(`"${from}" → "${to}"  (${count} rows)`)
      await renameAgent(from, to)
      console.log(`  ✓ Updated`)
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`)
    }
  }

  console.log('\nVerification pass:')
  for (const { from, to } of RENAMES) {
    const remaining = await countRows(from)
    const done = await countRows(to)
    console.log(`  "${from}": ${remaining} remaining  |  "${to}": ${done} rows`)
  }

  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
