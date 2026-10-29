import { toast } from 'sonner'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { useData } from '@/store/data'
import type { Clip, ClipPatch } from '@/types'
import { useHistory } from './history'

interface ClipsState {
  matchId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  clips: Clip[]
  selectedIds: string[]
  /** The clip shown in the inspector (last one clicked/created). */
  activeId: string | null
  load: (matchId: string) => Promise<void>
  reset: () => void
  select: (ids: string[], activeId?: string | null) => void
  toggle: (id: string) => void
}

const byTime = (a: Clip, b: Clip) => a.timeSec - b.timeSec || a.startSec - b.startSec

export const useClips = create<ClipsState>((set, get) => ({
  matchId: null,
  status: 'idle',
  clips: [],
  selectedIds: [],
  activeId: null,
  load: async (matchId) => {
    set({ matchId, status: 'loading', clips: [], selectedIds: [], activeId: null })
    try {
      const clips = await api.clips(matchId)
      if (get().matchId === matchId) set({ clips: clips.sort(byTime), status: 'ready' })
    } catch {
      if (get().matchId === matchId) set({ status: 'error' })
    }
  },
  reset: () => set({ matchId: null, status: 'idle', clips: [], selectedIds: [], activeId: null }),
  select: (ids, activeId) => set({ selectedIds: ids, activeId: activeId === undefined ? (ids[ids.length - 1] ?? null) : activeId }),
  toggle: (id) =>
    set((s) => {
      const on = s.selectedIds.includes(id)
      const selectedIds = on ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
      return { selectedIds, activeId: on ? (selectedIds[selectedIds.length - 1] ?? null) : id }
    }),
}))

const set = useClips.setState
const get = useClips.getState

// ── Local (optimistic) mutations ─────────────────────────────────────────────

function addLocal(clips: Clip[]) {
  set((s) => ({ clips: [...s.clips, ...clips].sort(byTime) }))
}
function removeLocal(ids: string[]) {
  const gone = new Set(ids)
  set((s) => {
    const selectedIds = s.selectedIds.filter((id) => !gone.has(id))
    return { clips: s.clips.filter((c) => !gone.has(c.id)), selectedIds, activeId: s.activeId && gone.has(s.activeId) ? (selectedIds[selectedIds.length - 1] ?? null) : s.activeId }
  })
}
function patchLocal(updates: { id: string; patch: ClipPatch }[]) {
  const map = new Map(updates.map((u) => [u.id, u.patch]))
  set((s) => ({ clips: s.clips.map((c) => (map.has(c.id) ? { ...c, ...map.get(c.id) } : c)).sort(byTime) }))
}

/** Re-sync from the server after a failed write so the UI never drifts from the truth. */
async function resync(err: unknown) {
  toast.error(err instanceof Error ? err.message : 'Save failed')
  const id = get().matchId
  if (id) await get().load(id)
}

const refreshMatchCounts = () => void useData.getState().refreshMatches().catch(() => {})

// ── Public actions (all undoable) ────────────────────────────────────────────

export async function createClips(clips: Clip[], label = clips.length === 1 ? 'Create clip' : `Create ${clips.length} clips`) {
  addLocal(clips)
  const ids = clips.map((c) => c.id)
  useHistory.getState().push({
    label,
    undo: async () => {
      removeLocal(ids)
      await api.deleteClips(ids)
      refreshMatchCounts()
    },
    redo: async () => {
      addLocal(clips)
      await api.createClips(clips)
      refreshMatchCounts()
    },
  })
  try {
    await api.createClips(clips)
    refreshMatchCounts()
  } catch (e) {
    await resync(e)
  }
}

export async function patchClips(updates: { id: string; patch: ClipPatch }[], label = 'Edit clip') {
  const existing = new Map(get().clips.map((c) => [c.id, c]))
  const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b)
  // Drop no-op edits so they create neither an undo step nor a network call.
  const effective: typeof updates = []
  const inverse: typeof updates = []
  for (const u of updates) {
    const cur = existing.get(u.id)
    if (!cur) continue
    const changedKeys = Object.keys(u.patch).filter((k) => !same(u.patch[k as keyof ClipPatch], cur[k as keyof Clip]))
    if (changedKeys.length === 0) continue
    const patch: Record<string, unknown> = {}
    const prev: Record<string, unknown> = {}
    for (const k of changedKeys) {
      patch[k] = u.patch[k as keyof ClipPatch]
      prev[k] = cur[k as keyof Clip]
    }
    effective.push({ id: u.id, patch: patch as ClipPatch })
    inverse.push({ id: u.id, patch: prev as ClipPatch })
  }
  if (effective.length === 0) return
  updates = effective
  patchLocal(updates)
  useHistory.getState().push({
    label,
    undo: async () => {
      patchLocal(inverse)
      await api.updateClips(inverse)
    },
    redo: async () => {
      patchLocal(updates)
      await api.updateClips(updates)
    },
  })
  try {
    await api.updateClips(updates)
  } catch (e) {
    await resync(e)
  }
}

/** Same patch applied to many clips (bulk edits). */
export const patchMany = (ids: string[], patch: ClipPatch, label: string) => patchClips(ids.map((id) => ({ id, patch })), label)

export async function deleteClips(ids: string[]) {
  const doomed = get().clips.filter((c) => ids.includes(c.id))
  if (doomed.length === 0) return
  removeLocal(ids)
  useHistory.getState().push({
    label: doomed.length === 1 ? 'Delete clip' : `Delete ${doomed.length} clips`,
    undo: async () => {
      addLocal(doomed)
      await api.createClips(doomed)
      refreshMatchCounts()
    },
    redo: async () => {
      removeLocal(ids)
      await api.deleteClips(ids)
      refreshMatchCounts()
    },
  })
  try {
    await api.deleteClips(ids)
    refreshMatchCounts()
  } catch (e) {
    await resync(e)
  }
}

/**
 * Live preview while dragging a clip edge: updates the store only. On pointer-up
 * restore the original values with this, then call `patchClips` once so the
 * whole drag is a single undo step.
 */
export function previewClip(id: string, patch: ClipPatch) {
  patchLocal([{ id, patch }])
}
