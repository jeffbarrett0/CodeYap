import { AlertTriangle, FileText, ListVideo, Shield, User } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/misc'
import { TooltipProvider } from '@/components/ui/tooltip'
import { dispatchKeydown } from '@/lib/hotkeys'
import { LibraryPage } from '@/features/library/LibraryPage'
import { MatchAnalysisPage } from '@/features/match/MatchAnalysisPage'
import { MatchesPage } from '@/features/matches/MatchesPage'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { Placeholder } from '@/pages/Placeholder'
import { SettingsPage } from '@/pages/SettingsPage'

export default function App() {
  const { status, error, fetchAll, users } = useData()
  const { userId, setUserId, theme } = useApp()

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  // One global key listener; components register bindings via useHotkeys().
  useEffect(() => {
    window.addEventListener('keydown', dispatchKeydown, true)
    return () => window.removeEventListener('keydown', dispatchKeydown, true)
  }, [])

  // First run (or a stale id after re-seeding): sign in as the analyst demo user.
  useEffect(() => {
    if (status !== 'ready') return
    if (!userId || !users.some((u) => u.id === userId)) {
      setUserId((users.find((u) => u.role === 'analyst') ?? users[0])?.id ?? null)
    }
  }, [status, users, userId, setUserId])

  const toaster = <Toaster theme={theme} position="bottom-right" toastOptions={{ className: '!bg-surface !text-foreground !border-border !text-xs' }} />

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted" role="status">
        <Spinner /> Loading workspace…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <EmptyState
        className="h-full"
        icon={AlertTriangle}
        title="Can’t reach the ScoutDesk server"
        description={`${error}. Make sure the API is running (npm run dev) and refresh.`}
        action={<Button variant="primary" onClick={() => void fetchAll()}>Retry</Button>}
      />
    )
  }

  return (
    <TooltipProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/library" replace />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="matches" element={<MatchesPage />} />
          <Route path="match/:matchId" element={<MatchAnalysisPage />} />
          <Route path="players" element={<Placeholder icon={User} title="Players" phase={6} description="Player database, profiles, heatmaps and comparison." />} />
          <Route path="teams" element={<Placeholder icon={Shield} title="Teams" phase={6} description="Teams, formations and match history." />} />
          <Route path="playlists" element={<Placeholder icon={ListVideo} title="Playlists" phase={7} description="Build, reorder and play back clip playlists; export as MP4." />} />
          <Route path="reports" element={<Placeholder icon={FileText} title="Reports" phase={9} description="Printable PDF scouting reports for players and teams." />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Route>
      </Routes>
      {toaster}
    </TooltipProvider>
  )
}
