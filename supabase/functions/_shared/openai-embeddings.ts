// Shared OpenAI embeddings call for KB semantic search (indexing + query-time
// retrieval). This is the only place in the codebase that calls OpenAI --
// every other LLM call here goes to Anthropic -- because Anthropic has no
// first-party embeddings endpoint.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const MODEL = 'text-embedding-3-small' // 1536 dims, matches kb_article_chunks.embedding

const MAX_ATTEMPTS = 4

export async function embedTexts(texts: string[]): Promise<number[][]> {
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: texts }),
    })
    if (res.ok) {
      const d = await res.json()
      return d.data.map((x: any) => x.embedding)
    }
    lastError = `OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 500)}`
    // Only rate limits/server hiccups are worth retrying -- a 400 (bad input) will
    // just fail the same way every time.
    if (res.status !== 429 && res.status < 500) break
    if (attempt < MAX_ATTEMPTS) {
      const retryAfterSec = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt
      await new Promise(r => setTimeout(r, waitMs))
    }
  }
  throw new Error(lastError)
}
