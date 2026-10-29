import { ArrowLeft, CheckCircle2, ExternalLink, FileJson, Globe, Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MatchBanner } from '@/components/MatchBanner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { api } from '@/lib/api'
import { parseTimecode } from '@/lib/timecode'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { EventsInfo, HudlCompetition, HudlMatch, ImportResult, MatchPreview } from '@/types'

type Step = 'link' | 'browse' | 'preview' | 'done'

const refreshAll = async () => {
  const [teams, players, matches] = await Promise.all([api.teams(), api.players(), api.matches()])
  useData.setState({ teams, players, matches })
}
const SOURCE_NAME = { hudl: 'Hudl open data', sofascore: 'SofaScore', generic: 'web page', file: 'Your JSON file' } as const

const EXAMPLE = `{
  "date": "2026-10-24",
  "competition": "Friendly",
  "venue": "Northbridge Stadium",
  "homeScore": 2, "awayScore": 1,
  "home": { "name": "Northbridge FC", "formation": "4-3-3",
    "players": [ { "name": "Luca Ferreira", "jersey": 8, "position": "CM" } ] },
  "away": { "name": "Rivermouth United", "formation": "4-2-3-1", "players": [] },
  "events": [ { "minute": 12, "second": 5, "team": "home", "player": "Luca Ferreira", "tag": "Goal", "outcome": "success" } ]
}`

/**
 * "Which match is this?" — paste a SofaScore / Transfermarkt / other link (or pick from the free Hudl
 * open data), review what was found, and import teams, date, league, lineups and (optionally) events.
 */
export function ImportMatchDialog({ targetMatchId, initialUrl, onClose, onDone }: { targetMatchId?: string | null; initialUrl?: string; onClose: () => void; onDone: (matchId: string) => void }) {
  const { matchById, teamById } = useLookups()
  const target = targetMatchId ? matchById.get(targetMatchId) : undefined
  const [step, setStep] = useState<Step>('link')
  const [url, setUrl] = useState(initialUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pv, setPv] = useState<{ id: string; preview: MatchPreview; events: EventsInfo } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  // review options
  const [date, setDate] = useState('')
  const [lineups, setLineups] = useState(true)
  const [details, setDetails] = useState(true)
  const [events, setEvents] = useState(false)
  const [pressures, setPressures] = useState(false)
  const [fh, setFh] = useState('0:00')
  const [sh, setSh] = useState('')
  const [jsonFiles, setJsonFiles] = useState<{ name: string; data: unknown }[] | null>(null)
  const [swap, setSwap] = useState(false)
  const [recognised, setRecognised] = useState<{ file: string; kind: string }[]>([])

  const lookup = async (body: { url?: string; hudlMatchId?: number }) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.importPreview(body)
      if (r.kind === 'browse') return setStep('browse')
      setPv({ id: r.previewId, preview: r.preview, events: r.events })
      setDate(r.preview.date ?? '')
      setEvents(false)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that link')
      setStep('link')
    } finally {
      setBusy(false)
    }
  }
  /** JSON the user already has: read in the browser, then previewed like a link. */
  const lookupJson = async (files: { name: string; data: unknown }[], swapSides = false) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.importPreviewJson({ files, swap: swapSides })
      if (r.kind !== 'preview') return
      setJsonFiles(files)
      setSwap(swapSides)
      setRecognised(r.recognised ?? [])
      setPv({ id: r.previewId, preview: r.preview, events: r.events })
      setDate(r.preview.date ?? '')
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read those files')
      setStep('link')
    } finally {
      setBusy(false)
    }
  }
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    const files: { name: string; data: unknown }[] = []
    for (const f of Array.from(list)) {
      try {
        files.push({ name: f.name, data: JSON.parse(await f.text()) })
      } catch {
        return setError(`“${f.name}” isn’t valid JSON (check it opens as text and has no stray commas).`)
      }
    }
    await lookupJson(files)
  }
  useEffect(() => { if (initialUrl?.trim()) void lookup({ url: initialUrl }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const apply = async () => {
    if (!pv) return
    const fhS = parseTimecode(fh, 25)
    const shS = sh.trim() ? parseTimecode(sh, 25) : null
    if (events && (fhS == null || (sh.trim() && shS == null))) return setError('Enter kick-off times like 0:45 or 1:02:30')
    setBusy(true)
    setError(null)
    try {
      const r = await api.importApply({
        previewId: pv.id, matchId: targetMatchId ?? null, updateMatch: details, importLineups: lineups, createMissing: true,
        overrides: date && date !== pv.preview.date ? { date } : undefined,
        importEvents: events, includePressures: pressures, firstHalfStart: fhS ?? 0, secondHalfStart: shS ?? undefined,
      })
      await refreshAll()
      setResult(r)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const searchQuery = target ? `${teamById.get(target.homeTeamId)?.name ?? ''} ${teamById.get(target.awayTeamId)?.name ?? ''} ${target.date.slice(0, 10)}`.trim() : ''
  const q = encodeURIComponent(searchQuery)
  const finder = [
    { name: 'SofaScore', href: searchQuery ? `https://www.sofascore.com/search?q=${q}` : 'https://www.sofascore.com/' },
    { name: 'Transfermarkt', href: searchQuery ? `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${q}` : 'https://www.transfermarkt.com/' },
    { name: 'Google', href: `https://www.google.com/search?q=${searchQuery ? q : ''}${searchQuery ? '+' : ''}match+sofascore+OR+transfermarkt` },
  ]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Import a match from a link" description="Paste a link or use your own JSON files — I’ll fill in the date, teams, league, lineups and more." className="max-w-2xl">
        <DialogBody className="space-y-4">
          {step === 'link' && (
            <>
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void lookup({ url }) }}>
                <Field label="Match link" hint="SofaScore, Transfermarkt, the Hudl open-data GitHub page, or any page about the match.">
                  <div className="flex gap-2">
                    <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.sofascore.com/football/match/…" aria-label="Match link" />
                    <Button type="submit" variant="primary" disabled={busy || !url.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Look up</Button>
                  </div>
                </Field>
                {error && <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
              </form>
              <div className="rounded-lg border border-border bg-background p-3 text-xs">
                <p className="mb-2 font-medium">Don’t have the link yet?</p>
                <div className="flex flex-wrap gap-2">
                  {finder.map((f) => <Button key={f.name} size="sm" asChild><a href={f.href} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3 w-3" /> Find on {f.name}</a></Button>)}
                </div>
                <p className="mt-2 text-muted">Open the match page there, then copy its address from your browser and paste it above.</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3 text-xs">
                <p className="mb-1 font-medium">I already have JSON files</p>
                <p className="mb-2 text-muted">Pick one or several files (match info, lineups, events). Works with StatsBomb / Hudl open data, SofaScore JSON, or the simple format below. Nothing is uploaded anywhere but your own ScoutDesk.</p>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-1.5 font-medium hover:bg-raised">
                  <FileJson className="h-3.5 w-3.5" /> Choose JSON file(s)
                  <input type="file" accept=".json,application/json" multiple className="sr-only" aria-label="Choose JSON files" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
                </label>
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted">Simple format example</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-raised p-2 text-2xs leading-snug">{EXAMPLE}</pre>
                  <p className="mt-1 text-muted">Only <code>home</code> and <code>away</code> are needed; everything else is optional. <code>minute</code> is the match clock (63 = 63rd minute); <code>team</code> is <code>home</code>, <code>away</code> or the team name.</p>
                </details>
              </div>
              <div className="rounded-lg border border-border bg-background p-3 text-xs">
                <p className="mb-1 font-medium">Want full event data for free?</p>
                <p className="mb-2 text-muted">The Hudl open data has lineups plus every shot, pass, duel and more for hundreds of matches (World Cups, Euros, some league seasons). It can fill your clip list automatically.</p>
                <Button size="sm" onClick={() => setStep('browse')}><Globe className="h-3.5 w-3.5" /> Browse Hudl open data</Button>
              </div>
            </>
          )}

          {step === 'browse' && <HudlBrowser onBack={() => setStep('link')} onPick={(m) => void lookup({ hudlMatchId: m })} busy={busy} />}

          {step === 'preview' && pv && (
            <>
              <MatchBanner compact competition={pv.preview.competition} date={date || null} venue={pv.preview.venue} home={{ name: pv.preview.home.name, formation: pv.preview.home.formation }} away={{ name: pv.preview.away.name, formation: pv.preview.away.formation }} homeScore={pv.preview.homeScore} awayScore={pv.preview.awayScore} status={{ label: SOURCE_NAME[pv.preview.source], tone: 'muted' }} />
              {pv.preview.source === 'file' && (
                <div className="space-y-1 rounded border border-border bg-background p-2 text-xs">
                  {recognised.map((r) => <p key={r.file}><strong>{r.file}</strong> <span className="text-muted">→ {r.kind}</span></p>)}
                  {jsonFiles && <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={swap} disabled={busy} onChange={(e) => void lookupJson(jsonFiles, e.target.checked)} /> Swap home and away (if the sides came out the wrong way round)</label>}
                </div>
              )}
              <p className="text-xs text-muted">
                Found: {pv.preview.home.players.length + pv.preview.away.players.length > 0 ? `${pv.preview.home.players.length + pv.preview.away.players.length} players in the lineups` : 'no lineups on this page'}
                {pv.events.available ? ` · ${pv.events.summary.reduce((a, s) => a + s.count, 0)} tagged-worthy events` : ''}.
              </p>
              {(pv.preview.missing.includes('date') || !pv.preview.date) && (
                <Field label="Match date" hint="This page didn’t say when it was played."><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              )}
              <fieldset className="space-y-2 text-xs">
                <legend className="label mb-1">What should I import?</legend>
                {target && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={details} onChange={(e) => setDetails(e.target.checked)} /> <span><strong>Match details</strong> — teams, date, league, venue and score will replace what’s on “{teamById.get(target.homeTeamId)?.name} v {teamById.get(target.awayTeamId)?.name}”.</span></label>}
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={lineups} onChange={(e) => setLineups(e.target.checked)} disabled={pv.preview.home.players.length === 0} /> <span><strong>Lineups &amp; players</strong> — adds the players (name, shirt number, position) to your database and the match lineup. Teams and players that already exist are reused.</span></label>
                {pv.events.available && (
                  <div className="rounded border border-border p-2.5">
                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={events} onChange={(e) => setEvents(e.target.checked)} /> <span><strong>Match events as clips</strong> — goals, shots, key passes, crosses, dribbles, tackles, interceptions, fouls, saves… placed on your timeline and pitch map.</span></label>
                    {events && (
                      <div className="mt-2 space-y-2 pl-6">
                        <p className="text-muted">Tell me where the match starts in <em>your</em> video so the clips line up:</p>
                        <div className="grid max-w-md grid-cols-2 gap-2">
                          <Field label="1st half kick-off at"><Input value={fh} onChange={(e) => setFh(e.target.value)} placeholder="0:45" className="font-mono" aria-label="First half kick-off time in video" /></Field>
                          <Field label="2nd half starts at" hint="Leave empty if unknown"><Input value={sh} onChange={(e) => setSh(e.target.value)} placeholder="1:02:30" className="font-mono" aria-label="Second half start time in video" /></Field>
                        </div>
                        <div className="flex flex-wrap gap-1">{pv.events.summary.map((s) => <span key={s.tag} className="rounded-sm border border-border bg-raised px-1.5 py-0.5 text-2xs">{s.tag} <strong className="timecode">{s.count}</strong></span>)}</div>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={pressures} onChange={(e) => setPressures(e.target.checked)} /> Also add pressing actions ({pv.events.pressureCount} — lots of clips)</label>
                        {pv.events.outsideTwoHalves > 0 && <p className="text-2xs text-muted">{pv.events.outsideTwoHalves} events in extra time are skipped.</p>}
                        <p className="text-2xs text-muted">Re-importing replaces earlier imported clips; your own tags are never touched.</p>
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
              {error && <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
            </>
          )}

          {step === 'done' && result && (
            <div className="space-y-3 py-2 text-center">
              <CheckCircle2 className="mx-auto h-9 w-9 text-success" />
              <h3 className="text-sm font-semibold">Match imported</h3>
              <ul className="mx-auto max-w-sm space-y-1 text-left text-xs">
                {result.createdTeams.length > 0 && <li>Created team{result.createdTeams.length > 1 ? 's' : ''}: <strong>{result.createdTeams.join(', ')}</strong></li>}
                <li>{result.createdPlayers} new player{result.createdPlayers === 1 ? '' : 's'} added{result.matchedPlayers ? `, ${result.matchedPlayers} matched to players you already had` : ''}</li>
                {result.clipsCreated > 0 && <li><strong>{result.clipsCreated}</strong> clips added to the timeline{result.clipsSkipped ? ` (${result.clipsSkipped} skipped: outside the video or no matching tag)` : ''}</li>}
                {result.unknownTags.length > 0 && <li className="text-muted">No tag called {result.unknownTags.join(', ')} in your taxonomy — add one in Settings to include them.</li>}
              </ul>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          {step === 'preview' ? <Button variant="ghost" onClick={() => { setStep('link'); setError(null) }}><ArrowLeft className="h-3.5 w-3.5" /> Different link</Button> : <span />}
          <div className="flex gap-2">
            {step !== 'done' && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
            {step === 'preview' && <Button variant="primary" disabled={busy || (!pv?.preview.date && !date)} onClick={() => void apply()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Import</Button>}
            {step === 'done' && result && <Button variant="primary" onClick={() => onDone(result.matchId)}>{targetMatchId ? 'Done' : 'Use this match'}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HudlBrowser({ onBack, onPick, busy }: { onBack: () => void; onPick: (matchId: number) => void; busy: boolean }) {
  const [comps, setComps] = useState<HudlCompetition[] | null>(null)
  const [sel, setSel] = useState('')
  const [matches, setMatches] = useState<HudlMatch[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.hudlCompetitions().then(setComps).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the list')) }, [])
  useEffect(() => {
    if (!sel) return setMatches(null)
    const [c, s] = sel.split(':').map(Number)
    setMatches(null)
    api.hudlMatches(c!, s!).then(setMatches).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load matches'))
  }, [sel])
  const shown = useMemo(() => (matches ?? []).filter((m) => `${m.home} ${m.away}`.toLowerCase().includes(q.toLowerCase())), [matches, q])
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      <Field label="Competition & season">
        <Select value={sel} onChange={(e) => setSel(e.target.value)} disabled={!comps}>
          <option value="">{comps ? 'Choose…' : 'Loading…'}</option>
          {(comps ?? []).map((c) => <option key={`${c.competitionId}:${c.seasonId}`} value={`${c.competitionId}:${c.seasonId}`}>{c.name} — {c.season}</option>)}
        </Select>
      </Field>
      {matches && (
        <>
          <Input aria-label="Filter matches by team" placeholder="Filter by team…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border text-xs">
            {shown.map((m) => (
              <li key={m.matchId}>
                <button type="button" disabled={busy} onClick={() => onPick(m.matchId)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised disabled:opacity-50">
                  <span className="timecode w-20 text-muted">{m.date}</span>
                  <span className="flex-1 truncate font-medium">{m.home} <span className="timecode mx-1 rounded bg-raised px-1">{m.homeScore ?? '–'}–{m.awayScore ?? '–'}</span> {m.away}</span>
                  {m.stage && <span className="text-2xs text-muted">{m.stage}</span>}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="p-3 text-center text-muted">No matches.</li>}
          </ul>
        </>
      )}
      <p className="text-2xs text-muted">Data: Hudl open data (StatsBomb format) — free for non-commercial use, please credit “Hudl Statsbomb”.</p>
    </div>
  )
}

