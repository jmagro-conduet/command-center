import { useState } from 'react'
import './index.css'
import Sidebar from './components/layout/Sidebar'
import type { Page } from './components/layout/Sidebar'
import LogTicket from './pages/LogTicket'
import Bulletin from './pages/Bulletin'
import Events from './pages/Events'
import Submissions from './pages/Submissions'
import Report from './pages/Report'
import Analytics from './pages/Analytics'
import Users from './pages/Users'
import Learn from './pages/Learn'
import Settings from './pages/Settings'

export default function App() {
  const [activePage, setActivePage] = useState<Page>('log-ticket')

  function renderPage() {
    switch (activePage) {
      case 'log-ticket':  return <LogTicket />
      case 'bulletin':    return <Bulletin />
      case 'events':      return <Events />
      case 'submissions': return <Submissions />
      case 'report':      return <Report />
      case 'analytics':   return <Analytics />
      case 'users':       return <Users />
      case 'learn':       return <Learn />
      case 'settings':    return <Settings />
    }
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      gap: 16,
      padding: 16,
      background: '#F1F1F2',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      <main style={{
        flex: 1,
        overflowY: 'auto',
        minWidth: 0,
        paddingRight: 4,
      }}>
        {renderPage()}
      </main>
    </div>
  )
}
