import { Crosshair, Minus, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState, Segmented } from '@/components/ui/misc'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { formatTimecode, parseTimecode } from '@/lib/timecode'
import { clamp, cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { Clip, ClipPatch, Outcome } from '@/types'
import { SquareDashedMousePointer } from 'lucide-react'
import { deleteClips, patchClips, patchMany, useClips } from './clips'
import { player, usePlayback } from './playback'
import { ZonePicker } from './ZonePicker'
import { parseZone, zoneCenter } from './zones'

const MIN_CLIP = 0.5
const OUTCOME_OPTIONS: { value: Outcome; label: string; title: string }[] = [
  { value: 'success', label: '✓', title: 'Success' },
  { value: 'fail', label: '✗', title: 'Fail' },
  { value: 'neutral', label: '–', title: 'Neutral' },
]

/** Editable timecode with ± nudge and "set to playhead". */
function TimeField({ label, value, onCommit, min, max, fps }: { label: string; value: number; onCommit: (v: number) => void; min: number; max: number; fps: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (v: number) => onCommit(clamp(Math.round(v * fps) / fps, min, max))
  return (
    <div className="space-y-1">
      <span className="label">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          value={draft ?? formatTimecode(value, fps)}
          onFocus={(e) => (setDraft(formatTimecode(value, fps)), e.currentTarget.select())}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const parsed = draft == null ? null : parseTimecode(draft, fps)
            if (parsed != null) commit(parsed)
            setDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') (setDraft(null), e.currentTarget.blur())
            e.stopPropagation()
          }}
          aria-label={`${label} time`}
          className="h-7 flex-1 font-mono text-xs"
        />
        <Tip label="−0.5 s" side="top"><Button variant="secondary" size="icon" aria-label={`${label} minus half a second`} onClick={() => commit(value - 0.5)}><Minus className="h-3 w-3" /></Button></Tip>
        <Tip label="+0.5 s" side="top"><Button variant="secondary" size="icon" aria-label={`${label} plus half a second`} onClick={() => commit(value + 0.5)}><Plus className="h-3 w-3" /></Button></Tip>
        <Tip label="Set to playhead" side="top"><Button variant="secondary" size="icon" aria-label={`Set ${label} to playhead`} onClick={() => commit(player.currentTime)}><Crosshair className="h-3 w-3" /></Button></Tip>
      </div>
    </div>
  )
}

function LabelsEditor({ labels, suggestions, onChange, disabled }: { labels: string[]; suggestions: string[]; onChange: (l: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const add = () => {
    const l = text.trim().toLowerCase().replace(/\s+/g, '-')
    if (l && !labels.includes(l)) onChange([...labels, l])
    setText('')
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {labels.map((l) => (
          <span key={l} className="inline-flex items-center gap-1 rounded-sm border border-border bg-raised px-1.5 py-0.5 text-2xs">
            {l}
            {!disabled && <button type="button" aria-label={`Remove label ${l}`} onClick={() => onChange(labels.filter((x) => x !== l))} className="text-muted hover:text-foreground"><X className="h-2.5 w-2.5" /></button>}
          </span>
        ))}
      </div>
      <Input
        list="label-suggestions"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === ',') (e.preventDefault(), add())
        }}
        onBlur={add}
        placeholder="Add label, press Enter"
        aria-label="Add label"
        className="h-7 text-xs"
      />
      <datalist id="label-suggestions">{suggestions.filter((s) => !labels.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  )
}

function useRoster(teamId: string | null) {
  const players = useData((s) => s.players)
  return useMemo(() => players.filter((p) => !teamId || p.teamId === teamId).sort((a, b) => (a.jersey ?? 99) - (b.jersey ?? 99)), [players, teamId])
}

function TagSelect({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const categories = useData((s) => s.categories)
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Tag">
      {value === '' && <option value="">Mixed…</option>}
      {categories.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {c.tagTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}

export function ClipInspector({ canWrite, onPlayClip }: { canWrite: boolean; onPlayClip: (c: Clip) => void }) {
  const clips = useClips((s) => s.clips)
  const selectedIds = useClips((s) => s.selectedIds)
  const activeId = useClips((s) => s.activeId)
  const selection = useMemo(() => clips.filter((c) => selectedIds.includes(c.id)), [clips, selectedIds])
  const active = clips.find((c) => c.id === activeId) ?? null

  if (selection.length === 0) {
    return <EmptyState icon={SquareDashedMousePointer} title="No clip selected" description="Select a clip in the list or on the timeline to fine-tune its range, player, outcome and notes." className="h-full" />
  }
  if (selection.length > 1 || !active) return <BulkInspector clips={selection} canWrite={canWrite} />
  return <SingleInspector key={active.id} clip={active} canWrite={canWrite} onPlayClip={onPlayClip} />
}

function SingleInspector({ clip, canWrite, onPlayClip }: { clip: Clip; canWrite: boolean; onPlayClip: (c: Clip) => void }) {
  const fps = usePlayback((s) => s.fps)
  const duration = usePlayback((s) => s.duration)
  const teams = useData((s) => s.teams)
  const allClips = useClips((s) => s.clips)
  const { playerById } = useLookups()
  const roster = useRoster(clip.teamId)
  const [notes, setNotes] = useState(clip.notes)
  useEffect(() => setNotes(clip.notes), [clip.notes])
  const grid = parseZone(clip.zone)?.grid ?? '3x3'
  const labelSuggestions = useMemo(() => [...new Set(allClips.flatMap((c) => c.labels))].sort(), [allClips])
  const patch = (p: ClipPatch, label = 'Edit clip') => void patchClips([{ id: clip.id, patch: p }], label)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Field label="Tag"><TagSelect value={clip.tagTypeId} disabled={!canWrite} onChange={(id) => patch({ tagTypeId: id }, 'Change tag')} /></Field>

        <fieldset disabled={!canWrite} className="space-y-2.5">
          <TimeField label="Start" value={clip.startSec} fps={fps} min={0} max={clip.endSec - MIN_CLIP} onCommit={(v) => patch({ startSec: v }, 'Adjust clip start')} />
          <TimeField label="End" value={clip.endSec} fps={fps} min={clip.startSec + MIN_CLIP} max={duration || Infinity} onCommit={(v) => patch({ endSec: v }, 'Adjust clip end')} />
          <div className="flex items-center justify-between text-2xs text-muted">
            <span>Moment <span className="timecode text-foreground">{formatTimecode(clip.timeSec, fps)}</span> · Length <span className="timecode text-foreground">{(clip.endSec - clip.startSec).toFixed(1)}s</span></span>
            <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => patch({ timeSec: clamp(player.currentTime, clip.startSec, clip.endSec) }, 'Move tag moment')}>Set moment to playhead</button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Team">
              <Select value={clip.teamId ?? ''} onChange={(e) => patch({ teamId: e.target.value || null }, 'Change team')} aria-label="Team">
                <option value="">—</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.shortName}</option>)}
              </Select>
            </Field>
            <Field label="Jersey">
              <Input inputMode="numeric" value={clip.jersey ?? ''} onChange={(e) => patch({ jersey: e.target.value === '' ? null : clamp(Number(e.target.value.replace(/\D/g, '')) || 0, 0, 99) }, 'Change jersey')} onKeyDown={(e) => e.stopPropagation()} className="font-mono" aria-label="Jersey number" />
            </Field>
          </div>
          <Field label="Player">
            <Select
              value={clip.playerId ?? ''}
              onChange={(e) => {
                const p = e.target.value ? playerById.get(e.target.value) : undefined
                patch(p ? { playerId: p.id, jersey: p.jersey, teamId: p.teamId ?? clip.teamId } : { playerId: null }, 'Change player')
              }}
              aria-label="Player"
            >
              <option value="">No player</option>
              {roster.map((p) => <option key={p.id} value={p.id}>{p.jersey != null ? `#${p.jersey} ` : ''}{p.name}</option>)}
            </Select>
          </Field>

          <div className="space-y-1">
            <span className="label">Outcome</span>
            <Segmented ariaLabel="Outcome" value={clip.outcome} onChange={(o) => patch({ outcome: o }, 'Change outcome')} options={OUTCOME_OPTIONS} className="w-full [&>button]:flex-1" />
          </div>

          <div className="space-y-1">
            <span className="label">Zone</span>
            <div className="w-40"><ZonePicker value={clip.zone} grid={grid} onChange={(z) => { const c = zoneCenter(z); patch({ zone: z, ...(c ? { x: c.x, y: c.y } : {}) }, 'Change zone') }} /></div>
          </div>

          <div className="space-y-1">
            <span className="label">Labels</span>
            <LabelsEditor labels={clip.labels} suggestions={labelSuggestions} onChange={(l) => patch({ labels: l }, 'Edit labels')} />
          </div>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onBlur={() => notes !== clip.notes && patch({ notes }, 'Edit notes')} rows={3} placeholder="What happened? Why does it matter?" />
          </Field>
        </fieldset>
      </div>
      <div className={cn('flex shrink-0 items-center justify-between gap-2 border-t border-border p-2')}>
        <Button variant="secondary" size="sm" onClick={() => onPlayClip(clip)}><Play className="h-3.5 w-3.5" /> Play clip</Button>
        <Button variant="danger" size="sm" disabled={!canWrite} onClick={() => void deleteClips([clip.id])}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
      </div>
    </div>
  )
}

function BulkInspector({ clips, canWrite }: { clips: Clip[]; canWrite: boolean }) {
  const teams = useData((s) => s.teams)
  const ids = clips.map((c) => c.id)
  const sameTag = clips.every((c) => c.tagTypeId === clips[0]!.tagTypeId) ? clips[0]!.tagTypeId : ''
  const sameOutcome = clips.every((c) => c.outcome === clips[0]!.outcome) ? clips[0]!.outcome : null
  const [label, setLabel] = useState('')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <fieldset disabled={!canWrite} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs"><strong>{clips.length} clips selected.</strong> <span className="text-muted">Changes apply to all of them.</span></p>
        <Field label="Tag"><TagSelect value={sameTag} onChange={(id) => void patchMany(ids, { tagTypeId: id }, 'Change tag')} /></Field>
        <div className="space-y-1">
          <span className="label">Outcome</span>
          <Segmented ariaLabel="Outcome for all" value={(sameOutcome ?? '') as Outcome} onChange={(o) => void patchMany(ids, { outcome: o }, 'Change outcome')} options={OUTCOME_OPTIONS} className="w-full [&>button]:flex-1" />
        </div>
        <Field label="Team">
          <Select value="" onChange={(e) => void patchMany(ids, { teamId: e.target.value || null }, 'Change team')} aria-label="Team for all">
            <option value="" disabled>Set team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Add label to all">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key !== 'Enter') return
            const l = label.trim().toLowerCase().replace(/\s+/g, '-')
            if (!l) return
            void patchClips(clips.map((c) => ({ id: c.id, patch: { labels: [...new Set([...c.labels, l])] } })), 'Add label')
            setLabel('')
          }} placeholder="Label, press Enter" />
        </Field>
      </fieldset>
      <div className="flex shrink-0 justify-end border-t border-border p-2">
        <Button variant="danger" size="sm" disabled={!canWrite} onClick={() => void deleteClips(ids)}><Trash2 className="h-3.5 w-3.5" /> Delete {clips.length}</Button>
      </div>
    </div>
  )
}
