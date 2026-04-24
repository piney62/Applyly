import { useRef, useState } from 'react'
import { Btn } from '../components/Btn'
import { Spinner } from '../components/Spinner'
import { CheckIcon } from '../components/CheckIcon'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useResumeStore } from '../store/resumeStore'

interface Props { navigate: (screen: string) => void }

type Phase = 'idle' | 'loading' | 'done'

export function S02_ResumeSetup({ navigate }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [skillsCount, setSkillsCount] = useState(0)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const token = useAuthStore((s) => s.token)
  const setMaster = useResumeStore((s) => s.setMaster)

  async function handleFile(file: File) {
    if (!file.name.endsWith('.docx')) { setError('Please upload a .docx file'); return }
    setError('')
    setPhase('loading')

    const fd = new FormData()
    fd.append('file', file)

    try {
      const res = await api.resume.upload(fd, token ?? '')
      setMaster({ id: res.resume_id, skillsCount: res.skills_count })
      setSkillsCount(res.skills_count)
      setPhase('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setPhase('idle')
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '28px 24px 24px', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Upload your resume to get started</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6B7280' }}>
          Upload once. Applyly uses it to fill forms automatically.
        </p>
      </div>

      {phase === 'idle' && (
        <>
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#534AB7' : '#E5E7EB'}`,
              borderRadius: 12,
              padding: '32px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? '#EEEEF9' : '#F9FAFB',
              transition: 'all 150ms',
            }}
          >
            <div style={{ fontSize: 28 }}>📄</div>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#374151', fontWeight: 500 }}>
              Drag & drop or <span style={{ color: '#534AB7' }}>browse</span>
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>.docx files only</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </>
      )}

      {phase === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 0' }}>
          <Spinner size={32} />
          <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>Reading your resume…</p>
        </div>
      )}

      {phase === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
          <CheckIcon size={40} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: '#1D9E75', textAlign: 'center' }}>
            {skillsCount} skills detected. You're ready.
          </p>
        </div>
      )}

      {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A' }}>{error}</p>}

      {phase === 'done' && (
        <div style={{ marginTop: 'auto' }}>
          <Btn kind="primary" fullWidth onClick={() => navigate('S03')}>Continue</Btn>
        </div>
      )}
    </div>
  )
}
