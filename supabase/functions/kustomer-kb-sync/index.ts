// kustomer-kb-sync
//
// Pulls Modo's Kustomer Knowledge Base into the Learn Center instead of
// someone manually downloading/uploading SOPs. Kustomer articles come in two
// scopes that map onto two different QA needs: "internal" articles are
// agent-facing SOPs (how to actually handle a request), "public" articles are
// the player-facing help-center answers (the "ideal response" QA judges
// gameLM's output against) -- both are pulled, tagged into separate
// categories so they stay visually distinct in Learn.
//
// Two Kustomer API calls per article: GET /v1/kb/articles lists article
// stubs (title, scope, which version is currently published), then
// GET /v1/kb/versions/{id} returns that version's actual htmlBody. Articles
// with no published version (drafts) are skipped.
//
// Idempotent: upserts on (external_source, external_id) so a recurring run
// updates existing rows instead of duplicating them. Re-indexing (chunk +
// embed) only happens for articles that are new or whose Kustomer version
// timestamp actually changed since the last sync -- re-embedding ~100
// unchanged articles every run would be pure waste.
//
// Currently Modo-only: the KUSTOMER_API_KEY secret is a single org-scoped
// key, and Modo is the only operator with Kustomer access today. If another
// operator gets Kustomer access later, this needs a per-operator key (same
// shape as the Linear project mapping) instead of the hardcoded lookup below.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
const KUSTOMER_API_KEY  = Deno.env.get('KUSTOMER_API_KEY')!
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
const kustomer = { Authorization: `Bearer ${KUSTOMER_API_KEY}`, 'Content-Type': 'application/json' }

const KUSTOMER_API = 'https://api.kustomerapp.com'
const CONCURRENCY = 5

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Kustomer's editor output is fairly simple/consistent (p, h1-6, ul/ol/li,
// a, br, table) -- a small hand-rolled converter is enough, no need for a
// full HTML parser dependency.
function htmlToText(html: string): string {
  let s = html
  s = s.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const clean = inner.replace(/<[^>]+>/g, '').trim()
    return clean && href && !clean.includes(href) ? `${clean} (${href})` : clean
  })
  s = s.replace(/<li[^>]*>/gi, '\n- ')
  s = s.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|table|tr|ul|ol|li)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  const namedEntities: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'",
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–',
  }
  s = s.replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)))
  s = s.replace(/&([a-zA-Z#0-9]+);/g, (m, name: string) => namedEntities[name] ?? m)
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

interface ArticleStub {
  id: string
  title: string
  scope: string
  versionId: string | null
}

async function fetchAllArticleStubs(): Promise<ArticleStub[]> {
  const stubs: ArticleStub[] = []
  let page = 1
  const pageSize = 100
  while (true) {
    const res = await fetch(`${KUSTOMER_API}/v1/kb/articles?pageSize=${pageSize}&page=${page}`, { headers: kustomer })
    if (!res.ok) throw new Error(`Kustomer articles list ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    for (const a of data.data ?? []) {
      stubs.push({
        id: a.id,
        title: a.attributes?.title ?? 'Untitled',
        scope: a.attributes?.scope ?? 'public',
        versionId: a.attributes?.langVersions?.en_us?.currentVersion?.id ?? null,
      })
    }
    if (!data.links?.next) break
    page++
  }
  return stubs
}

async function fetchVersionBody(versionId: string): Promise<{ htmlBody: string; updatedAt: string } | null> {
  const res = await fetch(`${KUSTOMER_API}/v1/kb/versions/${versionId}`, { headers: kustomer })
  if (!res.ok) return null
  const data = await res.json()
  const a = data.data?.attributes
  if (!a) return null
  return { htmlBody: a.htmlBody ?? '', updatedAt: a.updatedAt ?? a.modifiedAt ?? new Date().toISOString() }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const opRes = await fetch(`${SUPABASE_URL}/rest/v1/operators?name=ilike.modo&select=id&limit=1`, { headers: sb })
    const operator = opRes.ok ? (await opRes.json())[0] : null
    if (!operator) return json({ error: 'Modo operator not found (expected an operators row named "MODO")' }, 404)

    // What's already synced, so an unchanged AND already-successfully-indexed
    // article can skip re-indexing below. indexed_at is checked too, not just
    // the timestamp -- a row can be upserted (external_updated_at written)
    // while its indexing call still failed (rate limit, transient error), and
    // that must not look "unchanged" on the next run or it'd stay un-indexed forever.
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kb_articles?operator_id=eq.${operator.id}&external_source=eq.kustomer&select=external_id,external_updated_at,indexed_at`,
      { headers: sb },
    )
    const existingByExternalId = new Map<string, { updatedAt: string; indexedAt: string | null }>(
      (existingRes.ok ? await existingRes.json() : []).map((r: any) => [r.external_id, { updatedAt: r.external_updated_at, indexedAt: r.indexed_at }]),
    )

    const allStubs = await fetchAllArticleStubs()
    const stubs = allStubs.filter(s => s.versionId)

    const fetched = await mapLimit(stubs, CONCURRENCY, async stub => {
      const version = await fetchVersionBody(stub.versionId!)
      if (!version || !version.htmlBody.trim()) return null
      const content = htmlToText(version.htmlBody)
      if (!content) return null
      const prior = existingByExternalId.get(stub.id)
      const changed = !prior || !prior.indexedAt || new Date(prior.updatedAt).getTime() !== new Date(version.updatedAt).getTime()
      return {
        title: stub.title,
        content,
        category: stub.scope === 'internal' ? 'Kustomer SOPs (Internal)' : 'Kustomer Player FAQs',
        is_published: true,
        include_in_ask: true,
        operator_id: operator.id,
        created_by: 'kustomer-sync',
        updated_by: 'kustomer-sync',
        external_source: 'kustomer',
        external_id: stub.id,
        external_updated_at: version.updatedAt,
        _changed: changed,
      }
    })
    const rows = fetched.filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length === 0) return json({ synced: 0, indexed: 0, message: 'No articles with readable content found.' })

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/kb_articles?on_conflict=external_source,external_id&select=id,external_id`, {
      method: 'POST',
      headers: { ...sb, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows.map(({ _changed, ...r }) => r)),
    })
    if (!upsertRes.ok) return json({ error: `Failed to upsert articles: ${(await upsertRes.text()).slice(0, 500)}` }, 500)
    const upserted: { id: string; external_id: string }[] = await upsertRes.json()

    // Only re-index (chunk + embed) articles that are new or actually
    // changed -- re-embedding ~100 unchanged articles every run is waste.
    // Lower concurrency than the Kustomer fetch step above: each call here
    // triggers its own OpenAI embeddings request, and firing many at once
    // was tripping OpenAI's rate limit (embedTexts retries on 429, but
    // there's no reason to lean on that when a smaller batch avoids it).
    const INDEX_CONCURRENCY = 2
    const changedExternalIds = new Set(rows.filter(r => r._changed).map(r => r.external_id))
    const toIndex = upserted.filter(row => changedExternalIds.has(row.external_id))
    const indexErrors: string[] = []
    const indexResults = await mapLimit(toIndex, INDEX_CONCURRENCY, async row => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/index-kb-article`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ article_id: row.id }),
        })
        if (!res.ok) indexErrors.push(`${row.id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
        return res.ok
      } catch (e) {
        indexErrors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`)
        return false
      }
    })

    return json({
      total_kustomer_articles_seen: allStubs.length,
      skipped_draft_no_version: allStubs.length - stubs.length,
      skipped_empty_body: stubs.length - rows.length,
      synced: upserted.length,
      unchanged_skipped_reindex: upserted.length - toIndex.length,
      indexed: indexResults.filter(Boolean).length,
      index_errors: indexErrors.slice(0, 10),
    })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
