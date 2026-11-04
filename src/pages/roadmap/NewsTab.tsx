import { useState } from 'react'
import type { Doc } from '../../lib/roadmap/logic'
import { ACTIONS, CATS, D, newId, safeUrl } from '../../lib/roadmap/logic'
import type { Ctx } from './ui'
import { newsWrite, todayLocalISO } from './helpers'

const CatChip = ({ n }: { n: Doc }) => n.category && CATS[n.category]
  ? <span className={`rm-chip rm-cat-${n.category}`}>{CATS[n.category]}</span> : <span className="rm-chip rm-cat-none">To categorise</span>
const ActChip = ({ n }: { n: Doc }) => n.action === 'required' ? <span className="rm-chip rm-act-yes">Action required</span>
  : n.action === 'none' ? <span className="rm-chip rm-act-no">No action required</span> : <span className="rm-chip rm-act-none">Action not decided</span>
export { CatChip, ActChip }

function DateBlock({ n }: { n: Doc }) {
  const x = D(n.date)
  if (!x || isNaN(x.getTime())) return <div className="dt none"><b>No date</b></div>
  return <div className="dt"><b>{x.getDate()}</b><span>{x.toLocaleDateString(undefined, { month: 'short' })}</span><small>{x.getFullYear()}</small></div>
}

export default function NewsTab({ ctx }: { ctx: Ctx }) {
  const [cat, setCat] = useState('all')
  const [act, setAct] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [f, setF] = useState({ title: '', source: '', url: '', date: todayLocalISO(), summary: '' })
  const list = [...ctx.v.news.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const counts: Record<string, number> = { all: list.length, none: list.filter(n => !CATS[n.category]).length }
  Object.keys(CATS).forEach(k => { counts[k] = list.filter(n => n.category === k).length })
  const ac: Record<string, number> = { all: list.length, required: list.filter(n => n.action === 'required').length, none: list.filter(n => n.action === 'none').length, undecided: list.filter(n => !ACTIONS[n.action]).length }
  const rows = list
    .filter(n => cat === 'all' ? true : cat === 'none' ? !CATS[n.category] : n.category === cat)
    .filter(n => act === 'all' ? true : act === 'undecided' ? !ACTIONS[n.action] : n.action === act)
  const ctrl = ctx.canEdit && ctx.editing

  async function turnIntoIdea(n: Doc) {
    const iid = newId('idea'), now = new Date().toISOString()
    try {
      await ctx.writer.set('items', iid, { title: n.title, story: '', theme: '', horizon: 'idea', priority: '', owner: '', assignedTo: '', delivery: 'tbc', source: 'news', newsId: n.id, note: 'From industry news: ' + n.title, reason: '', order: 1000 + ctx.v.items.size, createdAt: now, updatedAt: now })
      await newsWrite(ctx, n.id, { ideaId: iid }, 'Added to Future Focus')
    } catch { ctx.toast("Couldn't create the idea. Try again.") }
  }
  async function addNews(e: React.FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return
    const now = new Date().toISOString()
    try {
      await ctx.writer.set('news', newId('news'), { title: f.title.trim(), source: f.source.trim(), url: f.url.trim(), date: f.date, summary: f.summary.trim(), category: '', action: '', status: 'new', discussion: '', relevance: '', addedAt: now, updatedAt: now })
      setF(s => ({ ...s, title: '', source: '', url: '', summary: '' })); setFormOpen(false); ctx.toast('News added')
    } catch { ctx.toast("Couldn't add the news item. Try again.") }
  }

  const card = (n: Doc) => {
    const url = safeUrl(n.url)
    const stop = (e: React.MouseEvent) => e.stopPropagation()
    return (
      <article key={n.id} className="rm-news" onClick={() => ctx.open({ kind: 'news', id: n.id })}>
        <DateBlock n={n} />
        <span className="meta">{n.source ? n.source : 'No source'}</span>
        <h4>{url ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={stop}>{n.title} ↗</a> : n.title}</h4>
        {n.summary ? <p className="sum">{n.summary}</p> : null}
        <div className="side"><CatChip n={n} /><ActChip n={n} />{n.status === 'discussed' && <span className="rm-chip plain">Discussed</span>}</div>
        {n.action === 'required' && n.actionNote ? <div className="todo"><b>Action:</b> {n.actionNote}{n.actionOwner ? ' · ' + n.actionOwner : ''}</div> : null}
        {n.discussion ? <div className="disc"><b>Team notes:</b> {n.discussion}</div> : null}
        {ctrl && (
          <div className="rm-ctrl" onClick={stop}>
            <span className="rm-pseg" role="group" aria-label="Category">{Object.entries(CATS).map(([k, l]) =>
              <button key={k} type="button" aria-pressed={n.category === k} onClick={() => newsWrite(ctx, n.id, { category: n.category === k ? '' : k })}>{l}</button>)}</span>
            <span className="rm-pseg" role="group" aria-label="Action">{Object.entries(ACTIONS).map(([k, l]) =>
              <button key={k} type="button" aria-pressed={n.action === k} onClick={() => newsWrite(ctx, n.id, { action: n.action === k ? '' : k })}>{l}</button>)}</span>
            {!n.ideaId && <button type="button" className="rm-mbtn" onClick={() => turnIntoIdea(n)}>Turn into idea</button>}
            <button type="button" className="rm-mbtn" onClick={() => newsWrite(ctx, n.id, { status: n.status === 'discussed' ? 'new' : 'discussed' })}>{n.status === 'discussed' ? 'Mark not discussed' : 'Mark discussed'}</button>
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="rm-sec">
      <div className="rm-sec-head">
        <div><h2>Industry news</h2><p>Stories from the daily AI Briefing and Competitor Radar in #ai-newsletter arrive here each day, plus anything added by hand: announcements, emails and market moves worth a team conversation. Categorise each one, talk it through, and turn the ones that matter into ideas on Future Focus.</p></div>
        {ctx.canEdit && !formOpen && <button type="button" className="rm-btn rm-btn--sm" onClick={() => setFormOpen(true)}>Add news</button>}
      </div>
      {ctx.canEdit && formOpen && (
        <form className="rm-form-card news" onSubmit={addNews}>
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Headline" aria-label="Headline" autoFocus />
          <input value={f.source} onChange={e => setF({ ...f, source: e.target.value })} placeholder="Source, e.g. a customer email" aria-label="Source" />
          <input type="url" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="Link (optional)" aria-label="Link" />
          <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} aria-label="Date" />
          <textarea value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} placeholder="What happened, in a sentence or two" aria-label="Summary" />
          <button className="rm-btn" type="submit" style={{ alignSelf: 'start' }}>Add news</button>
        </form>
      )}
      <div className="rm-cat-filter" role="group" aria-label="Filter by category">
        {([['all', 'All'], ['none', 'To categorise'], ...Object.entries(CATS)] as [string, string][]).map(([k, l]) =>
          <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)}>{l} <span className="n">{counts[k]}</span></button>)}
        <span className="rm-filter-sep" aria-hidden="true" />
        {([['all', 'Any action'], ['required', 'Action required'], ['undecided', 'Not decided'], ['none', 'No action']] as [string, string][]).map(([k, l]) =>
          <button key={k} type="button" aria-pressed={act === k} onClick={() => setAct(k)}>{l} <span className="n">{ac[k]}</span></button>)}
      </div>
      <div className="rm-news-list">
        {rows.map(card)}
        {!rows.length && <div className="rm-state">{list.length ? 'Nothing matches this filter.' : 'No news yet.' + (ctx.canEdit ? ' Add the first item above.' : '')}</div>}
      </div>
    </div>
  )
}
