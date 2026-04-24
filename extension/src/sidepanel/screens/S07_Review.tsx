import { useEffect, useState } from 'react'
import { Btn } from '../components/Btn'
import { BottomNav } from '../components/BottomNav'
import { Spinner } from '../components/Spinner'
import { api } from '../api/client'
import { useFormStore } from '../store/formStore'
import { useJobStore } from '../store/jobStore'
import { useResumeStore } from '../store/resumeStore'

interface Props { navigate: (screen: string) => void }

export function S07_Review({ navigate }: Props) {
  const { detectedFields, coverLetter: storedCoverLetter, setCoverLetter } = useFormStore()
  const detectedJob = useJobStore((s) => s.detectedJob)
  const selectedResume = useResumeStore((s) => s.selectedResume)

  const filledFields = detectedFields.filter((f) => f.status === 'filled')

  const [coverLetter, setCoverLetterLocal] = useState(storedCoverLetter)
  const [generatingCL, setGeneratingCL] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const aiCount = filledFields.filter((f) => f.isAI).length

  // Auto-generate cover letter on mount if not already generated
  useEffect(() => {
    if (!coverLetter && selectedResume?.id) {
      generateCoverLetter()
    }
  }, [])

  async function generateCoverLetter() {
    if (!selectedResume?.id) return
    setGeneratingCL(true)
    try {
      const res = await api.ai.coverLetter({
        resume_id: selectedResume.id,
        job_description_text: detectedJob?.jobDescription ?? '',
        job_url: detectedJob?.jobUrl,
      })
      setCoverLetterLocal(res.cover_letter_text)
      setCoverLetter(res.cover_letter_text)
    } catch {
      // Non-fatal — user can manually write
    } finally {
      setGeneratingCL(false)
    }
  }

  async function handleManualTrack() {
    setError('')
    setSubmitting(true)
    try {
      await api.tracker.add({
        company: detectedJob?.company ?? 'Unknown',
        job_title: detectedJob?.jobTitle ?? 'Unknown',
        job_url: detectedJob?.jobUrl,
        resume_id: selectedResume?.id,
        resume_type: selectedResume?.type ?? 'uploaded',
        cover_letter: coverLetter,
        status: 'applied',
      })
      setSubmitted(true)
      setTimeout(() => navigate('S08'), 1500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🎉</div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1D9E75' }}>Application tracked!</p>
        <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>Redirecting to tracker…</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Cover letter */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Cover Letter</p>
            <button
              onClick={generateCoverLetter}
              disabled={generatingCL}
              style={{ background: 'none', border: 'none', color: '#534AB7', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {generatingCL ? <Spinner size={12} /> : '↻ Regenerate'}
            </button>
          </div>
          {generatingCL ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#9CA3AF', fontSize: 13 }}>
              <Spinner size={14} /> Generating cover letter…
            </div>
          ) : (
            <textarea
              value={coverLetter}
              onChange={(e) => {
                setCoverLetterLocal(e.target.value)
                setCoverLetter(e.target.value)
              }}
              rows={8}
              style={{
                width: '100%',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                lineHeight: 1.5,
              }}
              placeholder="Your cover letter will appear here after generation…"
            />
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: 0 }} />

        {/* Field summary */}
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
            Field Summary
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6B7280' }}>
            {filledFields.length} fields filled · {aiCount} AI-generated
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filledFields.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
                <span style={{ color: '#6B7280', flexShrink: 0 }}>{f.label}</span>
                <span style={{ color: '#111827', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Auto-detection notice */}
        <div style={{ background: '#EEEEF9', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#534AB7', lineHeight: 1.5 }}>
          Complete the reCAPTCHA on the form and click Submit — we'll detect and track your application automatically.
        </div>

        {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A' }}>{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Btn kind="success" fullWidth disabled={submitting} onClick={handleManualTrack}>
            {submitting ? <><Spinner size={16} color="white" /> Saving…</> : 'Mark as Submitted'}
          </Btn>
          <button
            onClick={() => navigate('S03')}
            style={{ background: 'none', border: 'none', color: '#E24B4A', fontSize: 13, cursor: 'pointer', padding: 0 }}
          >
            Cancel
          </button>
        </div>
      </div>
      <BottomNav active="apply" navigate={navigate} />
    </div>
  )
}
