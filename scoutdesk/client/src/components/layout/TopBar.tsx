import { Check, HelpCircle, Moon, Sun } from 'lucide-react'
import { useMatch } from 'react-router-dom'
import { Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Tip } from '@/components/ui/tooltip'
import { initials } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import { useUi } from '@/store/ui'
import { GlobalSearch } from './GlobalSearch'

export function TopBar() {
  const { theme, toggleTheme, userId, setUserId, contextTeamId, setContextTeam } = useApp()
  const users = useData((s) => s.users)
  const teams = useData((s) => s.teams)
  const setCheatSheetOpen = useUi((s) => s.setCheatSheetOpen)
  const { teamById, matchById } = useLookups()
  const user = users.find((u) => u.id === userId)
  const matchRoute = useMatch('/match/:matchId')
  const match = matchRoute ? matchById.get(matchRoute.params.matchId!) : undefined
  const home = match && teamById.get(match.homeTeamId)
  const away = match && teamById.get(match.awayTeamId)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {match && home && away ? (
          <div className="flex min-w-0 items-center gap-2 text-xs" aria-label="Current match">
            <span className="label">Match</span>
            <span className="truncate font-semibold">{home.name}</span>
            <span className="timecode rounded bg-raised px-1.5 py-0.5 font-semibold">{match.homeScore ?? '–'} – {match.awayScore ?? '–'}</span>
            <span className="truncate font-semibold">{away.name}</span>
            <span className="hidden truncate text-muted xl:inline">· {match.competition}</span>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-xs">
            <span className="label">Team</span>
            <Select value={contextTeamId ?? ''} onChange={(e) => setContextTeam(e.target.value || null)} className="h-7 w-44 text-xs" aria-label="Team context">
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </label>
        )}
      </div>

      <GlobalSearch />

      <div className="flex flex-1 items-center justify-end gap-1">
        <Tip label="Keyboard shortcuts" hotkey="?">
          <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={() => setCheatSheetOpen(true)}>
            <HelpCircle className="h-4 w-4" />
          </Button>
        </Tip>
        <Tip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </Tip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Account: ${user?.name ?? 'not signed in'}`} className="ml-1 flex h-7 items-center gap-2 rounded pl-1 pr-2 hover:bg-raised">
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-2xs font-bold text-black" style={{ background: user?.color ?? '#64748b' }}>
                {user ? initials(user.name) : '?'}
              </span>
              <span className="hidden text-xs font-medium lg:block">{user?.name ?? 'Sign in'}</span>
              {user && <span className="hidden rounded bg-raised px-1 py-px text-2xs capitalize text-muted lg:block">{user.role}</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Switch demo user</DropdownMenuLabel>
            {users.map((u) => (
              <DropdownMenuItem key={u.id} onSelect={() => setUserId(u.id)}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold text-black" style={{ background: u.color }}>{initials(u.name)}</span>
                <span className="flex-1">{u.name}</span>
                <span className="text-2xs capitalize text-muted">{u.role}</span>
                {u.id === userId && <Check className="h-3 w-3 text-accent" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-2xs text-muted">Roles: admin manages everything, analyst can tag, viewer is read-only.</p>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}



