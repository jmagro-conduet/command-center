// summarize-common-questions — powers Ask the Operator's "Commonly asked"
// panel. Exact-text grouping undercounted real repeats ("win/loss statement"
// vs "win loss statement", "withdrawal options" vs "how can players
// withdraw") since differently-worded askings of the same question never
// matched. This clusters semantically via Claude instead, producing a single
// clean representative question per theme. Cached per operator (see
// CACHE_TTL_MS) so opening Ask repeatedly doesn't re-cluster every time.
//
// Excludes rows with no user_id -- those are direct-API calls (testing /
// backfill / verification), never a real logged-in agent asking through the
// UI, and would otherwise pollute "commonly asked" with test traffic.
//
// POST body: { operator_id: string }

import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }

const CACHE_TTL_MS = 60 * 60 * 1000 // 1h — clustering is a nice-to-have summary, not real-time data
const WINDOW_DAYS  = 30
const MAX_THEMES   = 8

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['themes'],
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summarized_question', 'count'],
        properties: {
          summarized_question: { type: 'string', description: 'One clean, natural question representing everything in this group' },
          count: { type: 'integer', description: 'Sum of occurrences of every input line merged into this group' },
        },
      },
    },
  },
}

async function writeCache(operatorId: string, themes: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/ask_operator_theme_cache?on_conflict=operator_id`, {
    method: 'POST',
    headers: { ...sb, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ operator_id: operatorId, themes, computed_at: new Date().toISOString() }),
  }).catch(() => {})
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const operatorId: string = body.operator_id
    if (!operatorId) return json({ error: 'operator_id is required' }, 400)

    const cacheRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ask_operator_theme_cache?operator_id=eq.${operatorId}&select=themes,computed_at`,
      { headers: sb }
    )
    const cacheRows = cacheRes.ok ? await cacheRes.json() : []
    const cached = cacheRows?.[0]
    if (cached && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
      return json({ themes: cached.themes })
    }

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const logsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ask_operator_logs?operator_id=eq.${operatorId}&created_at=gte.${since}&user_id=not.is.null&select=question`,
      { headers: sb }
    )
    const logs: { question: string }[] = logsRes.ok ? await logsRes.json() : []

    // Pre-group exact (normalized) repeats ourselves -- cheap, and keeps the
    // list Claude sees short even when the same exact phrasing was asked
    // many times.
    const counts = new Map<string, { text: string; count: number }>()
    for (const r of logs) {
      const text = r.question.trim()
      if (!text) continue
      const key = text.toLowerCase().replace(/\s+/g, ' ')
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { text, count: 1 })
    }
    const distinct = [...counts.values()]

    if (distinct.length === 0) {
      await writeCache(operatorId, [])
      return json({ themes: [] })
    }

    const listText = distinct.map(q => `- (${q.count}x) ${q.text}`).join('\n')
    const system =
      'You group real support-agent questions into common THEMES for a "commonly asked" UI panel. Each input line ' +
      'is a distinct phrasing actually asked, with a count of how many times that exact wording was used. Merge ' +
      'lines asking for the same underlying information into one theme, even when worded very differently -- write ' +
      'ONE clean, natural question representing the whole group (do not just copy one of the input lines verbatim ' +
      'unless it already reads well), and sum the merged counts. Keep unrelated questions separate even if they ' +
      'share a topic (e.g. "withdrawal options" and "withdrawal timing" are different questions). Only return ' +
      `themes whose summed count is 2 or more -- drop genuine one-offs entirely. Return at most ${MAX_THEMES} ` +
      'themes, highest count first.'

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: `QUESTIONS:\n${listText}` }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      }),
    })
    if (!aiRes.ok) return json({ error: `Anthropic API ${aiRes.status}: ${(await aiRes.text()).slice(0, 500)}` }, 502)
    const d = await aiRes.json()
    if (d.stop_reason === 'refusal') return json({ error: 'The model declined to summarize.' }, 502)
    const block = d.content?.find((b: any) => b.type === 'text')
    let parsed: any
    try {
      parsed = JSON.parse(block?.text ?? '')
    } catch {
      return json({ error: 'Unexpected non-JSON response.' }, 502)
    }

    const themes = Array.isArray(parsed.themes)
      ? parsed.themes
          .filter((t: any) => typeof t?.summarized_question === 'string' && Number(t?.count) >= 2)
          .sort((a: any, b: any) => b.count - a.count)
          .slice(0, MAX_THEMES)
      : []

    await writeCache(operatorId, themes)
    return json({ themes })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
