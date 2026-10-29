import { Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Pitch, px, py } from '@/components/pitch/Pitch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Dot, EmptyState } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { PageHeader } from '@/pages/Placeholder'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { Match, Team } from '@/types'
import { PlayerDialog } from '../players/PlayerDialog'
import { FORMATIONS, assignPlayers, formationSlots } from './formations'

export function TeamsPage() {
  const teams = useData((s) => s.teams)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const { canWrite } = useCan()
  const selected = teams.find((t) => t.id === selectedId) ?? teams[0]

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Teams" subtitle={`${teams.length} teams`} actions={<Button variant="primary" size="sm" disabled={!canWrite} onClick={() => setEditing('new')}><Plus className="h-3.5 w-3.5" /> New team</Button>} />
      {teams.length === 0 ? (
        <EmptyState icon={Shield} title="No teams yet" description="Add your team and the opponents you scout." className="flex-1" action={canWrite ? <Button variant="primary" onClick={() => setEditing('new')}>New team</Button> : undefined} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul className="w-64 shrink-0 overflow-y-auto border-r border-border p-2" aria-label="Teams">
            {teams.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setSelectedId(t.id)} aria-current={selected?.id === t.id} className={cn('flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-xs transition-colors hover:bg-raised/60', selected?.id === t.id && 'bg-raised')}>
                  <span className="flex h-7 w-7 items-center justify-center rounded text-2xs font-bold text-white" style={{ background: t.color }}>{t.shortName}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.name}</span><span className="block text-2xs text-muted">{t.isOwn ? 'Own team' : 'Opponent'} · {t.formation}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <TeamDetail key={selected.id} team={selected} onEdit={() => setEditing(selected)} />}
        </div>
      )}
      {editing && <TeamDialog team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(t) => setSelectedId(t.id)} />}
    </div>
  )
}

function TeamDetail({ team, onEdit }: { team: Team; onEdit: () => void }) {
  const players = useData((s) => s.players)
  const matches = useData((s) => s.matches)
  const { teamById } = useLookups()
  const { canWrite } = useCan()
  const [formation, setFormation] = useState(team.formation)
  const [addPlayer, setAddPlayer] = useState(false)
  const roster = useMemo(() => players.filter((p) => p.teamId === team.id).sort((a, b) => (a.jersey ?? 99) - (b.jersey ?? 99)), [players, team.id])
  const slots = useMemo(() => formationSlots(formation), [formation])
  const placed = useMemo(() => assignPlayers(slots, roster), [slots, roster])
  const history = useMemo(() => matches.filter((m) => m.homeTeamId === team.id || m.awayTeamId === team.id), [matches, team.id])

  const saveFormation = async (f: string) => {
    setFormation(f)
    if (!canWrite) return
    try {
      useData.getState().upsertTeam(await api.patchTeam(team.id, { formation: f }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save formation')
    }
  }

  const result = (m: Match) => {
    if (m.homeScore == null || m.awayScore == null) return null
    const [f, a] = m.homeTeamId === team.id ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore]
    return f > a ? 'W' : f < a ? 'L' : 'D'
  }
  const record = history.reduce((r, m) => { const x = result(m); if (x) r[x]++; return r }, { W: 0, D: 0, L: 0 })

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto grid max-w-5xl gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <header className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: team.color }}>{team.shortName}</span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold">{team.name}</h2>
              <p className="text-xs text-muted">{team.isOwn ? 'Own team' : 'Opponent'}{team.country ? ` · ${team.country}` : ''} · record <span className="timecode text-foreground">{record.W}W {record.D}D {record.L}L</span></p>
            </div>
            <Button size="sm" disabled={!canWrite} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
          </header>
          {team.notes && <p className="panel p-3 text-xs text-muted">{team.notes}</p>}

          <section className="panel">
            <div className="flex items-center justify-between border-b border-border px-3 py-2"><h3 className="text-xs font-semibold">Roster <span className="text-muted">({roster.length})</span></h3><Button size="xs" disabled={!canWrite} onClick={() => setAddPlayer(true)}><Plus className="h-3 w-3" /> Add player</Button></div>
            {roster.length === 0 ? <p className="p-4 text-center text-xs text-muted">No players on this team yet.</p> : (
              <ul className="divide-y divide-border">
                {roster.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <span className="timecode w-6 text-right text-muted">{p.jersey ?? '–'}</span>
                    <PlayerAvatar player={p} size={24} color={team.color} />
                    <span className="flex-1 font-medium">{p.name}</span>
                    <span className="flex gap-1">{p.positions.map((x) => <Badge key={x} className="font-mono">{x}</Badge>)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3 className="border-b border-border px-3 py-2 text-xs font-semibold">Match history</h3>
            {history.length === 0 ? <p className="p-4 text-center text-xs text-muted">No matches yet.</p> : (
              <table className="w-full text-xs">
                <tbody>
                  {history.map((m) => {
                    const home = m.homeTeamId === team.id
                    const opp = teamById.get(home ? m.awayTeamId : m.homeTeamId)
                    const r = result(m)
                    return (
                      <tr key={m.id} className="border-b border-border last:border-0 hover:bg-raised/40">
                        <td className="px-3 py-1.5 text-muted">{formatDate(m.date)}</td>
                        <td className="px-3 py-1.5"><Link to={`/match/${m.id}`} className="flex items-center gap-1.5 font-medium hover:text-accent"><span className="text-muted">{home ? 'vs' : '@'}</span><Dot color={opp?.color ?? '#888'} />{opp?.name}</Link></td>
                        <td className="timecode px-3 py-1.5">{m.homeScore ?? '–'} – {m.awayScore ?? '–'}</td>
                        <td className="px-3 py-1.5">{r && <Badge className={r === 'W' ? 'border-success/40 text-success' : r === 'L' ? 'border-danger/40 text-danger' : ''}>{r}</Badge>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="panel h-fit p-3" aria-label="Formation field">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">Formation</h3>
            <Select aria-label="Formation" value={formation} onChange={(e) => void saveFormation(e.target.value)} disabled={!canWrite} className="h-7 w-28 font-mono text-xs">
              {(FORMATIONS.includes(formation as never) ? FORMATIONS : [formation, ...FORMATIONS]).map((f) => <option key={f}>{f}</option>)}
            </Select>
          </div>
          <div className="aspect-[105/68]">
            <Pitch label={`${team.name} ${formation} formation`}>
              {slots.map((s, i) => {
                const p = placed[i]
                return (
                  <g key={i}>
                    <circle cx={px(s.x)} cy={py(s.y)} r={3} fill={team.color} stroke="#fff" strokeWidth={0.4} opacity={p ? 1 : 0.45} />
                    <text x={px(s.x)} y={py(s.y) + 1.1} textAnchor="middle" fontSize={3} fontWeight={700} fill="#fff">{p?.jersey ?? ''}</text>
                    <text x={px(s.x)} y={py(s.y) + 6.2} textAnchor="middle" fontSize={2.3} fill="#fff" stroke="rgba(0,0,0,.5)" strokeWidth={0.5} paintOrder="stroke">{p ? p.name.split(' ').slice(-1)[0] : s.role}</text>
                  </g>
                )
              })}
            </Pitch>
          </div>
          <p className="mt-2 text-2xs text-muted">Indicative: players are placed by primary position, then jersey number.</p>
        </section>
      </div>
      {addPlayer && <PlayerDialog player={null} defaultTeamId={team.id} onClose={() => setAddPlayer(false)} />}
    </div>
  )
}

function TeamDialog({ team, onClose, onSaved }: { team: Team | null; onClose: () => void; onSaved: (t: Team) => void }) {
  const upsertTeam = useData((s) => s.upsertTeam)
  const removeTeam = useData((s) => s.removeTeam)
  const { isAdmin } = useCan()
  const [f, setF] = useState({ name: team?.name ?? '', shortName: team?.shortName ?? '', color: team?.color ?? '#3b82f6', isOwn: team?.isOwn ?? false, country: team?.country ?? '', formation: team?.formation ?? '4-3-3', notes: team?.notes ?? '' })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    try {
      const body = { ...f, name: f.name.trim(), shortName: f.shortName.trim().toUpperCase().slice(0, 5), country: f.country.trim() || null }
      const saved = team ? await api.patchTeam(team.id, body) : await api.createTeam(body)
      upsertTeam(saved)
      onSaved(saved)
      toast.success(team ? 'Team saved' : 'Team created')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save team')
    }
  }
  const remove = async () => {
    if (!team || !confirm(`Delete ${team.name}?`)) return
    try {
      await api.deleteTeam(team.id)
      removeTeam(team.id)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={team ? 'Edit team' : 'New team'} className="max-w-md">
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Short name"><Input value={f.shortName} maxLength={5} onChange={(e) => set('shortName', e.target.value)} className="font-mono uppercase" /></Field>
          <Field label="Colour"><Input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} className="h-8 p-0.5" /></Field>
          <Field label="Country"><Input value={f.country} onChange={(e) => set('country', e.target.value)} /></Field>
          <Field label="Formation"><Select value={f.formation} onChange={(e) => set('formation', e.target.value)} className="font-mono">{FORMATIONS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={f.isOwn} onChange={(e) => set('isOwn', e.target.checked)} /> This is our own team (not an opponent)</label>
          <Field label="Notes" className="col-span-2"><Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Style of play, set-piece routines…" /></Field>
        </DialogBody>
        <DialogFooter className="justify-between">
          {team && isAdmin ? <Button variant="danger" size="sm" onClick={() => void remove()}><Trash2 className="h-3.5 w-3.5" /> Delete</Button> : <span />}
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim() || !f.shortName.trim()} onClick={() => void save()}>{team ? 'Save' : 'Create team'}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
