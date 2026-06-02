// backfill-zd-details.cjs
// Populates zd_created_at and zd_message_count on all tickets
// that don't have it yet.
//
// Usage: node scripts/backfill-zd-details.cjs [--days=30]
//        omit --days to process ALL tickets

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // bypass corporate SSL proxy

const BASE     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const h        = { apikey: KEY, Authorization: 'Bearer ' + KEY }

// ⚠️ Update this URL after deploying zd-ticket-details via the Supabase dashboard
const ZD_FN_URL = 'REPLACE_WITH_ZD_TICKET_DETAILS_FUNCTION_URL'

const BATCH = 10  // keep low to respect ZD rate limits

const arg  = process.argv.find(a => a.startsWith('--days='))
const DAYS = arg ? parseInt(arg.split('=')[1], 10) : null

async function main() {
  if (ZD_FN_URL === 'REPLACE_WITH_ZD_TICKET_DETAILS_FUNCTION_URL') {
    console.error('❌  Update ZD_FN_URL in this script with the deployed function URL first.')
    process.exit(1)
  }

  let query = BASE + '/rest/v1/tickets?zd_message_count=is.null&select=id,ticket_number,created_at&order=created_at.desc'
  if (DAYS) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - DAYS)
    query += '&created_at=gte.' + cutoff.toISOString()
    console.log(`Processing tickets from last ${DAYS} days`)
  } else {
    console.log('Processing all tickets without zd_message_count')
  }

  // Fetch all eligible tickets
  let tickets = []
  let from = 0
  while (true) {
    const res  = await fetch(query + '&offset=' + from + '&limit=1000', { headers: h })
    const data = await res.json()
    if (!data || data.length === 0) break
    tickets.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  // Filter out non-6-digit ticket numbers
  const valid   = tickets.filter(t => /^\d{5,7}$/.test(t.ticket_number))
  const invalid = tickets.length - valid.length
  console.log(`Found ${tickets.length} tickets (${valid.length} valid, ${invalid} skipped — bad numbers)`)

  if (valid.length === 0) { console.log('Nothing to do.'); return }

  let totalOk = 0, totalFailed = 0

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH).map(t => ({ supabase_id: t.id, ticket_number: t.ticket_number }))
    process.stdout.write(`  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(valid.length / BATCH)} (${i + 1}–${Math.min(i + BATCH, valid.length)} of ${valid.length})... `)

    const res    = await fetch(ZD_FN_URL, {
      method:  'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tickets: batch }),
    })
    const result = await res.json()

    if (!res.ok) {
      console.log('ERROR', result.error ?? res.status)
      totalFailed += batch.length
    } else {
      console.log(`ok=${result.processed} failed=${result.failed}`)
      totalOk     += result.processed ?? 0
      totalFailed += result.failed    ?? 0
      // Log any individual failures
      result.results?.filter(r => r.error).forEach(r =>
        console.log(`    ⚠  ${r.ticket_number}: ${r.error}`)
      )
    }
  }

  console.log('\n── Backfill complete ──────────────────────────')
  console.log(`  Populated:  ${totalOk}`)
  console.log(`  Failed:     ${totalFailed}`)

  // Verify
  const vRes  = await fetch(BASE + '/rest/v1/tickets?zd_message_count=is.null&select=id', { headers: h })
  const remaining = await vRes.json()
  console.log(`  Remaining without count: ${remaining.length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
