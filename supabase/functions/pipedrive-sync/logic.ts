// pipedrive-sync -- pure logic (no network, no Deno), testable in Node.
//
// Turns Pipedrive API objects into the compact documents the Sales Funnel page reads, and holds the
// safety rules: how a deal's stage history is read, which deals need their history (re)fetched, and
// when a response looks wrong enough that nothing should be written.
//
// Everything Pipedrive returns is treated as data: only the fields below are read, strings are capped,
// and ids must be numbers.

export interface PipelineCfg {
  key: string; id: number; name: string; label: string
  pre: Record<string, string>; lostStage: number | null; wonStep: number | null
  steps: { name: string; stages: number[] }[]
}
export interface FunnelConfig { windowDays?: number; hiddenDeals?: number[]; pipelines: PipelineCfg[]; stageNames: Record<string, string> }

export type StageHistory = [number, string][] // [stage id, YYYY-MM-DD it entered that stage]
export interface Deal {
  id: number; pipeline: string; title: string; stage: number; status: string
  owner: number | null; value: number; cur: string; acv: number; prob: number | null
  added: string; changed: string | null; closed: string | null; exp: string | null; next: number | null; lost: string
  history: StageHistory; historyOk: boolean; deleted?: boolean
}
export interface Activity { id: number; type: string; subject: string; due: string | null }

const cap = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const num = (x: unknown): number | null => { const n = Number(x); return x !== null && x !== '' && x !== undefined && isFinite(n) ? n : null }
const day = (s: unknown): string | null => { const t = String(s ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null }

export function normalizeDeal(d: any, pipelineKey: string): Deal | null {
  const id = num(d?.id), stage = num(d?.stage_id)
  if (id === null || stage === null) return null
  const acv = d?.acv && typeof d.acv === 'object' ? num(d.acv.value) : num(d?.acv)
  return {
    id, pipeline: pipelineKey, title: cap(d.title, 200), stage, status: cap(d.status, 12) || 'open',
    owner: num(d.owner_id && typeof d.owner_id === 'object' ? d.owner_id.id : d.owner_id), value: num(d.value) ?? 0, cur: cap(d.currency, 6) || 'USD', acv: acv ?? 0,
    prob: num(d.probability), added: day(d.add_time) || '', changed: day(d.stage_change_time), closed: day(d.close_time), exp: day(d.expected_close_date),
    next: num(d.next_activity_id), lost: cap(d.lost_reason, 160), history: [], historyOk: false, deleted: d.is_deleted === true ? true : undefined,
  }
}

// A deal's stage history needs (re)reading when we have none, the last read failed, or the deal has moved since.
export function needsHistory(next: Deal, stored: Deal | undefined): boolean {
  return !stored || !stored.historyOk || stored.stage !== next.stage || stored.changed !== next.changed || stored.status !== next.status
}
// Newest changes first, never more than `max` per run, so the daily request budget is protected; the rest wait for the next run.
export function planFlows(deals: Deal[], stored: Map<number, Deal>, max: number): number[] {
  return deals.filter(d => needsHistory(d, stored.get(d.id)))
    .sort((a, b) => Number(!!stored.get(a.id)) - Number(!!stored.get(b.id)) || String(b.changed || b.added).localeCompare(String(a.changed || a.added)))
    .slice(0, max).map(d => d.id)
}

// GET /deals/{id}/flow -> stage history. Items look like {object:'dealChange', data:{field_key:'stage_id', old_value, new_value, log_time}}.
export function parseFlow(items: unknown, deal: Pick<Deal, 'stage' | 'added'>): { history: StageHistory; ok: boolean } {
  if (!Array.isArray(items)) return { history: [], ok: false }
  const changes = items
    .filter((it: any) => it && it.object === 'dealChange' && it.data && it.data.field_key === 'stage_id')
    .map((it: any) => ({ old: num(it.data.old_value), nw: num(it.data.new_value), at: day(it.data.log_time ?? it.timestamp) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  if (!changes.length) return { history: [[deal.stage, deal.added]], ok: true }
  if (changes.some(c => c.nw === null || !c.at)) return { history: [], ok: false }
  const first = changes[0]
  const history: StageHistory = []
  if (first.old !== null) history.push([first.old, deal.added || first.at as string])
  for (const c of changes) history.push([c.nw as number, c.at as string])
  return { history, ok: true }
}

export function normalizeActivity(a: any): Activity | null {
  const id = num(a?.id); if (id === null) return null
  return { id, type: cap(a.type, 30), subject: cap(a.subject, 140), due: day(a.due_date) }
}

// ---- safety
export function listLooksWrong(fetched: number, stored: number): string {
  if (stored >= 10 && fetched < stored * 0.5) return `Pipedrive returned ${fetched} deals but ${stored} are stored. Not writing, in case the response is incomplete.`
  return ''
}
// Deals we hold that Pipedrive no longer returns. Marked deleted (never removed), and only a few per run.
export function vanishedDeals(stored: Deal[], fetchedIds: Set<number>, max: number): { ids: number[]; tooMany: boolean } {
  const ids = stored.filter(d => !d.deleted && !fetchedIds.has(d.id)).map(d => d.id)
  return ids.length > max ? { ids: [], tooMany: true } : { ids, tooMany: false }
}

export function mergeDeal(next: Deal, stored: Deal | undefined, flow: { history: StageHistory; ok: boolean } | null): Deal {
  if (flow && flow.ok) return { ...next, history: flow.history, historyOk: true }
  if (stored && stored.historyOk && stored.stage === next.stage && stored.changed === next.changed && stored.status === next.status) return { ...next, history: stored.history, historyOk: true }
  return { ...next, history: stored?.history || [], historyOk: false }
}

export function validateConfig(c: any): string {
  if (!c || !Array.isArray(c.pipelines) || !c.pipelines.length) return 'The funnel config has no pipelines.'
  for (const p of c.pipelines) if (!p || typeof p.key !== 'string' || !Number.isFinite(Number(p.id)) || !Array.isArray(p.steps)) return 'A pipeline in the funnel config is malformed.'
  return ''
}
