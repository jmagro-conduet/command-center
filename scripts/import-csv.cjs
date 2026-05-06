/**
 * Import a gamelm_feedback CSV into Supabase.
 * Usage: node scripts/import-csv.cjs <path-to-csv>
 *
 * - Timestamps in the CSV are treated as US Eastern (EDT = UTC-4 in May)
 * - Only imports rows newer than the most recent logged_at already in the DB
 * - Reuses existing ticket rows where ticket_number already exists
 */

const fs   = require('fs')
const path = require('path')
const { createClient } = require('../node_modules/@supabase/supabase-js')

const SUPABASE_URL     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const EST_OFFSET_HOURS = -4   // May = EDT (UTC-4)

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []
  let field = '', row = [], inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuote = false
      else field += ch
    } else {
      if (ch === '"') inQuote = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') {
        row.push(field); field = ''
        if (row.some(f => f.trim())) rows.push(row)
        row = []
      } else if (ch === '\r') { /* skip */ }
      else field += ch
    }
  }
  if (field || row.length) { row.push(field); if (row.some(f => f.trim())) rows.push(row) }
  return rows
}

// Parse "M/D/YYYY, H:MM:SS AM/PM" in Eastern time -> ISO UTC string
function parseESTtoUTC(str) {
  const m = (str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let [, mo, d, y, h, min, sec, ap] = m
  h = parseInt(h)
  if (ap.toUpperCase() === 'PM' && h !== 12) h += 12
  if (ap.toUpperCase() === 'AM' && h === 12) h = 0
  const utc = new Date(Date.UTC(+y, +mo - 1, +d, h, +min, +sec))
  utc.setUTCHours(utc.getUTCHours() - EST_OFFSET_HOURS)
  return utc.toISOString()
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) { console.error('Usage: node scripts/import-csv.cjs <path-to-csv>'); process.exit(1) }

  // 1. Find the cutoff: newest logged_at already in the DB
  const { data: newest } = await sb.from('ticket_issues')
    .select('logged_at').order('logged_at', { ascending: false }).limit(1)
  const cutoff = newest?.[0]?.logged_at ?? '1970-01-01T00:00:00Z'
  console.log('Last imported timestamp:', cutoff)

  // 2. Parse CSV and keep only rows newer than cutoff
  const text    = fs.readFileSync(path.resolve(csvPath), 'utf8')
  const rows    = parseCSV(text)
  const headers = rows[0].map(h => h.trim())
  const allData = rows.slice(1)
  console.log('CSV rows total:', allData.length)

  const col = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase())
  const iTs = col('Timestamp'), iAgent = col('Agent'), iEmail = col('Email')
  const iTeam = col('Team'), iTicket = col('Ticket'), iCategory = col('Category')
  const iType = col('Issue type'), iCust = col('Customer Input')
  const iSugg = col('Suggested Response'), iReas = col('Reasoning')
  const iFin  = col('Final Edits'), iNotes = col('Notes')

  const newRows = allData
    .map(r => ({ r, ts: parseESTtoUTC(r[iTs]) }))
    .filter(({ ts }) => ts && ts > cutoff)

  console.log('New rows to import:', newRows.length)
  if (newRows.length === 0) { console.log('Nothing to import — DB is already up to date.'); return }

  // 3. Resolve ticket_number -> ticket id (reuse existing, insert new)
  const newTicketNumbers = [...new Set(newRows.map(({ r }) => r[iTicket]?.trim()).filter(Boolean))]
  const existingMap = new Map()

  for (let i = 0; i < newTicketNumbers.length; i += 200) {
    const batch = newTicketNumbers.slice(i, i + 200)
    const { data: found } = await sb.from('tickets').select('id,ticket_number').in('ticket_number', batch)
    for (const t of (found ?? [])) {
      if (!existingMap.has(t.ticket_number)) existingMap.set(t.ticket_number, t.id)
    }
  }

  const toInsert = newTicketNumbers.filter(n => !existingMap.has(n))
  if (toInsert.length > 0) {
    console.log('Inserting', toInsert.length, 'new tickets...')
    const ticketRows = toInsert.map(num => {
      const { r } = newRows.find(({ r }) => r[iTicket]?.trim() === num)
      return {
        ticket_number:   num,
        ticket_category: r[iCategory]?.trim() || null,
        agent_name:      r[iAgent]?.trim()    || null,
        agent_email:     r[iEmail]?.trim()    || null,
        agent_team:      r[iTeam]?.trim()     || null,
      }
    })
    for (let i = 0; i < ticketRows.length; i += 100) {
      const { data: ins, error } = await sb.from('tickets').insert(ticketRows.slice(i, i + 100)).select('id,ticket_number')
      if (error) { console.error('Ticket insert error:', error.message); process.exit(1) }
      for (const t of (ins ?? [])) existingMap.set(t.ticket_number, t.id)
    }
    console.log(' v', toInsert.length, 'new tickets inserted')
  } else {
    console.log('All ticket numbers already exist — reusing IDs')
  }

  // 4. Insert ticket_issues
  const issues = []
  for (const { r, ts } of newRows) {
    const num = r[iTicket]?.trim()
    const ticketId = existingMap.get(num)
    if (!ticketId) { console.warn('No ticket ID for:', num); continue }
    issues.push({
      ticket_id:          ticketId,
      logged_at:          ts,
      issue_type:         r[iType]?.trim()  || null,
      suggested_response: r[iSugg]?.trim()  || null,
      customer_input:     r[iCust]?.trim()  || null,
      reasoning:          r[iReas]?.trim()  || null,
      final_edits:        r[iFin]?.trim()   || null,
      issue_comment:      r[iNotes]?.trim() || null,
    })
  }

  console.log('Inserting', issues.length, 'ticket_issues...')
  let inserted = 0
  for (let i = 0; i < issues.length; i += 100) {
    const { error } = await sb.from('ticket_issues').insert(issues.slice(i, i + 100))
    if (error) { console.error('Issue insert error:', error.message); process.exit(1) }
    inserted += Math.min(100, issues.length - i)
    process.stdout.write('\r  ' + inserted + '/' + issues.length)
  }
  console.log('\n  v', inserted, 'ticket_issues inserted')

  const { count } = await sb.from('ticket_issues').select('*', { count: 'exact', head: true })
  console.log('\nDone. Total ticket_issues in DB:', count)
}

main().catch(err => { console.error(err); process.exit(1) })
