import { CalendarDays, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Badge, Dot, EmptyState } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/pages/Placeholder'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { TagStatus } from '@/types'

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
                {['Date', 'Fixture', 'Competition', 'Videos', 'Clips', 'Tagging'].map((h) => (
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {creating && <NewMatchDialog onClose={() => setCreating(false)} />}
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
