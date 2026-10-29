import { ArrowLeft, FileText, GitCompare, Info, Pencil } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Badge, Dot, EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { Select } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatClock } from '@/lib/timecode'
import { cn, formatDate } from '@/lib/utils'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { PlayerProfile } from '@/types'
import { AddToPlaylistMenu } from '../playlists/AddToPlaylistMenu'
import { ActionsChart, PlayerPitch, ProfileRadar, radarSeries } from './Charts'
import { PlayerDialog } from './PlayerDialog'
import { StatCards } from './StatCards'

export function usePlayerProfile(id: string | null) {
  const [data, setData] = useState<PlayerProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!id) { setData(null); return }
    let live = true
    setError(null)
    api.profile(id).then((d) => live && setData(d)).catch((e) => live && setError(e instanceof Error ? e.message : 'Failed to load'))
    return () => { live = false }
  }, [id, tick])
  useEffect(() => setData(null), [id])
  return { data, error, reload: () => setTick((t) => t + 1) }
}

export function PlayerProfilePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, reload } = usePlayerProfile(id)
  const players = useData((s) => s.players)
  const { teamById, matchById } = useLookups()
  const { canWrite } = useCan()
  const [mode, setMode] = useState<'heat' | 'events'>('heat')
  const [cat, setCat] = useState('')
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const cats = useMemo(() => [...new Set((data?.clips ?? []).map((c) => c.category))], [data])
  const mapClips = useMemo(() => (data?.clips ?? []).filter((c) => !cat || c.category === cat), [data, cat])

  if (error) return <EmptyState className="h-full" icon={Info} title="Player not found" description={error} action={<Button asChild><Link to="/players">Back to players</Link></Button>} />
  if (!data) return <div className="space-y-3 p-4"><Skeleton className="h-20" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>

  const { player, stats, radar } = data
  const team = player.teamId ? teamById.get(player.teamId) : undefined
  const peerName = radar.peers === 'position' ? `${radar.group} average` : radar.peers === 'everyone' ? 'All-player average' : undefined
  const clipIds = picked.size ? [...picked] : data.clips.map((c) => c.id)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <Link to="/players" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Players</Link>

        <header className="flex flex-wrap items-center gap-4">
          <PlayerAvatar player={player} size={72} color={team?.color} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{player.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {team && <span className="inline-flex items-center gap-1"><Dot color={team.color} /> {team.name}</span>}
              {player.jersey != null && <span className="timecode">#{player.jersey}</span>}
              {player.positions.map((p) => <Badge key={p} className="font-mono">{p}</Badge>)}
              {player.age != null && <span>Age {player.age}</span>}
              {player.nationality && <span>{player.nationality}</span>}
              {player.foot && <span className="capitalize">{player.foot}-footed</span>}
              {player.heightCm && <span>{player.heightCm} cm</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm"><GitCompare className="h-3.5 w-3.5" /> Compare with…</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                {players.filter((p) => p.id !== id).map((p) => <DropdownMenuItem key={p.id} onSelect={() => navigate(`/players/compare?a=${id}&b=${p.id}`)}>{p.jersey != null && <span className="timecode w-5 text-muted">{p.jersey}</span>}{p.name}</DropdownMenuItem>)}
                {players.length < 2 && <p className="px-2 py-1 text-xs text-muted">Add another player first.</p>}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" asChild><Link to={`/reports?type=player&id=${id}`}><FileText className="h-3.5 w-3.5" /> PDF report</Link></Button>
            <Button size="sm" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> {canWrite ? 'Edit' : 'Details'}</Button>
          </div>
        </header>

        {stats.clips === 0 ? (
          <EmptyState icon={Info} title="No tagged actions yet" description="Tag this player in a match (pick them in the Tagging panel) and their stats, heatmap and profile will build up here." className="panel" action={<Button asChild variant="primary"><Link to="/matches">Open a match</Link></Button>} />
        ) : (
          <>
            <StatCards stats={stats} />
            <details className="text-2xs text-muted">
              <summary className="cursor-pointer hover:text-foreground">How are these computed?</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>All numbers come from analyst tags in {stats.matches} match{stats.matches === 1 ? '' : 'es'} — they describe tagged actions, not full-match totals.</li>
                {Object.entries(data.definitions).map(([k, v]) => <li key={k}><strong className="capitalize">{k}</strong>: {v}</li>)}
              </ul>
            </details>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="panel p-3" aria-label="Heatmap">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold">Where they act</h2>
                  <div className="flex items-center gap-2">
                    <Select aria-label="Filter map by category" value={cat} onChange={(e) => setCat(e.target.value)} className="h-7 w-36 text-xs"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
                    <Segmented ariaLabel="Map mode" value={mode} onChange={setMode} options={[{ value: 'heat', label: 'Heat' }, { value: 'events', label: 'Events' }]} />
                  </div>
                </div>
                <PlayerPitch clips={mapClips} mode={mode} label={`${player.name} ${mode === 'heat' ? 'heatmap' : 'event map'}`} />
                <p className="mt-1.5 text-2xs text-muted">Positions are shown in the team’s attacking direction (left → right).</p>
              </section>

              <section className="panel p-3" aria-label="Profile radar">
                <h2 className="text-xs font-semibold">Profile {peerName ? `vs ${radar.peers === 'position' ? `${radar.group} peers` : 'all other players'}` : ''}</h2>
                <ProfileRadar axes={radar.axes} series={radarSeries(radar.axes, player.name, 'hsl(var(--accent))', peerName)} label={`Radar chart of ${player.name}: ${radar.axes.map((a) => `${a.label} ${a.value}`).join(', ')}`} />
                <p className="text-2xs text-muted">Per-match counts scaled so the best player in your database = 100 (rates are already %). Discipline is inverted: higher is cleaner.{radar.peers === 'none' && ' No other tagged players yet, so there is no peer average.'}{radar.peers === 'everyone' && ' No same-position peers yet, so the average is across all other players.'}</p>
              </section>
            </div>

            <section className="panel p-3" aria-label="Actions by type">
              <h2 className="mb-1 text-xs font-semibold">Tagged actions by type</h2>
              <ActionsChart clips={data.clips} />
            </section>

            {player.notes && <section className="panel p-3"><h2 className="mb-1 text-xs font-semibold">Scouting notes</h2><p className="whitespace-pre-wrap text-xs text-muted">{player.notes}</p></section>}

            <section className="panel" aria-label="Clips">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="text-xs font-semibold">Clips <span className="text-muted">({data.clips.length})</span></h2>
                <AddToPlaylistMenu clipIds={clipIds} disabled={!canWrite} label={picked.size ? `Add ${picked.size} to playlist` : 'Add all to playlist'} />
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-left"><th className="w-8 px-3 py-1.5" /><th className="label px-2 py-1.5">Time</th><th className="label px-2 py-1.5">Tag</th><th className="label px-2 py-1.5">Outcome</th><th className="label px-2 py-1.5">Match</th><th className="label px-2 py-1.5">Notes</th></tr></thead>
                <tbody>
                  {data.clips.map((c) => {
                    const m = matchById.get(c.matchId)
                    return (
                      <tr key={c.id} className="border-t border-border hover:bg-raised/40">
                        <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Select ${c.tag} at ${formatClock(c.timeSec)}`} checked={picked.has(c.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n })} /></td>
                        <td className="px-2 py-1.5"><Link to={`/match/${c.matchId}?clip=${c.id}`} className="timecode text-accent hover:underline">{formatClock(c.timeSec)}</Link></td>
                        <td className="px-2 py-1.5"><span className="flex items-center gap-1.5 font-medium"><Dot color={c.color} />{c.tag}</span></td>
                        <td className={cn('px-2 py-1.5 capitalize', c.outcome === 'success' ? 'text-success' : c.outcome === 'fail' ? 'text-danger' : 'text-muted')}>{c.outcome}</td>
                        <td className="px-2 py-1.5 text-muted">{m ? `${teamById.get(m.homeTeamId)?.shortName} v ${teamById.get(m.awayTeamId)?.shortName} · ${formatDate(m.date)}` : ''}</td>
                        <td className="max-w-xs truncate px-2 py-1.5 text-muted" title={c.notes}>{c.notes}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
      {editing && <PlayerDialog player={player} onClose={() => { setEditing(false); reload() }} />}
    </div>
  )
}
