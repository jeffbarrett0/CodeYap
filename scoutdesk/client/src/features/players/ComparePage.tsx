import { ArrowLeft, Info } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { Dot, EmptyState, Skeleton } from '@/components/ui/misc'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { PlayerProfile } from '@/types'
import { PlayerPitch, ProfileRadar, type RadarSeries } from './Charts'
import { usePlayerProfile } from './PlayerProfilePage'
import { statItems } from './StatCards'

const COLORS = ['#a3e635', '#38bdf8']

/** Two players side by side: stats table (leader marked), radar overlay, heatmaps and key clips. */
export function ComparePage() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const players = useData((s) => s.players)
  const { teamById, matchById } = useLookups()
  const a = sp.get('a') ?? ''
  const b = sp.get('b') ?? ''
  const A = usePlayerProfile(a || null)
  const B = usePlayerProfile(b || null)
  const set = (k: 'a' | 'b', v: string) => navigate(`/players/compare?a=${k === 'a' ? v : a}&b=${k === 'b' ? v : b}`, { replace: true })

  const rows = useMemo(() => {
    if (!A.data || !B.data) return []
    const sa = statItems(A.data.stats)
    const sb = statItems(B.data.stats)
    return sa.map((x, i) => ({ x, y: sb[i]! }))
  }, [A.data, B.data])

  const radar = useMemo(() => {
    if (!A.data || !B.data) return null
    const axes = A.data.radar.axes
    const series: RadarSeries[] = [
      { name: A.data.player.name, color: COLORS[0]!, values: Object.fromEntries(axes.map((x) => [x.key, x.value])) },
      { name: B.data.player.name === A.data.player.name ? `${B.data.player.name} (2)` : B.data.player.name, color: COLORS[1]!, values: Object.fromEntries(B.data.radar.axes.map((x) => [x.key, x.value])) },
    ]
    return { axes, series }
  }, [A.data, B.data])

  const head = (d: PlayerProfile | null, color: string, which: 'a' | 'b', value: string) => (
    <div className="flex items-center gap-3">
      {d ? <PlayerAvatar player={d.player} size={44} color={color} /> : <Skeleton className="h-11 w-11 rounded-full" />}
      <div className="min-w-0 flex-1">
        <Select aria-label={`Player ${which.toUpperCase()}`} value={value} onChange={(e) => set(which, e.target.value)} className="h-8 text-sm font-semibold" style={{ borderColor: color }}>
          <option value="">Choose a player…</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {d && <p className="mt-0.5 truncate text-2xs text-muted">{d.player.teamId ? teamById.get(d.player.teamId)?.name : 'No team'} · {d.player.positions.join('/')}{d.player.age ? ` · ${d.player.age}` : ''}</p>}
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <Link to="/players" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Players</Link>
        <h1 className="text-lg font-semibold">Compare players</h1>
        <div className="grid gap-4 md:grid-cols-2">{head(A.data, COLORS[0]!, 'a', a)}{head(B.data, COLORS[1]!, 'b', b)}</div>

        {!a || !b ? (
          <EmptyState icon={Info} title="Pick two players" description="Choose a player on each side to compare their tagged stats, profile shape, heatmaps and clips." className="panel" />
        ) : A.error || B.error ? (
          <EmptyState icon={Info} title="Couldn’t load a player" description={A.error ?? B.error ?? ''} className="panel" action={<Button asChild><Link to="/players">Back to players</Link></Button>} />
        ) : !A.data || !B.data || !radar ? (
          <div className="space-y-3"><Skeleton className="h-72" /><Skeleton className="h-64" /></div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="panel overflow-hidden" aria-label="Stats comparison">
                <table className="w-full text-xs">
                  <caption className="sr-only">Tagged stats, {A.data.player.name} versus {B.data.player.name}</caption>
                  <thead><tr className="border-b border-border"><th className="label px-3 py-2 text-left">Stat</th><th className="px-3 py-2 text-right text-xs font-semibold"><span className="inline-flex items-center gap-1.5"><Dot color={COLORS[0]!} />{A.data.player.name.split(' ').slice(-1)[0]}</span></th><th className="px-3 py-2 text-right text-xs font-semibold"><span className="inline-flex items-center gap-1.5"><Dot color={COLORS[1]!} />{B.data.player.name.split(' ').slice(-1)[0]}</span></th></tr></thead>
                  <tbody>
                    {rows.map(({ x, y }) => {
                      const better = x.n === y.n ? 0 : (x.n > y.n) !== !!x.lowerIsBetter ? 1 : 2
                      const cell = (it: typeof x, mine: 1 | 2) => (
                        <td className={cn('timecode px-3 py-1.5 text-right', better === mine ? 'font-bold text-foreground' : 'text-muted')}>
                          {better === mine && <span aria-label="leads" className="mr-1 text-accent">▲</span>}{it.value}
                        </td>
                      )
                      return <tr key={x.key} className="border-b border-border/60 last:border-0"><th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{x.label}</th>{cell(x, 1)}{cell(y, 2)}</tr>
                    })}
                  </tbody>
                </table>
              </section>
              <section className="panel p-3" aria-label="Profile radar comparison">
                <h2 className="text-xs font-semibold">Profile shape</h2>
                <ProfileRadar axes={radar.axes} series={radar.series} label={`Radar comparison of ${A.data.player.name} and ${B.data.player.name}`} />
                <p className="text-2xs text-muted">Scaled against the best player in the database (= 100). ▲ marks the leader on each stat; for errors, fouls, cards and lost possession lower is better.</p>
              </section>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[A.data, B.data].map((d, i) => (
                <section key={i} className="panel p-3" aria-label={`${d.player.name} heatmap and key clips`}>
                  <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Dot color={COLORS[i]!} /> {d.player.name} — heatmap</h2>
                  <PlayerPitch clips={d.clips} mode="heat" label={`${d.player.name} heatmap`} />
                  <h3 className="label mb-1 mt-3">Key clips</h3>
                  <ul className="space-y-0.5">
                    {d.clips.filter((c) => ['goal', 'shot on target', 'key pass', 'dribble', 'interception', 'tackle', 'duel won'].includes(c.tag.toLowerCase())).slice(0, 6).map((c) => {
                      const m = matchById.get(c.matchId)
                      return <li key={c.id}><Link to={`/match/${c.matchId}?clip=${c.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-raised"><Dot color={c.color} /><span className="font-medium">{c.tag}</span><span className="timecode text-muted">{formatClock(c.timeSec)}</span><span className="ml-auto truncate text-2xs text-muted">{m ? `${teamById.get(m.homeTeamId)?.shortName} v ${teamById.get(m.awayTeamId)?.shortName}` : ''}</span></Link></li>
                    })}
                    {d.clips.length === 0 && <li className="text-xs text-muted">No tagged clips.</li>}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
