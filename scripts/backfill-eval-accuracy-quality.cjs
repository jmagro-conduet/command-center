// backfill-eval-accuracy-quality.cjs
// Runs Eval 2 (accuracy) and Eval 3 (quality) on all ticket_issues from the
// last N days that have a suggested_response but haven't been scored yet.
//
// Usage: node scripts/backfill-eval-accuracy-quality.cjs
//        node scripts/backfill-eval-accuracy-quality.cjs --days=30
//        node scripts/backfill-eval-accuracy-quality.cjs --force   (re-score everything)

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE         = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY          = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const h            = { apikey: KEY, Authorization: 'Bearer ' + KEY }
const ACCURACY_URL = 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/eval-accuracy'
const QUALITY_URL  = 'https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/eval-quality'
const BATCH        = 10   // keep low — each issue makes a Claude API call
const FORCE        = process.argv.includes('--force')
const dayArg       = process.argv.find(a => a.startsWith('--days='))
const DAYS         = dayArg ? parseInt(dayArg.split('=')[1], 10) : 14

async function main() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - DAYS)
  console.log(`Backfilling last ${DAYS} days (since ${cutoff.toISOString().slice(0, 10)})`)

  if (FORCE) {
    process.stdout.write('  --force: resetting accuracy + quality scores... ')
    await fetch(BASE + `/rest/v1/ticket_issues?created_at=gte.${cutoff.toISOString()}&accuracy_ran_at=not.is.null`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ accuracy_error_class: null, accuracy_evidence: null, accuracy_reasoning: null, accuracy_human_review: null, accuracy_ran_at: null }),
    })
    await fetch(BASE + `/rest/v1/ticket_issues?created_at=gte.${cutoff.toISOString()}&quality_ran_at=not.is.null`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ quality_intent: null, quality_resolution: null, quality_info_gathering: null, quality_clarity: null, quality_brand: null, quality_score: null, quality_flag: null, quality_flag_reason: null, quality_ran_at: null }),
    })
    console.log('done ✓')
  }

  // Fetch all eligible issues: has suggested_response, not yet scored, within date window
  // Excludes "No response" issues (no suggested_response to score)
  let query = BASE + `/rest/v1/ticket_issues?created_at=gte.${cutoff.toISOString()}&suggested_response=not.is.null&issue_type=neq.No response&select=id,issue_type&order=created_at.asc&limit=1000`
  if (!FORCE) query += '&accuracy_ran_at=is.null'

  const res     = await fetch(query, { headers: h })
  const pending = await res.json()

  if (!Array.isArray(pending)) { console.error('Failed to fetch issues:', pending); process.exit(1) }
  console.log(`Found ${pending.length} issues to score`)
  if (pending.length === 0) { console.log('Nothing to do.'); return }

  const ids        = pending.map(r => r.id)
  const totalBatches = Math.ceil(ids.length / BATCH)
  let accOk = 0, accFail = 0, qualOk = 0, qualFail = 0

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch     = ids.slice(i, i + BATCH)
    const batchNum  = Math.floor(i / BATCH) + 1
    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} issues)... `)

    const [accRes, qualRes] = await Promise.all([
      fetch(ACCURACY_URL, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch }) }).then(r => r.json()),
      fetch(QUALITY_URL,  { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch }) }).then(r => r.json()),
    ])

    accOk   += accRes.processed  ?? 0
    accFail += accRes.errors     ?? 0
    qualOk  += qualRes.processed ?? 0
    qualFail += qualRes.errors   ?? 0

    console.log(`accuracy=${accRes.processed ?? '?'} quality=${qualRes.processed ?? '?'}`)
  }

  console.log('\n── Backfill complete ──────────────────────────')
  console.log(`  Accuracy scored:  ${accOk}  (${accFail} errors)`)
  console.log(`  Quality scored:   ${qualOk}  (${qualFail} errors)`)
}

main().catch(e => { console.error(e); process.exit(1) })
