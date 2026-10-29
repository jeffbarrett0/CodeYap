import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newId } from '@/lib/ids'
import type { Clip, Outcome } from '@/types'

export interface ClipFilters {
  text: string
  categoryIds: string[]
  tagTypeIds: string[]
  playerIds: string[]
  /** "none" matches clips with no player. */
  teamIds: string[]
  outcomes: Outcome[]
  zones: string[]
  labels: string[]
}

export const EMPTY_FILTERS: ClipFilters = { text: '', categoryIds: [], tagTypeIds: [], playerIds: [], teamIds: [], outcomes: [], zones: [], labels: [] }

export const activeFilterCount = (f: ClipFilters) =>
  (f.text.trim() ? 1 : 0) + f.categoryIds.length + f.tagTypeIds.length + f.playerIds.length + f.teamIds.length + f.outcomes.length + f.zones.length + f.labels.length

interface FilterState {
  filters: ClipFilters
  setFilters: (patch: Partial<ClipFilters>) => void
  replaceFilters: (f: ClipFilters) => void
  clear: () => void
}

export const useFilters = create<FilterState>((set) => ({
  filters: EMPTY_FILTERS,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  replaceFilters: (filters) => set({ filters }),
  clear: () => set({ filters: EMPTY_FILTERS }),
}))

interface Preset {
  id: string
  name: string
  filters: ClipFilters
}
interface PresetState {
  presets: Preset[]
  save: (name: string, filters: ClipFilters) => void
  remove: (id: string) => void
}

/** Saved filter presets live in the browser (per analyst machine). */
export const useFilterPresets = create<PresetState>()(
  persist(
    (set) => ({
      presets: [],
      save: (name, filters) => set((s) => ({ presets: [...s.presets.filter((p) => p.name !== name), { id: newId('fp'), name, filters }] })),
      remove: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: 'scoutdesk.filter-presets' },
  ),
)

export interface FilterContext {
  categoryOfTag: (tagTypeId: string) => { id: string } | undefined
  tagName: (tagTypeId: string) => string
  playerName: (id: string | null) => string
}

/** Pure filter predicate. Text search covers tag, player, notes and labels. */
export function matchesFilters(c: Clip, f: ClipFilters, ctx: FilterContext): boolean {
  if (f.categoryIds.length && !f.categoryIds.includes(ctx.categoryOfTag(c.tagTypeId)?.id ?? '')) return false
  if (f.tagTypeIds.length && !f.tagTypeIds.includes(c.tagTypeId)) return false
  if (f.playerIds.length && !f.playerIds.includes(c.playerId ?? 'none')) return false
  if (f.teamIds.length && !f.teamIds.includes(c.teamId ?? 'none')) return false
  if (f.outcomes.length && !f.outcomes.includes(c.outcome)) return false
  if (f.zones.length && !f.zones.includes(c.zone ?? 'none')) return false
  if (f.labels.length && !f.labels.some((l) => c.labels.includes(l))) return false
  const text = f.text.trim().toLowerCase()
  if (text) {
    const hay = `${ctx.tagName(c.tagTypeId)} ${ctx.playerName(c.playerId)} ${c.notes} ${c.labels.join(' ')}`.toLowerCase()
    if (!text.split(/\s+/).every((w) => hay.includes(w))) return false
  }
  return true
}
