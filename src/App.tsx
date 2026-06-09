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
import Leaderboard from './pages/Leaderboard'
import Learn from './pages/Learn'
import Settings from './pages/Settings'
import ReportCard from './pages/ReportCard'

const FOCUS_STALE_MS = 2 * 60 * 1000 // treat data as stale after 2 min away

function AppShell() {
  const { user, loading, recoveryMode, updatePassword } = useAuth()
  const [activePage, setActivePage] = useState<Page>('log-ticket')
  const [pageKey, setPageKey] = useState(0)
  const lastActiveRef = useRef(Date.now())

  // Bump pageKey on window focus if the tab has been backgrounded ≥2 min
  useEffect(() => {
    function onBlur()  { lastActiveRef.current = Date.now() }
    function onFocus() {
      if (Date.now() - lastActiveRef.current >= FOCUS_STALE_MS) {
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

  const isAdmin = user?.role === 'admin'

  function renderPage() {
    switch (activePage) {
      case 'log-ticket':  return <LogTicket    key={pageKey} />
      case 'bulletin':    return <Bulletin     key={pageKey} />
      case 'leaderboard': return <Leaderboard  key={pageKey} />
      case 'events':      return isAdmin ? <Events      key={pageKey} /> : <LogTicket key={pageKey} />
      case 'submissions': return isAdmin ? <Submissions key={pageKey} /> : <LogTicket key={pageKey} />
      case 'report':      return isAdmin ? <Report      key={pageKey} /> : <LogTicket key={pageKey} />
      case 'analytics':    return isAdmin ? <Analytics   key={pageKey} /> : <LogTicket key={pageKey} />
      case 'report-card': return isAdmin ? <ReportCard  key={pageKey} /> : <LogTicket key={pageKey} />
      case 'users':       return isAdmin ? <Settings key={pageKey} initialTab="users" /> : <LogTicket key={pageKey} />
      case 'learn':       return <Learn       key={pageKey} />
      case 'settings':    return isAdmin ? <Settings key={pageKey} /> : <Settings key={pageKey} />
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', gap: 16, padding: 16,
      background: '#F1F1F2', overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <Sidebar activePage={activePage} onNavigate={handleNavigate} />
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 4 }}>
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
