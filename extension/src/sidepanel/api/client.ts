import { useAuthStore } from '../store/authStore'

async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = useAuthStore.getState().token ?? undefined

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'API_CALL', method, path, body, token },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (response?.error) {
          reject(new Error(response.error))
          return
        }
        resolve(response?.data as T)
      }
    )
  })
}

// ---------- typed API surface ----------

export interface RegisterIn { name: string; email: string; password: string }
export interface LoginIn { email: string; password: string }
export interface LoginOut {
  token: string
  has_resume: boolean
  resume_id: string | null
  skills_count: number
  user: { id: string; name: string; email: string }
}

export interface AnalyzeIn { job_url?: string; job_description_text: string }
export interface AnalyzeOut {
  match_score: number
  keywords: { word: string; status: 'matched' | 'weak' | 'missing' }[]
  knockouts: { keyword: string; mentions: number }[]
}

export interface CoverLetterIn { job_url?: string; resume_id: string; job_description_text?: string }
export interface CoverLetterOut { cover_letter_text: string }

export interface AnswerIn { question: string; resume_id: string; job_description_text?: string }
export interface AnswerOut { answer: string }

export interface AddApplicationIn {
  company: string; job_title: string; job_url?: string
  resume_id?: string; resume_type?: string; cover_letter?: string; status?: string
}

export const api = {
  auth: {
    register: (data: RegisterIn) =>
      apiCall<{ user_id: string; token: string }>('POST', '/auth/register', data),
    login: (data: LoginIn) =>
      apiCall<LoginOut>('POST', '/auth/login', data),
  },

  resume: {
    parsedData: (resumeId: string) =>
      apiCall<{ resume_id: string; parsed_data: Record<string, unknown> }>(
        'GET', `/resume/parsed?resume_id=${encodeURIComponent(resumeId)}`
      ),

    // File uploads go through direct fetch (FormData can't be relayed via chrome messages)
    upload: async (formData: FormData, token: string) => {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/resume/upload`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail)
      }
      return res.json() as Promise<{ resume_id: string; skills_count: number }>
    },

    uploadTemp: async (formData: FormData, token: string) => {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/resume/upload-temp`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail)
      }
      return res.json() as Promise<{ temp_resume_id: string }>
    },
  },

  jobs: {
    analyze: (data: AnalyzeIn) =>
      apiCall<AnalyzeOut>('POST', '/jobs/analyze', data),
  },

  ai: {
    coverLetter: (data: CoverLetterIn) =>
      apiCall<CoverLetterOut>('POST', '/ai/cover-letter', data),
    answer: (data: AnswerIn) =>
      apiCall<AnswerOut>('POST', '/ai/answer', data),
  },

  tracker: {
    list: () =>
      apiCall<{ applications: unknown[] }>('GET', '/tracker/list'),
    add: (data: AddApplicationIn) =>
      apiCall<{ application_id: string }>('POST', '/tracker/add', data),
    updateStatus: (id: string, status: string) =>
      apiCall<{ updated: boolean }>('PATCH', `/tracker/${id}/status`, { status }),
  },
}
