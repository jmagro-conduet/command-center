// roadmap-news-sync -- pure logic (no network, no Deno), testable in Node.
//
// Turns the daily "Raphie AI Briefing" and "Competitor Radar" Slack posts into
// Industry news docs. Same rules the Claude task used; the story extraction
// itself is done by Claude in index.ts, and everything it returns is treated as
// untrusted data: only the fields below are read, lengths are capped, and links
// must be plain http(s).

export type PostKind = 'briefing' | 'radar'
export interface SlackPost { ts: string; text: string }
export interface Story { title: string; sourceName: string; url: string; summary: string; relevance: string }
export interface ExistingNews { id: string; data: Record<string, any> }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function postKind(text: string): PostKind | null {
  if (/competitor radar/i.test(text)) return 'radar'
  if (/ai briefing/i.test(text)) return 'briefing'
  return null
}

// Slack mrkdwn: <https://x|label> -> label (url), <https://x> -> url, &amp; &lt; &gt;
export function slackToText(t: string): string {
  return t
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

export const dayOf = (ts: string, tz = 'America/New_York') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(+ts.split('.')[0] * 1000))

const cap = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const safeUrl = (u: unknown) => (/^https?:\/\/[^\s]+$/i.test(String(u ?? '').trim()) ? String(u).trim() : '')

// Claude is asked for a JSON array; be tolerant of code fences / prose around it.
export function parseStories(raw: string): Story[] {
  const a = raw.indexOf('['), b = raw.lastIndexOf(']')
  if (a < 0 || b <= a) return []
  let arr: unknown
  try { arr = JSON.parse(raw.slice(a, b + 1)) } catch { return [] }
  if (!Array.isArray(arr)) return []
  return arr.filter(x => x && typeof x === 'object' && typeof (x as any).title === 'string' && (x as any).title.trim())
    .slice(0, 30).map((x: any) => ({
      title: cap(x.title, 200).replace(/^\d+[.)]\s*/, '').replace(/\s*\(follow-up\)\s*$/i, ''),
      sourceName: cap(x.sourceName, 80), url: safeUrl(x.url), summary: cap(x.summary, 600), relevance: cap(x.relevance, 400),
    }))
}

export function buildNewsDocs(kind: PostKind, date: string, stories: Story[], existing: ExistingNews[], nowIso: string) {
  const urls = new Set(existing.map(e => String(e.data.url || '').trim()).filter(Boolean))
  const titles = new Set(existing.map(e => norm(e.data.title)))
  const ids = new Set(existing.map(e => e.id))
  const prefix = kind === 'radar' ? `nl-radar-${date}-` : `nl-${date}-`
  const out: { id: string; data: Record<string, any> }[] = []
  stories.forEach((s, i) => {
    const id = prefix + (i + 1)
    if (ids.has(id) || (s.url && urls.has(s.url)) || titles.has(norm(s.title))) return
    urls.add(s.url); titles.add(norm(s.title))
    out.push({
      id, data: {
        title: s.title, source: (kind === 'radar' ? 'Competitor Radar' : 'AI Briefing') + (s.sourceName ? ' · ' + s.sourceName : ''),
        url: s.url, date, summary: s.summary, relevance: s.relevance, category: '', action: '', status: 'new', discussion: '',
        origin: 'ai-newsletter', addedAt: nowIso, updatedAt: nowIso,
      },
    })
  })
  return out
}

export const EXTRACT_RULES = {
  briefing: `This is a "Raphie AI Briefing". Each numbered story under AI NEWS is one news item. Skip the TL;DR, the AI TOOLKIT section, tools and prompting tips.`,
  radar: `This is a "Competitor Radar". Each concrete, dated competitor move (a launch, acquisition, funding, partnership, price change, customer win) is one news item. Skip "no material moves", watchlist health and pending-review notes.`,
}
