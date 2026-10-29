import { Plus, Search, User } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Badge, Dot, EmptyState } from '@/components/ui/misc'
import { PageHeader } from '@/pages/Placeholder'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { Player } from '@/types'
import { POSITIONS, PlayerDialog } from './PlayerDialog'

export function PlayersPage() {
  const players = useData((s) => s.players)
  const teams = useData((s) => s.teams)
  const contextTeamId = useApp((s) => s.contextTeamId)
  const { teamById } = useLookups()
  const { canWrite } = useCan()
  const [q, setQ] = useState('')
  const [teamId, setTeamId] = useState('')
  const [pos, setPos] = useState('')
  const [editing, setEditing] = useState<Player | 'new' | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const tid = teamId || contextTeamId
    return players.filter((p) => (!tid || p.teamId === tid) && (!pos || p.positions.includes(pos)) && (!needle || `${p.name} ${p.nationality ?? ''} ${p.jersey ?? ''}`.toLowerCase().includes(needle)))
  }, [players, q, teamId, pos, contextTeamId])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Players" subtitle={`${rows.length} of ${players.length}`} actions={<Button variant="primary" size="sm" disabled={!canWrite} onClick={() => setEditing('new')}><Plus className="h-3.5 w-3.5" /> New player</Button>} />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative w-64">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
          <Input aria-label="Filter players" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, nationality, jersey…" className="h-7 pl-8 text-xs" />
        </div>
        <Select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-7 w-44 text-xs">
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value)} className="h-7 w-32 text-xs">
          <option value="">All positions</option>
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {players.length === 0 ? (
          <EmptyState icon={User} title="No players yet" description="Add players so tags can be linked to them and profiles built from their clips." action={canWrite ? <Button variant="primary" onClick={() => setEditing('new')}>New player</Button> : undefined} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No players match your filters" action={<Button onClick={() => (setQ(''), setTeamId(''), setPos(''))}>Clear filters</Button>} />
        ) : (
          <table className="panel w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="text-left">{['Player', '#', 'Pos', 'Team', 'Foot', 'Height', 'Age', 'Nationality'].map((h) => <th key={h} scope="col" className="label sticky top-0 border-b border-border bg-surface px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const t = p.teamId ? teamById.get(p.teamId) : undefined
                return (
                  <tr key={p.id} className="cursor-pointer hover:bg-raised/40" onClick={() => setEditing(p)}>
                    <td className="border-b border-border px-3 py-1.5">
                      <button type="button" className="flex items-center gap-2.5 text-left font-medium hover:text-accent" onClick={(e) => (e.stopPropagation(), setEditing(p))}>
                        <PlayerAvatar player={p} size={26} color={t?.color} /> {p.name}
                      </button>
                    </td>
                    <td className="timecode border-b border-border px-3 py-1.5 text-muted">{p.jersey ?? '—'}</td>
                    <td className="border-b border-border px-3 py-1.5"><span className="flex gap-1">{p.positions.map((x) => <Badge key={x} className="font-mono">{x}</Badge>)}</span></td>
                    <td className="border-b border-border px-3 py-1.5">{t ? <span className="flex items-center gap-1.5"><Dot color={t.color} />{t.name}</span> : <span className="text-muted">—</span>}</td>
                    <td className="border-b border-border px-3 py-1.5 capitalize text-muted">{p.foot ?? '—'}</td>
                    <td className="timecode border-b border-border px-3 py-1.5 text-muted">{p.heightCm ? `${p.heightCm} cm` : '—'}</td>
                    <td className="timecode border-b border-border px-3 py-1.5 text-muted">{p.age ?? '—'}</td>
                    <td className="border-b border-border px-3 py-1.5 text-muted">{p.nationality ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && <PlayerDialog player={editing === 'new' ? null : editing} defaultTeamId={teamId || contextTeamId} onClose={() => setEditing(null)} />}
    </div>
  )
}
