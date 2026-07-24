import { useState, useEffect, useRef } from 'react'
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

const FOCUS_STALE_MS = 2 * 60 * 1000 // treat data as stale after 2 min away

function AppShell() {
  const { user, loading, recoveryMode, updatePassword } = useAuth()
  const [activePage, setActivePage] = useState<Page>('log-ticket')
  const [pageKey, setPageKey] = useState(0)
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

  function handleNavigate(page: Page) {
    setActivePage(page)
    setPageKey(k => k + 1) // force remount = fresh fetch on every page switch
  }

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F1F1F2',
      }}>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
          Loading…
        </div>
      </div>
    )
  }

  if (recoveryMode) return <ResetPasswordPage updatePassword={updatePassword} />
  if (!user) return <Login />

  const isAdmin      = user?.role === 'admin'
  const isQA         = user?.role === 'qa'
  const isOperator   = user?.role === 'operator'
  const isSuperAdmin = !!user?.isSuperAdmin

  function renderPage() {
    if (isOperator) return <ExecutiveSummary key={pageKey} />
    switch (activePage) {
      case 'log-ticket':  return <LogTicket    key={pageKey} />
      case 'bulletin':    return <Bulletin     key={pageKey} />
      case 'leaderboard': return <Leaderboard  key={pageKey} />
      case 'events':      return isAdmin ? <Events      key={pageKey} /> : <LogTicket key={pageKey} />
      case 'submissions': return isAdmin ? <Submissions key={pageKey} /> : <LogTicket key={pageKey} />
      case 'report':      return isAdmin ? <Report      key={pageKey} /> : <LogTicket key={pageKey} />
      case 'executive-summary': return isAdmin ? <ExecutiveSummary key={pageKey} /> : <LogTicket key={pageKey} />
      case 'analytics':   return isAdmin ? <Analytics   key={pageKey} /> : <LogTicket key={pageKey} />
      case 'report-card': return (isAdmin || isQA) ? <ReportCard key={pageKey} /> : <LogTicket key={pageKey} />
      case 'bug-tracker': return <BugTracker key={pageKey} />
      case 'eval-reports': return isSuperAdmin ? <EvalReport key={pageKey} /> : <LogTicket key={pageKey} />
      case 'users':       return isSuperAdmin ? <Settings key={pageKey} initialTab="users" /> : <LogTicket key={pageKey} />
      case 'learn':       return <Learn       key={pageKey} />
      case 'settings':    return isAdmin ? <Settings key={pageKey} /> : <Settings key={pageKey} />
    }
  }

  return (
    <div className="app-layout" style={{
      height: '100vh', display: 'flex', gap: 16, padding: 16,
      background: '#F1F1F2', overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <Sidebar activePage={activePage} onNavigate={handleNavigate} />
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
