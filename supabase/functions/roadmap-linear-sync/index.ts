// roadmap-linear-sync
//
// Keeps the Product Roadmap's Linear data fresh. Replaces the Claude
// "Raphie roadmap Linear sync" scheduled task: Command Center now pulls from
// Linear itself, on a cron (see 20261105_roadmap_cron.sql).
//
// Calling it (always requires the x-roadmap-secret header = ROADMAP_INGEST_SECRET;
// the daily cron reads the secret from Supabase Vault at run time):
//   {"force": true}   -> run now and write
//   {}                -> run and write, unless a sync was attempted in the last 30 minutes
//   {"dryRun": true}  -> return what it WOULD write, writes nothing
//   {"introspect": "Project"} -> list a Linear GraphQL type's fields (debugging)
//
// Safety: it never touches the hand-edited collections, never deletes more than
// 10 docs in a run, and if Linear can't be read it leaves the existing data alone
// and records the failure so the page shows its "sync failed" banner.
import { corsHeaders } from '../_shared/cors.ts'
import { roadmapDb as db, sameSecret } from '../_shared/roadmap-db.ts'
import {
  quarterInfo, countIssues, resolveProjectIds, selectProjects, buildProjectDoc, buildInitiativeDoc, cycleDoc, changedFields,
  isWindowInitiative,
} from './logic.ts'
import type { LProject, LIssue, LInitiative, LCycle } from './logic.ts'

const LINEAR_API_KEY = Deno.env.get('LINEAR_API_KEY')
const SECRET = Deno.env.get('ROADMAP_INGEST_SECRET')
const TEAM_KEY = 'RAPH'
const MAX_DELETES = 10
const THROTTLE_MS = 30 * 60 * 1000

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST', headers: { Authorization: LINEAR_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Linear API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  if (j.errors) throw new Error(`Linear API error: ${JSON.stringify(j.errors).slice(0, 400)}`)
  return j.data
}
async function pages<T>(query: string, key: string, vars: Record<string, unknown> = {}, map: (n: any) => T): Promise<T[]> {
  const out: T[] = []
  let after: string | null = null
  for (let i = 0; i < 40; i++) {
    const data = await gql(query, { ...vars, after })
    const conn = data[key]
    out.push(...conn.nodes.map(map))
    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }
  return out
}

const PROJECTS_Q = `query($after:String){ projects(first:25, after:$after, includeArchived:false, filter:{ accessibleTeams:{ some:{ key:{ eq:"${TEAM_KEY}" } } } }){
  pageInfo{ hasNextPage endCursor }
  nodes{ id identifier slugId name url status{ name type } startDate targetDate createdAt completedAt canceledAt lead{ name email }
    labels(first:20){ nodes{ name } } initiatives(first:20){ nodes{ id name } } projectMilestones(first:25){ nodes{ name targetDate progress } } } } }`
const ISSUES_Q = `query($after:String,$since:DateTimeOrDuration){ issues(first:100, after:$after, includeArchived:false, filter:{ team:{ key:{ eq:"${TEAM_KEY}" } },
  or:[ { completedAt:{ gte:$since } }, { state:{ type:{ nin:["completed","canceled"] } } } ] }){
  pageInfo{ hasNextPage endCursor }
  nodes{ state{ name type } assignee{ name email } completedAt project{ id } labels(first:15){ nodes{ name } } } } }`
const INITS_Q = `query($after:String){ initiatives(first:100, after:$after){ pageInfo{ hasNextPage endCursor }
  nodes{ id identifier slugId name status health targetDate description url owner{ name email } parentInitiative{ name } } } }`
const CYCLE_Q = `query{ cycles(first:1, filter:{ team:{ key:{ eq:"${TEAM_KEY}" } }, isActive:{ eq:true } }){ nodes{ number startsAt endsAt issueCountHistory completedIssueCountHistory } } }`

async function readLinear() {
  const projects = await pages<LProject>(PROJECTS_Q, 'projects', {}, n => ({
    id: n.id, identifier: n.identifier, slugId: n.slugId, name: n.name, url: n.url, statusName: n.status?.name || '', statusType: n.status?.type || '',
    startDate: n.startDate, targetDate: n.targetDate, createdAt: n.createdAt, completedAt: n.completedAt, canceledAt: n.canceledAt,
    lead: n.lead, labels: (n.labels?.nodes || []).map((l: any) => l.name), initiatives: n.initiatives?.nodes || [],
    milestones: (n.projectMilestones?.nodes || []).map((m: any) => ({ name: m.name, targetDate: m.targetDate, progress: m.progress })),
  }))
  return { projects }
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405)
  if (!LINEAR_API_KEY) return json({ ok: false, error: 'LINEAR_API_KEY is not configured.' }, 500)
  const body = await req.json().catch(() => ({}))
  if (!SECRET) return json({ ok: false, error: 'ROADMAP_INGEST_SECRET is not configured.' }, 500)
  if (!sameSecret(req.headers.get('x-roadmap-secret') || '', SECRET)) return json({ ok: false, error: 'Unauthorized.' }, 401)

  // ---- debugging: list the fields of a Linear GraphQL type ----
  if (body.introspect) {
    try {
      const d = await gql(`query($n:String!){ __type(name:$n){ fields{ name type{ name kind ofType{ name kind } } } } }`, { n: String(body.introspect) })
      return json({ ok: true, type: body.introspect, fields: (d.__type?.fields || []).map((f: any) => `${f.name}: ${f.type?.name || f.type?.ofType?.name || f.type?.kind}`) })
    } catch (e) { return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 502) }
  }

  const started = new Date()
  const prevSync = await db.get('sync', 'linear')
  if (!body.force && !body.dryRun && prevSync?.attemptedAt && started.getTime() - new Date(prevSync.attemptedAt).getTime() < THROTTLE_MS) {
    return json({ ok: true, skipped: 'A sync was attempted in the last 30 minutes.' })
  }

  try {
    const q = quarterInfo(started)
    const [{ projects: allProjects }, issues, inits, cycle, existingProjects, existingInits] = await Promise.all([
      readLinear(),
      pages<LIssue>(ISSUES_Q, 'issues', { since: q.qStart }, n => ({
        projectId: n.project?.id ?? null, statusName: n.state?.name || '', statusType: n.state?.type || '', assignee: n.assignee,
        completedAt: n.completedAt, labels: (n.labels?.nodes || []).map((l: any) => l.name),
      })),
      pages<LInitiative>(INITS_Q, 'initiatives', {}, n => ({
        id: n.id, identifier: n.identifier, slugId: n.slugId, name: n.name, status: n.status, health: n.health, targetDate: n.targetDate, description: n.description,
        url: n.url, owner: n.owner, parentName: n.parentInitiative?.name ?? null,
      })),
      gql(CYCLE_Q).then(d => (d.cycles.nodes[0] || null) as LCycle | null),
      db.list('linear'), db.list('initiatives'),
    ])
    const goalInits = inits.filter(i => i.name && !isWindowInitiative(i.name) && i.status !== 'Completed')
    const stats = countIssues(issues, q.qStart)
    const idMatch = resolveProjectIds(allProjects, existingProjects)
    const idOf = (p: LProject) => idMatch.get(p.id)!.id
    const chosen = selectProjects(allProjects, stats.per, new Set(goalInits.map(i => i.name)), new Set(existingProjects.map(d => d.id)), idOf, q)

    const existingById = new Map(existingProjects.map(d => [d.id, d.data]))
    const projectDocs = chosen.map(p => ({ id: idOf(p), how: idMatch.get(p.id)!.how, data: buildProjectDoc(p, idOf(p), stats.per.get(p.id), existingById.get(idOf(p))) }))
    const keep = new Set(projectDocs.map(d => d.id))
    const staleProjects = existingProjects.filter(d => !keep.has(d.id)).map(d => d.id)

    const initDocs = goalInits.map(i => ({ id: i.identifier || `I-${i.slugId}`, data: buildInitiativeDoc(i) }))
    const keepInit = new Set(initDocs.map(d => d.id))
    const staleInits = existingInits.filter(d => !keepInit.has(d.id)).map(d => d.id)

    const now = started.toISOString()
    const syncDoc = {
      ok: true, syncedAt: now, lastGoodAt: now, attemptedAt: now, error: '', projects: projectDocs.length, initiatives: initDocs.length,
      noProjectDoneQ4: stats.noProjectDone, cycle: cycleDoc(cycle), lightsOn: stats.lights,
      note: 'Daily sync from Linear. Issue counts cover the current quarter.',
      themes: prevSync?.themes ?? {}, spinach: prevSync?.spinach ?? null,
    }

    const warnings: string[] = []
    if (stats.unlisted.length) warnings.push(`Issue status names not in the known list (bucketed by type): ${stats.unlisted.join(', ')}`)
    const newOnes = projectDocs.filter(d => d.how === 'new').map(d => d.data.name)
    if (newOnes.length) warnings.push(`${newOnes.length} project(s) with no matching existing doc get a new id (P-<slug>): ${newOnes.join(' | ')}`)

    const deletes = [...staleProjects.map(id => ({ c: 'linear', id })), ...staleInits.map(id => ({ c: 'initiatives', id }))]
    const tooMany = deletes.length > MAX_DELETES
    if (tooMany) warnings.push(`${deletes.length} docs would be deleted (limit ${MAX_DELETES}); deleting none this run.`)

    if (body.dryRun) {
      return json({
        ok: true, dryRun: true, quarter: q, counts: { linearProjects: allProjects.length, issues: issues.length, goalInitiatives: initDocs.length, writeProjects: projectDocs.length, deleteCandidates: deletes.length },
        idMatching: Object.fromEntries(['identifier', 'slug', 'name', 'new'].map(h => [h, projectDocs.filter(d => d.how === h).length])),
        wouldDelete: deletes, warnings, sync: syncDoc,
        changes: projectDocs.map(d => ({ id: d.id, name: d.data.name, how: d.how, changed: changedFields(existingById.get(d.id), d.data) })),
        sampleDoc: projectDocs[0],
      })
    }

    await db.upsert([
      ...projectDocs.map(d => ({ collection: 'linear', doc_id: d.id, data: d.data, updated_by: 'sync:linear' })),
      ...initDocs.map(d => ({ collection: 'initiatives', doc_id: d.id, data: d.data, updated_by: 'sync:linear' })),
    ])
    if (!tooMany) { await db.remove('linear', staleProjects); await db.remove('initiatives', staleInits) }
    await db.upsert([{ collection: 'sync', doc_id: 'linear', data: syncDoc, updated_by: 'sync:linear' }])
    return json({ ok: true, projects: projectDocs.length, initiatives: initDocs.length, deleted: tooMany ? 0 : deletes.length, warnings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!body.dryRun) {
      // never overwrite good data: only record the failure so the page shows its banner
      await db.upsert([{ collection: 'sync', doc_id: 'linear', data: { ...(prevSync || {}), ok: false, attemptedAt: started.toISOString(), error: msg.slice(0, 300) }, updated_by: 'sync:linear' }]).catch(() => {})
    }
    return json({ ok: false, error: msg }, 502)
  }
})
