import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

const SUPABASE_URL = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const CSV_PATH = 'C:\\Users\\JohnMagro\\Downloads\\gamelm_feedback_2026-04-27 (1).csv'

function parseTimestamp(ts) {
  // "4/27/2026, 1:56:05 PM" → ISO string
  const d = new Date(ts)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

async function run() {
  const raw = readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, '')
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
  console.log(`Parsed ${rows.length} CSV rows`)

  // Group rows by ticket number — one tickets row per unique ticket
  const ticketMap = new Map()
  for (const row of rows) {
    const key = row['Ticket']
    if (!ticketMap.has(key)) {
      ticketMap.set(key, {
        ticket_number: row['Ticket'],
        ticket_category: row['Category'] || '',
        agent_name: row['Agent'] || '',
        agent_email: row['Email'] || '',
        agent_team: row['Team'] || null,
        notes: row['Notes'] || '',
        created_at: parseTimestamp(row['Timestamp']),
        issues: []
      })
    }
    ticketMap.get(key).issues.push({
      issue_type: row['Issue type'] || '',
      issue_comment: row['Suggested Response'] || '',
      reasoning: row['Reasoning'] || null,
      final_edits: row['Final Edits'] || null,
      customer_input: row['Customer Input'] || null,
      logged_at: parseTimestamp(row['Timestamp']),
    })
  }

  const tickets = [...ticketMap.values()]
  console.log(`Unique tickets: ${tickets.length}`)

  let ticketsInserted = 0
  let issuesInserted = 0
  let errors = 0

  // Insert in batches of 50
  const BATCH = 50
  for (let i = 0; i < tickets.length; i += BATCH) {
    const batch = tickets.slice(i, i + BATCH)

    const ticketPayload = batch.map(({ issues: _issues, ...t }) => t)
    const { data: insertedTickets, error: ticketErr } = await supabase
      .from('tickets')
      .insert(ticketPayload)
      .select('id, ticket_number')

    if (ticketErr) {
      console.error(`Ticket batch ${i}–${i + BATCH} error:`, ticketErr.message)
      errors++
      continue
    }

    ticketsInserted += insertedTickets.length

    // Build ticket_issues payload using the returned IDs
    const issuePayload = []
    for (const inserted of insertedTickets) {
      const src = ticketMap.get(inserted.ticket_number)
      for (const issue of src.issues) {
        issuePayload.push({ ticket_id: inserted.id, ...issue })
      }
    }

    const { data: insertedIssues, error: issueErr } = await supabase
      .from('ticket_issues')
      .insert(issuePayload)
      .select('id')

    if (issueErr) {
      console.error(`Issue batch error (tickets ${i}–${i + BATCH}):`, issueErr.message)
      errors++
    } else {
      issuesInserted += insertedIssues.length
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH, tickets.length)}/${tickets.length} tickets`)
  }

  console.log('\n')
  console.log('── Import complete ────────────────────')
  console.log(`  Tickets inserted:      ${ticketsInserted}`)
  console.log(`  Ticket issues inserted: ${issuesInserted}`)
  console.log(`  Errors:                ${errors}`)
  console.log('───────────────────────────────────────')

  // Verify counts
  const { count: tCount } = await supabase.from('tickets').select('*', { count: 'exact', head: true })
  const { count: iCount } = await supabase.from('ticket_issues').select('*', { count: 'exact', head: true })
  console.log(`  DB tickets total:      ${tCount}`)
  console.log(`  DB ticket_issues total: ${iCount}`)
}

run().catch(console.error)
