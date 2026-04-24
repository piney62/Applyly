import { create } from 'zustand'
import { persist, PersistStorage } from 'zustand/middleware'
import { chromeStorage } from './chromeStorage'

interface MasterResume {
  id: string
  skillsCount: number
}

interface SelectedResume {
  id: string
  type: 'uploaded' | 'ai_generated'
}

interface ResumeState {
  masterResume: MasterResume | null
  selectedResume: SelectedResume | null
  setMaster: (resume: MasterResume | null) => void
  setSelected: (resume: SelectedResume | null) => void
}

export const useResumeStore = create<ResumeState>()(
  persist(
    (set) => ({
      masterResume: null,
      selectedResume: null,
      setMaster: (resume) => set({ masterResume: resume }),
      setSelected: (resume) => set({ selectedResume: resume }),
    }),
    {
      name: 'applyly-resume',
      storage: chromeStorage as unknown as PersistStorage<ResumeState>,
    }
  )
)
