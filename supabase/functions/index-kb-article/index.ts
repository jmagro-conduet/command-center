// index-kb-article — (re)builds the searchable chunks for one Learn KB
// article. Called whenever an article is saved (see Learn.tsx's handleSave),
// and once as a backfill for articles that existed before this pipeline did.
//
// Text articles are chunked directly. PDFs have no text-extraction pipeline
// in this repo (Claude reads PDFs natively at answer-time elsewhere, e.g.
// quiz-generate) -- so for indexing purposes only, Claude is asked to
// transcribe the PDF's full text once, which is then chunked and embedded
// like any other text. DOCX/XLSX/PPTX-only articles still can't be read.
//
// POST body: { article_id: string }

import { corsHeaders } from '../_shared/cors.ts'
import { embedTexts } from '../_shared/openai-embeddings.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }

const CHUNK_TARGET_CHARS = 2400

// Greedy paragraph accumulation up to a target size; a single paragraph
// longer than the target gets hard-split so nothing is ever dropped.
function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs) {
    current = current ? `${current}\n\n${p}` : p
    while (current.length > CHUNK_TARGET_CHARS * 1.5) {
      chunks.push(current.slice(0, CHUNK_TARGET_CHARS))
      current = current.slice(CHUNK_TARGET_CHARS)
    }
    if (current.length > CHUNK_TARGET_CHARS) {
      chunks.push(current)
      current = ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}

let lastPdfError: string | null = null

async function extractPdfText(fileUrl: string, title: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16000,
        system: 'Transcribe the ENTIRE text content of the attached document verbatim, preserving structure ' +
          '(headings, lists, tables as plain text). Output only the transcribed text — no commentary, no summary, no additions.',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Document title: ${title}` },
            { type: 'document', source: { type: 'url', url: fileUrl } },
          ],
        }],
      }),
    })
    if (!res.ok) { lastPdfError = `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`; return null }
    const d = await res.json()
    if (d.stop_reason === 'refusal') { lastPdfError = 'model refused'; return null }
    const block = d.content?.find((b: any) => b.type === 'text')
    if (!block?.text) lastPdfError = `no text block in response: ${JSON.stringify(d).slice(0, 500)}`
    return block?.text ?? null
  } catch (e) {
    lastPdfError = `fetch threw: ${e instanceof Error ? e.message : String(e)}`
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const articleId: string = body.article_id
    if (!articleId) return json({ error: 'article_id is required' }, 400)

    const artRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kb_articles?id=eq.${articleId}&select=id,title,content,file_url,file_type,is_published`,
      { headers: sb }
    )
    const rows = artRes.ok ? await artRes.json() : []
    const article = rows?.[0]
    if (!article) return json({ error: 'Article not found' }, 404)

    // Always clear old chunks first — re-index from scratch. This also correctly
    // handles unpublish/re-publish and content edits with no special-casing.
    await fetch(`${SUPABASE_URL}/rest/v1/kb_article_chunks?article_id=eq.${articleId}`, { method: 'DELETE', headers: sb })

    async function markStatus(skipReason: string | null) {
      await fetch(`${SUPABASE_URL}/rest/v1/kb_articles?id=eq.${articleId}`, {
        method: 'PATCH',
        headers: { ...sb, Prefer: 'return=minimal' },
        body: JSON.stringify({ indexed_at: new Date().toISOString(), index_skip_reason: skipReason }),
      })
    }

    if (!article.is_published) {
      await markStatus('unpublished')
      return json({ indexed: 0, skipped: 'unpublished' })
    }

    const hasText = !!article.content && article.content.trim().length >= 200
    const isPdf = article.file_type === 'application/pdf' && !!article.file_url

    let fullText: string | null = null
    if (hasText) fullText = article.content
    else if (isPdf) fullText = await extractPdfText(article.file_url, article.title)

    if (!fullText || !fullText.trim()) {
      const reason = isPdf
        ? `PDF transcription failed: ${lastPdfError ?? 'unknown'}`
        : 'no typed content and not a PDF (Word/Excel/PowerPoint uploads aren\'t readable yet)'
      await markStatus(reason)
      return json({ indexed: 0, skipped: reason })
    }

    const chunks = chunkText(fullText)
    if (chunks.length === 0) {
      await markStatus('no chunks produced')
      return json({ indexed: 0, skipped: 'no chunks produced' })
    }

    const embeddings = await embedTexts(chunks)
    const chunkRows = chunks.map((c, i) => ({
      article_id: articleId,
      chunk_index: i,
      content: c,
      embedding: embeddings[i],
    }))

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/kb_article_chunks`, {
      method: 'POST',
      headers: { ...sb, Prefer: 'return=minimal' },
      body: JSON.stringify(chunkRows),
    })
    if (!insRes.ok) {
      await markStatus('failed to store chunks')
      return json({ error: `Failed to store chunks: ${(await insRes.text()).slice(0, 500)}` }, 500)
    }

    await markStatus(null)
    return json({ indexed: chunks.length })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
