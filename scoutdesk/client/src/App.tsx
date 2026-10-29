import { AlertTriangle } from 'lucide-react'
import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/misc'
import { TooltipProvider } from '@/components/ui/tooltip'
import { dispatchKeydown } from '@/lib/hotkeys'
import { LibraryPage } from '@/features/library/LibraryPage'
import { MatchAnalysisPage } from '@/features/match/MatchAnalysisPage'
import { PlaylistsPage } from '@/features/playlists/PlaylistsPage'
import { PlayersPage } from '@/features/players/PlayersPage'
import { TeamsPage } from '@/features/teams/TeamsPage'
import { MatchesPage } from '@/features/matches/MatchesPage'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { SettingsPage } from '@/pages/SettingsPage'

// Chart-heavy and rarely-first screens load on demand to keep the initial bundle small.
const ComparePage = lazy(() => import('@/features/players/ComparePage').then((m) => ({ default: m.ComparePage })))
const PlayerProfilePage = lazy(() => import('@/features/players/PlayerProfilePage').then((m) => ({ default: m.PlayerProfilePage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const SharePage = lazy(() => import('@/features/share/SharePage').then((m) => ({ default: m.SharePage })))
const Fallback = () => <div className="flex h-full items-center justify-center" role="status"><Spinner /></div>

export default function App() {
  const { status, error, fetchAll, users } = useData()
  const { userId, setUserId, theme } = useApp()

  // Public share links render without loading the workspace (no sign-in).
  const isShare = useLocation().pathname.startsWith('/s/')

  useEffect(() => {
    if (!isShare) void fetchAll()
  }, [fetchAll, isShare])

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

  if (isShare) {
    return (
      <TooltipProvider>
        <Suspense fallback={<Fallback />}><Routes><Route path="/s/:token" element={<SharePage />} /></Routes></Suspense>
      </TooltipProvider>
    )
  }

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
      <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/library" replace />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="matches" element={<MatchesPage />} />
          <Route path="match/:matchId" element={<MatchAnalysisPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="players/compare" element={<ComparePage />} />
          <Route path="players/:id" element={<PlayerProfilePage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="playlists/:id" element={<PlaylistsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Route>
      </Routes>
      </Suspense>
      {toaster}
    </TooltipProvider>
  )
}
