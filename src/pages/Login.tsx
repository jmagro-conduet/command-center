import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authClient, supabase } from '../lib/supabase'

type View = 'sign-in' | 'create-account' | 'forgot-password'

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '10px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s',
  width: '100%', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
}

export default function Login() {
  const { signIn } = useAuth()
  const [view, setView] = useState<View>('sign-in')

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F1F1F2',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '40px 36px',
        width: 380, border: '1.5px solid rgba(0,0,0,0.09)',
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

        {view === 'sign-in'        && <SignInForm    onForgot={() => setView('forgot-password')} onCreateAccount={() => setView('create-account')} signIn={signIn} />}
        {view === 'create-account' && <CreateAccountForm onBack={() => setView('sign-in')} signIn={signIn} />}
        {view === 'forgot-password'&& <ForgotPasswordForm onBack={() => setView('sign-in')} />}
      </div>
    </div>
  )
}

// ── Sign in ───────────────────────────────────────────────────────────────────

function SignInForm({ onForgot, onCreateAccount, signIn }: {
  onForgot: () => void
  onCreateAccount: () => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
}) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await signIn(email.trim(), password)
    setLoading(false)
    if (error) setError(error.includes('Invalid') ? 'Invalid email or password.' : error)
  }

  return (
    <>
      <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', marginBottom: 6 }}>
        Sign in
      </h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginBottom: 24 }}>
        Use your Conduet account credentials.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            required autoFocus placeholder="you@conduet.com" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        <Field label="Password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            required placeholder="••••••••" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        <div style={{ textAlign: 'right', marginTop: -6 }}>
          <button type="button" onClick={onForgot} style={{
            fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}>
            Forgot password?
          </button>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        <PrimaryButton loading={loading}>{loading ? 'Signing in…' : 'Sign in'}</PrimaryButton>
      </form>

      <div style={{ textAlign: 'center', marginTop: 20, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B' }}>
        New to Command Center?{' '}
        <button onClick={onCreateAccount} style={{
          color: '#9B59D0', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, padding: 0,
        }}>
          Create account
        </button>
      </div>
    </>
  )
}

// ── Create account ────────────────────────────────────────────────────────────

function CreateAccountForm({ onBack, signIn }: {
  onBack: () => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
}) {
  const [name,      setName]      = useState('')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== password2) { setError('Passwords do not match.'); return }
    if (password.length < 8)    { setError('Password must be at least 8 characters.'); return }

    setLoading(true)

    // Create auth user via admin API (service role — skips email confirmation)
    const { data, error: authErr } = await (supabase.auth as any).admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })

    if (authErr || !data?.user) {
      setLoading(false)
      setError(authErr?.message ?? 'Failed to create account.')
      return
    }

    // Create public.users profile
    await supabase.from('users').insert([{
      auth_id: data.user.id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: 'agent',
    }])

    // Sign in immediately
    const { error: signInErr } = await signIn(email.trim(), password)
    setLoading(false)
    if (signInErr) setError(signInErr)
  }

  return (
    <>
      <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', marginBottom: 6 }}>
        Create account
      </h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginBottom: 24 }}>
        Your account will be set up as an Agent. An admin can update your role.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Full name">
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            required autoFocus placeholder="Jane Smith" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        <Field label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            required placeholder="you@conduet.com" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        <Field label="Password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            required placeholder="Min 8 characters" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        <Field label="Confirm password">
          <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
            required placeholder="••••••••" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        {error && <ErrorBox>{error}</ErrorBox>}

        <PrimaryButton loading={loading}>{loading ? 'Creating account…' : 'Create account'}</PrimaryButton>
      </form>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button onClick={onBack} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>
          ← Back to sign in
        </button>
      </div>
    </>
  )
}

// ── Forgot password ───────────────────────────────────────────────────────────

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await authClient.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setSent(true)
  }

  if (sent) {
    return (
      <>
        <div style={{
          background: 'rgba(22,101,52,0.06)', border: '1px solid rgba(22,101,52,0.2)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 20,
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534',
        }}>
          Check your email — we sent a password reset link to <strong>{email}</strong>.
        </div>
        <button onClick={onBack} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>
          ← Back to sign in
        </button>
      </>
    )
  }

  return (
    <>
      <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', marginBottom: 6 }}>
        Reset password
      </h2>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginBottom: 24 }}>
        Enter your email and we'll send you a reset link.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            required autoFocus placeholder="you@conduet.com" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
        </Field>

        {error && <ErrorBox>{error}</ErrorBox>}

        <PrimaryButton loading={loading}>{loading ? 'Sending…' : 'Send reset link'}</PrimaryButton>
      </form>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button onClick={onBack} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>
          ← Back to sign in
        </button>
      </div>
    </>
  )
}

// ── Reset password (after clicking email link) ────────────────────────────────

export function ResetPasswordPage({ updatePassword }: {
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
}) {
  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== password2) { setError('Passwords do not match.'); return }
    if (password.length < 8)    { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    const { error } = await updatePassword(password)
    setLoading(false)
    if (error) { setError(error); return }
    setDone(true)
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F1F1F2',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '40px 36px',
        width: 380, border: '1.5px solid rgba(0,0,0,0.09)',
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

        {done ? (
          <>
            <div style={{
              background: 'rgba(22,101,52,0.06)', border: '1px solid rgba(22,101,52,0.2)',
              borderRadius: 10, padding: '14px 16px', marginBottom: 20,
              fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534',
            }}>
              Password updated successfully. You're now signed in.
            </div>
          </>
        ) : (
          <>
            <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 600, color: '#000', marginBottom: 6 }}>
              Set new password
            </h2>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginBottom: 24 }}>
              Choose a new password for your account.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="New password">
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required autoFocus placeholder="Min 8 characters" style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </Field>

              <Field label="Confirm new password">
                <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
                  required placeholder="••••••••" style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e  => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')} />
              </Field>

              {error && <ErrorBox>{error}</ErrorBox>}

              <PrimaryButton loading={loading}>{loading ? 'Updating…' : 'Update password'}</PrimaryButton>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#58595B' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(229,62,62,0.06)', border: '1px solid rgba(229,62,62,0.2)',
      borderRadius: 10, padding: '10px 12px',
      fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e',
    }}>
      {children}
    </div>
  )
}

function PrimaryButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading} style={{
      background: '#000', color: '#fff', border: 'none', borderRadius: 10,
      padding: '11px 16px', fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
      cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
      transition: 'opacity 0.15s', marginTop: 4,
    }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.8' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = loading ? '0.6' : '1' }}
    >
      {children}
    </button>
  )
}
