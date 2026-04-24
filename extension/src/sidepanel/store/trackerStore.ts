import { create } from 'zustand'

export type AppStatus = 'applied' | 'phone_screen' | 'interview' | 'offer' | 'rejected'

export interface Application {
  id: string
  company: string
  job_title: string
  job_url: string | null
  resume_id: string | null
  resume_type: string
  status: AppStatus
  cover_letter: string | null
  applied_at: string
}

interface TrackerState {
  applications: Application[]
  filterStatus: string
  setApplications: (list: Application[]) => void
  updateStatus: (id: string, status: AppStatus) => void
  setFilter: (status: string) => void
}

export const useTrackerStore = create<TrackerState>()((set) => ({
  applications: [],
  filterStatus: 'all',
  setApplications: (list) => set({ applications: list }),
  updateStatus: (id, status) =>
    set((s) => ({
      applications: s.applications.map((a) => (a.id === id ? { ...a, status } : a)),
    })),
  setFilter: (status) => set({ filterStatus: status }),
}))
