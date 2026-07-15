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
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

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

// Pages per transcription call. Keeps every call comfortably under Anthropic's
// 100-page-per-request cap, and small enough that a single call reliably
// finishes within the Edge Function's execution window even for slow/dense
// (image-heavy) PDFs -- large docs were failing outright at 1 call regardless
// of the page cap, purely from taking too long.
const PAGE_CHUNK_SIZE = 15

const TRANSCRIBE_SYSTEM =
  'Transcribe the ENTIRE text content of the attached document verbatim, preserving structure ' +
  '(headings, lists, tables as plain text). Output only the transcribed text — no commentary, no summary, no additions.'

let lastPdfError: string | null = null

async function transcribeSource(source: Record<string, unknown>, label: string): Promise<{ text: string | null; error: string | null }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16000,
        system: TRANSCRIBE_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: label },
            { type: 'document', source },
          ],
        }],
      }),
    })
    if (!res.ok) return { text: null, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}` }
    const d = await res.json()
    if (d.stop_reason === 'refusal') return { text: null, error: 'model refused' }
    const block = d.content?.find((b: any) => b.type === 'text')
    if (!block?.text) return { text: null, error: `no text block in response: ${JSON.stringify(d).slice(0, 500)}` }
    return { text: block.text, error: null }
  } catch (e) {
    return { text: null, error: `fetch threw: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function extractPdfText(fileUrl: string, title: string): Promise<string | null> {
  const fileRes = await fetch(fileUrl).catch(() => null)
  if (!fileRes?.ok) { lastPdfError = `failed to fetch PDF: HTTP ${fileRes?.status ?? 'network error'}`; return null }
  const bytes = new Uint8Array(await fileRes.arrayBuffer())

  let pdfDoc
  try {
    pdfDoc = await PDFDocument.load(bytes)
  } catch (e) {
    lastPdfError = `failed to parse PDF: ${e instanceof Error ? e.message : String(e)}`
    return null
  }
  const totalPages = pdfDoc.getPageCount()

  if (totalPages <= PAGE_CHUNK_SIZE) {
    const { text, error } = await transcribeSource({ type: 'url', url: fileUrl }, `Document title: ${title}`)
    if (error) lastPdfError = error
    return text
  }

  // Split into page-range sub-PDFs and transcribe them concurrently -- wall
  // time is bounded by the slowest chunk rather than the sum of all of them,
  // which is what was blowing past the execution timeout on large documents.
  const ranges: [number, number][] = []
  for (let start = 0; start < totalPages; start += PAGE_CHUNK_SIZE) {
    ranges.push([start, Math.min(start + PAGE_CHUNK_SIZE, totalPages)])
  }

  const results = await Promise.all(ranges.map(async ([start, end]) => {
    const label = `pages ${start + 1}-${end}`
    const subDoc = await PDFDocument.create()
    const pages = await subDoc.copyPages(pdfDoc, Array.from({ length: end - start }, (_, i) => start + i))
    pages.forEach(p => subDoc.addPage(p))
    const subBytes = await subDoc.save()
    const data = encodeBase64(subBytes)
    const { text, error } = await transcribeSource(
      { type: 'base64', media_type: 'application/pdf', data },
      `Document title: ${title} (${label} of ${totalPages})`
    )
    return { label, text, error }
  }))

  const failed = results.filter(r => r.error)
  if (failed.length > 0) {
    lastPdfError = failed.map(f => `${f.label}: ${f.error}`).join(' | ').slice(0, 1000)
    return null
  }

  return results.map(r => r.text).join('\n\n')
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
