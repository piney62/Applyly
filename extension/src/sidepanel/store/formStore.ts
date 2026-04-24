import { create } from 'zustand'

export interface DetectedField {
  label: string
  status: 'pending' | 'filled'
  value?: string
  isAI?: boolean
  pageIndex: number
}

export type FillStatus = 'idle' | 'armed' | 'filling' | 'page_complete' | 'paused' | 'done'

interface FormState {
  currentPage: number
  totalPages: number | null
  detectedFields: DetectedField[]
  status: FillStatus
  autoAdvance: boolean
  coverLetter: string

  addPageFields: (pageIndex: number, labels: string[]) => void
  setPage: (current: number, total: number | null) => void
  setStatus: (status: FillStatus) => void
  markFieldFilled: (label: string, pageIndex: number, value: string, isAI: boolean) => void
  setAutoAdvance: (v: boolean) => void
  setCoverLetter: (text: string) => void
  reset: () => void
}

export const useFormStore = create<FormState>()((set) => ({
  currentPage: 1,
  totalPages: null,
  detectedFields: [],
  status: 'idle',
  autoAdvance: false,
  coverLetter: '',

  addPageFields: (pageIndex, labels) =>
    set((s) => {
      const existing = new Set(
        s.detectedFields.filter((f) => f.pageIndex === pageIndex).map((f) => f.label)
      )
      const newFields: DetectedField[] = labels
        .filter((label) => !existing.has(label))
        .map((label) => ({ label, status: 'pending', pageIndex }))
      return { detectedFields: [...s.detectedFields, ...newFields] }
    }),

  setPage: (current, total) =>
    set({ currentPage: current, totalPages: total }),

  setStatus: (status) => set({ status }),

  markFieldFilled: (label, pageIndex, value, isAI) =>
    set((s) => ({
      detectedFields: s.detectedFields.map((f) =>
        f.label === label && f.pageIndex === pageIndex
          ? { ...f, status: 'filled', value, isAI }
          : f
      ),
    })),

  setAutoAdvance: (v) => set({ autoAdvance: v }),

  setCoverLetter: (text) => set({ coverLetter: text }),

  reset: () =>
    set({
      currentPage: 1,
      totalPages: null,
      detectedFields: [],
      status: 'idle',
      coverLetter: '',
    }),
}))
