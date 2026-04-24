import { useRef, useState } from 'react'
import { Btn } from '../components/Btn'
import { BottomNav } from '../components/BottomNav'
import { Spinner } from '../components/Spinner'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useResumeStore } from '../store/resumeStore'
import { useFormStore } from '../store/formStore'

interface Props { navigate: (screen: string) => void }

export function S05_ResumeSelect({ navigate }: Props) {
  const [uploading, setUploading] = useState(false)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const token = useAuthStore((s) => s.token)
  const masterResume = useResumeStore((s) => s.masterResume)
  const setMaster = useResumeStore((s) => s.setMaster)
  const setSelected = useResumeStore((s) => s.setSelected)
  const resetForm = useFormStore((s) => s.reset)
  const setFormStatus = useFormStore((s) => s.setStatus)
  const autoAdvance = useFormStore((s) => s.autoAdvance)

  async function handleContinue() {
    setError('')
    let resumeId = masterResume?.id ?? ''

    if (selectedFile) {
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', selectedFile)
        if (saveAsDefault) {
          fd.append('save_as_default', 'true')
          const res = await api.resume.upload(fd, token ?? '')
          resumeId = res.resume_id
          setMaster({ id: res.resume_id, skillsCount: res.skills_count })
        } else {
          const res = await api.resume.uploadTemp(fd, token ?? '')
          resumeId = res.temp_resume_id
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Upload failed')
        setUploading(false)
        return
      }
      setUploading(false)
    }

    if (!resumeId) { setError('No resume selected'); return }

    // Fetch full parsed resume data for form filling
    let parsedData: Record<string, unknown> = {}
    try {
      const res = await api.resume.parsedData(resumeId)
      parsedData = res.parsed_data ?? {}
    } catch {
      // Non-fatal — form filler will use whatever data is available
    }

    setSelected({ id: resumeId, type: 'uploaded' })
    resetForm()
    setFormStatus('filling')

    // Tell the content script to start filling with full resume data
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'START_FILL',
        resumeData: { id: resumeId, ...parsedData },
        token: token,
        autoAdvance,
      })
    }

    navigate('S06')
  }

  const canContinue = !!(selectedFile || masterResume)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Which resume would you like to use?</h2>

        {/* Card A — upload own resume */}
        <div style={{
          border: '2px solid #534AB7',
          borderRadius: 12,
          padding: 16,
          background: '#FAFAFA',
        }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Upload my own resume</p>
          <p style={{ margin: '4px 0 12px', fontSize: 12, color: '#6B7280' }}>Use a resume you've prepared yourself</p>

          {masterResume && !selectedFile && (
            <div style={{ fontSize: 12, color: '#1D9E75', marginBottom: 10 }}>
              ✓ Using your saved resume
            </div>
          )}

          <button
            onClick={() => fileRef.current?.click()}
            style={{
              background: '#EEEEF9',
              border: '1px dashed #534AB7',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 12,
              color: '#534AB7',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            {selectedFile ? selectedFile.name : 'Choose different .docx…'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            style={{ display: 'none' }}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />

          {selectedFile && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
              />
              Save as my default resume
            </label>
          )}
        </div>

        {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A' }}>{error}</p>}

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Btn kind="primary" fullWidth disabled={!canContinue || uploading} onClick={handleContinue}>
            {uploading ? <><Spinner size={16} color="white" /> Uploading…</> : 'Continue'}
          </Btn>
          <button
            onClick={() => navigate('S04')}
            style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0 }}
          >
            ← Back
          </button>
        </div>
      </div>
      <BottomNav active="apply" navigate={navigate} />
    </div>
  )
}
