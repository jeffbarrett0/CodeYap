import { MapPin } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Pitch, type PitchHandle, px, py } from '@/components/pitch/Pitch'
import { Button } from '@/components/ui/button'
import { Dot, EmptyState, Segmented } from '@/components/ui/misc'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { Clip, Outcome } from '@/types'
import { patchClips, useClips } from './clips'
import { player, usePlayback } from './playback'
import { useVisibleClips } from './visible'
import { zoneAt } from './zones'

const RING: Record<Outcome, string> = { success: '#4ade80', fail: '#f87171', neutral: 'transparent' }

/** Event locations on a 2D pitch (attack → right). Honours the shared clip filters plus a time range. */
export function PitchView({ canWrite }: { canWrite: boolean }) {
  const { list } = useVisibleClips()
  const total = useClips((s) => s.clips.length)
  const selectedIds = useClips((s) => s.selectedIds)
  const activeId = useClips((s) => s.activeId)
  const duration = usePlayback((s) => s.duration)
  const categories = useData((s) => s.categories)
  const { categoryOfTag, tagById } = useLookups()
  const [mode, setMode] = useState<'events' | 'heat'>('events')
  const [place, setPlace] = useState(false)
  const [range, setRange] = useState<[number, number] | null>(null)
  const pitchRef = useRef<PitchHandle>(null)
  const drag = useRef<{ x: number; y: number; ex: number; ey: number } | null>(null)
  const [preview, setPreview] = useState<{ x: number; y: number; ex: number; ey: number } | null>(null)

  const [t0, t1] = range ?? [0, duration]
  const inRange = useMemo(() => list.filter((c) => c.timeSec >= t0 && c.timeSec <= t1), [list, t0, t1])
  const located = useMemo(() => inRange.filter((c) => c.x != null && c.y != null), [inRange])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const active = activeId ? useClips.getState().clips.find((c) => c.id === activeId) : undefined
  const legend = useMemo(() => categories.map((c) => ({ c, n: located.filter((l) => categoryOfTag.get(l.tagTypeId)?.id === c.id).length })), [categories, located, categoryOfTag])
  const placing = place && canWrite && !!active

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!placing || !pitchRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pitchRef.current.toPitch(e.clientX, e.clientY)
    drag.current = { x: p.x, y: p.y, ex: p.x, ey: p.y }
    setPreview({ ...drag.current })
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !pitchRef.current) return
    const p = pitchRef.current.toPitch(e.clientX, e.clientY)
    drag.current.ex = p.x
    drag.current.ey = p.y
    setPreview({ ...drag.current })
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    setPreview(null)
    if (!d || !active) return
    const moved = Math.hypot(d.ex - d.x, d.ey - d.y) > 3
    const r = (n: number) => Math.round(n * 10) / 10
    void patchClips(
      [{ id: active.id, patch: { x: r(d.x), y: r(d.y), endX: moved ? r(d.ex) : null, endY: moved ? r(d.ey) : null, zone: zoneAt(d.x, d.y, active.zone?.startsWith('6x4') ? '6x4' : '3x3') } }],
      'Set event location',
    )
  }

  const select = (c: Clip) => {
    useClips.getState().select([c.id])
    player.skip(0)
    player.seek(c.startSec)
  }

  if (total === 0) return <EmptyState icon={MapPin} title="No events to plot" description="Tagged clips with a zone or location appear here." className="h-full" />

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 p-2">
        <Pitch
          ref={pitchRef}
          label={`Pitch showing ${located.length} events`}
          heat={mode === 'heat' ? located.map((c) => ({ x: c.x!, y: c.y! })) : null}
          heatColor="hsl(var(--accent))"
          cursor={placing ? 'crosshair' : undefined}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <defs>
            <marker id="pv-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
              <path d="M0 0 6 3 0 6z" fill="context-stroke" />
            </marker>
          </defs>
          {mode === 'events' && located.map((c) => {
            const color = categoryOfTag.get(c.tagTypeId)?.color ?? '#94a3b8'
            const sel = selected.has(c.id)
            return (
              <g key={c.id} style={{ pointerEvents: placing ? 'none' : 'auto', cursor: 'pointer' }} onClick={() => select(c)} opacity={sel || selected.size === 0 ? 1 : 0.55}>
                {c.endX != null && c.endY != null && <line x1={px(c.x!)} y1={py(c.y!)} x2={px(c.endX)} y2={py(c.endY)} stroke={color} strokeWidth={sel ? 0.55 : 0.35} markerEnd="url(#pv-arrow)" opacity={0.8} />}
                <circle cx={px(c.x!)} cy={py(c.y!)} r={1.9} fill="transparent" stroke={RING[c.outcome]} strokeWidth={0.4} />
                <circle cx={px(c.x!)} cy={py(c.y!)} r={sel ? 1.4 : 1.05} fill={color} stroke={sel ? '#fff' : 'rgba(0,0,0,.5)'} strokeWidth={sel ? 0.45 : 0.2} />
                <title>{`${formatClock(c.timeSec)} · ${tagById.get(c.tagTypeId)?.name}`}</title>
              </g>
            )
          })}
          {preview && (
            <g stroke="#fff" strokeWidth={0.4} fill="#fff" pointerEvents="none">
              <circle cx={px(preview.x)} cy={py(preview.y)} r={1.2} />
              {Math.hypot(preview.ex - preview.x, preview.ey - preview.y) > 3 && <line x1={px(preview.x)} y1={py(preview.y)} x2={px(preview.ex)} y2={py(preview.ey)} markerEnd="url(#pv-arrow)" />}
            </g>
          )}
        </Pitch>
      </div>

      <aside className="flex w-56 shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-border p-2.5 text-xs" aria-label="Pitch controls">
        <Segmented ariaLabel="Pitch mode" value={mode} onChange={setMode} options={[{ value: 'events', label: 'Events' }, { value: 'heat', label: 'Heatmap' }]} className="w-full [&>button]:flex-1" />

        <div className="space-y-1">
          <div className="flex items-center justify-between"><span className="label">Time range</span>{range && <button type="button" className="text-2xs text-muted hover:text-foreground" onClick={() => setRange(null)}>Reset</button>}</div>
          <input type="range" min={0} max={Math.max(1, duration)} step={1} value={t0} onChange={(e) => setRange([Math.min(Number(e.target.value), t1 - 1), t1])} aria-label="Range start" className="w-full" />
          <input type="range" min={0} max={Math.max(1, duration)} step={1} value={t1} onChange={(e) => setRange([t0, Math.max(Number(e.target.value), t0 + 1)])} aria-label="Range end" className="w-full" />
          <p className="timecode text-2xs text-muted">{formatClock(t0)} – {formatClock(t1)}</p>
        </div>

        {canWrite && (
          <div className="space-y-1">
            <Button variant={place ? 'primary' : 'secondary'} size="sm" className="w-full" aria-pressed={place} disabled={!active} onClick={() => setPlace((p) => !p)}>
              <MapPin className="h-3.5 w-3.5" /> Set location
            </Button>
            <p className="text-2xs text-muted">{!active ? 'Select a clip first.' : place ? 'Click the pitch to place the event; drag to also set where it ended.' : 'Place or move the selected clip’s event.'}</p>
          </div>
        )}

        <div className="space-y-1">
          <span className="label">Showing {located.length} of {inRange.length}</span>
          {inRange.length > located.length && <p className="text-2xs text-muted">{inRange.length - located.length} clips have no location yet.</p>}
          <ul className="space-y-0.5">
            {legend.map(({ c, n }) => (
              <li key={c.id} className={cn('flex items-center gap-1.5', n === 0 && 'opacity-40')}><Dot color={c.color} /><span className="flex-1 truncate">{c.name}</span><span className="timecode text-muted">{n}</span></li>
            ))}
          </ul>
          <p className="text-2xs text-muted">Ring: <span className="text-success">success</span> · <span className="text-danger">fail</span></p>
        </div>
      </aside>
    </div>
  )
}
