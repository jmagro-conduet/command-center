import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useOperator } from '../../context/OperatorContext'

export type Page =
  | 'log-ticket'
  | 'bulletin'
  | 'leaderboard'
  | 'events'
  | 'submissions'
  | 'report'
  | 'executive-summary'
  | 'analytics'
  | 'report-card'
  | 'bug-tracker'
  | 'users'
  | 'learn'
  | 'settings'

interface NavItem {
  id: Page
  label: string
  icon: React.ReactNode
}

function TicketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M7 15h4M7 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function BulletinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M5 5h14M5 9h14M5 13h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <circle cx="18" cy="17" r="4" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M18 15.5v1.5l1 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function EventsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="3" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M7 13h2v2H7z" fill="currentColor"/>
      <path d="M11 13h2v2h-2z" fill="currentColor"/>
    </svg>
  )
}

function SubmissionsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function AnalyticsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 17l4-5 4 3 4-6 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 21h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function LeaderboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="11" width="4" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.7"/>
      <rect x="10" y="6"  width="4" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.7"/>
      <rect x="18" y="3"  width="4" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/>
    </svg>
  )
}

function LearnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 19V7a2 2 0 012-2h12a2 2 0 012 2v12" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M4 19a2 2 0 002 2h12a2 2 0 002-2" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M9 7v14M9 11h6M9 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
    </svg>
  )
}

function ExecSummaryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 21h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <rect x="4" y="12" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.7"/>
      <rect x="10" y="8" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.7"/>
      <rect x="16" y="4" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M5 9l4-3 4 2 5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
    </svg>
  )
}

function ReportCardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M7 8h4M7 12h6M7 16h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M15 13l1.5 1.5L19 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function BugTrackerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M9 3h6M8 6c0-1.105.895-2 2-2h4a2 2 0 012 2v1a4 4 0 01-4 4h0a4 4 0 01-4-4V6z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 7H5a1 1 0 00-1 1v1a3 3 0 003 3M16 7h3a1 1 0 011 1v1a3 3 0 01-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M6 21h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.7"/>
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s ease' }}>
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

const AGENT_NAV: NavItem[] = [
  { id: 'log-ticket',  label: 'Log ticket',  icon: <TicketIcon /> },
  { id: 'bulletin',    label: 'Bulletin',    icon: <BulletinIcon /> },
  { id: 'leaderboard', label: 'Leaderboard', icon: <LeaderboardIcon /> },
  { id: 'bug-tracker', label: 'Bug Tracker', icon: <BugTrackerIcon /> },
  { id: 'learn',       label: 'Learn',       icon: <LearnIcon /> },
]

// Feature-flagged pages (not shown in nav but Page type kept for routing)
// 'report' — hidden until reporting feature is ready
// 'users'  — moved to bottom section (under Settings)

const ADMIN_NAV: NavItem[] = [
  { id: 'log-ticket',  label: 'Log ticket',  icon: <TicketIcon /> },
  { id: 'bulletin',    label: 'Bulletin',    icon: <BulletinIcon /> },
  { id: 'leaderboard', label: 'Leaderboard', icon: <LeaderboardIcon /> },
  { id: 'events',      label: 'Events',      icon: <EventsIcon /> },
  { id: 'submissions', label: 'Submissions', icon: <SubmissionsIcon /> },
  { id: 'executive-summary', label: 'Executive Summary', icon: <ExecSummaryIcon /> },
  { id: 'analytics',   label: 'Analytics',   icon: <AnalyticsIcon /> },
  { id: 'report-card', label: 'Report Card', icon: <ReportCardIcon /> },
  { id: 'bug-tracker', label: 'Bug Tracker', icon: <BugTrackerIcon /> },
  { id: 'learn',       label: 'Learn',       icon: <LearnIcon /> },
]

const QA_NAV: NavItem[] = [
  { id: 'log-ticket',  label: 'Log ticket',  icon: <TicketIcon /> },
  { id: 'bulletin',    label: 'Bulletin',    icon: <BulletinIcon /> },
  { id: 'leaderboard', label: 'Leaderboard', icon: <LeaderboardIcon /> },
  { id: 'report-card', label: 'Report Card', icon: <ReportCardIcon /> },
  { id: 'bug-tracker', label: 'Bug Tracker', icon: <BugTrackerIcon /> },
  { id: 'learn',       label: 'Learn',       icon: <LearnIcon /> },
]

const OPERATOR_NAV: NavItem[] = [
  { id: 'executive-summary', label: 'Executive Summary', icon: <ExecSummaryIcon /> },
]

interface Props {
  activePage: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ activePage, onNavigate }: Props) {
  const [collapsed, setCollapsed]           = useState(false)
  const [operatorDropOpen, setOperatorDropOpen] = useState(false)
  const { user, signOut }                   = useAuth()
  const { operators, selectedOperator, setSelectedOperator } = useOperator()
  const navItems   = user?.role === 'admin' ? ADMIN_NAV : user?.role === 'qa' ? QA_NAV : user?.role === 'operator' ? OPERATOR_NAV : AGENT_NAV
  const initial    = user?.name ? user.name[0].toUpperCase() : '?'
  const isAdmin    = user?.role === 'admin'
  const isOperator = user?.role === 'operator'
  const isSuperAdmin = !!user?.isSuperAdmin

  return (
    <div className="app-sidebar" style={{
      width: collapsed ? 72 : 240,
      minWidth: collapsed ? 72 : 240,
      height: '100%',
      background: '#fff',
      borderRadius: 20,
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 12px',
      transition: 'width 0.25s ease, min-width 0.25s ease',
      overflow: 'hidden',
      flexShrink: 0,
    }}>

      {/* Logo + collapse */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        marginBottom: 24,
        paddingLeft: collapsed ? 0 : 4,
        paddingRight: collapsed ? 0 : 2,
      }}>
        {!collapsed && (
          <div>
            <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', lineHeight: 1 }}>
              conduet<sup style={{ fontSize: 9, verticalAlign: 'super' }}>®</sup>
            </div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', marginTop: 3 }}>
              CS Command Center
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#58595B',
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>

      {/* User badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 8px',
        borderRadius: 12,
        background: 'rgba(0,0,0,0.03)',
        marginBottom: 20,
        overflow: 'hidden',
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: '#9B59D0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: 'Manrope, sans-serif',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
        }}>
          {initial}
        </div>
        {!collapsed && (
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name ?? '—'}
            </div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B', textTransform: 'capitalize' }}>
              {user?.role ?? ''}
            </div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(item => {
          const active = activePage === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '9px 0' : '9px 10px',
                borderRadius: 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: active ? '#CEA4FF' : 'transparent',
                color: active ? '#000' : '#58595B',
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: active ? 500 : 400,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
              }}
              onMouseLeave={e => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 8,
                background: active ? '#fff' : 'transparent',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}>
                {item.icon}
              </span>
              {!collapsed && item.label}
            </button>
          )
        })}
      </nav>

      {/* Bottom: operator switcher + settings + sign out */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 12 }}>

        {/* Operator indicator — admins get a switcher, operator-role gets a locked read-only badge */}
        {!collapsed && selectedOperator && (isAdmin || isOperator) && (
          <div style={{ position: 'relative', marginBottom: 6 }}>
            {/* Admin: full switcher button */}
            {isAdmin && <button
              onClick={() => setOperatorDropOpen(o => !o)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: 10,
                border: '1.5px solid rgba(0,0,0,0.09)',
                background: operatorDropOpen ? 'rgba(206,164,255,0.08)' : 'rgba(0,0,0,0.02)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!operatorDropOpen) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
              onMouseLeave={e => { if (!operatorDropOpen) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 6,
                  background: '#9B59D0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  fontFamily: 'Manrope, sans-serif', fontSize: 9, fontWeight: 700, color: '#fff',
                }}>
                  {selectedOperator?.name?.[0]?.toUpperCase() ?? 'O'}
                </div>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                  color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {selectedOperator?.name ?? 'Select operator'}
                </span>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: '#58595B', transform: operatorDropOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>}

            {/* Operator-role: locked badge, no dropdown */}
            {isOperator && (
              <div style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 10,
                border: '1.5px solid rgba(155,89,208,0.2)',
                background: 'rgba(155,89,208,0.05)',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 6,
                  background: '#9B59D0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  fontFamily: 'Manrope, sans-serif', fontSize: 9, fontWeight: 700, color: '#fff',
                }}>
                  {selectedOperator.name[0].toUpperCase()}
                </div>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                  color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {selectedOperator.name}
                </span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: '#9B59D0' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            )}

            {operatorDropOpen && isAdmin && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
                background: '#fff', borderRadius: 10,
                border: '1.5px solid rgba(0,0,0,0.09)',
                boxShadow: '0 -4px 16px rgba(0,0,0,0.1)',
                zIndex: 100, overflow: 'hidden',
              }}>
                {operators.map(op => (
                  <button
                    key={op.id}
                    onClick={() => { setSelectedOperator(op); setOperatorDropOpen(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 12px',
                      background: selectedOperator?.id === op.id ? 'rgba(206,164,255,0.1)' : 'transparent',
                      borderBottom: '1px solid rgba(0,0,0,0.05)',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (selectedOperator?.id !== op.id) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                    onMouseLeave={e => { if (selectedOperator?.id !== op.id) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: 6, background: selectedOperator?.id === op.id ? '#9B59D0' : 'rgba(0,0,0,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      fontFamily: 'Manrope, sans-serif', fontSize: 9, fontWeight: 700,
                      color: selectedOperator?.id === op.id ? '#fff' : '#58595B',
                    }}>
                      {op.name[0].toUpperCase()}
                    </div>
                    <span style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: selectedOperator?.id === op.id ? 500 : 400,
                      color: selectedOperator?.id === op.id ? '#9B59D0' : '#000',
                    }}>
                      {op.name}
                    </span>
                    {selectedOperator?.id === op.id && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 'auto', color: '#9B59D0' }}>
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!isOperator && <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? (isSuperAdmin ? 'Admin settings' : 'Settings') : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: collapsed ? '9px 0' : '9px 10px',
            borderRadius: 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            background: (activePage === 'settings' || activePage === 'users') ? '#CEA4FF' : 'transparent',
            color: (activePage === 'settings' || activePage === 'users') ? '#000' : '#58595B',
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
            fontWeight: (activePage === 'settings' || activePage === 'users') ? 500 : 400,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            if (activePage !== 'settings' && activePage !== 'users') e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
          }}
          onMouseLeave={e => {
            if (activePage !== 'settings' && activePage !== 'users') e.currentTarget.style.background = 'transparent'
          }}
        >
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 8,
            background: (activePage === 'settings' || activePage === 'users') ? '#fff' : 'transparent',
            flexShrink: 0,
          }}>
            <SettingsIcon />
          </span>
          {!collapsed && (isSuperAdmin ? 'Admin settings' : 'Settings')}
        </button>}

        <button
          onClick={() => signOut()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: collapsed ? '9px 0' : '9px 10px',
            borderRadius: 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: '#58595B',
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
            transition: 'all 0.15s',
            cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          }}>
            <SignOutIcon />
          </span>
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </div>
  )
}
