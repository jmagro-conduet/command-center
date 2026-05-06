/**
 * Import a gamelm_feedback CSV into Supabase.
 * Usage: node scripts/import-csv.js <path-to-csv>
 *
 * - Timestamps in the CSV are treated as US Eastern (EDT = UTC-4 in May)
 * - Upserts tickets by ticket_number to avoid duplicates
 * - Inserts ticket_issues; skips exact duplicates (same ticket + logged_at + issue_type)
 */

const fs   = require('fs')
const path = require('path')
const { createClient } = require('./node_modules/@supabase/supabase-js')

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
// EST/EDT offset — May is EDT (UTC-4)
const EST_OFFSET_HOURS = -4

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── CSV parser (handles quoted fields with embedded commas/newlines) ───────────
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
      if (ch === '"') { inQuote = true }
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

// Parse "M/D/YYYY, H:MM:SS AM/PM" as US Eastern and return ISO UTC string
function parseESTtoUTC(str) {
  str = str.trim()
  // e.g. "5/6/2026, 10:43:35 AM"
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let [, mo, d, y, h, min, sec, ap] = m
  h = parseInt(h); if (ap.toUpperCase() === 'PM' && h !== 12) h += 12; if (ap.toUpperCase() === 'AM' && h === 12) h = 0
  // Build UTC by subtracting EST offset
  const local = new Date(Date.UTC(+y, +mo - 1, +d, h, +min, +sec))
  local.setUTCHours(local.getUTCHours() - EST_OFFSET_HOURS)  // subtract -4 = add 4
  return local.toISOString()
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) { console.error('Usage: node scripts/import-csv.js <path-to-csv>'); process.exit(1) }

  const text = fs.readFileSync(path.resolve(csvPath), 'utf8')
  const rows = parseCSV(text)
  const headers = rows[0].map(h => h.trim())
  const data    = rows.slice(1)

  console.log(`Parsed ${data.length} data rows from ${path.basename(csvPath)}`)

  // Map header names → indices
  const col = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase())
  const iTimestamp = col('Timestamp'), iAgent = col('Agent'), iEmail = col('Email')
  const iTeam = col('Team'), iTicket = col('Ticket'), iCategory = col('Category')
  const iIssueType = col('Issue type'), iCustomer = col('Customer Input')
  const iSuggested = col('Suggested Response'), iReasoning = col('Reasoning')
  const iFinalEdits = col('Final Edits'), iNotes = col('Notes')

  // ── Step 1: upsert tickets (grouped by ticket_number) ────────────────────
  const ticketMap = new Map() // ticket_number → { agent_name, agent_email, agent_team, ticket_category }
  for (const r of data) {
    const num = r[iTicket]?.trim()
    if (!num) continue
    if (!ticketMap.has(num)) {
      ticketMap.set(num, {
        ticket_number:   num,
        ticket_category: r[iCategory]?.trim() || null,
        agent_name:      r[iAgent]?.trim()    || null,
        agent_email:     r[iEmail]?.trim()    || null,
        agent_team:      r[iTeam]?.trim()     || null,
      })
    }
  }

  const ticketsToUpsert = [...ticketMap.values()]
  console.log(`Upserting ${ticketsToUpsert.length} unique tickets…`)

  // Upsert in batches of 100
  let ticketInserted = 0, ticketUpdated = 0
  for (let i = 0; i < ticketsToUpsert.length; i += 100) {
    const batch = ticketsToUpsert.slice(i, i + 100)
    const { error } = await sb.from('tickets').upsert(batch, { onConflict: 'ticket_number', ignoreDuplicates: false })
    if (error) { console.error('Ticket upsert error:', error.message); process.exit(1) }
    ticketInserted += batch.length
  }
  console.log(`  ✓ ${ticketInserted} tickets upserted`)

  // ── Step 2: fetch ticket IDs for the numbers we just upserted ─────────────
  const ticketNumbers = [...ticketMap.keys()]
  const idMap = new Map() // ticket_number → uuid
  for (let i = 0; i < ticketNumbers.length; i += 200) {
    const batch = ticketNumbers.slice(i, i + 200)
    const { data: rows, error } = await sb.from('tickets').select('id,ticket_number').in('ticket_number', batch)
    if (error) { console.error('Ticket fetch error:', error.message); process.exit(1) }
    for (const r of rows) idMap.set(r.ticket_number, r.id)
  }

  // ── Step 3: build ticket_issues rows ──────────────────────────────────────
  const issues = []
  for (const r of data) {
    const num = r[iTicket]?.trim()
    const ticketId = idMap.get(num)
    if (!ticketId) { console.warn('  ⚠ No ticket found for number:', num); continue }

    const loggedAt = parseESTtoUTC(r[iTimestamp] || '')
    if (!loggedAt) { console.warn('  ⚠ Could not parse timestamp:', r[iTimestamp]); continue }

    const issueType = r[iIssueType]?.trim() || null
    const custInput = r[iCustomer]?.trim()  || null
    const suggested = r[iSuggested]?.trim() || null
    const reasoning = r[iReasoning]?.trim() || null
    const finalEdits = r[iFinalEdits]?.trim() || null
    const notes     = r[iNotes]?.trim()     || null

    issues.push({
      ticket_id:         ticketId,
      logged_at:         loggedAt,
      issue_type:        issueType,
      suggested_response: suggested,
      customer_input:    custInput,
      reasoning:         reasoning,
      final_edits:       finalEdits,
      issue_comment:     notes,
    })
  }

  console.log(`Inserting ${issues.length} ticket_issues rows…`)

  // Insert in batches; use ignoreDuplicates to skip exact re-imports safely
  let issueInserted = 0
  for (let i = 0; i < issues.length; i += 100) {
    const batch = issues.slice(i, i + 100)
    const { error, data: inserted } = await sb.from('ticket_issues').insert(batch, { count: 'exact' })
    if (error) {
      // If it's a unique constraint violation, try one-by-one to skip dupes
      if (error.code === '23505') {
        for (const row of batch) {
          const { error: e2 } = await sb.from('ticket_issues').insert(row)
          if (e2 && e2.code !== '23505') console.error('  Issue insert error:', e2.message)
          else if (!e2) issueInserted++
        }
      } else {
        console.error('Issue insert error:', error.message)
        process.exit(1)
      }
    } else {
      issueInserted += batch.length
    }
  }

  console.log(`  ✓ ${issueInserted} ticket_issues inserted`)

  // ── Final count ────────────────────────────────────────────────────────────
  const { count } = await sb.from('ticket_issues').select('*', { count: 'exact', head: true })
  console.log(`\nDone. Total ticket_issues in DB: ${count}`)
}

main().catch(err => { console.error(err); process.exit(1) })
