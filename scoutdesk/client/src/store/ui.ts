import { create } from 'zustand'

interface UiState {
  cheatSheetOpen: boolean
  setCheatSheetOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  cheatSheetOpen: false,
  setCheatSheetOpen: (cheatSheetOpen) => set({ cheatSheetOpen }),
}))
