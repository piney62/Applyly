import { useState } from 'react'
import { Logo } from '../components/Logo'
import { Input } from '../components/Input'
import { Btn } from '../components/Btn'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useResumeStore } from '../store/resumeStore'

interface Props { navigate: (screen: string) => void }

export function S01_Login({ navigate }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)
  const setMaster = useResumeStore((s) => s.setMaster)

  async function handleLogin() {
    setError('')
    if (!email || !password) { setError('Email and password are required'); return }

    setLoading(true)
    try {
      const res = await api.auth.login({ email, password })
      login(res.token, res.user)
      if (res.resume_id) {
        setMaster({ id: res.resume_id, skillsCount: res.skills_count })
      }
      navigate(res.has_resume ? 'S03' : 'S02')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '32px 24px 24px', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <Logo />
        <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>Welcome back</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Input label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      </div>

      <button
        style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: 12, cursor: 'default', textAlign: 'left', padding: 0 }}
        disabled
      >
        Forgot password? (coming soon)
      </button>

      {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A', textAlign: 'center' }}>{error}</p>}

      <Btn kind="primary" fullWidth disabled={loading} onClick={handleLogin}>
        {loading ? 'Logging in…' : 'Log In'}
      </Btn>

      <p style={{ margin: 0, textAlign: 'center', fontSize: 13, color: '#6B7280' }}>
        Don't have an account?{' '}
        <button
          onClick={() => navigate('S00')}
          style={{ background: 'none', border: 'none', color: '#534AB7', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: 0 }}
        >
          Sign up
        </button>
      </p>
    </div>
  )
}
