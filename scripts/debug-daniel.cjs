/**
 * Debug script: Compare Daniel Bestritsky's ZD ticket count vs gameLM ticket count
 * Usage: node scripts/debug-daniel.cjs
 */

const { createClient } = require('../node_modules/@supabase/supabase-js')

const SUPABASE_URL      = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const ANON_KEY          = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTU4MjksImV4cCI6MjA5MDQ5MTgyOX0.hz75aFhXeL5yRkbwn1tmHd37D2omQ3wR8LbOG6pJpzI'

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  // 1. Get today's date range (last 30 days) — same as Analytics page
  const now = new Date()
  const end_date = now.toISOString().slice(0, 10)
  const startD = new Date(now)
  startD.setDate(startD.getDate() - 30)
  const start_date = startD.toISOString().slice(0, 10)

  console.log(`Date range: ${start_date} → ${end_date}\n`)

  // 2. Call edge function to get ZD data
  console.log('Fetching ZD data from edge function...')
  const edgeRes = await fetch(
    `${SUPABASE_URL}/functions/v1/zendesk-tickets`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ start_date, end_date }),
    }
  )

  if (!edgeRes.ok) {
    console.error('Edge function error:', edgeRes.status, await edgeRes.text())
    process.exit(1)
  }

  const zdData = await edgeRes.json()
  console.log(`ZD total count: ${zdData.count}`)
  console.log(`ZD agents returned: ${zdData.agents?.length ?? 0}`)

  // Find Daniel
  const daniel = zdData.agents?.find(a =>
    a.name.toLowerCase().includes('daniel') || a.name.toLowerCase().includes('bestritsky')
  )
  console.log('\n--- Daniel in ZD response ---')
  if (daniel) {
    console.log(`  Name:  ${daniel.name}`)
    console.log(`  Email: ${daniel.email}`)
    console.log(`  ZD ticket count: ${daniel.count}`)
  } else {
    console.log('  NOT FOUND in ZD agents list!')
    // Show all agents for context
    console.log('\n  All ZD agents:')
    for (const a of zdData.agents ?? []) {
      console.log(`    ${a.name} (${a.email}) — ${a.count} tickets`)
    }
  }

  // 3. Query gameLM DB for Daniel's tickets in last 30 days
  console.log('\n--- Daniel in gameLM DB ---')
  const cutoffISO = startD.toISOString()

  const { data: danielIssues, error } = await sb
    .from('ticket_issues')
    .select('ticket_id, tickets!inner(ticket_number, agent_name, agent_email)')
    .gte('logged_at', cutoffISO)

  if (error) { console.error('DB error:', error.message); process.exit(1) }

  // Filter for Daniel by agent_name
  const danielRows = (danielIssues ?? []).filter(row => {
    const name = (row.tickets?.agent_name ?? '').toLowerCase()
    return name.includes('daniel') || name.includes('bestritsky')
  })

  const danielTicketIds = new Set(danielRows.map(r => r.ticket_id))
  const danielTicketNumbers = new Set(danielRows.map(r => r.tickets?.ticket_number).filter(Boolean))

  console.log(`  Matching DB rows (issues): ${danielRows.length}`)
  console.log(`  Unique ticket_ids: ${danielTicketIds.size}`)
  console.log(`  Unique ticket_numbers: ${danielTicketNumbers.size}`)

  // Show unique agent names that matched
  const danielNames = [...new Set(danielRows.map(r => r.tickets?.agent_name).filter(Boolean))]
  console.log(`  Agent name variants in DB: ${JSON.stringify(danielNames)}`)

  // 4. Also check what agent names contain "daniel" in tickets table
  console.log('\n--- All "daniel" entries in tickets table ---')
  const { data: danielTickets } = await sb
    .from('tickets')
    .select('agent_name, agent_email, ticket_number')
    .ilike('agent_name', '%daniel%')
    .order('agent_name')

  const nameGroups = {}
  for (const t of danielTickets ?? []) {
    const key = `${t.agent_name} | ${t.agent_email}`
    nameGroups[key] = (nameGroups[key] ?? 0) + 1
  }
  for (const [key, count] of Object.entries(nameGroups)) {
    console.log(`  "${key}" — ${count} tickets total in DB`)
  }

  // 5. Summary
  console.log('\n=== SUMMARY ===')
  const zdCount = daniel?.count ?? 0
  console.log(`ZD tickets (last 30d):    ${zdCount}`)
  console.log(`gameLM tickets (last 30d): ${danielTicketNumbers.size}`)
  if (danielTicketNumbers.size > 0 && zdCount > 0) {
    const pct = ((danielTicketNumbers.size / zdCount) * 100).toFixed(1)
    console.log(`Adoption %:               ${pct}%`)
    if (danielTicketNumbers.size > zdCount) {
      console.log('\n⚠  gameLM count EXCEEDS ZD count — ZD count is too low')
      console.log('   Possible causes:')
      console.log('   1. Some ZD tickets have null assignee_id (unassigned)')
      console.log('   2. Tickets assigned via group, not directly to Daniel')
      console.log('   3. brand_id or via:native_messaging filter is too narrow')
      console.log('   4. ZD search API pagination not returning all results')
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
