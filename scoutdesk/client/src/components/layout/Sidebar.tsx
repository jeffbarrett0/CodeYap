import { CalendarDays, FileText, Film, ListVideo, PanelLeftClose, PanelLeftOpen, Settings, Shield, User } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Tip } from '@/components/ui/tooltip'
import { useApp } from '@/store/app'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/library', label: 'Library', icon: Film },
  { to: '/matches', label: 'Matches', icon: CalendarDays },
  { to: '/players', label: 'Players', icon: User },
  { to: '/teams', label: 'Teams', icon: Shield },
  { to: '/playlists', label: 'Playlists', icon: ListVideo },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const toggle = useApp((s) => s.toggleSidebar)

  return (
    <nav aria-label="Primary" className={cn('flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150', collapsed ? 'w-[52px]' : 'w-[200px]')}>
      <div className="flex h-12 items-center gap-2.5 border-b border-border px-3.5">
        <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0" aria-hidden>
          <rect x="6" y="9" width="20" height="14" rx="1.5" fill="none" stroke="hsl(var(--accent))" strokeWidth="2.4" />
          <path d="M16 9v14" stroke="hsl(var(--accent))" strokeWidth="2.4" />
          <circle cx="16" cy="16" r="3" fill="none" stroke="hsl(var(--accent))" strokeWidth="2.4" />
        </svg>
        {!collapsed && <span className="text-sm font-semibold tracking-tight">ScoutDesk</span>}
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 p-1.5">
        {NAV.map(({ to, label, icon: Icon }) => {
          const link = (
            <NavLink
              to={to}
              aria-label={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'relative flex h-8 items-center gap-2.5 rounded px-2.5 text-xs font-medium transition-colors',
                  isActive ? 'bg-raised text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent' : 'text-muted hover:bg-raised/60 hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && label}
            </NavLink>
          )
          return <li key={to}>{collapsed ? <Tip label={label} side="right">{link}</Tip> : link}</li>
        })}
      </ul>

      <div className="border-t border-border p-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-full items-center gap-2.5 rounded px-2.5 text-xs text-muted transition-colors hover:bg-raised/60 hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </nav>
  )
}
