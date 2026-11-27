import { authClient, supabase } from '../supabase'
import { computeHealthIssues, fetchDismissals, filterActive } from '../dataHealth'
import type { HealthIssue } from '../dataHealth'
import type { Data } from '../strategy/logic'
import { loadStrategyData } from '../strategy/useStrategy'
import type { AttemptLite, EvalRow, QuizLite } from './metrics'
import {
  accuracyErrors, bulletinPostedFor, chunk, distinctTickets, editedRate, localDateString, pendingAccuracyReviews, perfectRate, qualityAvg, quizTodo,
  splitPeriods, startOfLocalDay, unreadBulletins,
} from './metrics'

// Data for the Home cards and the Operators page. Reads use the same client the existing pages use,
// with the same definitions (see metrics.ts). Every function either returns data or throws; the card
// that called it shows a quiet "couldn't load" message, so one failing card never breaks Home.

const PAGE = 1000
async function pagedAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString()

// ---------------------------------------------------------------- operators
export interface OpPerf {
  operatorId: string; tickets: number; perfect: number; majority: number; partial: number; noResponse: number
  avgQuality: number | null; fullAuto: number; perfectRate: number | null; editedRate: number | null
}
// One aggregated read for all the operators given (the caller passes only operators the person may see).
export async function fetchOperatorPerf(operatorIds: string[], days: number): Promise<Record<string, OpPerf>> {
  if (!operatorIds.length) return {}
  const { data, error } = await supabase.rpc('operator_perf_summary', { p_operator_ids: operatorIds, p_days: days })
  if (error) throw new Error(error.message)
  const out: Record<string, OpPerf> = {}
  for (const r of (data || []) as Record<string, number | string | null>[]) {
    const perfect = Number(r.perfect), majority = Number(r.majority_edit), partial = Number(r.partial_edit)
    out[String(r.operator_id)] = {
      operatorId: String(r.operator_id), tickets: Number(r.tickets), perfect, majority, partial, noResponse: Number(r.no_response),
      avgQuality: r.avg_quality == null ? null : Number(r.avg_quality), fullAuto: Number(r.full_auto_tickets),
      perfectRate: perfectRate(perfect, majority, partial), editedRate: editedRate(perfect, majority, partial),
    }
  }
  return out
}

// ---------------------------------------------------------------- support agent
export async function fetchTicketsToday(agentEmail: string, operatorId: string | null): Promise<number> {
  let q = supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('agent_email', agentEmail).gte('created_at', startOfLocalDay().toISOString())
  if (operatorId) q = q.eq('operator_id', operatorId)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count || 0
}

export async function fetchMyWeek(agentEmail: string, operatorId: string | null, isQaMode: boolean): Promise<{ tickets: number; perfectRate: number | null }> {
  const rows = await pagedAll<{ issue_type: string; tickets: { id: string; ticket_number: string | number | null } | { id: string; ticket_number: string | number | null }[] }>((from, to) => {
    let q = supabase.from('ticket_issues').select('issue_type, tickets!inner(id, ticket_number, agent_email)').eq('tickets.agent_email', agentEmail).gte('created_at', daysAgo(7)).range(from, to)
    if (operatorId) q = q.eq('operator_id', operatorId)
    return q as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>
  })
  const t = rows.map(r => (Array.isArray(r.tickets) ? r.tickets[0] : r.tickets)).filter(Boolean)
  const c = (type: string) => rows.filter(r => r.issue_type === type).length
  return { tickets: distinctTickets(t, isQaMode), perfectRate: perfectRate(c('Perfect'), c('Majority edit'), c('Partial edit')) }
}

export async function fetchUnreadBulletins(email: string): Promise<{ id: string; bulletin_date: string }[]> {
  const [pub, seen] = await Promise.all([
    supabase.from('daily_bulletins').select('id, bulletin_date').eq('is_published', true).order('bulletin_date', { ascending: false }).limit(60),
    supabase.from('bulletin_views').select('bulletin_id').eq('user_email', email),
  ])
  if (pub.error) throw new Error(pub.error.message)
  if (seen.error) throw new Error(seen.error.message)
  return unreadBulletins((pub.data || []) as { id: string; bulletin_date: string }[], new Set((seen.data || []).map(r => r.bulletin_id as string)))
}

export async function fetchTrainingTodo(userId: string, operatorId: string | null, includeUnpublished: boolean) {
  let qz = supabase.from('quizzes').select('id, title, passing_score')
  qz = operatorId ? qz.or(`operator_id.eq.${operatorId},operator_id.is.null`) : qz.is('operator_id', null)
  if (!includeUnpublished) qz = qz.eq('is_published', true)
  const { data: quizzes, error } = await qz
  if (error) throw new Error(error.message)
  const list = (quizzes || []) as QuizLite[]
  if (!list.length) return []
  const { data: attempts, error: e2 } = await supabase.from('quiz_attempts').select('quiz_id, score_pct, passed, completed_at').eq('user_id', userId).in('quiz_id', list.map(q => q.id))
  if (e2) throw new Error(e2.message)
  return quizTodo(list, (attempts || []) as AttemptLite[])
}

// ---------------------------------------------------------------- QA
export interface QaWeek {
  quality: number | null; qualityPrior: number | null; errors: ReturnType<typeof accuracyErrors>; errorsPrior: ReturnType<typeof accuracyErrors>
  qualityFlags: number; pendingReviews: number
}
export async function fetchQaWeek(operatorId: string): Promise<QaWeek> {
  const rows = await pagedAll<EvalRow & { id: string }>((from, to) =>
    supabase.from('ticket_issues').select('id, created_at, quality_score, quality_ran_at, quality_flag, accuracy_error_class, accuracy_ran_at')
      .eq('operator_id', operatorId).gte('created_at', daysAgo(14)).order('created_at', { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: (EvalRow & { id: string })[] | null; error: { message: string } | null }>)
  const { current, prior } = splitPeriods(rows, new Date(), 7)
  const candidates = current.filter(r => r.accuracy_error_class === 'P1A' || r.accuracy_error_class === 'P1B' || r.accuracy_error_class === 'P2')
  let reviews: { ticket_issue_id: string; eval_type: string; review_status: string }[] = []
  for (const ids of chunk(candidates.map(r => r.id), 400)) {
    const { data, error } = await supabase.from('ticket_issue_reviews').select('ticket_issue_id, eval_type, review_status').eq('eval_type', 'accuracy').in('ticket_issue_id', ids)
    if (error) throw new Error(error.message)
    reviews = reviews.concat((data || []) as typeof reviews)
  }
  return {
    quality: qualityAvg(current), qualityPrior: qualityAvg(prior), errors: accuracyErrors(current), errorsPrior: accuracyErrors(prior),
    qualityFlags: current.filter(r => r.quality_flag === true).length, pendingReviews: pendingAccuracyReviews(candidates, reviews),
  }
}

export async function fetchOpenBugs(operatorId: string): Promise<number> {
  const { count, error } = await supabase.from('bug_reports').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('operator_id', operatorId)
  if (error) throw new Error(error.message)
  return count || 0
}

// ---------------------------------------------------------------- admin
export async function fetchTeamToday(operatorId: string): Promise<{ tickets: number; agents: number }> {
  const rows = await pagedAll<{ agent_email: string | null }>((from, to) =>
    supabase.from('tickets').select('agent_email').eq('operator_id', operatorId).gte('created_at', startOfLocalDay().toISOString()).range(from, to) as unknown as PromiseLike<{ data: { agent_email: string | null }[] | null; error: { message: string } | null }>)
  return { tickets: rows.length, agents: new Set(rows.map(r => r.agent_email).filter(Boolean)).size }
}

export async function fetchBulletinPostedToday(): Promise<boolean> {
  const today = localDateString()
  const { data, error } = await supabase.from('daily_bulletins').select('bulletin_date, is_published').eq('bulletin_date', today)
  if (error) throw new Error(error.message)
  return bulletinPostedFor(today, (data || []) as { bulletin_date: string; is_published: boolean }[])
}

// ---------------------------------------------------------------- SuperAdmin
export async function fetchPlatformHealth(): Promise<{ issues: HealthIssue[]; red: number; orange: number; lastEval: { run_at: string; pass_rate: number } | null }> {
  const [issues, dismissals] = await Promise.all([computeHealthIssues(), fetchDismissals()])
  const active = filterActive(issues, dismissals)
  const { data } = await supabase.from('eval_regression_runs').select('run_at, pass_rate').order('run_at', { ascending: false }).limit(1)
  const last = (data || [])[0] as { run_at: string; pass_rate: number | string } | undefined
  return { issues: active, red: active.filter(i => i.severity === 'red').length, orange: active.filter(i => i.severity === 'orange').length, lastEval: last ? { run_at: last.run_at, pass_rate: Number(last.pass_rate) } : null }
}

export async function fetchPeopleSummary(): Promise<{ users: number; superadmins: number; customProfiles: number | null }> {
  const [u, s] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'superadmin'),
  ])
  if (u.error) throw new Error(u.error.message)
  const p = await supabase.from('access_profiles').select('key', { count: 'exact', head: true }).eq('built_in', false)
  return { users: u.count || 0, superadmins: s.count || 0, customProfiles: p.error ? null : (p.count || 0) }
}

// ---------------------------------------------------------------- company
export const fetchStrategy = (): Promise<Data> => loadStrategyData()

export async function fetchRoadmapGlance(): Promise<{ sprintSummary: string; newsToDiscuss: number }> {
  const [sprint, news] = await Promise.all([
    authClient.from('roadmap_docs').select('data').eq('collection', 'meta').eq('doc_id', 'sprint').maybeSingle(),
    authClient.from('roadmap_docs').select('data->>status').eq('collection', 'news'),
  ])
  if (sprint.error) throw new Error(sprint.error.message)
  if (news.error) throw new Error(news.error.message)
  const rows = (news.data || []) as unknown as { status: string | null }[]
  return { sprintSummary: String((sprint.data?.data as { summary?: string } | undefined)?.summary || ''), newsToDiscuss: rows.filter(r => r.status !== 'discussed').length }
}
