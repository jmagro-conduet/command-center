import type { ReactNode } from 'react'

// The shared page header for Raphie Hub: a small breadcrumb, the page title, optional tags
// (such as "View only") and actions. New pages use it; existing pages keep their own header
// until they are touched, so nothing already built changes shape.
export default function PageHeader({ crumb, title, subtitle, tags, actions }: {
  crumb?: string
  title: string
  subtitle?: string
  tags?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(0,0,0,0.55)', minHeight: 16 }}>{crumb || 'Raphie'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, margin: 0, color: '#000' }}>{title}</h1>
          {tags}
        </div>
        {subtitle && <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#323232', margin: '3px 0 0' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  )
}

export const Tag = ({ children }: { children: ReactNode }) => (
  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 100, background: 'rgba(0,0,0,0.05)', color: '#323232' }}>{children}</span>
)
