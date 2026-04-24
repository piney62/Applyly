import { PersistStorage } from 'zustand/middleware'

export const chromeStorage: PersistStorage<unknown> = {
  getItem: (name) =>
    new Promise((resolve) => {
      chrome.storage.local.get(name, (result) => {
        resolve(result[name] ?? null)
      })
    }),
  setItem: (name, value) =>
    new Promise<void>((resolve) => {
      chrome.storage.local.set({ [name]: value }, () => resolve())
    }),
  removeItem: (name) =>
    new Promise<void>((resolve) => {
      chrome.storage.local.remove(name, () => resolve())
    }),
}
