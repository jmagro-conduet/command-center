// strategy-draft-review
//
// Drafts an ELT review (a check-in for every key result, plus new / closed
// actions and action progress) from pasted meeting notes, for the admin to
// review and approve in the Strategy page. It only returns a draft; nothing is
// written to the database here.
//
// Called from the app with the signed-in user's JWT. The caller must be a
// SuperAdmin or hold the 'strategy' page with edit rights (it spends Claude
// credits and the notes are confidential).
import { corsHeaders } from '../_shared/cors.ts'
import { SYSTEM, buildPrompt, parseDraft, parseRequest } from './logic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function canEditStrategy(token: string): Promise<boolean> {
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  if (!u.ok) return false
  const email = String((await u.json()).email || '')
  if (!email) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(email)}&select=id,role&limit=1`, { headers: sb })
  const row = r.ok ? (await r.json())[0] : null
  if (!row || row.role === 'operator') return false
  if (row.role === 'superadmin') return true
  const g = await fetch(`${SUPABASE_URL}/rest/v1/page_access?user_id=eq.${row.id}&page_key=eq.strategy&can_edit=eq.true&select=user_id&limit=1`, { headers: sb })
  return g.ok && (await g.json()).length > 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token || !(await canEditStrategy(token))) return json({ ok: false, error: 'You need edit access to Strategy to draft an ELT review.' }, 403)
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: 'ANTHROPIC_API_KEY is not configured.' }, 500)

  const text = await req.text()
  if (text.length > 400_000) return json({ ok: false, error: 'That request is too large.' }, 413)
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* handled below */ }
  const parsed = parseRequest(body)
  if (typeof parsed === 'string') return json({ ok: false, error: parsed }, 400)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 8000, system: SYSTEM, messages: [{ role: 'user', content: buildPrompt(parsed) }] }),
  })
  if (!res.ok) return json({ ok: false, error: `Claude request failed (${res.status}).` }, 502)
  const out = String((await res.json()).content?.find((b: { type: string }) => b.type === 'text')?.text ?? '')
  const draft = parseDraft(out, parsed)
  if (!draft) return json({ ok: false, error: 'Could not read the draft. Try again.' }, 502)
  return json({ ok: true, draft })
})
