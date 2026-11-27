import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import { OperatorProvider } from './context/OperatorContext'
import Sidebar from './components/layout/Sidebar'
import type { Page } from './components/layout/Sidebar'
import Login, { ResetPasswordPage } from './pages/Login'
import LogTicket from './pages/LogTicket'
import Bulletin from './pages/Bulletin'
import Events from './pages/Events'
import Submissions from './pages/Submissions'
import Report from './pages/Report'
import Analytics from './pages/Analytics'
import ExecutiveSummary from './pages/ExecutiveSummary'
import Leaderboard from './pages/Leaderboard'
import Learn from './pages/Learn'
import Settings from './pages/Settings'
import ReportCard from './pages/ReportCard'
import BugTracker from './pages/BugTracker'
import EvalReport from './pages/EvalReport'
import Roadmap from './pages/Roadmap'
import Strategy from './pages/Strategy'
import Home from './pages/Home'
import Operators from './pages/Operators'
import ComingSoon from './pages/ComingSoon'
import CommandPalette from './components/CommandPalette'
import { canOpen } from './lib/access/core'

const FOCUS_STALE_MS = 2 * 60 * 1000 // treat data as stale after 2 min away

// ---- URLs. One page per path: / is Home, /strategy, /analytics, /settings, and so on.
const ROUTABLE: Page[] = ['home', 'operators', 'customer-success', 'client-status', 'log-ticket', 'bulletin', 'leaderboard', 'events', 'submissions', 'report', 'executive-summary', 'analytics', 'report-card', 'bug-tracker', 'users', 'learn', 'settings', 'eval-reports', 'roadmap', 'strategy']
const pathFor = (p: Page) => (p === 'home' ? '/' : '/' + p)
function pageFromPath(pathname: string): Page | null {
  const seg = pathname.replace(/^\/+/, '').split('/')[0]
  if (!seg) return 'home'
  return (ROUTABLE as string[]).includes(seg) ? (seg as Page) : null
}
// What this person actually gets for a requested page: Home is everyone's default, Settings is
// always available, and anything else needs access (customer logins only ever see Executive Summary).
function resolvePage(user: ReturnType<typeof useAuth>['user'], requested: Page | null): Page {
  if (!user) return 'home'
  if (user.role === 'operator') return 'executive-summary'
  if (requested === 'home' || requested === 'settings') return requested
  if (requested && ((requested === 'events' || requested === 'report') ? user.role === 'admin' : canOpen(user.access, requested))) return requested
  return 'home'
}

function AppShell() {
  const { user, loading, recoveryMode, updatePassword } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [pageKey, setPageKey] = useState(0) // bumped when the tab comes back after a while
  const lastActiveRef = useRef(Date.now())
  const mainRef = useRef<HTMLElement>(null)
  // Scroll position to restore after an idle-remount (not a real navigation
  // — those should land at the top like any normal page load). Null means
  // "nothing pending" so the restore effect below is a no-op most of the time.
  const pendingScrollRef = useRef<number | null>(null)

  // Bump pageKey on window focus if the tab has been backgrounded ≥2 min
  useEffect(() => {
    function onBlur()  { lastActiveRef.current = Date.now() }
    function onFocus() {
      if (Date.now() - lastActiveRef.current >= FOCUS_STALE_MS) {
        pendingScrollRef.current = mainRef.current?.scrollTop ?? null
        setPageKey(k => k + 1)
      }
    }
    window.addEventListener('blur',  onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur',  onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // The remounted page's content starts empty/short while its own data loads,
  // so restoring scrollTop once right at mount would just clamp to nothing.
  // Re-apply over a short window to catch it once real content has grown in.
  useEffect(() => {
    const target = pendingScrollRef.current
    if (target === null) return
    pendingScrollRef.current = null
    const timers = [0, 50, 150, 300, 600, 1000].map(delay => setTimeout(() => {
      if (mainRef.current) mainRef.current.scrollTop = target
    }, delay))
    return () => timers.forEach(clearTimeout)
  }, [pageKey])

  // The page is the URL. Every navigation remounts the page (fresh fetch), same as before.
  function handleNavigate(page: Page) { navigate(pathFor(page)) }

  const requested = pageFromPath(location.pathname)
  const resolved = resolvePage(user, requested)

  // A URL that is unknown, or a page this person cannot open, becomes Home (not an error screen).
  useEffect(() => {
    if (!user) return
    const want = pathFor(resolved)
    if (location.pathname !== want && !(resolved === 'home' && location.pathname === '/')) navigate(want, { replace: true })
  }, [user, resolved, location.pathname, navigate])

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f0eeec',
      }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#323232' }}>
          Loading…
        </div>
      </div>
    )
  }

  if (recoveryMode) return <ResetPasswordPage updatePassword={updatePassword} />
  if (!user) return <Login />

  const isOperator = user?.role === 'operator'
  const page: Page = resolved
  const viewKey = location.key + ':' + pageKey

  function renderPage() {
    if (isOperator) return <ExecutiveSummary key={viewKey} />
    switch (page) {
      case 'home':        return <Home         key={viewKey} onNavigate={handleNavigate} />
      case 'operators':   return <Operators    key={viewKey} onNavigate={handleNavigate} />
      case 'customer-success':
      case 'client-status': return <ComingSoon  key={viewKey} page={page} />
      case 'log-ticket':  return <LogTicket    key={viewKey} />
      case 'bulletin':    return <Bulletin     key={viewKey} />
      case 'leaderboard': return <Leaderboard  key={viewKey} />
      case 'events':      return <Events       key={viewKey} />
      case 'submissions': return <Submissions  key={viewKey} />
      case 'report':      return <Report       key={viewKey} />
      case 'executive-summary': return <ExecutiveSummary key={viewKey} />
      case 'analytics':   return <Analytics    key={viewKey} />
      case 'report-card': return <ReportCard   key={viewKey} />
      case 'bug-tracker': return <BugTracker   key={viewKey} />
      case 'eval-reports': return <EvalReport  key={viewKey} />
      case 'roadmap':     return <Roadmap      key={viewKey} />
      case 'strategy':    return <Strategy     key={viewKey} />
      case 'users':       return <Settings     key={viewKey} initialTab="users" />
      case 'learn':       return <Learn        key={viewKey} />
      case 'settings':    return <Settings     key={viewKey} />
    }
  }

  return (
    <div className="app-layout" style={{
      height: '100vh', display: 'flex', gap: 16, padding: 16,
      background: '#f0eeec', overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <Sidebar activePage={page} onNavigate={handleNavigate} />
      {!isOperator && <CommandPalette onNavigate={handleNavigate} />}
      <main ref={mainRef} className="app-main" style={{ flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 4 }}>
        {renderPage()}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <OperatorProvider>
        <AppShell />
      </OperatorProvider>
    </AuthProvider>
  )
}
