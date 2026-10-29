import { CalendarDays, Search, Shield, User } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dot, Kbd } from '@/components/ui/misc'
import { useHotkeys } from '@/lib/hotkeys'
import { cn, formatDate } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'

interface Result {
  key: string
  group: string
  icon: React.ReactNode
  label: string
  sub?: string
  to: string
}

/** Client-side search across matches, teams, players and tags (all loaded up front). */
export function GlobalSearch() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const { teamById, categoryOfTag } = useLookups()
  const { matches, teams, players, categories } = useData()

  useHotkeys([
    { combo: '/', description: 'Focus global search', group: 'Global', handler: () => inputRef.current?.focus() },
    { combo: 'mod+k', description: 'Focus global search', group: 'Global', hidden: true, allowInInput: true, handler: () => inputRef.current?.focus() },
  ])

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const has = (...s: (string | null | undefined)[]) => s.some((x) => x?.toLowerCase().includes(needle))
    const out: Result[] = []
    for (const m of matches) {
      const h = teamById.get(m.homeTeamId)
      const a = teamById.get(m.awayTeamId)
      if (has(h?.name, a?.name, m.competition, m.venue)) {
        out.push({ key: `m${m.id}`, group: 'Matches', icon: <CalendarDays className="h-3.5 w-3.5" />, label: `${h?.name} v ${a?.name}`, sub: `${formatDate(m.date)} · ${m.competition}`, to: `/match/${m.id}` })
      }
    }
    for (const t of teams) if (has(t.name, t.shortName)) out.push({ key: `t${t.id}`, group: 'Teams', icon: <Shield className="h-3.5 w-3.5" />, label: t.name, sub: t.isOwn ? 'Own team' : 'Opponent', to: '/teams' })
    for (const p of players) if (has(p.name, p.nationality, ...p.positions)) out.push({ key: `p${p.id}`, group: 'Players', icon: <User className="h-3.5 w-3.5" />, label: p.name, sub: `${p.jersey != null ? `#${p.jersey} · ` : ''}${p.positions.join('/')} · ${p.teamId ? teamById.get(p.teamId)?.name : 'Free agent'}`, to: '/players' })
    const firstMatch = matches[0]
    for (const c of categories) for (const t of c.tagTypes) {
      if (has(t.name, c.name) && firstMatch) {
        out.push({ key: `g${t.id}`, group: 'Tags', icon: <Dot color={categoryOfTag.get(t.id)?.color ?? '#888'} />, label: t.name, sub: `${c.name} · open in latest match`, to: `/match/${firstMatch.id}?tag=${t.id}` })
      }
    }
    return out.slice(0, 40)
  }, [q, matches, teams, players, categories, teamById, categoryOfTag])

  useEffect(() => setActive(0), [q])

  const go = (r: Result) => {
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
    navigate(r.to)
  }

  let lastGroup = ''
  return (
    <div className="relative w-full max-w-md">
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
          else if (e.key === 'Enter' && results[active]) go(results[active])
          else if (e.key === 'Escape') (setOpen(false), e.currentTarget.blur())
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="global-search-results"
        aria-label="Search players, teams, matches and tags"
        placeholder="Search players, teams, matches, tags…"
        className="h-8 w-full rounded border border-border bg-background pl-8 pr-9 text-sm placeholder:text-muted/70 hover:border-muted/50 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
      <Kbd className="pointer-events-none absolute right-2 top-[7px]">/</Kbd>

      {open && q.trim() && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 top-9 z-50 max-h-96 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-xl">
          {results.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted">No results for “{q}”</p>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? (lastGroup = r.group) : null
            return (
              <div key={r.key}>
                {header && <div className="label px-2 pb-0.5 pt-2">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs', i === active && 'bg-raised')}
                >
                  <span className="text-muted">{r.icon}</span>
                  <span className="truncate font-medium">{r.label}</span>
                  {r.sub && <span className="ml-auto truncate pl-2 text-2xs text-muted">{r.sub}</span>}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
