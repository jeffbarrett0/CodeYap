import { toast } from 'sonner'
import { create } from 'zustand'
import { ApiError, uploadVideo } from '@/lib/api'
import { newId } from '@/lib/ids'
import { useData } from './data'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled'

export interface UploadItem {
  id: string
  file: File
  title: string
  matchId: string | null
  angle: string
  tags: string[]
  progress: number
  status: UploadStatus
  error?: string
  videoId?: string
}

interface UploadState {
  items: UploadItem[]
  enqueue: (items: Omit<UploadItem, 'id' | 'progress' | 'status'>[]) => void
  cancel: (id: string) => void
  retry: (id: string) => void
  clearFinished: () => void
}

const MAX_PARALLEL = 2
const controllers = new Map<string, AbortController>()

/**
 * Uploads live in a store (not a component) so they keep going when the user
 * navigates away from the Library — full-match files take a while.
 */
export const useUploads = create<UploadState>((set, get) => {
  const patch = (id: string, p: Partial<UploadItem>) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }))

  async function pump() {
    const { items } = get()
    const active = items.filter((i) => i.status === 'uploading').length
    const next = items.filter((i) => i.status === 'queued').slice(0, Math.max(0, MAX_PARALLEL - active))
    for (const item of next) void start(item)
  }

  async function start(item: UploadItem) {
    const ctrl = new AbortController()
    controllers.set(item.id, ctrl)
    patch(item.id, { status: 'uploading', progress: 0, error: undefined })
    try {
      const video = await uploadVideo(
        item.file,
        { title: item.title, matchId: item.matchId, angle: item.angle, tags: item.tags },
        (f) => patch(item.id, { progress: f }),
        ctrl.signal,
      )
      useData.getState().upsertVideo(video)
      void useData.getState().refreshMatches()
      patch(item.id, { status: 'done', progress: 1, videoId: video.id })
      toast.success(`Uploaded “${item.title}” — processing…`)
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      patch(item.id, { status: cancelled ? 'cancelled' : 'error', error: e instanceof ApiError ? e.message : 'Upload failed' })
      if (!cancelled) toast.error(`Upload failed: ${e instanceof Error ? e.message : item.title}`)
    } finally {
      controllers.delete(item.id)
      void pump()
    }
  }

  return {
    items: [],
    enqueue: (items) => {
      set((s) => ({ items: [...s.items, ...items.map((i) => ({ ...i, id: newId('up'), progress: 0, status: 'queued' as const }))] }))
      void pump()
    },
    cancel: (id) => {
      controllers.get(id)?.abort()
      if (get().items.find((i) => i.id === id)?.status === 'queued') patch(id, { status: 'cancelled' })
    },
    retry: (id) => {
      patch(id, { status: 'queued', progress: 0, error: undefined })
      void pump()
    },
    clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status === 'queued' || i.status === 'uploading') })),
  }
})
