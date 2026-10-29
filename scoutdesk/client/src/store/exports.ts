import { toast } from 'sonner'
import { create } from 'zustand'
import { api } from '@/lib/api'
import type { ExportJob } from '@/types'

interface ExportsState {
  jobs: ExportJob[]
  refresh: () => Promise<void>
  start: (kind: 'clip' | 'playlist', refId: string, label: string, titles?: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
}

const seenDone = new Set<string>()

export const useExports = create<ExportsState>((set, get) => ({
  jobs: [],
  refresh: async () => {
    const jobs = await api.exports()
    // Announce completions that happen while the user is elsewhere in the app.
    for (const j of jobs) {
      if (j.status === 'done' && !seenDone.has(j.id) && get().jobs.some((o) => o.id === j.id && o.status !== 'done')) toast.success(`Export ready: ${j.label}`)
      if (j.status === 'done' || j.status === 'failed') seenDone.add(j.id)
    }
    set({ jobs })
  },
  start: async (kind, refId, label, titles) => {
    try {
      const job = await api.createExport(kind, refId, titles)
      set((s) => ({ jobs: [job, ...s.jobs] }))
      toast(`Exporting “${label}” — see the Exports tray`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start export')
    }
  },
  remove: async (id) => {
    await api.deleteExport(id)
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  },
}))
