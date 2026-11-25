import type { ReactNode } from 'react'
import { STATUS_CODES, STATUS_LABEL, STATUS_DEF } from '../../lib/strategy/logic'
import { StatusPill } from './ui'

const Sec = ({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub?: string; children: ReactNode }) => (
  <section className="rm-card st-guide">
    <div><div className="rm-lbl">{eyebrow}</div><h2 style={{ fontSize: 20, marginTop: 4 }}>{title}</h2>{sub && <span className="st-sm-t" style={{ fontSize: 13 }}>{sub}</span>}</div>
    {children}
  </section>
)
const Item = ({ h, children }: { h: string; children: ReactNode }) => <div><h3>{h}</h3><p>{children}</p></div>

export default function GuideTab() {
  return (
    <>
      <section className="rm-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '28px 32px' }}>
        <div className="rm-lbl">Guide</div>
        <h2 style={{ fontSize: 26, lineHeight: 1.25 }}>How Strategy works</h2>
        <p className="st-sm-t" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 820 }}>Strategy turns Raphie&rsquo;s Strategy on a Page into a living record. Each monthly ELT updates it, and every update is kept, so the team can see where each key result stands today and how it got there.</p>
      </section>

      <Sec eyebrow="1 · Our OKR framework" title="How we set goals: Objectives and Key Results" sub="From Raphie Strategy On A Page, Q4 2026, Appendix: Strategy on Page Guide">
        <div className="st-g4">
          <div className="st-gbox"><span className="rm-lbl">North Star</span><p>Become the trusted AI platform that iGaming and sports betting operators run their player operations experience on.</p></div>
          <div className="st-gbox"><span className="rm-lbl">6 Pillars, Objectives</span><p>The &ldquo;what&rdquo;. One per pillar, six total. 12 to 24 months.</p></div>
          <div className="st-gbox hl"><span className="rm-lbl" style={{ color: '#000' }}>Key Results</span><p style={{ color: '#000' }}>The &ldquo;how we&rsquo;ll know&rdquo;. Set every 90 to 180 days. Tracked at every ELT.</p></div>
          <div className="st-gbox"><span className="rm-lbl">Initiatives</span><p>Projects, workstreams and pieces of work that deliver the KRs.</p></div>
        </div>
        <div className="st-g2">
          <Item h="Objectives are the “what”">One per pillar, six total. They are aspirational and can span 12 to 24 months, not something we expect to fully tick off in a quarter.</Item>
          <Item h="Key Results are the “how we’ll know”">Set every 90 to 180 days against each Objective. Each Objective carries multiple KRs at any given time.</Item>
          <Item h="Measurable or definable">A KR can be measurable (for example &ldquo;$XM ARR&rdquo;) or definable and binary (for example &ldquo;Launch new brand&rdquo;). It does not have to be a number, but it must be clearly done or not done.</Item>
          <Item h="Initiatives deliver the KRs">Initiatives are what actually deliver the KRs. Most touch more than one Objective: map each to one Primary Objective it mainly drives, plus any Secondary Objectives it also supports.</Item>
          <Item h="One strategy, not one per function">There is no separate Strategy on a Page per business function. Their quarterly KRs, owned within the six pillar Objectives, are how their work shows up in the strategy.</Item>
          <Item h="A living draft">The Strategy on a Page is a living draft. We revise Objectives and KRs as the business evolves and do not treat it as fixed once published.</Item>
        </div>
        <div>
          <div className="rm-lbl" style={{ marginBottom: 8 }}>Cadence</div>
          <div className="st-row" style={{ fontSize: 14 }}>
            <span className="st-tag" style={{ padding: '8px 14px', fontSize: 14 }}>Annual goal-setting (1 session)</span><span aria-hidden="true">→</span>
            <span className="st-tag" style={{ padding: '8px 14px', fontSize: 14 }}>Quarterly kickoff and review (1hr each)</span><span aria-hidden="true">→</span>
            <span className="st-tag" style={{ padding: '8px 14px', fontSize: 14 }}>Board briefing each quarter</span>
          </div>
          <p style={{ marginTop: 8 }}>Strategy adds one more rhythm inside each quarter: the <b style={{ color: '#000', fontWeight: 500 }}>monthly ELT</b> (45 minutes), where every outstanding key result is checked in.</p>
        </div>
      </Sec>

      <Sec eyebrow="2 · Running the ELT" title="The monthly loop">
        <div className="st-g4">
          <div className="st-gbox"><span className="rm-lbl">Step 1 · Before</span><h3 style={{ fontSize: 16 }}>The agenda drafts itself</h3><p>Add the ELT date on the ELT tab. Every outstanding key result is on the agenda, pillar by pillar, with off-track and at-risk ones first. A key result leaves the agenda only once it is marked done. No preparation is needed from owners.</p></div>
          <div className="st-gbox"><span className="rm-lbl">Step 2 · During</span><h3 style={{ fontSize: 16 }}>Talk through each KR</h3><p>Spinach records the Teams meeting. Owners give a status and a one-line update per key result, naming it as they go (&ldquo;Revenue KR3&rdquo;). New actions are said with an owner and a date.</p></div>
          <div className="st-gbox ai"><span className="rm-lbl" style={{ color: 'var(--ai-text)' }}>Step 3 · After</span><h3 style={{ fontSize: 16 }}>Review the drafted updates</h3><p>Paste the Spinach notes into the ELT tab and choose Draft updates with Claude. Claude drafts every update in agenda order. The admin approves status changes, confirms the rest, checks new and closed actions, and adds anything Spinach missed.</p></div>
          <div className="st-gbox"><span className="rm-lbl">Step 4 · Saved</span><h3 style={{ fontSize: 16 }}>The dashboard updates</h3><p>Saving stores that ELT&rsquo;s check-ins and actions and updates Strategy on a Page. Nothing from the meeting reaches the dashboard without approval.</p></div>
        </div>
        <div className="st-note">Habits that keep the record accurate: name the key result before you speak to it, give every action an owner and a date, and say when something is a business priority outside the OKRs.</div>
      </Sec>

      <Sec eyebrow="3 · How progress is tracked" title="Statuses, history and actions">
        <div>
          <div className="st-row" style={{ marginBottom: 6 }}><h3 style={{ fontSize: 14 }}>Key result statuses</h3><span className="st-tag">Proposed definitions</span></div>
          {STATUS_CODES.map(k => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: 16, alignItems: 'start', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ justifySelf: 'start' }}><StatusPill code={k} /></span><p aria-label={STATUS_LABEL[k] + ' definition'}>{STATUS_DEF[k]}</p>
            </div>
          ))}
        </div>
        <div className="st-g2">
          <Item h="One check-in per KR per ELT">Each check-in holds the status, a one-line note and the line from the meeting it came from. Key results with a numeric target also record a value, shown as a trend against the target.</Item>
          <Item h="Nothing is overwritten">Every saved ELT is a snapshot. Use &ldquo;As of&rdquo; on Strategy on a Page to see the dashboard as it was after any past ELT, or click a key result to see its full check-in history. Between ELTs, anyone with edit access can update a status from the key result&rsquo;s panel. It is saved as a dated check-in marked &ldquo;updated between ELTs&rdquo;, with who made it.</Item>
          <Item h="Definition of done">Meatier key results carry a short &ldquo;done when&rdquo; checklist, shown when you click the key result and as a tag on Strategy on a Page. Each starts as a draft and is marked agreed once the ELT signs it off. Tick items as they are met; a key result should not be marked Done while items are still open.</Item>
          <Item h="Not discussed? Carried forward">If a key result is not heard in the meeting, its status carries forward unchanged and it is flagged at the top of its pillar at the next ELT.</Item>
          <Item h="A new Strategy on a Page each half-year">OKRs are set every half-year. Each half is its own OKR period with its own Strategy on a Page, ELTs and history. The admin sets up the next period from the Admin tab, starting from a copy of the current one; it stays a draft until you make it current. Earlier periods stay viewable from the period menu.</Item>
          <Item h="Actions">Every action has an owner, a due date and the ELT it was agreed at. Add comments to track progress; the latest shows under the action everywhere it appears. Progress mentioned in an ELT is drafted as a comment for you to approve. Actions due or overdue open the next agenda, and those carried over two or more ELTs are flagged.</Item>
          <Item h="Business priorities">Actions that do not belong to a key result are tracked as business priorities and shown on Strategy on a Page. If several gather around one theme, raise it at the quarterly review as a possible new key result.</Item>
        </div>
      </Sec>

      <Sec eyebrow="4 · Who does what" title="Roles and access">
        <div className="st-g4">
          <div className="st-gbox hl"><h3 style={{ fontSize: 16 }}>Admin and coordinator</h3><p style={{ color: '#000' }}>The only person who updates Strategy, plus anyone given edit access. After each ELT, checks the drafted updates against the Spinach notes, adds anything Spinach missed, then approves and saves. Follows up owners on their actions, keeps definitions of done current, and sets up each new half-year.</p></div>
          <div className="st-gbox"><h3 style={{ fontSize: 16 }}>Pillar owners</h3><p>Accountable for the key results in their pillar, as named on Strategy on a Page. Give a status and a one-line update for each one at the ELT. They do not edit; the admin records their updates.</p></div>
          <div className="st-gbox"><h3 style={{ fontSize: 16 }}>Action owners</h3><p>Anyone in the team. Own the actions agreed at an ELT, and report progress or completion at the next one.</p></div>
          <div className="st-gbox ai"><h3 style={{ fontSize: 16 }}>Spinach and Claude</h3><p>Spinach records the meeting. Claude matches what was said to each key result and drafts check-ins, new actions and action progress. Nothing is saved until the admin approves it.</p></div>
        </div>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Who can change what</h3>
          <div className="st-tablewrap">
            <table className="st-gtbl" style={{ minWidth: 560 }}>
              <thead><tr><th scope="col">Access</th><th scope="col">Who</th><th scope="col">Can</th></tr></thead>
              <tbody>
                <tr><td style={{ fontWeight: 500 }}>Edit</td><td>SuperAdmins, plus anyone given edit access on the Strategy page</td><td>Everything: save ELT reviews, update statuses, manage actions, comments and definitions of done, add ELT dates and set up new OKR periods.</td></tr>
                <tr><td style={{ fontWeight: 500 }}>View only</td><td>Anyone else given the Strategy page</td><td>See everything (Strategy on a Page, key result history, agendas, saved ELT updates, actions and comments) but change nothing. A &ldquo;View only&rdquo; label shows at the top.</td></tr>
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 10 }}>Most changes come through the ELT review. The admin can also update a status between ELTs; those updates are labelled &ldquo;updated between ELTs&rdquo; with the admin&rsquo;s name, so the history stays clear. Drafted reviews that have not been saved are visible only to people with edit access.</p>
        </div>
      </Sec>
    </>
  )
}
