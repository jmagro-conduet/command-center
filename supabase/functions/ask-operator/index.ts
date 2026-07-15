// ask-operator — grounded Q&A for QA covering an operator they don't normally
// work. Answers strictly from that operator's Learn/KB content (SOPs, house
// rules, process docs) so QA gets an operator-specific answer instead of
// having to already know it or dig through documents themselves.
//
// Semantic retrieval (embeddings + pgvector), not context-stuffing: the first
// version sent an operator's entire KB corpus on every question, which hit a
// real limit immediately (RSI alone has 8 PDF SOPs, exceeding Anthropic's
// 600-combined-PDF-page cap per request). Now only the handful of chunks
// actually relevant to the question are retrieved and sent.
//
// POST body: { operator_id: string, question: string, user_id?: string }

import { corsHeaders } from '../_shared/cors.ts'
import { embedTexts } from '../_shared/openai-embeddings.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }

const MATCH_COUNT = 12

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'sources', 'coverage'],
  properties: {
    answer: { type: 'string', description: 'The answer, grounded only in the provided KB material.' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title'],
        properties: {
          id:    { type: 'string', description: 'the kb_articles id this claim came from' },
          title: { type: 'string' },
        },
      },
      description: 'Every article actually drawn from. Empty array if none apply.',
    },
    coverage: {
      type: 'string',
      enum: ['full', 'partial', 'none'],
      description: '"full" if the retrieved material fully answers the question, "partial" if it only partly addresses it, "none" if it does not address it at all.',
    },
  },
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const operatorId: string = body.operator_id
    const question: string = typeof body.question === 'string' ? body.question.trim() : ''
    if (!operatorId) return json({ error: 'operator_id is required' }, 400)
    if (!question) return json({ error: 'question is required' }, 400)

    const opRes = await fetch(`${SUPABASE_URL}/rest/v1/operators?id=eq.${operatorId}&select=name`, { headers: sb })
    const opRows = opRes.ok ? await opRes.json() : []
    const operatorName: string = opRows?.[0]?.name ?? 'this operator'

    const [queryEmbedding] = await embedTexts([question])

    const matchRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_kb_chunks`, {
      method: 'POST',
      headers: sb,
      body: JSON.stringify({ query_embedding: queryEmbedding, match_operator_id: operatorId, match_count: MATCH_COUNT }),
    })
    if (!matchRes.ok) return json({ error: `Retrieval failed: ${(await matchRes.text()).slice(0, 500)}` }, 500)
    const chunks: { chunk_id: string; article_id: string; article_title: string; article_category: string; content: string; similarity: number }[] =
      await matchRes.json()

    if (!Array.isArray(chunks) || chunks.length === 0) {
      // Distinguish "nothing indexed yet" from "operator genuinely has no KB" —
      // check whether any published article exists at all for this operator.
      const artCountRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kb_articles?is_published=eq.true&include_in_ask=eq.true&select=id&or=(operator_id.eq.${operatorId},operator_id.is.null)&limit=1`,
        { headers: sb }
      )
      const hasAnyArticles = artCountRes.ok && (await artCountRes.json()).length > 0
      return json({
        error: hasAnyArticles
          ? `${operatorName}'s KB articles exist but aren't indexed for search yet — open and re-save each one in Learn to index it.`
          : `No knowledge-base content exists yet for ${operatorName}. Add published SOPs/process articles in Learn — they're indexed automatically.`,
      }, 422)
    }

    // How many ask-eligible published articles for this operator aren't
    // searchable at all (never indexed, or indexing skipped/failed) —
    // surfaced so QA knows the answer may be incomplete, not just silently
    // missing content. Articles deliberately excluded from Ask (QA/training
    // material) don't count — they're not a gap, they're scoped out on purpose.
    const allArtRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kb_articles?is_published=eq.true&include_in_ask=eq.true&select=id,indexed_at,index_skip_reason&or=(operator_id.eq.${operatorId},operator_id.is.null)`,
      { headers: sb }
    )
    const allArticles = allArtRes.ok ? await allArtRes.json() : []
    const excludedCount = allArticles.filter((a: any) => !a.indexed_at || a.index_skip_reason).length

    const contextBlocks = chunks.map(c => ({
      type: 'text',
      text: `### ${c.article_title} (id: ${c.article_id}, category: ${c.article_category})\n${c.content}`,
    }))

    const systemText =
      `You are a QA support assistant helping a QA teammate who is covering "${operatorName}" but doesn't normally ` +
      `work this operator. Answer their question using ONLY the knowledge-base excerpts provided in the user message ` +
      `(retrieved from SOPs, house rules, and process docs for ${operatorName}). Never use outside/general knowledge ` +
      `about this operator or the iGaming industry to fill gaps — if the excerpts don't address the question, or only ` +
      `partly do, say so plainly in your answer rather than guessing or implying confidence they don't support. ` +
      `Note the excerpts are the most relevant sections found by search, not necessarily the operator's complete ` +
      `documentation on the topic. Cite every article you actually drew from (by its id) in "sources" — empty array ` +
      `if none apply. Set "coverage" honestly per the schema description.` +
      (excludedCount > 0
        ? ` Note: ${excludedCount} published document(s) for this operator aren't searchable yet (not indexed, or ` +
          `indexing failed) and couldn't be considered — mention this only if it seems relevant to a gap in your answer.`
        : '')

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        system: systemText,
        messages: [{ role: 'user', content: [...contextBlocks, { type: 'text', text: `QUESTION: ${question}` }] }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      }),
    })

    if (!aiRes.ok) return json({ error: `Anthropic API ${aiRes.status}`, body: (await aiRes.text()).slice(0, 800) }, 502)
    const d = await aiRes.json()
    if (d.stop_reason === 'refusal') return json({ error: 'The model declined to answer. Try rephrasing the question.' }, 502)
    const block = d.content?.find((b: any) => b.type === 'text')
    let parsed: any
    try {
      parsed = JSON.parse(block?.text ?? '')
    } catch (e) {
      if (d.stop_reason === 'max_tokens') {
        return json({ error: 'The answer was too long and got cut off — try asking a more specific question.' }, 502)
      }
      return json({
        error: 'Unexpected non-JSON response. Try again.',
        debug: {
          stop_reason: d.stop_reason,
          parseError: e instanceof Error ? e.message : String(e),
          rawText: (block?.text ?? '').slice(0, 1000),
          contentTypes: d.content?.map((b: any) => b.type),
        },
      }, 502)
    }

    const coverage = ['full', 'partial', 'none'].includes(parsed.coverage) ? parsed.coverage : 'partial'
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((s: any) => typeof s?.id === 'string' && typeof s?.title === 'string')
      : []

    const usage = {
      input:      d.usage?.input_tokens ?? 0,
      cacheWrite: d.usage?.cache_creation_input_tokens ?? 0,
      cacheRead:  d.usage?.cache_read_input_tokens ?? 0,
    }

    // Fire-and-forget log — never block the response on it.
    fetch(`${SUPABASE_URL}/rest/v1/ask_operator_logs`, {
      method: 'POST',
      headers: { ...sb, Prefer: 'return=minimal' },
      body: JSON.stringify({
        operator_id: operatorId,
        user_id: typeof body.user_id === 'string' ? body.user_id : null,
        question,
        answer: parsed.answer ?? '',
        coverage,
        source_ids: sources.map((s: any) => s.id),
        excluded_count: excludedCount,
      }),
    }).catch(() => {})

    return json({ answer: parsed.answer ?? '', sources, coverage, excluded_count: excludedCount, usage })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
