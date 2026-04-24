import { useState } from 'react'
import { Pill } from '../components/Pill'
import { Btn } from '../components/Btn'
import { BottomNav } from '../components/BottomNav'
import { Spinner } from '../components/Spinner'
import { api } from '../api/client'
import { useJobStore } from '../store/jobStore'
import { useResumeStore } from '../store/resumeStore'

interface Props { navigate: (screen: string) => void }

const platformColors: Record<string, string> = {
  Indeed: '#2164F3', Workday: '#E87730', Greenhouse: '#24A37A', Lever: '#141C4C',
}

export function S03_Detection({ navigate }: Props) {
  const detectedJob = useJobStore((s) => s.detectedJob)
  const setAnalysis = useJobStore((s) => s.setAnalysis)
  const masterResume = useResumeStore((s) => s.masterResume)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')

  async function handleAnalyze() {
    if (!detectedJob) return
    setError('')
    setAnalyzing(true)
    try {
      const res = await api.jobs.analyze({ job_description_text: detectedJob.jobDescription, job_url: detectedJob.jobUrl })
      setAnalysis({ matchScore: res.match_score, keywords: res.keywords, knockouts: res.knockouts ?? [] })
      navigate('S04')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const platformColor = detectedJob ? (platformColors[detectedJob.platform] ?? '#534AB7') : '#534AB7'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {detectedJob ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: platformColor,
                color: 'white',
                borderRadius: 6,
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 600,
              }}>
                {detectedJob.platform}
              </span>
            </div>

            <div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
                {detectedJob.company}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: '#374151' }}>{detectedJob.jobTitle}</p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {masterResume ? (
                <Pill color="green" dot>Resume ready</Pill>
              ) : (
                <button
                  onClick={() => navigate('S02')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <Pill color="red" dot>No resume — upload now</Pill>
                </button>
              )}
            </div>

            {error && <p style={{ margin: 0, fontSize: 12, color: '#E24B4A' }}>{error}</p>}

            <div style={{ marginTop: 'auto' }}>
              <Btn
                kind="primary"
                fullWidth
                disabled={!masterResume || analyzing}
                onClick={handleAnalyze}
              >
                {analyzing ? <><Spinner size={16} color="white" /> Analyzing…</> : 'Analyze This Job'}
              </Btn>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#9CA3AF' }}>
            <span style={{ fontSize: 36 }}>🔍</span>
            <p style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>No job detected on this page</p>
            <p style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>
              Navigate to a job listing on Indeed, Workday, Greenhouse, or Lever
            </p>
          </div>
        )}
      </div>
      <BottomNav active="apply" navigate={navigate} />
    </div>
  )
}
