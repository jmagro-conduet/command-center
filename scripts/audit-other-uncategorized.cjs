// audit-other-uncategorized.cjs
// Pulls all tickets where category is Other, Uncategorized, or blank
// so we can decide how to re-bucket them.

const SUPABASE_URL = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

async function query(params) {
  const url = `${SUPABASE_URL}/rest/v1/tickets?${params}&select=id,ticket_category,issue_type,customer_input,suggested_response,issue_comment,agent_name,logged_at`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function countAll() {
  const url = `${SUPABASE_URL}/rest/v1/tickets?select=ticket_category`
  const res = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } })
  const raw = await res.json()
  // tally
  const counts = {}
  for (const r of raw) {
    const cat = (r.ticket_category || '(blank)').trim()
    counts[cat] = (counts[cat] || 0) + 1
  }
  return counts
}

function truncate(str, n = 120) {
  if (!str) return '—'
  const s = str.replace(/\n/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

async function main() {
  // 1. Full category distribution
  console.log('=== FULL CATEGORY DISTRIBUTION ===')
  const counts = await countAll()
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  for (const [cat, n] of sorted) {
    console.log(`  ${String(n).padStart(4)}  ${cat}`)
  }

  // 2. Other tickets
  const otherRows = await query('ticket_category=ilike.other')
  console.log(`\n=== OTHER (${otherRows.length} tickets) ===`)
  for (const r of otherRows) {
    console.log(`\n[${r.id}] agent=${r.agent_name}  type=${r.issue_type}  date=${r.logged_at?.slice(0,10)}`)
    console.log(`  customer_input:     ${truncate(r.customer_input)}`)
    console.log(`  suggested_response: ${truncate(r.suggested_response)}`)
    if (r.issue_comment) console.log(`  issue_comment:      ${truncate(r.issue_comment)}`)
  }

  // 3. Uncategorized tickets
  const uncatRows = await query('ticket_category=ilike.uncategorized')
  console.log(`\n=== UNCATEGORIZED (${uncatRows.length} tickets) ===`)
  for (const r of uncatRows) {
    console.log(`\n[${r.id}] agent=${r.agent_name}  type=${r.issue_type}  date=${r.logged_at?.slice(0,10)}`)
    console.log(`  customer_input:     ${truncate(r.customer_input)}`)
    console.log(`  suggested_response: ${truncate(r.suggested_response)}`)
    if (r.issue_comment) console.log(`  issue_comment:      ${truncate(r.issue_comment)}`)
  }

  // 4. Blank / null category
  const blankRows = await query('ticket_category=is.null')
  console.log(`\n=== BLANK/NULL CATEGORY (${blankRows.length} tickets) ===`)
  for (const r of blankRows) {
    console.log(`\n[${r.id}] agent=${r.agent_name}  type=${r.issue_type}  date=${r.logged_at?.slice(0,10)}`)
    console.log(`  customer_input:     ${truncate(r.customer_input)}`)
    console.log(`  suggested_response: ${truncate(r.suggested_response)}`)
  }

  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
