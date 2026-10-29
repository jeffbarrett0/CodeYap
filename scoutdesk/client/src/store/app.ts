import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setApiUser } from '@/lib/api'

export type Theme = 'dark' | 'light'

interface AppState {
  theme: Theme
  userId: string | null
  sidebarCollapsed: boolean
  /** Global team context: filters Library / Matches. null = all teams. */
  contextTeamId: string | null
  /** Seconds captured before / after the tag moment when a clip is created. */
  preRoll: number
  postRoll: number
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setUserId: (id: string | null) => void
  toggleSidebar: () => void
  setContextTeam: (id: string | null) => void
  setRoll: (pre: number, post: number) => void
}

const applyTheme = (t: Theme) => {
  document.documentElement.dataset.theme = t
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      userId: null,
      sidebarCollapsed: false,
      contextTeamId: null,
      preRoll: 5,
      postRoll: 5,
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      setUserId: (userId) => {
        setApiUser(userId)
        set({ userId })
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setContextTeam: (contextTeamId) => set({ contextTeamId }),
      setRoll: (preRoll, postRoll) => set({ preRoll, postRoll }),
    }),
    {
      name: 'scoutdesk.app',
      onRehydrateStorage: () => (state) => {
        if (!state) return
        applyTheme(state.theme)
        setApiUser(state.userId)
      },
    },
  ),
)
