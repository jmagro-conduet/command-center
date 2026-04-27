import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email.trim(), password)
    setLoading(false)
    if (error) {
      setError(error.includes('Invalid') ? 'Invalid email or password.' : error)
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F1F1F2',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '40px 36px',
        width: 360, border: '1.5px solid rgba(0,0,0,0.09)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 22, fontWeight: 600, color: '#000', lineHeight: 1 }}>
            conduet<sup style={{ fontSize: 10, verticalAlign: 'super' }}>®</sup>
          </div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', marginTop: 4 }}>
            CS Command Center
          </div>
        </div>

        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', marginBottom: 6 }}>
          Sign in
        </h2>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginBottom: 24 }}>
          Use your Conduet account credentials.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#58595B' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@conduet.com"
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                padding: '10px 12px', fontSize: 13, color: '#000',
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#58595B' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                padding: '10px 12px', fontSize: 13, color: '#000',
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(229,62,62,0.06)', border: '1px solid rgba(229,62,62,0.2)',
              borderRadius: 10, padding: '10px 12px',
              fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: '#000', color: '#fff', border: 'none', borderRadius: 10,
              padding: '11px 16px', fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
              cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.15s', marginTop: 4,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.8' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = '1' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
