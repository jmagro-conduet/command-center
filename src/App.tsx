import { useState } from 'react'
import './index.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/layout/Sidebar'
import type { Page } from './components/layout/Sidebar'
import Login, { ResetPasswordPage } from './pages/Login'
import LogTicket from './pages/LogTicket'
import Bulletin from './pages/Bulletin'
import Events from './pages/Events'
import Submissions from './pages/Submissions'
import Report from './pages/Report'
import Analytics from './pages/Analytics'
import Users from './pages/Users'
import Learn from './pages/Learn'
import Settings from './pages/Settings'

function AppShell() {
  const { user, loading, recoveryMode, updatePassword } = useAuth()
  const [activePage, setActivePage] = useState<Page>('log-ticket')

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
      case 'log-ticket':  return <LogTicket />
      case 'bulletin':    return <Bulletin />
      case 'events':      return isAdmin ? <Events /> : <LogTicket />
      case 'submissions': return isAdmin ? <Submissions /> : <LogTicket />
      case 'report':      return isAdmin ? <Report /> : <LogTicket />
      case 'analytics':   return isAdmin ? <Analytics /> : <LogTicket />
      case 'users':       return isAdmin ? <Users /> : <LogTicket />
      case 'learn':       return <Learn />
      case 'settings':    return <Settings />
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', gap: 16, padding: 16,
      background: '#F1F1F2', overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 4 }}>
        {renderPage()}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
