import { Lock } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { Field, Input, Select } from '@/components/ui/input'
import { Dot, Kbd, Segmented } from '@/components/ui/misc'
import { formatHotkey, useHotkeys, type Binding } from '@/lib/hotkeys'
import { cn, clamp } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { Match, Outcome } from '@/types'
import { useClips } from './clips'
import { tagMoment, useTagging } from './tagging'
import { ZonePicker } from './ZonePicker'

const OUTCOMES: { value: 'auto' | Outcome; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Use each tag’s default outcome (Alt+0)' },
  { value: 'success', label: '✓', title: 'Success (Alt+1)' },
  { value: 'fail', label: '✗', title: 'Fail (Alt+2)' },
  { value: 'neutral', label: '–', title: 'Neutral (Alt+3)' },
]

export function TaggingPanel({ match, canWrite }: { match: Match; canWrite: boolean }) {
  const categories = useData((s) => s.categories)
  const players = useData((s) => s.players)
  const { teamById } = useLookups()
  const clips = useClips((s) => s.clips)
  const { teamId, playerId, jersey, outcome, zone, grid, flashTagId, setTeam, setPlayer, setJersey, setOutcome, setZone, setGrid } = useTagging()
  const { preRoll, postRoll, setRoll } = useApp()
  const jerseyRef = useRef<HTMLInputElement>(null)

  const home = teamById.get(match.homeTeamId)
  const away = teamById.get(match.awayTeamId)
  const roster = useMemo(() => players.filter((p) => p.teamId === teamId).sort((a, b) => (a.jersey ?? 99) - (b.jersey ?? 99)), [players, teamId])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of clips) m.set(c.tagTypeId, (m.get(c.tagTypeId) ?? 0) + 1)
    return m
  }, [clips])

  // One binding per tag hotkey, plus context shortcuts. Disabled for read-only users.
  const bindings = useMemo<Binding[]>(() => {
    const b: Binding[] = categories.flatMap((cat) =>
      cat.tagTypes.filter((t) => t.hotkey).map((t) => ({
        combo: t.hotkey!, description: `Tag: ${t.name}`, group: `Tagging · ${cat.name}`, enabled: canWrite, handler: () => void tagMoment(t),
      })),
    )
    b.push(
      { combo: 'alt+t', description: 'Toggle tagging team', group: 'Tagging context', enabled: canWrite, allowInInput: true, handler: () => setTeam(useTagging.getState().teamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId, useData.getState().players) },
      { combo: 'alt+0', description: 'Outcome: auto', group: 'Tagging context', enabled: canWrite, allowInInput: true, handler: () => setOutcome('auto') },
      { combo: 'alt+1', description: 'Outcome: success', group: 'Tagging context', enabled: canWrite, allowInInput: true, handler: () => setOutcome('success') },
      { combo: 'alt+2', description: 'Outcome: fail', group: 'Tagging context', enabled: canWrite, allowInInput: true, handler: () => setOutcome('fail') },
      { combo: 'alt+3', description: 'Outcome: neutral', group: 'Tagging context', enabled: canWrite, allowInInput: true, handler: () => setOutcome('neutral') },
      { combo: '#', description: 'Pick player by jersey number (type, Enter)', group: 'Tagging context', enabled: canWrite, handler: () => jerseyRef.current?.focus() },
    )
    return b
  }, [categories, canWrite, match.homeTeamId, match.awayTeamId, setTeam, setOutcome])
  useHotkeys(bindings)

  const applyJersey = (raw: string) => {
    const n = raw === '' ? null : clamp(Math.round(Number(raw)), 0, 99)
    const p = n == null ? undefined : roster.find((x) => x.jersey === n)
    if (p) setPlayer(p.id, players)
    else {
      useTagging.setState({ playerId: null })
      setJersey(n)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!canWrite && (
        <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <Lock className="h-3.5 w-3.5" /> Read-only: viewers can’t create tags.
        </div>
      )}

      <fieldset disabled={!canWrite} className="space-y-2.5 border-b border-border p-3">
        <legend className="sr-only">Tagging context</legend>
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Tagging team">
          {[home, away].map((t) =>
            t ? (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={teamId === t.id}
                onClick={() => setTeam(t.id, players)}
                className={cn('flex h-7 items-center justify-center gap-1.5 rounded border text-xs font-semibold transition-colors', teamId === t.id ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted hover:text-foreground')}
              >
                <Dot color={t.color} /> {t.shortName}
              </button>
            ) : null,
          )}
        </div>

        <div className="grid grid-cols-[1fr_56px] gap-2">
          <Field label="Player">
            <Select value={playerId ?? ''} onChange={(e) => setPlayer(e.target.value || null, players)} aria-label="Player">
              <option value="">No player</option>
              {roster.map((p) => <option key={p.id} value={p.id}>{p.jersey != null ? `#${p.jersey} ` : ''}{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Jersey">
            <Input
              ref={jerseyRef}
              inputMode="numeric"
              placeholder="#"
              value={jersey ?? ''}
              onChange={(e) => applyJersey(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.stopPropagation(), e.currentTarget.blur())}
              aria-label="Jersey number"
              className="text-center font-mono"
            />
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div className="space-y-1">
            <span className="label">Outcome</span>
            <Segmented ariaLabel="Outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} className="w-full [&>button]:flex-1" />
          </div>
          <div className="space-y-1">
            <span className="label">Roll −/+ s</span>
            <div className="flex gap-1">
              <Input type="number" min={0} max={60} step={0.5} value={preRoll} onChange={(e) => setRoll(clamp(Number(e.target.value) || 0, 0, 60), postRoll)} aria-label="Pre-roll seconds" className="h-8 w-12 px-1.5 text-center font-mono text-xs" />
              <Input type="number" min={0} max={60} step={0.5} value={postRoll} onChange={(e) => setRoll(preRoll, clamp(Number(e.target.value) || 0, 0, 60))} aria-label="Post-roll seconds" className="h-8 w-12 px-1.5 text-center font-mono text-xs" />
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-32 shrink-0 space-y-1">
            <span className="label">Zone</span>
            <ZonePicker value={zone} onChange={setZone} grid={grid} />
          </div>
          <div className="space-y-1 pt-4 text-2xs text-muted">
            <Segmented ariaLabel="Zone grid" value={grid} onChange={setGrid} options={[{ value: '3x3', label: '3×3' }, { value: '6x4', label: '6×4' }]} />
            <p>Attack → right. Click again to clear.</p>
          </div>
        </div>
      </fieldset>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" role="group" aria-label="Quick tags">
        {categories.map((cat) => (
          <section key={cat.id} aria-label={cat.name}>
            <h3 className="label mb-1 flex items-center gap-1.5"><Dot color={cat.color} /> {cat.name}</h3>
            <div className="grid grid-cols-2 gap-1">
              {cat.tagTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => void tagMoment(t)}
                  className={cn(
                    'flex h-8 items-center justify-between gap-1 rounded border border-border bg-background pl-2 pr-1.5 text-left text-xs transition-colors hover:bg-raised disabled:opacity-50',
                    flashTagId === t.id && 'border-transparent bg-accent text-accent-foreground',
                  )}
                  style={{ borderLeft: `3px solid ${cat.color}` }}
                  title={t.name}
                >
                  <span className="truncate font-medium">{t.name}{t.hotkey && <span className="sr-only">, shortcut {formatHotkey(t.hotkey)}</span>}</span>
                  <span className="flex shrink-0 items-center gap-1" aria-hidden>
                    {(counts.get(t.id) ?? 0) > 0 && <span className="timecode text-2xs text-muted">{counts.get(t.id)}</span>}
                    {t.hotkey && <Kbd>{formatHotkey(t.hotkey)}</Kbd>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
