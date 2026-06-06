/**
 * Test different ZD query variants via the edge function to find Daniel's 189 tickets.
 * Usage: node scripts/debug-zd-variants.cjs
 */
const https = require('https')

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTU4MjksImV4cCI6MjA5MDQ5MTgyOX0.hz75aFhXeL5yRkbwn1tmHd37D2omQ3wR8LbOG6pJpzI'
const HOST = 'uepigbagbaskbslpjeqq.supabase.co'
const PATH = '/functions/v1/zendesk-tickets'

const now   = new Date()
const end   = now.toISOString().slice(0, 10)
const startD = new Date(now); startD.setDate(startD.getDate() - 30)
const start = startD.toISOString().slice(0, 10)

function post(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request({
      hostname: HOST, path: PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ANON,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const VARIANTS = [
  ['Current  (via:native_messaging + brand_id)',  null],
  ['Drop via  (brand_id only)',                   `type:ticket brand_id:8399147779099 created>=${start} created<=${end}`],
  ['Drop brand (via:native_messaging only)',      `type:ticket via:native_messaging created>=${start} created<=${end}`],
  ['No channel/brand filters',                    `type:ticket created>=${start} created<=${end}`],
]

async function main() {
  console.log(`Date range: ${start} → ${end}\n`)
  console.log('Querying Zendesk via edge function...\n')

  for (const [label, query_override] of VARIANTS) {
    const body = { start_date: start, end_date: end }
    if (query_override) body.query_override = query_override

    try {
      const d = await post(body)
      const daniel = d.agents?.find(a => a.name?.toLowerCase().includes('daniel') || a.name?.toLowerCase().includes('bestritsky'))

      console.log(`[${label}]`)
      console.log(`  Total tickets : ${d.count ?? 'ERR'}`)
      console.log(`  Agents found  : ${d.agents?.length ?? 0}`)
      console.log(`  Daniel        : ${daniel ? daniel.count + ' tickets' : 'NOT IN RESULTS'}`)
      if (d.agents) {
        const top = d.agents.slice(0, 6).map(a => `${a.name.split(' ')[0]}:${a.count}`).join('  ')
        console.log(`  Top agents    : ${top}`)
      }
      if (d.error) console.log(`  ERROR: ${d.error}`)
    } catch (e) {
      console.log(`[${label}] FAILED: ${e.message}`)
    }
    console.log()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
