// fix-riley-issues.cjs
// Retroactive fix: for all Riley Kitts ticket_issues where
// issue_comment is set but suggested_response is null,
// copy issue_comment → suggested_response and clear issue_comment.
// "None" / "No response" sentinels are left as null in suggested_response.

const BASE = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const h    = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }

const SENTINELS = new Set(['none', 'no response', 'none available'])

async function main() {
  // 1. Fetch all Riley ticket IDs
  const tRes = await fetch(BASE + '/rest/v1/tickets?agent_name=eq.Riley Kitts&select=id', { headers: h })
  const tickets = await tRes.json()
  const ids = tickets.map(t => t.id)
  console.log('Riley tickets:', ids.length)

  // 2. Collect affected issue rows in chunks
  let affected = []
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const url = BASE + '/rest/v1/ticket_issues?ticket_id=in.(' + chunk.join(',') + ')&issue_comment=not.is.null&suggested_response=is.null&select=id,issue_comment,issue_type'
    const r = await fetch(url, { headers: h })
    affected = affected.concat(await r.json())
  }
  console.log('Affected rows:', affected.length)

  let fixed = 0, skipped = 0, errors = 0

  for (const row of affected) {
    const raw = (row.issue_comment || '').trim()
    const isSentinel = SENTINELS.has(raw.toLowerCase())

    const patch = isSentinel
      ? { suggested_response: null, issue_comment: null }
      : { suggested_response: raw,  issue_comment: null }

    const res = await fetch(BASE + '/rest/v1/ticket_issues?id=eq.' + row.id, {
      method: 'PATCH',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })

    if (res.ok) {
      isSentinel ? skipped++ : fixed++
    } else {
      console.error('  FAILED row', row.id, await res.text())
      errors++
    }
  }

  console.log('\nResults:')
  console.log('  Migrated (real content): ', fixed)
  console.log('  Cleared (sentinels):     ', skipped)
  console.log('  Errors:                  ', errors)

  // 3. Verify
  let remaining = []
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const url = BASE + '/rest/v1/ticket_issues?ticket_id=in.(' + chunk.join(',') + ')&issue_comment=not.is.null&suggested_response=is.null&select=id'
    const r = await fetch(url, { headers: h })
    remaining = remaining.concat(await r.json())
  }
  console.log('\nVerification — rows still in old format:', remaining.length)
  if (remaining.length === 0) console.log('All clean ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
