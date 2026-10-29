import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Category, Match, Player, TagType, Team, User, Video } from '@/types'

interface DataState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  users: User[]
  teams: Team[]
  players: Player[]
  matches: Match[]
  videos: Video[]
  categories: Category[]
  fetchAll: () => Promise<void>
  refreshVideos: () => Promise<void>
  refreshMatches: () => Promise<void>
  upsertVideo: (v: Video) => void
  removeVideo: (id: string) => void
  upsertMatch: (m: Match) => void
}

export const useData = create<DataState>((set) => ({
  status: 'idle',
  error: null,
  users: [],
  teams: [],
  players: [],
  matches: [],
  videos: [],
  categories: [],

  fetchAll: async () => {
    set({ status: 'loading', error: null })
    try {
      const [users, teams, players, matches, videos, categories] = await Promise.all([
        api.users(), api.teams(), api.players(), api.matches(), api.videos(), api.taxonomy(),
      ])
      set({ users, teams, players, matches, videos, categories, status: 'ready' })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Failed to load data' })
    }
  },
  refreshVideos: async () => set({ videos: await api.videos() }),
  refreshMatches: async () => set({ matches: await api.matches() }),
  upsertVideo: (v) =>
    set((s) => ({ videos: s.videos.some((x) => x.id === v.id) ? s.videos.map((x) => (x.id === v.id ? v : x)) : [v, ...s.videos] })),
  removeVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),
  upsertMatch: (m) =>
    set((s) => ({ matches: s.matches.some((x) => x.id === m.id) ? s.matches.map((x) => (x.id === m.id ? m : x)) : [m, ...s.matches] })),
}))

// ── Lookups ───────────────────────────────────────────────────────────────────

export interface Lookups {
  teamById: Map<string, Team>
  playerById: Map<string, Player>
  matchById: Map<string, Match>
  tagById: Map<string, TagType>
  categoryById: Map<string, Category>
  categoryOfTag: Map<string, Category>
}

/** Build id→entity maps once per data change (call inside useMemo). */
export function buildLookups(s: Pick<DataState, 'teams' | 'players' | 'matches' | 'categories'>): Lookups {
  const tagById = new Map<string, TagType>()
  const categoryOfTag = new Map<string, Category>()
  for (const c of s.categories) for (const t of c.tagTypes) {
    tagById.set(t.id, t)
    categoryOfTag.set(t.id, c)
  }
  return {
    teamById: new Map(s.teams.map((t) => [t.id, t])),
    playerById: new Map(s.players.map((p) => [p.id, p])),
    matchById: new Map(s.matches.map((m) => [m.id, m])),
    categoryById: new Map(s.categories.map((c) => [c.id, c])),
    tagById,
    categoryOfTag,
  }
}
