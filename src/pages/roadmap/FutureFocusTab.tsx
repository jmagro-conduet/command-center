import { useState } from 'react'
import type { Candidate } from '../../lib/roadmap/logic'
import { ALIGN, CONF, IMPACT, candidates, fmt, newId } from '../../lib/roadmap/logic'
import type { Ctx } from './ui'
import { saveErr } from './helpers'

type Sort = 'rank' | 'new' | 'old'
type Filter = 'all' | 'active' | 'must' | 'unscored'

export default function FutureFocusTab({ ctx }: { ctx: Ctx }) {
  const { v } = ctx
  const [sort, setSort] = useState<Sort>('rank')
  const [filter, setFilter] = useState<Filter>('active')
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [story, setStory] = useState('')

  const all = candidates(v, ctx.P)
  const C = filter === 'active' ? all.filter(c => !c.parked) : filter === 'must' ? all.filter(c => c.must) : filter === 'unscored' ? all.filter(c => c.score == null && !c.must) : all.slice()
  if (sort === 'new') C.sort((a, b) => String(b.added).localeCompare(String(a.added)))
  if (sort === 'old') C.sort((a, b) => String(a.added || '9').localeCompare(String(b.added || '9')))
  const slots = Math.max(0, (v.planning && +v.planning.cutline) || 0)
  const scored = all.filter(c => c.score != null).length, musts = all.filter(c => c.must).length
  const cut = Math.min(slots, C.filter(c => c.score != null || c.must).length)
  const showCut = sort === 'rank'
  const ed = ctx.canEdit && ctx.editing

  async function saveRice(key: string, k: string, raw: string) {
    const cur: Record<string, any> = Object.assign({}, v.rice.get(key) || {}); delete cur.id
    const val = raw === '' ? null : Number(raw)
    if (val != null && (isNaN(val) || val < 0)) { ctx.toast('Use a number of 0 or more.'); return }
    cur[k] = val; cur.updatedAt = new Date().toISOString()
    try { await ctx.writer.set('rice', key, cur) } catch (e) { ctx.toast(saveErr(e, "Couldn't save the score. Try again.")) }
  }
  async function moveCut(delta: number) {
    const n = Math.max(0, slots + delta)
    try { await (v.planning ? ctx.writer.update('meta', 'planning', { cutline: n }) : ctx.writer.set('meta', 'planning', { cutline: n })) }
    catch (e) { ctx.toast(saveErr(e, "Couldn't move the line. Try again.")) }
  }
  async function addIdea(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const now = new Date().toISOString()
    try {
      await ctx.writer.set('items', newId('idea'), { title: title.trim(), story: story.trim(), theme: '', horizon: 'idea', priority: '', owner: '', assignedTo: '', delivery: 'tbc', source: 'meeting', note: '', reason: '', order: 1000 + v.items.size, createdAt: now, updatedAt: now })
      setTitle(''); setStory(''); setIdeaOpen(false); ctx.toast('Idea added. Score it to rank it.')
    } catch { ctx.toast("Couldn't add the idea. Try again.") }
  }

  const num = (c: Candidate, k: string, step: string) => ed
    ? <input type="number" min="0" step={step} inputMode="decimal" key={`${c.key}-${k}-${c.r[k] ?? ''}`} defaultValue={c.r[k] ?? ''} aria-label={`${k} for ${c.title}`}
        onBlur={e => { if (e.target.value.trim() !== String(c.r[k] ?? '')) saveRice(c.key, k, e.target.value.trim()) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    : <>{c.r[k] ?? '–'}</>
  const sel = (c: Candidate, k: string, opts: [string, string][]) => ed
    ? <select value={c.r[k] != null ? String(c.r[k]) : ''} aria-label={`${k} for ${c.title}`} onChange={e => saveRice(c.key, k, e.target.value)}>
        <option value="">–</option>{opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
      </select>
    : <>{c.r[k] != null ? (k === 'conf' ? c.r[k] + '%' : c.r[k]) : '–'}</>

  const cutMsg = cut === 0
    ? `Capacity line: score items or mark must haves to fill the ${slots} slot${slots === 1 ? '' : 's'} above this line.`
    : `Capacity line: room for ${slots} item${slots === 1 ? '' : 's'} in the next planning slot. ${cut < slots ? `${cut} filled so far. Only must haves and scored items can sit above the line.` : 'Everything below waits.'}`
  const cutRow = (
    <tr key="cut" className="cut"><td colSpan={8}><div className="rm-cutline">{cutMsg}
      {ed && <span className="cb"><button type="button" className="rm-mbtn" onClick={() => moveCut(-1)}>Fewer</button><button type="button" className="rm-mbtn" onClick={() => moveCut(1)}>More</button></span>}
    </div></td></tr>
  )

  const rows: React.ReactNode[] = []
  C.forEach((c, i) => {
    if (showCut && i === cut) rows.push(cutRow)
    rows.push(
      <tr key={c.key} className={`${showCut && i >= cut ? 'below' : ''} ${c.must ? 'must' : ''}`}>
        <td className="rm-rank">{i + 1}</td>
        <td>
          <button type="button" className="rm-ttl" onClick={() => ctx.open({ kind: 'cand', id: c.key })}>{c.title}</button>
          {c.must && <> <span className="rm-chip dark">Must have</span></>}
          <div className="rm-sub-line">{c.src}{c.lead ? ' · ' + c.lead : ''}{c.added ? ' · added ' + fmt(c.added.slice(0, 10)) : ''}</div>
          {c.must && c.r.mustReason && <div className="rm-mustr">{ALIGN[c.r.mustAlign] || ''}{c.r.mustAlignDetail ? ': ' + c.r.mustAlignDetail : ''} · {c.r.mustReason}</div>}
        </td>
        <td className="num">{num(c, 'reach', '1')}</td>
        <td className="num">{sel(c, 'impact', IMPACT)}</td>
        <td className="num">{sel(c, 'conf', CONF)}</td>
        <td className="num">{num(c, 'effort', '0.5')}</td>
        <td className="num">{c.score != null ? <span className="rm-score">{c.score.toFixed(1)}</span> : c.must ? <span className="rm-muted">–</span> : <span className="rm-chip plain">Not scored</span>}</td>
        <td className="num">{ctx.canEdit && <button type="button" className="rm-mbtn" onClick={() => ctx.open({ kind: 'cand', id: c.key })}>{c.score != null || c.must ? 'Edit' : 'Score'}</button>}</td>
      </tr>)
  })
  if (showCut && cut >= C.length) rows.push(cutRow)

  const seg = <T extends string>(val: T, set: (v: T) => void, opts: [T, string][], label: string) => (
    <div className="rm-seg" role="group" aria-label={label}>{opts.map(([k, l]) => <button key={k} type="button" aria-pressed={val === k} onClick={() => set(k)}>{l}</button>)}</div>)

  return (
    <div className="rm-sec">
      <div className="rm-sec-head">
        <div><h2>Future Focus</h2><p>Work we could pick up next, ranked by RICE score. Only what sits above the line is committed for the next slot of capacity. Score items before quarterly planning so a change in plans (a slot opening up, a new customer ask) is a quick re-rank, not a new estimating session.</p></div>
        {ctx.canEdit && !ideaOpen && <button type="button" className="rm-btn rm-btn--sm" onClick={() => setIdeaOpen(true)}>Add an idea</button>}
      </div>
      {ctx.canEdit && ideaOpen && (
        <form className="rm-form-card" onSubmit={addIdea}>
          <p>Add an idea to the list. Give it a one-line customer story so the team knows what it is when it comes up for scoring: who uses it, what Raphie does, and what changes for them.</p>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Idea name" aria-label="Idea name" autoFocus />
          <textarea value={story} onChange={e => setStory(e.target.value)} placeholder="Customer story" aria-label="Customer story" style={{ minHeight: 42 }} />
          <button className="rm-btn" type="submit">Add idea</button>
        </form>
      )}
      <div className="rm-pbar">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {seg<Sort>(sort, setSort, [['rank', 'Rank'], ['new', 'Newest'], ['old', 'Oldest']], 'Sort by')}
          {seg<Filter>(filter, setFilter, [['all', 'All'], ['active', 'Exclude parked'], ['must', 'Must haves'], ['unscored', 'Not scored']], 'Show')}
        </div>
        <span className="rm-muted" style={{ fontSize: 13 }}>{scored} of {all.length} scored{musts ? ` · ${musts} must have${musts === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div className="rm-tbl-scroll">
        <table className="rm-rice">
          <thead><tr><th>#</th><th>Item</th><th className="num">Reach</th><th className="num">Impact</th><th className="num">Confidence</th><th className="num">Effort</th><th className="num">Score</th><th /></tr></thead>
          <tbody>{rows.length ? rows : <tr><td colSpan={8} className="rm-muted" style={{ padding: 20 }}>Nothing matches this filter.</td></tr>}</tbody>
        </table>
      </div>
      <div className="rm-rice-key">
        <div className="rm-rk"><b>Reach</b>Operators who would use it in the next quarter (0 to 10).</div>
        <div className="rm-rk"><b>Impact</b>Per operator: 3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal.</div>
        <div className="rm-rk"><b>Confidence</b>100% evidence, 80% some evidence, 50% a hunch.</div>
        <div className="rm-rk"><b>Effort</b>Person-weeks across product, engineering and Pixie.</div>
        <div className="rm-rk"><b>Score</b>Reach × Impact × Confidence ÷ Effort. A guide for the ELT, not a decision.</div>
        <div className="rm-rk"><b>Must have</b>Goes above every RICE score and above the line. Needs a reason and what it aligns to: a key result, a customer commitment, compliance or a contract.</div>
      </div>
    </div>
  )
}
