// test-zd-details.cjs
// Tests the zd-ticket-details edge function on a small sample of tickets.
// Check the zd_message_count values against what you'd expect from ZD.
//
// Usage: node scripts/test-zd-details.cjs

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const ZD_FN    = 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/zd-ticket-details'
const h        = { apikey: KEY, Authorization: 'Bearer ' + KEY }

async function main() {
  // Pick 5 recent valid tickets to test against
  const res  = await fetch(
    BASE + '/rest/v1/tickets?select=id,ticket_number,agent_name&order=created_at.desc&limit=5',
    { headers: h }
  )
  const tickets = await res.json()

  console.log('Testing on these tickets:')
  tickets.forEach(t => console.log(`  #${t.ticket_number} — ${t.agent_name}`))
  console.log('')

  // Call the edge function
  const fnRes = await fetch(ZD_FN, {
    method:  'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      tickets: tickets.map(t => ({ supabase_id: t.id, ticket_number: t.ticket_number }))
    }),
  })

  const result = await fnRes.json()

  console.log(`Agent IDs loaded from ZD: ${result.agentIdsLoaded}`)
  console.log('')
  console.log('Results:')
  result.results?.forEach(r => {
    if (r.error) {
      console.log(`  #${r.ticket_number} → ERROR: ${r.error}`)
    } else {
      console.log(`  #${r.ticket_number} → ${r.zd_message_count} player message(s) | ZD created: ${r.zd_created_at?.slice(0,10)}`)
    }
  })

  console.log('')
  console.log('Check these counts against ZD — do they look right?')
  console.log('If yes, run: node scripts/backfill-zd-details.cjs')
}

main().catch(e => { console.error(e); process.exit(1) })
