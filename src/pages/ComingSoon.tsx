import { pageDef } from '../lib/access/core'
import { PLANNED } from '../lib/comingSoon'
import PageHeader, { Tag } from '../components/PageHeader'
import './home.css'

// A short plan page for something that is being built but not live yet. It shows what is planned,
// where the data will come from, who owns it and when, never invented numbers.
export default function ComingSoon({ page }: { page: string }) {
  const def = pageDef(page)
  const plan = PLANNED[page]
  if (!def || !plan) return null
  return (
    <div className="hub-page">
      <PageHeader crumb={def.group} title={def.label} tags={<Tag>Planned</Tag>} subtitle="Being built. This page shows the plan, not live data." />
      <section className="hub-card" aria-label="What it is">
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{plan.summary}</p>
      </section>
      <div className="hub-grid">
        <section className="hub-card" aria-label="What it will show">
          <h2>What it will show</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5 }}>
            {plan.willShow.map(x => <li key={x}>{x}</li>)}
          </ul>
        </section>
        <section className="hub-card" aria-label="Plan details">
          <h2>Plan</h2>
          <div className="hub-row"><span>Status</span><b>Planned</b></div>
          <div className="hub-row"><span>Data source</span><span style={{ textAlign: 'right', maxWidth: '60%' }}>{plan.source}</span></div>
          <div className="hub-row"><span>Owner</span><b>{plan.owner}</b></div>
          <div className="hub-row"><span>Target</span><b>{plan.target}</b></div>
        </section>
      </div>
      <p className="hub-sub" style={{ margin: '0 4px' }}>You can see this page because your access includes it. Who sees planned pages is set in Admin settings, Roles &amp; access.</p>
    </div>
  )
}
