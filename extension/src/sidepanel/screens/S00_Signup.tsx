import { useRef, useState } from 'react'
import { Logo } from '../components/Logo'
import { Input } from '../components/Input'
import { Btn } from '../components/Btn'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useResumeStore } from '../store/resumeStore'

interface Props { navigate: (screen: string) => void }

export function S00_Signup({ navigate }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const login = useAuthStore((s) => s.login)
  const setMaster = useResumeStore((s) => s.setMaster)

  async function handleSubmit() {
    setError('')
    if (!name || !email || !password) { setError('All fields are required'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }

    setLoading(true)
    try {
      const { token } = await api.auth.register({ name, email, password })
      const user = { id: '', name, email }
      login(token, user)

      if (selectedFile) {
        const fd = new FormData()
        fd.append('file', selectedFile)
        const res = await api.resume.upload(fd, token)
        setMaster({ id: res.resume_id, skillsCount: res.skills_count })
        navigate('S03')
      } else {
        navigate('S02')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '32px 24px 24px', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <Logo />
        <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>Create your account</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Input label="Full name" value={name} onChange={setName} autoComplete="name" />
        <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Input label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <Input label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />

        <div>
          <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 500, color: '#374151' }}>Resume <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(optional — upload now or later)</span></p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              width: '100%',
              background: '#F9FAFB',
              border: `1px dashed ${selectedFile ? '#1D9E75' : '#D1D5DB'}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              color: selectedFile ? '#1D9E75' : '#6B7280',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            {selectedFile ? `✓ ${selectedFile.name}` : '+ Choose .docx or .pdf…'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A', textAlign: 'center' }}>{error}</p>}

      <Btn kind="primary" fullWidth disabled={loading} onClick={handleSubmit}>
        {loading ? (selectedFile ? 'Creating account & uploading…' : 'Creating account…') : 'Create Account'}
      </Btn>

      <p style={{ margin: 0, textAlign: 'center', fontSize: 13, color: '#6B7280' }}>
        Already have an account?{' '}
        <button
          onClick={() => navigate('S01')}
          style={{ background: 'none', border: 'none', color: '#534AB7', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: 0 }}
        >
          Log in
        </button>
      </p>
    </div>
  )
}
