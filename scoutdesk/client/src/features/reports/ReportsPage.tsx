import { Download, FileText, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/input'
import { EmptyState, Segmented, Spinner } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/pages/Placeholder'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { Clip, Snapshot } from '@/types'

/** Build a printable PDF scouting report for a player or team, with live preview. */
export function ReportsPage() {
  const [sp, setSp] = useSearchParams()
  const players = useData((s) => s.players)
  const teams = useData((s) => s.teams)
  const { canWrite } = useCan()
  const { tagById, matchById, teamById } = useLookups()
  const type = (sp.get('type') as 'player' | 'team') || 'player'
  const subject = sp.get('id') || (type === 'player' ? players[0]?.id : teams.find((t) => !t.isOwn)?.id ?? teams[0]?.id) || ''
  const [notes, setNotes] = useState('')
  const [auto, setAuto] = useState(true)
  const [clips, setClips] = useState<Clip[]>([])
  const [pickedClips, setPickedClips] = useState<Set<string>>(new Set())
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [pickedSnaps, setPickedSnaps] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null)

  const setType = (t: 'player' | 'team') => { setSp({ type: t }, { replace: true }); setPdf(null) }
  const setSubject = (id: string) => { setSp({ type, id }, { replace: true }); setPdf(null); setPickedClips(new Set()) }

  // Candidate clips for manual selection, snapshots for inclusion
  useEffect(() => {
    if (!subject) return
    let live = true
    fetch('/api/clips').then((r) => r.json()).then((all: Clip[]) => live && setClips(all.filter((c) => (type === 'player' ? c.playerId === subject : c.teamId === subject)))).catch(() => {})
    api.snapshots({}).then((s) => live && setSnaps(s)).catch(() => {})
    return () => { live = false }
  }, [subject, type])
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url) }, [pdf])

  const generate = async () => {
    setBusy(true)
    try {
      const blob = await api.report(type, subject, { notes: notes || undefined, clipIds: !auto && pickedClips.size ? [...pickedClips] : undefined, snapshotIds: pickedSnaps.length ? pickedSnaps : undefined })
      if (pdf) URL.revokeObjectURL(pdf.url)
      const name = (type === 'player' ? players.find((p) => p.id === subject)?.name : teams.find((t) => t.id === subject)?.name) ?? 'report'
      setPdf({ url: URL.createObjectURL(blob), name: `${name.replace(/[^\w]+/g, '_')}_${type}_report.pdf` })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not generate report') } finally { setBusy(false) }
  }

  const sortedClips = useMemo(() => [...clips].sort((a, b) => a.matchId.localeCompare(b.matchId) || a.timeSec - b.timeSec), [clips])
  const emptySubject = type === 'player' ? players.length === 0 : teams.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Reports" subtitle="Printable PDF scouting reports" />
      {emptySubject ? <EmptyState className="flex-1" icon={FileText} title={`Add a ${type} first`} description="Reports are built from a player’s or team’s tagged clips." /> : (
        <div className="flex min-h-0 flex-1">
          <div className="w-[400px] shrink-0 space-y-4 overflow-y-auto border-r border-border p-4">
            <Segmented ariaLabel="Report type" value={type} onChange={setType} options={[{ value: 'player', label: 'Player report' }, { value: 'team', label: 'Team report' }]} className="w-full [&>button]:flex-1" />
            <Field label={type === 'player' ? 'Player' : 'Team'}>
              <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {type === 'player' ? players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isOwn ? ' (own)' : ''}</option>)}
              </Select>
            </Field>

            <fieldset className="space-y-1.5">
              <legend className="label mb-1">Key clips</legend>
              <label className="flex items-center gap-2 text-xs"><input type="radio" name="clipmode" checked={auto} onChange={() => setAuto(true)} /> Automatic — goals, key passes, chances, defensive actions</label>
              <label className="flex items-center gap-2 text-xs"><input type="radio" name="clipmode" checked={!auto} onChange={() => setAuto(false)} /> Choose clips ({pickedClips.size} selected)</label>
              {!auto && (
                <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded border border-border text-xs" aria-label="Clips to include">
                  {sortedClips.length === 0 && <li className="p-3 text-center text-muted">No tagged clips.</li>}
                  {sortedClips.map((c) => {
                    const m = matchById.get(c.matchId)
                    return (
                      <li key={c.id}><label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-raised/50">
                        <input type="checkbox" checked={pickedClips.has(c.id)} onChange={(e) => setPickedClips((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n })} />
                        <span className="timecode w-9 text-muted">{formatClock(c.timeSec)}</span><span className="flex-1 truncate font-medium">{tagById.get(c.tagTypeId)?.name}</span>
                        <span className="truncate text-2xs text-muted">{m ? `${teamById.get(m.homeTeamId)?.shortName} v ${teamById.get(m.awayTeamId)?.shortName}` : ''}</span>
                      </label></li>
                    )
                  })}
                </ul>
              )}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="label mb-1">Tactical snapshots <span className="normal-case text-muted">({pickedSnaps.length}/12)</span></legend>
              {snaps.length === 0 ? <p className="text-xs text-muted">None saved yet. In a match, use the camera button → “Save to report library” (drawings are included).</p> : (
                <ul className="grid grid-cols-3 gap-2">
                  {snaps.map((s) => {
                    const on = pickedSnaps.includes(s.id)
                    return (
                      <li key={s.id} className="group relative">
                        <button type="button" aria-pressed={on} aria-label={`${on ? 'Remove' : 'Include'} snapshot at ${formatClock(s.timeSec)}${s.caption ? `: ${s.caption}` : ''}`} onClick={() => setPickedSnaps((p) => (on ? p.filter((x) => x !== s.id) : p.length < 12 ? [...p, s.id] : p))} className={cn('block w-full overflow-hidden rounded border-2', on ? 'border-accent' : 'border-border')}>
                          <img src={s.url} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                          <span className="timecode block bg-raised px-1 py-0.5 text-left text-2xs text-muted">{formatClock(s.timeSec)} {s.caption && <span className="font-sans">· {s.caption}</span>}</span>
                        </button>
                        {canWrite && <button type="button" aria-label="Delete snapshot" onClick={() => { void api.deleteSnapshot(s.id).then(() => (setSnaps((x) => x.filter((y) => y.id !== s.id)), setPickedSnaps((p) => p.filter((x) => x !== s.id)))) }} className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-white group-hover:block group-focus-within:block"><Trash2 className="h-3 w-3" /></button>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </fieldset>

            <Field label="Written notes" hint="Printed in the Scouting notes section. Leave empty to print ruled lines for hand-written notes.">
              <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Summary, strengths, weaknesses, recommendation…" />
            </Field>
            <Button variant="primary" className="w-full" disabled={busy || !subject || !canWrite} onClick={() => void generate()}>{busy ? <Spinner className="h-4 w-4 text-accent-foreground" /> : <FileText className="h-4 w-4" />} {pdf ? 'Regenerate PDF' : 'Generate PDF'}</Button>
            {!canWrite && <p className="text-2xs text-muted">Viewers can’t generate reports.</p>}
          </div>

          <div className="flex min-w-0 flex-1 flex-col bg-background">
            {pdf ? (
              <>
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface px-3"><span className="truncate text-xs font-medium">{pdf.name}</span><Button size="sm" variant="primary" asChild><a href={pdf.url} download={pdf.name}><Download className="h-3.5 w-3.5" /> Download PDF</a></Button></div>
                <iframe title="Report preview" src={pdf.url} className="min-h-0 flex-1 border-0 bg-white" />
              </>
            ) : <EmptyState icon={FileText} title="Preview appears here" description="Choose what to include, then generate. Reports contain summary stats, a heatmap, key clips with timestamps, snapshots and a notes section." className="flex-1" />}
          </div>
        </div>
      )}
    </div>
  )
}
