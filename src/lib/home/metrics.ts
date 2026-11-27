// Home card metrics -- pure functions, no imports, testable in Node.
// Each follows how the existing pages already define the same number, so Home never
// contradicts them (Analytics for perfect rate, Report Card for quality and accuracy,
// Bulletin for unread, Learn's quizzes for training).

// Perfect / (Perfect + Majority edit + Partial edit). "No response" is not counted (Analytics).
export function perfectRate(perfect: number, majority: number, partial: number): number | null {
  const d = perfect + majority + partial
  return d > 0 ? perfect / d : null
}
export function editedRate(perfect: number, majority: number, partial: number): number | null {
  const r = perfectRate(perfect, majority, partial)
  return r == null ? null : 1 - r
}
export const pct = (r: number | null, digits = 1) => (r == null ? '—' : (r * 100).toFixed(digits) + '%')

// Local midnight: the app has no timezone setting, every page uses the browser's local day.
export function startOfLocalDay(now: Date = new Date()): Date { const d = new Date(now); d.setHours(0, 0, 0, 0); return d }
export function localDateString(now: Date = new Date()): string {
  const m = now.getMonth() + 1, d = now.getDate()
  return now.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d
}

// A ticket is counted once however many responses it has. QA-mode operators reuse ticket numbers,
// so they are counted by row id.
export function distinctTickets(rows: { id?: string; ticket_number?: string | number | null }[], isQaMode: boolean): number {
  const keys = new Set<string>()
  for (const r of rows) keys.add(String(isQaMode ? r.id : (r.ticket_number ?? r.id)))
  return keys.size
}

// ---- bulletin
export const unreadBulletins = <T extends { id: string }>(published: T[], viewedIds: Set<string>): T[] => published.filter(b => !viewedIds.has(b.id))
export const bulletinPostedFor = (date: string, rows: { bulletin_date: string; is_published: boolean }[]) =>
  rows.some(r => r.bulletin_date === date && r.is_published)

// ---- training
export interface QuizLite { id: string; title: string; passing_score: number }
export interface AttemptLite { quiz_id: string; score_pct: number; passed: boolean | null; completed_at: string }
// Based on each quiz's LATEST attempt, as the Learn page shows it.
export function quizTodo(quizzes: QuizLite[], attempts: AttemptLite[]): { quiz: QuizLite; status: 'not_started' | 'not_passed' }[] {
  const latest = new Map<string, AttemptLite>()
  for (const a of attempts) { const cur = latest.get(a.quiz_id); if (!cur || a.completed_at > cur.completed_at) latest.set(a.quiz_id, a) }
  const out: { quiz: QuizLite; status: 'not_started' | 'not_passed' }[] = []
  for (const q of quizzes) {
    const a = latest.get(q.id)
    if (!a) out.push({ quiz: q, status: 'not_started' })
    else if (!(a.passed ?? a.score_pct >= q.passing_score)) out.push({ quiz: q, status: 'not_passed' })
  }
  return out
}

// ---- quality and accuracy (Report Card definitions)
export interface EvalRow { created_at: string; quality_score: number | null; quality_ran_at: string | null; quality_flag: boolean | null; accuracy_error_class: string | null; accuracy_ran_at: string | null }
export const QUALITY_TARGET = 3.5
export function qualityAvg(rows: EvalRow[]): number | null {
  const s = rows.filter(r => r.quality_ran_at && r.quality_score != null).map(r => Number(r.quality_score))
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null
}
export interface Errs { p1a: number; p1b: number; p2: number; total: number }
export function accuracyErrors(rows: EvalRow[]): Errs {
  const e = { p1a: 0, p1b: 0, p2: 0, total: 0 }
  for (const r of rows) {
    if (!r.accuracy_ran_at) continue
    if (r.accuracy_error_class === 'P1A') e.p1a++
    else if (r.accuracy_error_class === 'P1B') e.p1b++
    else if (r.accuracy_error_class === 'P2') e.p2++
  }
  e.total = e.p1a + e.p1b + e.p2
  return e
}
// Rows in the last `days` days (current) and the `days` before that (prior), by created_at.
export function splitPeriods<T extends { created_at: string }>(rows: T[], now: Date, days: number): { current: T[]; prior: T[] } {
  const cut = now.getTime() - days * 864e5, cut2 = now.getTime() - 2 * days * 864e5
  return {
    current: rows.filter(r => new Date(r.created_at).getTime() >= cut),
    prior: rows.filter(r => { const t = new Date(r.created_at).getTime(); return t >= cut2 && t < cut }),
  }
}
// Accuracy errors still waiting for a human: an error class with no confirmed or dismissed review.
export function pendingAccuracyReviews(issues: { id: string; accuracy_error_class: string | null }[], reviews: { ticket_issue_id: string; eval_type: string; review_status: string }[]): number {
  const done = new Set(reviews.filter(r => r.eval_type === 'accuracy' && (r.review_status === 'confirmed' || r.review_status === 'dismissed')).map(r => r.ticket_issue_id))
  return issues.filter(i => (i.accuracy_error_class === 'P1A' || i.accuracy_error_class === 'P1B' || i.accuracy_error_class === 'P2') && !done.has(i.id)).length
}

export const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out }

// A short sentence for "Needs attention" style rows.
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
