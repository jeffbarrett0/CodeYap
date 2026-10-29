import { toast } from 'sonner'
import { create } from 'zustand'

export interface HistoryEntry {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
  busy: boolean
  push: (e: HistoryEntry) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clear: () => void
}

const LIMIT = 200

/** Linear undo/redo over async, server-synced operations. */
export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  busy: false,
  push: (e) => set((s) => ({ past: [...s.past.slice(-(LIMIT - 1)), e], future: [] })),
  clear: () => set({ past: [], future: [] }),
  undo: async () => {
    const { past, busy } = get()
    const e = past[past.length - 1]
    if (!e || busy) return
    set({ busy: true, past: past.slice(0, -1) })
    try {
      await e.undo()
      set((s) => ({ future: [...s.future, e] }))
      toast(`Undid: ${e.label}`, { duration: 1500 })
    } catch (err) {
      toast.error(`Undo failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      set({ busy: false })
    }
  },
  redo: async () => {
    const { future, busy } = get()
    const e = future[future.length - 1]
    if (!e || busy) return
    set({ busy: true, future: future.slice(0, -1) })
    try {
      await e.redo()
      set((s) => ({ past: [...s.past, e] }))
      toast(`Redid: ${e.label}`, { duration: 1500 })
    } catch (err) {
      toast.error(`Redo failed: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      set({ busy: false })
    }
  },
}))
