// pipedrive-sync
//
// Keeps the Sales Funnel page fresh: copies deals, each deal's stage history, next activities and owner
// names from Pipedrive into public.funnel_docs. The page reads the copy, never Pipedrive directly, so it
// is fast, respects Raphie Hub roles, and the Pipedrive API token never leaves the server.
//
// Calling it (always requires the x-roadmap-secret header = ROADMAP_INGEST_SECRET; the cron reads the
// secret from Supabase Vault, see supabase/FUNNEL.md):
//   {}                   -> run and write, unless a sync was attempted in the last 5 minutes
//   {"force": true}      -> run now and write
//   {"dryRun": true}     -> read Pipedrive and report what it WOULD write; writes nothing
//   {"maxFlows": 20}     -> cap how many deals have their stage history read this run (default 60)
//
// Safety: it only reads Pipedrive (GET requests). It never deletes anything: deals that vanish are marked
// deleted, a few at a time. If Pipedrive can't be read, or the list looks far too short, it leaves the
// existing data alone and records the failure so the page shows its "sync failed" banner. The first run
// needs two or three passes to read every deal's history (60 per run), which spreads the API budget.
//
// Endpoint shapes follow Pipedrive's documentation (deals and activities: API v2; stage history and users:
// v1). They are kept in one place below. Run with {"dryRun": true} first after the token is set.
import { corsHeaders } from '../_shared/cors.ts'
import { funnelDb as db } from '../_shared/funnel-db.ts'
import { sameSecret } from '../_shared/roadmap-db.ts'
import { listLooksWrong, mergeDeal, normalizeActivity, normalizeDeal, parseFlow, planFlows, validateConfig, vanishedDeals } from './logic.ts'
import type { Activity, Deal, FunnelConfig } from './logic.ts'

const TOKEN = Deno.env.get('PIPEDRIVE_API_TOKEN')
const SECRET = Deno.env.get('ROADMAP_INGEST_SECRET')
const BASE = 'https://api.pipedrive.com'
const THROTTLE_MS = 5 * 60 * 1000
const DEFAULT_MAX_FLOWS = 60
const MAX_VANISHED = 10

const P = {
  deals: (pipelineId: number, cursor?: string) => `/api/v2/deals?pipeline_id=${pipelineId}&limit=500&include_fields=next_activity_id${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  flow: (dealId: number) => `/v1/deals/${dealId}/flow?limit=500`,
  activities: (ids: number[]) => `/api/v2/activities?ids=${ids.join(',')}&limit=100`,
  users: () => '/v1/users',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function pd(path: string, attempt = 0): Promise<any> {
  const res = await fetch(BASE + path, { headers: { 'x-api-token': TOKEN!, Accept: 'application/json' } })
  if (res.status === 429 && attempt < 2) { await sleep(Math.min(Number(res.headers.get('retry-after')) * 1000 || 2000, 5000)); return pd(path, attempt + 1) }
  if (res.status === 401 || res.status === 403) throw new Error(`Pipedrive rejected the API token (${res.status}). Check the PIPEDRIVE_API_TOKEN secret and that its user can see the pipelines.`)
  if (res.status === 429) throw new Error('Pipedrive rate limit reached (daily API budget or burst limit). Will retry on the next run.')
  if (!res.ok) throw new Error(`Pipedrive API ${res.status} for ${path.split('?')[0]}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  if (j && j.success === false) throw new Error(`Pipedrive API error for ${path.split('?')[0]}: ${String(j.error || j.error_info || 'unknown').slice(0, 200)}`)
  return j
}

async function readDeals(cfg: FunnelConfig): Promise<Deal[]> {
  const out: Deal[] = []
  for (const p of cfg.pipelines) {
    let cursor: string | undefined
    for (let i = 0; i < 20; i++) {
      const j = await pd(P.deals(p.id, cursor))
      for (const d of (Array.isArray(j.data) ? j.data : [])) { const n = normalizeDeal(d, p.key); if (n && !n.deleted) out.push(n) }
      cursor = j.additional_data?.next_cursor || undefined
      if (!cursor) break
    }
  }
  return out
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405)
  if (!SECRET) return json({ ok: false, error: 'ROADMAP_INGEST_SECRET is not configured.' }, 500)
  if (!sameSecret(req.headers.get('x-roadmap-secret') || '', SECRET)) return json({ ok: false, error: 'Unauthorized.' }, 401)
  if (!TOKEN) return json({ ok: false, error: 'PIPEDRIVE_API_TOKEN is not configured yet.' }, 500)
  const body = await req.json().catch(() => ({}))
  const started = new Date()
  const maxFlows = Math.max(0, Math.min(Number(body.maxFlows) || DEFAULT_MAX_FLOWS, 200))

  const prevSync = await db.get('meta', 'sync').catch(() => null)
  if (!body.force && !body.dryRun && prevSync?.attemptedAt && started.getTime() - new Date(prevSync.attemptedAt).getTime() < THROTTLE_MS) {
    return json({ ok: true, skipped: 'A sync was attempted in the last 5 minutes.' })
  }

  try {
    const cfg = (await db.get('config', 'funnel')) as FunnelConfig | null
    const bad = validateConfig(cfg)
    if (bad) throw new Error(bad)

    const storedDocs = await db.list('deals')
    const stored = new Map<number, Deal>(storedDocs.map(d => [Number(d.id), d.data as Deal]))
    const fetched = await readDeals(cfg as FunnelConfig)
    const wrong = listLooksWrong(fetched.length, storedDocs.length)
    if (wrong) throw new Error(wrong)

    // stage history, newest changes first, capped per run
    const toRead = planFlows(fetched, stored, maxFlows)
    const flows = new Map<number, ReturnType<typeof parseFlow>>()
    const warnings: string[] = []
    const byId = new Map(fetched.map(d => [d.id, d]))
    for (let i = 0; i < toRead.length; i += 3) {
      await Promise.all(toRead.slice(i, i + 3).map(async id => {
        try { const j = await pd(P.flow(id)); flows.set(id, parseFlow(j.data, byId.get(id)!)) }
        catch (e) { warnings.push(`History for deal ${id}: ${e instanceof Error ? e.message : e}`.slice(0, 200)); if (/rate limit|rejected/i.test(String(e))) throw e }
      }))
    }
    const deals = fetched.map(d => mergeDeal(d, stored.get(d.id), flows.get(d.id) || null))
    const waiting = deals.filter(d => !d.historyOk).length

    // next activities and owner names are small and refreshed every run; failures here are not fatal
    let activities: Activity[] = []
    try {
      const ids = [...new Set(deals.filter(d => d.status === 'open' && d.next).map(d => d.next as number))]
      for (let i = 0; i < ids.length; i += 100) {
        const j = await pd(P.activities(ids.slice(i, i + 100)))
        activities = activities.concat((Array.isArray(j.data) ? j.data : []).map(normalizeActivity).filter((a: Activity | null): a is Activity => !!a))
      }
    } catch (e) { warnings.push(`Next activities: ${e instanceof Error ? e.message : e}`.slice(0, 200)) }
    let users: { id: number; name: string }[] = []
    try { const j = await pd(P.users()); users = (Array.isArray(j.data) ? j.data : []).filter((u: any) => Number.isFinite(Number(u?.id))).map((u: any) => ({ id: Number(u.id), name: String(u.name || '').slice(0, 80) })) }
    catch (e) { warnings.push(`Users: ${e instanceof Error ? e.message : e}`.slice(0, 200)) }

    const gone = vanishedDeals(storedDocs.map(d => d.data as Deal), new Set(deals.map(d => d.id)), MAX_VANISHED)
    if (gone.tooMany) warnings.push('Many deals disappeared from Pipedrive at once, so none were marked deleted this run.')
    const now = started.toISOString()
    const meta = { ok: true, syncedAt: now, lastGoodAt: now, attemptedAt: now, error: '', deals: deals.length, historyRead: flows.size, historyWaiting: waiting, activities: activities.length, markedDeleted: gone.ids.length, warnings: warnings.slice(0, 5) }

    if (body.dryRun) {
      return json({ ok: true, dryRun: true, counts: { pipedriveDeals: fetched.length, stored: storedDocs.length, historyToRead: toRead.length, historyRead: flows.size, activities: activities.length, users: users.length, wouldMarkDeleted: gone.ids.length }, warnings, sample: deals.slice(0, 2).map(d => ({ ...d, title: d.title.slice(0, 3) + '…' })) })
    }

    await db.upsert([
      ...deals.map(d => ({ collection: 'deals', doc_id: String(d.id), data: d as unknown as Record<string, any>, updated_by: 'sync:pipedrive' })),
      ...gone.ids.map(id => ({ collection: 'deals', doc_id: String(id), data: { ...(stored.get(id) as Deal), deleted: true } as unknown as Record<string, any>, updated_by: 'sync:pipedrive' })),
      ...activities.map(a => ({ collection: 'activities', doc_id: String(a.id), data: a as unknown as Record<string, any>, updated_by: 'sync:pipedrive' })),
      ...users.map(u => ({ collection: 'users', doc_id: String(u.id), data: u as unknown as Record<string, any>, updated_by: 'sync:pipedrive' })),
      { collection: 'meta', doc_id: 'sync', data: meta, updated_by: 'sync:pipedrive' },
    ])
    return json({ ok: true, deals: deals.length, historyRead: flows.size, historyWaiting: waiting, activities: activities.length, markedDeleted: gone.ids.length, warnings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!body.dryRun) {
      await db.upsert([{ collection: 'meta', doc_id: 'sync', data: { ...(prevSync || {}), ok: false, attemptedAt: started.toISOString(), error: msg.slice(0, 300) }, updated_by: 'sync:pipedrive' }]).catch(() => {})
    }
    return json({ ok: false, error: msg }, 502)
  }
})
