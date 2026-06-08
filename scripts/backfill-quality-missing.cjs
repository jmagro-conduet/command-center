// backfill-quality-missing.cjs
// Scores quality for any issues that have accuracy_ran_at set but quality_ran_at is null.
// Use after the main backfill when a mid-run migration caused some quality PATCHes to fail.
//
// Usage: node scripts/backfill-quality-missing.cjs

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE        = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY         = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const h           = { apikey: KEY, Authorization: 'Bearer ' + KEY }
const QUALITY_URL = BASE + '/functions/v1/eval-quality'
const BATCH       = 10

async function main() {
  // Find all issues with accuracy scored but quality missing
  const res = await fetch(
    BASE + '/rest/v1/ticket_issues?accuracy_ran_at=not.is.null&quality_ran_at=is.null&suggested_response=not.is.null&issue_type=neq.No response&select=id&order=created_at.asc&limit=1000',
    { headers: h }
  )
  const pending = await res.json()
  if (!Array.isArray(pending)) { console.error('Failed to fetch:', pending); process.exit(1) }
  console.log(`Found ${pending.length} issues missing quality scores`)
  if (pending.length === 0) { console.log('Nothing to do.'); return }

  const ids = pending.map(r => r.id)
  const totalBatches = Math.ceil(ids.length / BATCH)
  let ok = 0, fail = 0

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch    = ids.slice(i, i + BATCH)
    const batchNum = Math.floor(i / BATCH) + 1
    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} issues)... `)
    const r = await fetch(QUALITY_URL, {
      method:  'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: batch }),
    }).then(r => r.json())
    ok   += r.processed ?? 0
    fail += r.errors    ?? 0
    console.log(`quality=${r.processed ?? '?'}`)
  }

  console.log('\n── Quality backfill complete ──')
  console.log(`  Scored: ${ok}  (${fail} errors)`)
}

main().catch(console.error)
