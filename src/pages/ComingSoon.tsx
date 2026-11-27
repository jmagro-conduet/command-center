import { pageDef } from '../lib/access/core'
import PageHeader from '../components/PageHeader'
import './home.css'

// Placeholder for a page that is planned but not built yet: a plain "Coming soon" with one line
// of context. No plan details, no numbers.
export default function ComingSoon({ page }: { page: string }) {
  const def = pageDef(page)
  if (!def) return null
  return (
    <div className="hub-page">
      <PageHeader crumb={def.group} title={def.label} />
      <div className="hub-empty" style={{ padding: '56px 24px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, margin: 0, color: '#000' }}>Coming soon</h2>
        {def.blurb && <p style={{ margin: '8px auto 0', maxWidth: 460, fontSize: 14, lineHeight: 1.5, color: '#323232' }}>{def.blurb}</p>}
      </div>
    </div>
  )
}
