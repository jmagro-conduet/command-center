// backfill-evals.cjs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // bypass corporate SSL proxy
// Runs the eval-issue edge function across all Majority/Partial edit rows
// from the last 30 days that have final_edits populated but no eval verdict yet.
//
// Usage: node scripts/backfill-evals.cjs [--days=14]

const BASE     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const EVAL_URL = 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/eval-issue-v2'
const h        = { apikey: KEY, Authorization: 'Bearer ' + KEY }
const BATCH    = 20   // IDs per edge function call

const arg   = process.argv.find(a => a.startsWith('--days='))
const DAYS  = arg ? parseInt(arg.split('=')[1], 10) : 30
const FORCE = process.argv.includes('--force')

async function main() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - DAYS)
  console.log(`Backfilling evals for last ${DAYS} days (since ${cutoff.toISOString().slice(0, 10)})${FORCE ? ' [--force: clearing existing verdicts]' : ''}`)

  // If --force, clear existing verdicts first so they get re-evaluated
  if (FORCE) {
    process.stdout.write('  Clearing existing verdicts... ')
    const clearRes = await fetch(
      BASE + '/rest/v1/ticket_issues'
        + '?issue_type=in.(Majority edit,Partial edit)'
        + '&eval_verdict=not.is.null'
        + '&logged_at=gte.' + cutoff.toISOString(),
      {
        method:  'PATCH',
        headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body:    JSON.stringify({ eval_verdict: null, eval_confidence: null, eval_reasoning: null, eval_ran_at: null }),
      }
    )
    console.log(clearRes.ok ? 'done ✓' : 'FAILED ' + clearRes.status)
  }

  // Fetch all eligible rows: Majority/Partial, final_edits present, not yet evaluated
  let rows = []
  let from  = 0
  while (true) {
    const url = BASE + '/rest/v1/ticket_issues'
      + '?issue_type=in.(Majority edit,Partial edit)'
      + '&final_edits=not.is.null'
      + '&final_edits=neq.'
      + '&eval_verdict=is.null'
      + '&logged_at=gte.' + cutoff.toISOString()
      + '&select=id'
      + '&order=logged_at.asc'
      + '&offset=' + from + '&limit=1000'
    const res  = await fetch(url, { headers: h })
    const data = await res.json()
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  console.log(`Found ${rows.length} rows to evaluate`)
  if (rows.length === 0) { console.log('Nothing to do.'); return }

  let totalProcessed = 0, totalSkipped = 0, totalErrors = 0

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => r.id)
    process.stdout.write(`  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)} (${i + 1}–${Math.min(i + BATCH, rows.length)} of ${rows.length})... `)

    const res  = await fetch(EVAL_URL, {
      method:  'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: batch }),
    })
    const result = await res.json()

    if (!res.ok) {
      console.log('ERROR', result.error ?? res.status)
      totalErrors += batch.length
    } else {
      console.log(`processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`)
      totalProcessed += result.processed ?? 0
      totalSkipped   += result.skipped   ?? 0
      totalErrors    += result.errors    ?? 0
      if (result.errorList?.length) result.errorList.forEach(e => console.log('    ⚠', e))
    }
  }

  console.log('\n── Backfill complete ──────────────────────')
  console.log(`  Evaluated:  ${totalProcessed}`)
  console.log(`  Skipped:    ${totalSkipped}`)
  console.log(`  Errors:     ${totalErrors}`)

  // Verify
  const vRes  = await fetch(
    BASE + '/rest/v1/ticket_issues?issue_type=in.(Majority edit,Partial edit)&final_edits=not.is.null&final_edits=neq.&eval_verdict=is.null&logged_at=gte.' + cutoff.toISOString() + '&select=id',
    { headers: h }
  )
  const remaining = await vRes.json()
  console.log(`  Remaining unevaluated: ${remaining.length}`)
  if (remaining.length === 0) console.log('  All clean ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
