import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

export type Page =
  | 'log-ticket'
  | 'bulletin'
  | 'events'
  | 'submissions'
  | 'report'
  | 'analytics'
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

function ReportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="2" width="16" height="20" rx="3" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M8 7h8M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M3 21c0-4 2.7-7 6-7s6 3 6 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M16 3c2.2.6 4 2.7 4 5M19 21c0-3-1.3-5.5-3.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
  { id: 'log-ticket', label: 'Log ticket', icon: <TicketIcon /> },
  { id: 'bulletin',   label: 'Bulletin',   icon: <BulletinIcon /> },
  { id: 'learn',      label: 'Learn',      icon: <LearnIcon /> },
]

const ADMIN_NAV: NavItem[] = [
  { id: 'log-ticket',  label: 'Log ticket',  icon: <TicketIcon /> },
  { id: 'bulletin',    label: 'Bulletin',    icon: <BulletinIcon /> },
  { id: 'events',      label: 'Events',      icon: <EventsIcon /> },
  { id: 'submissions', label: 'Submissions', icon: <SubmissionsIcon /> },
  { id: 'report',      label: 'Report',      icon: <ReportIcon /> },
  { id: 'analytics',   label: 'Analytics',   icon: <AnalyticsIcon /> },
  { id: 'users',       label: 'Users',       icon: <UsersIcon /> },
  { id: 'learn',       label: 'Learn',       icon: <LearnIcon /> },
]

interface Props {
  activePage: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ activePage, onNavigate }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, signOut } = useAuth()
  const navItems = user?.role === 'admin' ? ADMIN_NAV : AGENT_NAV
  const initial  = user?.name ? user.name[0].toUpperCase() : '?'

  return (
    <div style={{
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

      {/* Bottom: settings + sign out */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 12 }}>
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: collapsed ? '9px 0' : '9px 10px',
            borderRadius: 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            background: activePage === 'settings' ? '#CEA4FF' : 'transparent',
            color: activePage === 'settings' ? '#000' : '#58595B',
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
            fontWeight: activePage === 'settings' ? 500 : 400,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            if (activePage !== 'settings') e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
          }}
          onMouseLeave={e => {
            if (activePage !== 'settings') e.currentTarget.style.background = 'transparent'
          }}
        >
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 8,
            background: activePage === 'settings' ? '#fff' : 'transparent',
            flexShrink: 0,
          }}>
            <SettingsIcon />
          </span>
          {!collapsed && 'Settings'}
        </button>

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
