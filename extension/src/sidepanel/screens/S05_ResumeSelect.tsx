import { useRef, useState } from 'react'
import { Btn } from '../components/Btn'
import { BottomNav } from '../components/BottomNav'
import { Spinner } from '../components/Spinner'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useResumeStore } from '../store/resumeStore'
import { useFormStore } from '../store/formStore'
import { useJobStore } from '../store/jobStore'

interface Props { navigate: (screen: string) => void }

export function S05_ResumeSelect({ navigate }: Props) {
  const [selectedCard, setSelectedCard] = useState<'own' | 'tailored'>('own')
  const [uploading, setUploading] = useState(false)
  const [tailoring, setTailoring] = useState(false)
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
  const detectedJob = useJobStore((s) => s.detectedJob)

  const canTailor = !!(masterResume && detectedJob?.jobDescription)

  async function handleContinue() {
    setError('')
    let resumeId = masterResume?.id ?? ''

    if (selectedCard === 'tailored') {
      // Card B: AI-tailor the master resume to the detected JD
      if (!masterResume || !detectedJob?.jobDescription) {
        setError('Master resume and a detected job are required for AI tailoring')
        return
      }
      setTailoring(true)
      try {
        const res = await api.resume.tailor(masterResume.id, detectedJob.jobDescription)
        resumeId = res.resume_id
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Tailoring failed')
        setTailoring(false)
        return
      }
      setTailoring(false)
    } else if (selectedFile) {
      // Card A with new file upload
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

    // Fetch resume parsed data and user profile in parallel
    let parsedData: Record<string, unknown> = {}
    let userProfile: Record<string, unknown> = {}
    try {
      const [resumeRes, profileRes] = await Promise.allSettled([
        api.resume.parsedData(resumeId),
        api.auth.profile(),
      ])
      if (resumeRes.status === 'fulfilled') parsedData = resumeRes.value.parsed_data ?? {}
      if (profileRes.status === 'fulfilled') {
        const p = profileRes.value
        // User profile fields override resume fields for contact/address data
        if (p.first_name) userProfile.first_name = p.first_name
        if (p.last_name) userProfile.last_name = p.last_name
        if (p.phone) userProfile.phone = p.phone
        if (p.linkedin) userProfile.linkedin = p.linkedin
        if (p.street_address) userProfile.street_address = p.street_address
        if (p.city) userProfile.city = p.city
        if (p.state) userProfile.state = p.state
        if (p.country) userProfile.country = p.country
        if (p.postal_code) userProfile.postal_code = p.postal_code
      }
    } catch {
      // Non-fatal
    }

    setSelected({ id: resumeId, type: 'uploaded' })
    resetForm()
    setFormStatus('filling')

    // Tell the content script to start filling — resume data merged with user profile
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'START_FILL',
        resumeData: { id: resumeId, ...parsedData, ...userProfile },
        token: token,
        autoAdvance,
      })
    }

    navigate('S06')
  }

  const canContinue = selectedCard === 'tailored'
    ? canTailor
    : !!(selectedFile || masterResume)
  const isBusy = uploading || tailoring

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Which resume would you like to use?</h2>

        {/* Card A — upload own resume */}
        <div
          onClick={() => setSelectedCard('own')}
          style={{
            border: `2px solid ${selectedCard === 'own' ? '#534AB7' : '#E5E7EB'}`,
            borderRadius: 12,
            padding: 16,
            background: selectedCard === 'own' ? '#FAFAFA' : '#F9FAFB',
            cursor: 'pointer',
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Upload my own resume</p>
          <p style={{ margin: '4px 0 12px', fontSize: 12, color: '#6B7280' }}>Use a resume you've prepared yourself</p>

          {masterResume && !selectedFile && (
            <div style={{ fontSize: 12, color: '#1D9E75', marginBottom: 10 }}>
              ✓ Using your saved resume
            </div>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
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
            <label
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
              />
              Save as my default resume
            </label>
          )}
        </div>

        {/* Card B — AI-tailored resume */}
        <div
          onClick={() => canTailor && setSelectedCard('tailored')}
          style={{
            border: `2px solid ${selectedCard === 'tailored' ? '#534AB7' : '#E5E7EB'}`,
            borderRadius: 12,
            padding: 16,
            background: selectedCard === 'tailored' ? '#FAFAFA' : '#F9FAFB',
            cursor: canTailor ? 'pointer' : 'default',
            opacity: canTailor ? 1 : 0.5,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generate ATS-tailored resume</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280' }}>
            {canTailor
              ? "AI rewrites your resume to match this job's keywords"
              : 'Requires a saved resume and a detected job'}
          </p>
          {canTailor && (
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#9CA3AF' }}>Takes ~20-30 seconds</p>
          )}
        </div>

        {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A' }}>{error}</p>}

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Btn kind="primary" fullWidth disabled={!canContinue || isBusy} onClick={handleContinue}>
            {tailoring ? (
              <><Spinner size={16} color="white" /> Optimizing resume…</>
            ) : uploading ? (
              <><Spinner size={16} color="white" /> Uploading…</>
            ) : 'Continue'}
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
