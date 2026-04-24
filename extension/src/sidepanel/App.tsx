import { useEffect, useState } from 'react'
import { useAuthStore } from './store/authStore'
import { useResumeStore } from './store/resumeStore'
import { useJobStore } from './store/jobStore'
import { useFormStore } from './store/formStore'
import { api } from './api/client'

import { S00_Signup } from './screens/S00_Signup'
import { S01_Login } from './screens/S01_Login'
import { S02_ResumeSetup } from './screens/S02_ResumeSetup'
import { S03_Detection } from './screens/S03_Detection'
import { S04_Analysis } from './screens/S04_Analysis'
import { S05_ResumeSelect } from './screens/S05_ResumeSelect'
import { S06_FormFilling } from './screens/S06_FormFilling'
import { S07_Review } from './screens/S07_Review'
import { S08_Tracker } from './screens/S08_Tracker'
import { S09_Settings } from './screens/S09_Settings'
import { Logo } from './components/Logo'

type Screen = 'S00' | 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'S08' | 'S09'

const APPLY_SCREENS: Screen[] = ['S03', 'S04', 'S05', 'S06', 'S07']

export function App() {
  const { isLoggedIn } = useAuthStore()
  const { masterResume } = useResumeStore()
  const setDetectedJob = useJobStore((s) => s.setDetected)
  const { addPageFields, setPage, setStatus: setFormStatus, markFieldFilled } = useFormStore()

  const [screen, setScreen] = useState<Screen>(() => {
    if (!isLoggedIn) return 'S00'
    if (!masterResume) return 'S02'
    return 'S03'
  })

  // Handle messages from content scripts
  useEffect(() => {
    function handleMessage(message: Record<string, unknown>) {
      switch (message.type) {
        case 'JOB_DETECTED':
          setDetectedJob({
            platform: message.platform as string,
            company: message.company as string,
            jobTitle: message.jobTitle as string,
            jobUrl: message.jobUrl as string,
            jobDescription: message.jobDescription as string,
          })
          break

        case 'FILL_ARMED':
          setFormStatus('armed')
          break

        case 'PAGE_FIELDS_DETECTED':
          addPageFields(
            (message.currentPage as number) ?? 1,
            message.labels as string[],
          )
          setFormStatus('filling')
          break

        case 'FIELD_FILLED': {
          const label = message.fieldLabel as string
          const value = message.value as string
          const isAI = message.isAI as boolean
          const pageIndex = (message.pageIndex as number) ?? 1
          markFieldFilled(label, pageIndex, value, isAI)
          break
        }

        case 'PAGE_CHANGED':
          setPage(message.currentPage as number, message.totalPages as number | null)
          break

        case 'PAGE_FILL_COMPLETE':
          setFormStatus('page_complete')
          break

        case 'ALL_FIELDS_DONE':
          setFormStatus('done')
          setScreen('S07')
          break

        case 'APPLICATION_SUBMITTED': {
          const job = useJobStore.getState().detectedJob
          const resume = useResumeStore.getState().selectedResume
          const coverLetter = useFormStore.getState().coverLetter
          api.tracker.add({
            company: job?.company ?? 'Unknown',
            job_title: job?.jobTitle ?? 'Unknown',
            job_url: job?.jobUrl,
            resume_id: resume?.id,
            resume_type: resume?.type ?? 'uploaded',
            cover_letter: coverLetter,
            status: 'applied',
          }).catch(() => { /* non-fatal */ })
          setScreen('S08')
          break
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  const navigate = (s: string) => setScreen(s as Screen)

  const showHeader = !['S00', 'S01', 'S02'].includes(screen)

  return (
    <div style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'white', fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {showHeader && (
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid #F3F4F6',
          flexShrink: 0,
        }}>
          <Logo size={22} />
          {APPLY_SCREENS.includes(screen) && (
            <div style={{ display: 'flex', gap: 5 }}>
              {(['S03', 'S04', 'S05', 'S06', 'S07'] as Screen[]).map((s) => (
                <div key={s} style={{ width: 6, height: 6, borderRadius: '50%', background: screen === s ? '#534AB7' : '#E5E7EB' }} />
              ))}
            </div>
          )}
        </header>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {screen === 'S00' && <S00_Signup navigate={navigate} />}
        {screen === 'S01' && <S01_Login navigate={navigate} />}
        {screen === 'S02' && <S02_ResumeSetup navigate={navigate} />}
        {screen === 'S03' && <S03_Detection navigate={navigate} />}
        {screen === 'S04' && <S04_Analysis navigate={navigate} />}
        {screen === 'S05' && <S05_ResumeSelect navigate={navigate} />}
        {screen === 'S06' && <S06_FormFilling navigate={navigate} />}
        {screen === 'S07' && <S07_Review navigate={navigate} />}
        {screen === 'S08' && <S08_Tracker navigate={navigate} />}
        {screen === 'S09' && <S09_Settings navigate={navigate} />}
      </div>
    </div>
  )
}
