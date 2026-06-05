// eval-sentiment
// Backfill-oriented: classifies zd_last_player_message sentiment for tickets
// that have a stored message but no verdict yet.
//
// POST body (all optional):
//   { ids?: string[], limit?: number }
//   ids   — specific ticket IDs to classify (skips null-message check if included)
//   limit — max tickets to process per call (default 50)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!

const sbHeaders = {
  apikey:         SUPABASE_SERVICE_KEY,
  Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

const SENTIMENT_PROMPT = `You classify the sentiment of a player's final message to a customer support agent.

COMPLIMENT — Player expressed genuine appreciation or positive feedback about the agent or support they received, beyond a routine closing. Examples: "you were so helpful!", "amazing service", "you're the best", "that solved everything, thank you so much!"
NEUTRAL — Standard acknowledgment or closing with no clear sentiment. Examples: "ok", "thanks", "got it", "bye", "understood", "alright"
NEGATIVE — Player expressed frustration, dissatisfaction, or an unresolved concern. Examples: "this didn't help", "still not working", "very disappointed"

Important: "thanks" or "thank you" alone = NEUTRAL. Only classify as COMPLIMENT when there is additional genuine positive language beyond the routine acknowledgment.

Respond with ONLY valid JSON — no markdown, no explanation:
{"verdict": "COMPLIMENT"|"NEUTRAL"|"NEGATIVE", "confidence": 0-100}`

async function classifySentiment(message: string): Promise<{ verdict: string; confidence: number } | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 64,
        system:     SENTIMENT_PROMPT,
        messages:   [{ role: 'user', content: `Player message: "${message}"` }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const raw  = data.content?.[0]?.type === 'text' ? data.content[0].text.trim() : ''
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(text)
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body             = await req.json().catch(() => ({}))
    const ids: string[]    = body.ids   ?? []
    const limit: number    = body.limit ?? 50

    // Build fetch URL — either specific IDs or auto-pick unclassified tickets
    let fetchUrl: string
    if (ids.length > 0) {
      fetchUrl = `${SUPABASE_URL}/rest/v1/tickets?id=in.(${ids.join(',')})&zd_last_player_message=not.is.null&select=id,zd_last_player_message`
    } else {
      fetchUrl = `${SUPABASE_URL}/rest/v1/tickets?zd_last_player_message=not.is.null&zd_player_sentiment=is.null&select=id,zd_last_player_message&order=created_at.desc&limit=${limit}`
    }

    const fetchRes = await fetch(fetchUrl, { headers: sbHeaders })
    const tickets  = await fetchRes.json()

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return new Response(JSON.stringify({ processed: 0, skipped: 0, errors: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let processed = 0, skipped = 0, errors = 0

    for (const t of tickets) {
      const msg = (t.zd_last_player_message ?? '').trim()
      if (!msg) { skipped++; continue }

      const result = await classifySentiment(msg)
      if (!result) { errors++; continue }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/tickets?id=eq.${t.id}`, {
        method:  'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          zd_player_sentiment:     result.verdict,
          zd_sentiment_confidence: result.confidence,
        }),
      })

      if (patchRes.ok) processed++; else errors++
    }

    return new Response(JSON.stringify({ processed, skipped, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
