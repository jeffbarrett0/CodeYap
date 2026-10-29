import { create } from 'zustand'
import { api } from '@/lib/api'
import type { PlaylistSummary } from '@/types'

interface State {
  list: PlaylistSummary[]
  loaded: boolean
  refresh: () => Promise<void>
}

export const usePlaylists = create<State>((set) => ({
  list: [],
  loaded: false,
  refresh: async () => set({ list: await api.playlists(), loaded: true }),
}))
