import { create } from 'zustand'

/** Simple = footage, frame tools and a timeline. Pro = tagging, clips, event log, pitch… */
export type Mode = 'simple' | 'pro'
const KEY = 'scoutdesk.mode'

const read = (): Mode => {
  try { return localStorage.getItem(KEY) === 'pro' ? 'pro' : 'simple' } catch { return 'simple' }
}

export const useMode = create<{ mode: Mode; setMode: (m: Mode) => void }>((set) => ({
  mode: read(),
  setMode: (mode) => {
    try { localStorage.setItem(KEY, mode) } catch { /* private mode */ }
    set({ mode })
  },
}))
