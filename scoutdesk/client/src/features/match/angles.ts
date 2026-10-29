import { create } from 'zustand'

interface AnglesState {
  /** null = default (the "Main" angle, else the first ready video). */
  primaryId: string | null
  /** Second camera angle shown beside the main one, synced by offset. */
  secondaryId: string | null
  setPrimary: (id: string | null) => void
  setSecondary: (id: string | null) => void
  reset: () => void
}

export const useAngles = create<AnglesState>((set) => ({
  primaryId: null,
  secondaryId: null,
  setPrimary: (primaryId) => set((s) => ({ primaryId, secondaryId: s.secondaryId === primaryId ? null : s.secondaryId })),
  setSecondary: (secondaryId) => set({ secondaryId }),
  reset: () => set({ primaryId: null, secondaryId: null }),
}))
