import { supabase } from './supabase'

// Data Health checks — shared by the Sidebar (drives the Admin settings dot)
// and Settings' Data Health section (shows what's actually wrong + lets an
// admin dismiss an acknowledged issue). Severity is deliberately not uniform:
// "red" is reserved for things that need a person to fix data/config right
// now (misattributed rows hiding data from views); "orange" covers things
// that are usually self-healing via an existing tool (e.g. re-running
// Backfill Evaluations) rather than a sign something is actively broken.

export type HealthSeverity = 'red' | 'orange'

export interface HealthIssue {
  key: string
  severity: HealthSeverity
  title: string
  description: string
  count: number
}

const EVAL_BACKLOG_MIN = 5

export async function computeHealthIssues(): Promise<HealthIssue[]> {
  const [usersNoOp, issuesNoOp, accBacklog, quaBacklog] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true })
      .is('operator_id', null).not('operator_team', 'is', null),
    supabase.from('ticket_issues').select('id', { count: 'exact', head: true })
      .is('operator_id', null),
    supabase.from('ticket_issues').select('id', { count: 'exact', head: true })
      .neq('issue_type', 'No response').not('suggested_response', 'is', null).is('accuracy_ran_at', null),
    supabase.from('ticket_issues').select('id', { count: 'exact', head: true })
      .neq('issue_type', 'No response').not('suggested_response', 'is', null).is('quality_ran_at', null),
  ])

  const issues: HealthIssue[] = []

  if ((usersNoOp.count ?? 0) > 0) {
    issues.push({
      key: 'operator-attribution-users',
      severity: 'red',
      title: 'Users missing operator assignment',
      description: `${usersNoOp.count} user(s) have a team but no operator — set their operator in the Users tab. These users are silently hidden from operator-scoped views like the leaderboard and analytics.`,
      count: usersNoOp.count ?? 0,
    })
  }

  if ((issuesNoOp.count ?? 0) > 0) {
    issues.push({
      key: 'operator-attribution-issues',
      severity: 'red',
      title: 'Logged issues missing operator assignment',
      description: `${issuesNoOp.count} logged issue(s) have no operator — confirm every team value matches an Operator name. These rows are silently hidden from operator-scoped views.`,
      count: issuesNoOp.count ?? 0,
    })
  }

  const accCount = accBacklog.count ?? 0
  const quaCount = quaBacklog.count ?? 0
  if (accCount > EVAL_BACKLOG_MIN || quaCount > EVAL_BACKLOG_MIN) {
    issues.push({
      key: 'eval-backlog',
      severity: 'orange',
      title: 'Evaluation backlog',
      description: `${accCount} ticket(s) missing an accuracy score and ${quaCount} missing a quality score — usually left behind by an Anthropic credit outage that had no automatic retry. Run Backfill Evaluations with no date limit (not the default 14 days) to catch up.`,
      count: Math.max(accCount, quaCount),
    })
  }

  return issues
}

export async function fetchDismissals(): Promise<Record<string, number>> {
  const { data } = await supabase.from('data_health_dismissals').select('issue_key, dismissed_count')
  const map: Record<string, number> = {}
  for (const row of data ?? []) map[row.issue_key] = row.dismissed_count
  return map
}

// An issue stays dismissed only while its count hasn't grown past what was
// acknowledged — a worsening problem resurfaces on its own.
export function filterActive(issues: HealthIssue[], dismissals: Record<string, number>): HealthIssue[] {
  return issues.filter(i => !(i.key in dismissals) || i.count > dismissals[i.key])
}

export async function dismissIssue(key: string, count: number, dismissedBy: string | null): Promise<void> {
  await supabase.from('data_health_dismissals').upsert({
    issue_key: key, dismissed_count: count, dismissed_by: dismissedBy, dismissed_at: new Date().toISOString(),
  })
}
