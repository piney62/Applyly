import { create } from 'zustand'

export interface DetectedJob {
  platform: string
  company: string
  jobTitle: string
  jobUrl: string
  jobDescription: string
}

export interface Keyword {
  word: string
  status: 'matched' | 'weak' | 'missing'
}

export interface Knockout {
  keyword: string
  mentions: number
}

export interface AnalysisResult {
  matchScore: number
  keywords: Keyword[]
  knockouts: Knockout[]
}

interface JobState {
  detectedJob: DetectedJob | null
  analysisResult: AnalysisResult | null
  setDetected: (job: DetectedJob) => void
  setAnalysis: (result: AnalysisResult) => void
  clearJob: () => void
}

export const useJobStore = create<JobState>()((set) => ({
  detectedJob: null,
  analysisResult: null,
  setDetected: (job) => set({ detectedJob: job, analysisResult: null }),
  setAnalysis: (result) => set({ analysisResult: result }),
  clearJob: () => set({ detectedJob: null, analysisResult: null }),
}))
