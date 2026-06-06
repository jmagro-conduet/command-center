/**
 * Debug ZD query filters to find why Daniel's count is 98 vs 189 expected.
 * Usage: node scripts/debug-zd-query.cjs
 *
 * Tries progressively looser query variants and prints the total count + Daniel's share.
 * Requires ZENDESK_API_TOKEN and ZENDESK_EMAIL to be in .env.local
 * OR set them directly below.
 */

const fs   = require('fs')
const path = require('path')

// Load .env.local
const envPath = path.resolve(__dirname, '../.env.local')
const env = {}
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/)
    if (m) env[m[1].trim()] = m[2].trim()
  }
}

// ── Fill these in if not in .env.local ──────────────────────────────────────
const ZD_EMAIL = env.ZENDESK_EMAIL || ''
const ZD_TOKEN = env.ZENDESK_API_TOKEN || ''
// ─────────────────────────────────────────────────────────────────────────────

if (!ZD_EMAIL || !ZD_TOKEN) {
  console.error('Need ZENDESK_EMAIL and ZENDESK_API_TOKEN.')
  console.error('Add them to .env.local or set them at the top of this script.')
  process.exit(1)
}

const credentials = Buffer.from(`${ZD_EMAIL}/token:${ZD_TOKEN}`).toString('base64')
const zdHeaders = { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' }

const now = new Date()
const end_date   = now.toISOString().slice(0, 10)
const startD = new Date(now); startD.setDate(startD.getDate() - 30)
const start_date = startD.toISOString().slice(0, 10)

async function countQuery(label, query) {
  const url = `https://conduet.zendesk.com/api/v2/search/count.json?query=${encodeURIComponent(query)}`
  const res  = await fetch(url, { headers: zdHeaders })
  if (!res.ok) { console.error('ZD error', res.status, await res.text()); return null }
  const data = await res.json()
  return data.count ?? 0
}

async function danielCountQuery(label, query) {
  // Full paginated count for Daniel specifically
  let danielCount = 0
  let nextUrl = `https://conduet.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=100`
  const assigneeCounts = new Map()
  while (nextUrl) {
    const res  = await fetch(nextUrl, { headers: zdHeaders })
    if (!res.ok) break
    const data = await res.json()
    for (const t of data.results ?? []) {
      if (t.assignee_id) assigneeCounts.set(t.assignee_id, (assigneeCounts.get(t.assignee_id) ?? 0) + 1)
    }
    nextUrl = data.next_page ?? null
  }

  // Resolve IDs to names for any agents with 5+ tickets
  const ids = [...assigneeCounts.entries()].filter(([,c]) => c >= 5).map(([id]) => id)
  const agentNames = new Map()
  if (ids.length > 0) {
    const res = await fetch(`https://conduet.zendesk.com/api/v2/users/show_many.json?ids=${ids.join(',')}`, { headers: zdHeaders })
    if (res.ok) {
      const d = await res.json()
      for (const u of d.users ?? []) agentNames.set(u.id, u.name)
    }
  }

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`QUERY: ${label}`)
  console.log(`Total tickets: ${[...assigneeCounts.values()].reduce((a,b)=>a+b,0)}`)
  console.log('Top agents:')
  const sorted = [...assigneeCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10)
  for (const [id, count] of sorted) {
    const name = agentNames.get(id) ?? `ID:${id}`
    const isDaniel = name.toLowerCase().includes('daniel') || name.toLowerCase().includes('bestritsky')
    console.log(`  ${isDaniel ? '>>> ' : '    '}${name.padEnd(30)} ${count}`)
  }
}

async function main() {
  console.log(`Date range: ${start_date} → ${end_date}\n`)

  const queries = [
    // Current query
    ['Current (via:native_messaging + brand_id)',
      `type:ticket via:native_messaging brand_id:8399147779099 created>=${start_date} created<=${end_date}`],

    // Without via filter
    ['No via filter (brand_id only)',
      `type:ticket brand_id:8399147779099 created>=${start_date} created<=${end_date}`],

    // Without brand_id filter
    ['No brand_id (via:native_messaging only)',
      `type:ticket via:native_messaging created>=${start_date} created<=${end_date}`],

    // No channel/brand filters at all
    ['No filters (all ticket types, all brands)',
      `type:ticket created>=${start_date} created<=${end_date}`],

    // Daniel directly
    ['Daniel directly (assignee + no channel filter)',
      `type:ticket assignee:daniel.bestritsky@conduet.com created>=${start_date} created<=${end_date}`],
  ]

  // Quick count pass first
  console.log('Quick total counts:')
  for (const [label, query] of queries) {
    const count = await countQuery(label, query)
    console.log(`  ${count?.toString().padStart(5)}  ${label}`)
  }

  // Detailed breakdown for each query
  for (const [label, query] of queries) {
    await danielCountQuery(label, query)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
