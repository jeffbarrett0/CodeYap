import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useHotkeys } from '@/lib/hotkeys'
import { formatClock, formatTimecode } from '@/lib/timecode'
import { clamp, cn } from '@/lib/utils'
import { useLookups } from '@/store/hooks'
import type { Video } from '@/types'
import { useClips } from './clips'
import { player, usePlayback } from './playback'

const PAD_L = 16
const PAD_R = 24
const RULER_H = 24
const TRACK_H = 56
const ROW_H = 14
const MAX_ROWS = 4
const MAX_WIDTH = 8000
const STRIP_FRAMES = 24
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/**
 * Simple timeline: a time ruler, the match video as one filmstrip track, and the tagged clips as small
 * coloured markers underneath. Click or drag anywhere to jump to that moment; click a marker to open that clip.
 */
export function Timeline({ video, visibleIds }: { video: Video; visibleIds: Set<string>; canEdit?: boolean }) {
  const clips = useClips((s) => s.clips)
  const selectedIds = useClips((s) => s.selectedIds)
  const duration = usePlayback((s) => s.duration)
  const fps = usePlayback((s) => s.fps)
  const { categoryOfTag, tagById, playerById } = useLookups()

  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const scrubbing = useRef(false)

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(([e]) => setBoxW(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const baseW = Math.max(200, boxW - PAD_L - PAD_R)
  const maxZoom = Math.max(1, MAX_WIDTH / baseW)
  const trackW = baseW * Math.min(zoom, maxZoom)
  const pps = duration > 0 ? trackW / duration : 0
  const xOf = useCallback((t: number) => PAD_L + t * pps, [pps])
  const zoomBy = useCallback((f: number) => setZoom((z) => clamp(z * f, 1, maxZoom)), [maxZoom])

  useHotkeys([
    { combo: '=', description: 'Zoom timeline in', group: 'Timeline', handler: () => zoomBy(1.5) },
    { combo: '+', description: 'Zoom timeline in', group: 'Timeline', hidden: true, handler: () => zoomBy(1.5) },
    { combo: '-', description: 'Zoom timeline out', group: 'Timeline', handler: () => zoomBy(1 / 1.5) },
    { combo: 'shift+f', description: 'Fit whole match in timeline', group: 'Timeline', hidden: true, handler: () => setZoom(1) },
  ])

  // Playhead moves outside React; when zoomed in, the strip follows it while playing.
  useEffect(() => {
    const place = (t: number) => { if (headRef.current) headRef.current.style.transform = `translateX(${xOf(t)}px)` }
    place(usePlayback.getState().time)
    return usePlayback.subscribe((s, prev) => {
      if (s.time === prev.time) return
      place(s.time)
      const el = scrollRef.current
      if (el && s.playing && trackW > boxW) {
        const x = xOf(s.time)
        if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = x - 60
      }
    })
  }, [xOf, trackW, boxW, duration])

  // Ticks ───────────────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    if (pps <= 0) return []
    const step = STEPS.find((s) => s * pps >= 80) ?? STEPS[STEPS.length - 1]!
    const out: { t: number; major: boolean }[] = []
    for (let t = 0; t <= duration + 1e-6; t += step) out.push({ t, major: true })
    const minor = step / (step >= 60 ? 4 : step >= 10 ? 5 : 2)
    for (let t = 0; t <= duration + 1e-6; t += minor) if (Math.abs(t / step - Math.round(t / step)) > 1e-6) out.push({ t, major: false })
    return out
  }, [pps, duration])

  // Clip markers, packed into rows so overlapping clips do not hide each other ─
  const markers = useMemo(() => {
    const rows: number[] = []
    return [...clips]
      .filter((c) => visibleIds.has(c.id))
      .sort((a, b) => a.startSec - b.startSec)
      .map((clip) => {
        let row = rows.findIndex((end) => end <= clip.startSec)
        if (row === -1) row = Math.min(rows.length, MAX_ROWS - 1)
        rows[row] = Math.max(rows[row] ?? 0, clip.endSec)
        return { clip, row, color: categoryOfTag.get(clip.tagTypeId)?.color ?? '#94a3b8' }
      })
  }, [clips, visibleIds, categoryOfTag])
  const rowCount = Math.max(1, Math.min(MAX_ROWS, markers.reduce((m, x) => Math.max(m, x.row + 1), 1)))
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  // Seek by pointer ─────────────────────────────────────────────────────────
  const seekAt = (e: { clientX: number }) => {
    const r = scrollRef.current!.getBoundingClientRect()
    const x = e.clientX - r.left + scrollRef.current!.scrollLeft
    player.seek(clamp((x - PAD_L) / Math.max(pps, 1e-6), 0, duration))
  }
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || duration === 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbing.current = true
    seekAt(e)
  }
  const onMove = (e: React.PointerEvent) => { if (scrubbing.current) seekAt(e) }
  const onUp = () => { scrubbing.current = false }

  const onMarkerDown = (e: React.PointerEvent, id: string, start: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (e.metaKey || e.ctrlKey || e.shiftKey) useClips.getState().toggle(id)
    else useClips.getState().select([id])
    player.skip(0)
    player.seek(start)
  }

  const contentH = RULER_H + 6 + TRACK_H + 8 + rowCount * ROW_H + 8
  const cells = Math.max(1, Math.ceil(trackW / ((TRACK_H * 16) / 9)))

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-[26px] shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="label mr-1">Timeline</span>
        <Tip label="Uzaklaş" hotkey="-" side="top"><Button variant="ghost" size="icon-sm" aria-label="Zaman çizelgesini uzaklaştır" onClick={() => zoomBy(1 / 1.5)}><ZoomOut className="h-3.5 w-3.5" /></Button></Tip>
        <Tip label="Yakınlaş" hotkey="=" side="top"><Button variant="ghost" size="icon-sm" aria-label="Zaman çizelgesini yakınlaştır" onClick={() => zoomBy(1.5)}><ZoomIn className="h-3.5 w-3.5" /></Button></Tip>
        <Tip label="Tüm maçı sığdır" side="top"><Button variant="ghost" size="icon-sm" aria-label="Tüm maçı sığdır" onClick={() => setZoom(1)}><Maximize2 className="h-3.5 w-3.5" /></Button></Tip>
        <span className="timecode ml-auto text-2xs text-muted">{visibleIds.size}/{clips.length} clips</span>
      </div>

      <div ref={scrollRef} tabIndex={0} role="region" aria-label="Timeline" className="relative min-h-0 flex-1 overflow-auto">
        {duration === 0 ? (
          <p className="p-4 text-xs text-muted">Waiting for video metadata…</p>
        ) : (
          <div className="relative touch-none select-none" style={{ width: PAD_L + trackW + PAD_R, height: contentH, minHeight: '100%' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} data-testid="timeline-canvas">
            {/* ruler */}
            <div className="absolute left-0 right-0 top-0 border-b border-border/60" style={{ height: RULER_H }}>
              {ticks.map(({ t, major }) => (
                <div key={`${major}-${t}`} className="absolute bottom-0" style={{ left: xOf(t) }}>
                  <div className={cn('w-px', major ? 'h-2.5 bg-muted/70' : 'h-1.5 bg-border')} />
                  {major && <span className="timecode absolute bottom-2.5 left-1 whitespace-nowrap text-2xs text-muted">{formatClock(t)}</span>}
                </div>
              ))}
            </div>

            {/* the match video as one track */}
            <div className="absolute overflow-hidden rounded-md border-2 border-accent/70 bg-raised" style={{ left: PAD_L, width: trackW, top: RULER_H + 6, height: TRACK_H }}>
              <div className="flex h-full" aria-hidden>
                {Array.from({ length: cells }, (_, i) => (
                  <div key={i} className="h-full shrink-0" style={{ width: trackW / cells, backgroundImage: `url(${video.filmstripUrl})`, backgroundSize: `${STRIP_FRAMES * 100}% 100%`, backgroundPosition: `${(Math.min(STRIP_FRAMES - 1, Math.floor(((i + 0.5) / cells) * STRIP_FRAMES)) / (STRIP_FRAMES - 1)) * 100}% 0` }} />
                ))}
              </div>
              <div className="pointer-events-none absolute left-0 top-0 flex max-w-full items-center gap-2 bg-black/55 px-1.5 py-0.5 text-2xs text-white">
                <span className="truncate">{video.title}</span>
                <span className="timecode shrink-0 rounded bg-accent/80 px-1 text-accent-foreground">{formatTimecode(duration, fps).slice(0, 8)}</span>
              </div>
            </div>

            {/* tagged clips */}
            <div className="absolute" style={{ left: 0, right: 0, top: RULER_H + 6 + TRACK_H + 8 }}>
              {markers.map(({ clip, row, color }) => {
                const tag = tagById.get(clip.tagTypeId)
                const who = clip.playerId ? playerById.get(clip.playerId)?.name : null
                return (
                  <button
                    key={clip.id}
                    type="button"
                    tabIndex={-1}
                    aria-label={`${tag?.name ?? 'Clip'} ${formatClock(clip.timeSec)}`}
                    title={`${tag?.name ?? 'Clip'} · ${formatClock(clip.timeSec)}${who ? ` · ${who}` : ''}${clip.notes ? ` — ${clip.notes}` : ''}`}
                    onPointerDown={(e) => onMarkerDown(e, clip.id, clip.startSec)}
                    data-clip-marker={clip.id}
                    className={cn('absolute rounded-sm', selected.has(clip.id) && 'ring-2 ring-foreground')}
                    style={{ left: xOf(clip.startSec), top: row * ROW_H, width: Math.max(5, (clip.endSec - clip.startSec) * pps), height: ROW_H - 3, background: color }}
                  />
                )
              })}
            </div>

            {/* playhead */}
            <div ref={headRef} className="pointer-events-none absolute left-0 top-0 z-10 h-full will-change-transform" data-testid="playhead">
              <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
              <div className="absolute bottom-0 left-0 top-0 w-px bg-accent shadow-[0_0_0_0.5px_hsl(var(--accent)/0.4)]" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
