/**
 * Full adoption % audit: compare all agents' gameLM ticket count vs ZD ticket count
 * Usage: node scripts/debug-adoption.cjs
 */

const { createClient } = require('../node_modules/@supabase/supabase-js')

const SUPABASE_URL     = 'https://uepigbagbaskbslpjeqq.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const ANON_KEY         = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTU4MjksImV4cCI6MjA5MDQ5MTgyOX0.hz75aFhXeL5yRkbwn1tmHd37D2omQ3wR8LbOG6pJpzI'

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function main() {
  const now = new Date()
  const end_date = now.toISOString().slice(0, 10)
  const startD = new Date(now); startD.setDate(startD.getDate() - 30)
  const start_date = startD.toISOString().slice(0, 10)
  const cutoffISO  = startD.toISOString()

  console.log(`Date range: ${start_date} → ${end_date}\n`)

  // 1. Fetch all gameLM issues from last 30 days with ticket info
  console.log('Fetching gameLM data...')
  const PAGE = 1000
  const allIssues = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from('ticket_issues')
      .select('issue_type, logged_at, created_at, tickets!inner(ticket_number, agent_name, ticket_category, created_at)')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    allIssues.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  // Filter to last 30 days (same logic as Analytics.tsx — uses ticket_issues.created_at first)
  const filtered = allIssues.filter(ti => {
    const dateStr = ti.created_at ?? ti.logged_at ?? ti.tickets?.created_at
    if (!dateStr) return false
    return new Date(dateStr) >= startD
  })

  // Group by agent name, count unique tickets
  const agentMap = new Map()
  for (const ti of filtered) {
    const name = ti.tickets?.agent_name ?? 'Unknown'
    if (!agentMap.has(name)) agentMap.set(name, new Set())
    agentMap.get(name).add(ti.tickets?.ticket_number)
  }

  const gameLMAgents = [...agentMap.entries()]
    .map(([name, tickets]) => ({ name, count: tickets.size }))
    .sort((a, b) => b.count - a.count)

  console.log(`gameLM agents in last 30d: ${gameLMAgents.length}`)

  // 2. Fetch ZD data
  console.log('Fetching ZD data from edge function...')
  const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/zendesk-tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ start_date, end_date }),
  })
  if (!edgeRes.ok) { console.error('Edge function error:', await edgeRes.text()); process.exit(1) }
  const zdData = await edgeRes.json()

  console.log(`ZD total: ${zdData.count}, agents: ${zdData.agents?.length ?? 0}`)

  // 3. Match and compare
  console.log('\n' + '='.repeat(80))
  console.log('AGENT ADOPTION AUDIT (last 30 days)')
  console.log('='.repeat(80))
  console.log(`${'Agent'.padEnd(28)} ${'gameLM'.padStart(7)} ${'ZD'.padStart(7)} ${'Adoption'.padStart(10)}  Match?`)
  console.log('-'.repeat(70))

  for (const a of gameLMAgents) {
    const agentWords = a.name.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 4)
    const zdMatch = zdData.agents?.find(z => {
      const zdWords = z.name.toLowerCase().trim().split(/\s+/)
      return agentWords.some(w => zdWords.some(zw => zw.startsWith(w) || w.startsWith(zw)))
    })

    const zdCount   = zdMatch?.count ?? null
    const adoption  = zdCount ? ((a.count / zdCount) * 100).toFixed(1) + '%' : '—'
    const overFlag  = zdCount && a.count > zdCount ? ' ⚠ OVER 100%' : ''
    const matchName = zdMatch ? zdMatch.name : '❌ NO ZD MATCH'

    console.log(
      `${a.name.padEnd(28)} ${String(a.count).padStart(7)} ${String(zdCount ?? '—').padStart(7)} ${adoption.padStart(10)}  ${matchName}${overFlag}`
    )
  }

  // 4. Show ZD agents with NO gameLM match (potential uncovered volume)
  console.log('\n--- ZD agents with NO gameLM match (unlogged volume) ---')
  for (const z of zdData.agents ?? []) {
    const zdWords = z.name.toLowerCase().trim().split(/\s+/)
    const hasMatch = gameLMAgents.some(a => {
      const aw = a.name.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 4)
      return aw.some(w => zdWords.some(zw => zw.startsWith(w) || w.startsWith(zw)))
    })
    if (!hasMatch) {
      console.log(`  ${z.name} — ${z.count} ZD tickets`)
    }
  }

  // 5. Show agents with > 100% adoption (the real problem)
  console.log('\n--- Agents with adoption > 100% (gameLM > ZD) ---')
  let found = false
  for (const a of gameLMAgents) {
    const agentWords = a.name.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 4)
    const zdMatch = zdData.agents?.find(z => {
      const zdWords = z.name.toLowerCase().trim().split(/\s+/)
      return agentWords.some(w => zdWords.some(zw => zw.startsWith(w) || w.startsWith(zw)))
    })
    if (zdMatch && a.count > zdMatch.count) {
      const pct = ((a.count / zdMatch.count) * 100).toFixed(1)
      console.log(`  ${a.name}: gameLM=${a.count}, ZD=${zdMatch.count}, Adoption=${pct}%`)
      found = true
    }
  }
  if (!found) console.log('  None! All agents are at or below 100%.')
}

main().catch(err => { console.error(err); process.exit(1) })
