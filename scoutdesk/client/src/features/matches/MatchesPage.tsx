import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Dot, EmptyState } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/pages/Placeholder'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { Match, TagStatus } from '@/types'

const STATUS: Record<TagStatus, { label: string; cls: string }> = {
  untagged: { label: 'Untagged', cls: '' },
  in_progress: { label: 'In progress', cls: 'border-warning/40 text-warning' },
  complete: { label: 'Complete', cls: 'border-success/40 text-success' },
}

export function MatchesPage() {
  const matches = useData((s) => s.matches)
  const teams = useData((s) => s.teams)
  const contextTeamId = useApp((s) => s.contextTeamId)
  const { teamById } = useLookups()
  const { canWrite } = useCan()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Match | null>(null)
  const refreshMatches = useData((s) => s.refreshMatches)
  useEffect(() => void refreshMatches().catch(() => {}), [refreshMatches])

  const rows = useMemo(
    () => matches.filter((m) => !contextTeamId || m.homeTeamId === contextTeamId || m.awayTeamId === contextTeamId),
    [matches, contextTeamId],
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Matches"
        subtitle={`${rows.length} match${rows.length === 1 ? '' : 'es'}`}
        actions={<Button variant="primary" size="sm" disabled={!canWrite || teams.length < 2} onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> New match</Button>}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {rows.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No matches" description="Create a match, then attach a video to it from the Library." action={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}>New match</Button> : undefined} />
        ) : (
          <table className="panel w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="text-left">
                {['Date', 'Fixture', 'Competition', 'Videos', 'Clips', 'Tagging', ''].map((h) => (
                  <th key={h} scope="col" className="label sticky top-0 border-b border-border bg-surface px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const h = teamById.get(m.homeTeamId)
                const a = teamById.get(m.awayTeamId)
                const st = STATUS[m.tagStatus]
                return (
                  <tr key={m.id} className="group hover:bg-raised/40">
                    <td className="border-b border-border px-3 py-2 text-muted">{formatDate(m.date)}</td>
                    <td className="border-b border-border px-3 py-2">
                      <Link to={`/match/${m.id}`} className="flex items-center gap-2 font-medium hover:text-accent">
                        <Dot color={h?.color ?? '#888'} /> {h?.name}
                        <span className="timecode rounded bg-raised px-1.5 py-0.5">{m.homeScore ?? '–'} – {m.awayScore ?? '–'}</span>
                        <Dot color={a?.color ?? '#888'} /> {a?.name}
                      </Link>
                    </td>
                    <td className="border-b border-border px-3 py-2 text-muted">{m.competition || '—'}</td>
                    <td className="timecode border-b border-border px-3 py-2">{m.videoCount}</td>
                    <td className="timecode border-b border-border px-3 py-2">{m.clipCount}</td>
                    <td className="border-b border-border px-3 py-2"><Badge className={st.cls}>{st.label}</Badge></td>
                    <td className="border-b border-border px-3 py-1 text-right"><Button variant="ghost" size="icon-sm" aria-label={`Edit match ${h?.name} v ${a?.name}`} disabled={!canWrite} onClick={() => setEditing(m)}><Pencil className="h-3.5 w-3.5" /></Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {creating && <NewMatchDialog onClose={() => setCreating(false)} />}
      {editing && <EditMatchDialog match={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function NewMatchDialog({ onClose }: { onClose: () => void }) {
  const teams = useData((s) => s.teams)
  const upsertMatch = useData((s) => s.upsertMatch)
  const navigate = useNavigate()
  const [home, setHome] = useState(teams.find((t) => t.isOwn)?.id ?? teams[0]?.id ?? '')
  const [away, setAway] = useState(teams.find((t) => t.id !== home)?.id ?? '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [competition, setCompetition] = useState('')
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const valid = home && away && home !== away && date

  const save = async () => {
    try {
      const m = await api.createMatch({
        homeTeamId: home, awayTeamId: away, date: new Date(date).toISOString(), competition,
        homeScore: homeScore === '' ? null : Number(homeScore), awayScore: awayScore === '' ? null : Number(awayScore),
      })
      upsertMatch(m)
      toast.success('Match created')
      onClose()
      navigate(`/match/${m.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create match')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New match" className="max-w-md">
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field label="Home team"><Select value={home} onChange={(e) => setHome(e.target.value)}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Away team"><Select value={away} onChange={(e) => setAway(e.target.value)}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Competition"><Input value={competition} onChange={(e) => setCompetition(e.target.value)} placeholder="League · Matchday 1" /></Field>
          <Field label="Home score"><Input type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} /></Field>
          <Field label="Away score"><Input type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} /></Field>
          {home === away && <p className="col-span-2 text-xs text-danger">Home and away must be different teams.</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => void save()}>Create match</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditMatchDialog({ match, onClose }: { match: Match; onClose: () => void }) {
  const { players, upsertMatch, removeMatch } = useData()
  const { isAdmin } = useCan()
  const { teamById } = useLookups()
  const home = teamById.get(match.homeTeamId)
  const away = teamById.get(match.awayTeamId)
  const [f, setF] = useState({
    date: match.date.slice(0, 10), competition: match.competition, venue: match.venue ?? '',
    homeScore: match.homeScore?.toString() ?? '', awayScore: match.awayScore?.toString() ?? '', tagStatus: match.tagStatus,
    notes: match.notes,
  })
  const [lineups, setLineups] = useState(match.lineups)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const toggle = (side: 'home' | 'away', id: string) =>
    setLineups((l) => ({ ...l, [side]: l[side].includes(id) ? l[side].filter((x) => x !== id) : [...l[side], id] }))

  const save = async () => {
    try {
      const m = await api.patchMatch(match.id, {
        date: new Date(f.date).toISOString(), competition: f.competition, venue: f.venue || null,
        homeScore: f.homeScore === '' ? null : Number(f.homeScore), awayScore: f.awayScore === '' ? null : Number(f.awayScore),
        tagStatus: f.tagStatus, notes: f.notes, lineups,
      })
      upsertMatch(m)
      toast.success('Match saved')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save match')
    }
  }
  const remove = async () => {
    if (!confirm('Delete this match, its clips and video links? Video files stay in the Library.')) return
    try {
      await api.deleteMatch(match.id)
      removeMatch(match.id)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const roster = (teamId: string, side: 'home' | 'away') => (
    <fieldset className="space-y-1">
      <legend className="label mb-1">{teamById.get(teamId)?.name} lineup <span className="timecode normal-case text-muted">({lineups[side].length})</span></legend>
      {players.filter((p) => p.teamId === teamId).map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={lineups[side].includes(p.id)} onChange={() => toggle(side, p.id)} /> <span className="timecode w-5 text-muted">{p.jersey ?? ''}</span>{p.name}</label>
      ))}
      {players.filter((p) => p.teamId === teamId).length === 0 && <p className="text-2xs text-muted">No players on this team yet.</p>}
    </fieldset>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${home?.name} v ${away?.name}`} description="Match record" className="max-w-xl">
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Competition"><Input value={f.competition} onChange={(e) => set('competition', e.target.value)} /></Field>
          <Field label={`${home?.shortName} score`}><Input type="number" min={0} value={f.homeScore} onChange={(e) => set('homeScore', e.target.value)} /></Field>
          <Field label={`${away?.shortName} score`}><Input type="number" min={0} value={f.awayScore} onChange={(e) => set('awayScore', e.target.value)} /></Field>
          <Field label="Venue"><Input value={f.venue} onChange={(e) => set('venue', e.target.value)} /></Field>
          <Field label="Tagging status">
            <Select value={f.tagStatus} onChange={(e) => set('tagStatus', e.target.value as TagStatus)}>
              <option value="untagged">Untagged</option><option value="in_progress">In progress</option><option value="complete">Complete</option>
            </Select>
          </Field>
          {roster(match.homeTeamId, 'home')}
          {roster(match.awayTeamId, 'away')}
          <Field label="Notes" className="col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </DialogBody>
        <DialogFooter className="justify-between">
          {isAdmin ? <Button variant="danger" size="sm" onClick={() => void remove()}><Trash2 className="h-3.5 w-3.5" /> Delete</Button> : <span />}
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
