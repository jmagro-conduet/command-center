// Shared OpenAI embeddings call for KB semantic search (indexing + query-time
// retrieval). This is the only place in the codebase that calls OpenAI --
// every other LLM call here goes to Anthropic -- because Anthropic has no
// first-party embeddings endpoint.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const MODEL = 'text-embedding-3-small' // 1536 dims, matches kb_article_chunks.embedding

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  })
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const d = await res.json()
  return d.data.map((x: any) => x.embedding)
}
