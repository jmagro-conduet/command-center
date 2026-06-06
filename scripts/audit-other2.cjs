const BASE = 'https://uepigbagbaskbslpjeqq.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGlnYmFnYmFza2JzbHBqZXFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkxNTgyOSwiZXhwIjoyMDkwNDkxODI5fQ.lJkGYw4GEEpsHVFJNWB4et53bZVFjOyKNX839E1D_YU'
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY }

function trunc(s, n) {
  n = n || 110
  if (!s) return '—'
  var t = s.replace(/\n/g,' ').trim()
  return t.length > n ? t.slice(0,n) + '…' : t
}

async function q(filter) {
  var url = BASE + '/rest/v1/tickets?' + filter + '&select=id,ticket_category,agent_name,notes,other_category_detail,created_at&order=created_at.desc'
  var r = await fetch(url, { headers: h })
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + await r.text())
  return r.json()
}

async function main() {
  var other = await q('ticket_category=ilike.other')
  console.log('=== OTHER (' + other.length + ' tickets) ===')
  other.forEach(function(r) {
    console.log('[' + r.id + '] ' + String(r.created_at||'').slice(0,10) + ' agent=' + r.agent_name)
    console.log('  other_detail: ' + trunc(r.other_category_detail))
    console.log('  notes:        ' + trunc(r.notes))
  })

  var uncat = await q('ticket_category=ilike.uncategorized')
  console.log('\n=== UNCATEGORIZED (' + uncat.length + ' tickets) ===')
  uncat.forEach(function(r) {
    console.log('[' + r.id + '] ' + String(r.created_at||'').slice(0,10) + ' agent=' + r.agent_name)
    console.log('  other_detail: ' + trunc(r.other_category_detail))
    console.log('  notes:        ' + trunc(r.notes))
  })

  var blank = await q('ticket_category=is.null')
  console.log('\n=== BLANK/NULL (' + blank.length + ' tickets) ===')
  blank.forEach(function(r) {
    console.log('[' + r.id + '] ' + String(r.created_at||'').slice(0,10) + ' agent=' + r.agent_name)
    console.log('  notes: ' + trunc(r.notes))
  })
}

main().catch(function(e) { console.error(e); process.exit(1) })
