// backfill-sentiment.cjs
// Classifies zd_last_player_message for all tickets that have a stored message
// but no sentiment verdict yet. Calls the eval-sentiment edge function in batches.
//
// Usage: node scripts/backfill-sentiment.cjs
//        node scripts/backfill-sentiment.cjs --force   (re-classify ALL messages)

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE   = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const h      = { apikey: KEY, Authorization: 'Bearer ' + KEY }
const FN_URL = 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/eval-sentiment'
const BATCH  = 50
const FORCE  = process.argv.includes('--force')

async function main() {
  if (FORCE) {
    process.stdout.write('  --force: resetting all existing sentiment verdicts... ')
    const resetRes = await fetch(BASE + '/rest/v1/tickets?zd_player_sentiment=not.is.null', {
      method:  'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body:    JSON.stringify({ zd_player_sentiment: null, zd_sentiment_confidence: null }),
    })
    console.log(resetRes.ok ? 'done ✓' : 'FAILED ' + resetRes.status)
  }

  // Count pending
  const countRes = await fetch(
    BASE + '/rest/v1/tickets?zd_last_player_message=not.is.null&zd_player_sentiment=is.null&select=id',
    { headers: h }
  )
  const pending = await countRes.json()
  console.log(`Found ${pending.length} tickets with messages awaiting sentiment classification`)
  if (pending.length === 0) { console.log('Nothing to do.'); return }

  let processed = 0, skipped = 0, errors = 0, batch = 1
  const totalBatches = Math.ceil(pending.length / BATCH)

  while (true) {
    process.stdout.write(`  Batch ${batch}/${totalBatches}... `)

    const res    = await fetch(FN_URL, {
      method:  'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ limit: BATCH }),
    })
    const result = await res.json()

    if (!res.ok) {
      console.log('ERROR', result.error ?? res.status)
      errors += BATCH
    } else {
      console.log(`processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`)
      processed += result.processed ?? 0
      skipped   += result.skipped   ?? 0
      errors    += result.errors    ?? 0
    }

    // Stop when there's nothing left to process
    if ((result.processed ?? 0) === 0) break
    batch++
  }

  console.log('\n── Backfill complete ──────────────────────────')
  console.log(`  Classified: ${processed}`)
  console.log(`  Skipped:    ${skipped}`)
  console.log(`  Errors:     ${errors}`)

  const vRes      = await fetch(BASE + '/rest/v1/tickets?zd_last_player_message=not.is.null&zd_player_sentiment=is.null&select=id', { headers: h })
  const remaining = await vRes.json()
  console.log(`  Remaining:  ${remaining.length}`)
  if (remaining.length === 0) console.log('  All clean ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
