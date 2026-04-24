import { create } from 'zustand'
import { persist, PersistStorage } from 'zustand/middleware'
import { chromeStorage } from './chromeStorage'

interface User {
  id: string
  name: string
  email: string
}

interface AuthState {
  user: User | null
  token: string | null
  isLoggedIn: boolean
  login: (token: string, user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoggedIn: false,
      login: (token, user) => set({ token, user, isLoggedIn: true }),
      logout: () => set({ token: null, user: null, isLoggedIn: false }),
    }),
    {
      name: 'applyly-auth',
      storage: chromeStorage as unknown as PersistStorage<AuthState>,
    }
  )
)
