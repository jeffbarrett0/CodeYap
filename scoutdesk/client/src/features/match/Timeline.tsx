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
import { drawingLabel, useDrawing, type Shape } from './drawing'
import { player, usePlayback } from './playback'

const PAD_L = 16
const PAD_R = 24
const RULER_H = 22
const TRACK_H = 36
const TICK_H = 14
const DRAW_HEAD = 22 // title row of the drawings section
const DRAW_ROW = 24
const DRAW_GAP = 4
const EDGE = 7 // grab zone on a drawing's right edge (px)
const MAX_WIDTH = 8000
const STRIP_FRAMES = 24
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/**
 * Simple timeline: a time ruler, the match video as one filmstrip track, and the tagged events as thin ticks
 * underneath. Only three tones are used: neutral grey (events), the accent (goals and the selected event) and
 * the playhead. Click or drag anywhere to jump to that moment; click a tick to open that clip.
 *
 * Below the video sits the "Çizimler" section: every drawing is its own row and block. Click a block to select it
 * (the player jumps there), drag it to move it in time, drag its right edge to change how long it stays.
 */
export function Timeline({ video, visibleIds }: { video: Video; visibleIds: Set<string>; canEdit?: boolean }) {
  const clips = useClips((s) => s.clips)
  const selectedIds = useClips((s) => s.selectedIds)
  const duration = usePlayback((s) => s.duration)
  const fps = usePlayback((s) => s.fps)
  const { tagById, playerById } = useLookups()

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

  // Event ticks: one lane, sorted by time (hovering a tick tells what it is).
  const markers = useMemo(() => [...clips].filter((c) => visibleIds.has(c.id)).sort((a, b) => a.timeSec - b.timeSec), [clips, visibleIds])
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

  // Drawings ────────────────────────────────────────────────────────────────
  const drawings = useDrawing((s) => s.shapes)
  const selectedDrawing = useDrawing((s) => s.selectedId)
  const rows = useMemo(() => [...drawings].sort((a, b) => a.frame - b.frame), [drawings])
  const span = (d: Shape) => ({ start: d.frame / fps, dur: d.hold > 0 ? d.hold : 1 / fps }) // "only that frame" = one frame wide
  const dragRef = useRef<{ kind: 'move' | 'edge'; id: string; x: number; frame: number; hold: number } | null>(null)

  const drawingDown = (e: React.PointerEvent, d: Shape, kind: 'move' | 'edge') => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const st = useDrawing.getState()
    st.select(d.id)
    player.pause()
    if (kind === 'move') player.seek((d.frame + 0.5) / fps)
    dragRef.current = { kind, id: d.id, x: e.clientX, frame: d.frame, hold: d.hold }
  }
  const drawingMove = (e: React.PointerEvent) => {
    const g = dragRef.current
    if (!g || pps <= 0) return
    const dt = (e.clientX - g.x) / pps
    if (g.kind === 'move') {
      const frame = Math.max(0, Math.min(Math.floor(duration * fps) - 1, g.frame + Math.round(dt * fps)))
      useDrawing.getState().update(g.id, { frame })
      player.seek((frame + 0.5) / fps)
    } else {
      // Right edge: the duration follows the mouse in 0.1 s steps; very short = "only that frame".
      const base = g.hold > 0 ? g.hold : 1 / fps
      const hold = Math.round((base + dt) * 10) / 10
      useDrawing.getState().update(g.id, { hold: hold < 0.25 ? 0 : Math.min(120, hold) })
    }
  }
  const drawingUp = () => { dragRef.current = null }
  const picked = rows.find((d) => d.id === selectedDrawing)
  const pickedText = picked
    ? `Seçili: ${drawingLabel(picked)} · ${formatTimecode(span(picked).start, fps)} → ${formatTimecode(span(picked).start + span(picked).dur, fps)} (${picked.hold > 0 ? `${picked.hold} sn` : 'tek kare'})`
    : 'Bir çizimi seç; taşı ya da sağ kenarından süresini uzat.'
  const drawTop = RULER_H + 6 + TRACK_H + 6
  const tickTop = drawTop + DRAW_HEAD + Math.max(1, rows.length) * (DRAW_ROW + DRAW_GAP) + 6
  const contentH = tickTop + TICK_H + 10
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
            <div className="absolute overflow-hidden rounded-md border border-border bg-raised" style={{ left: PAD_L, width: trackW, top: RULER_H + 6, height: TRACK_H }}>
              <div className="flex h-full" aria-hidden>
                {Array.from({ length: cells }, (_, i) => (
                  <div key={i} className="h-full shrink-0" style={{ width: trackW / cells, backgroundImage: `url(${video.filmstripUrl})`, backgroundSize: `${STRIP_FRAMES * 100}% 100%`, backgroundPosition: `${(Math.min(STRIP_FRAMES - 1, Math.floor(((i + 0.5) / cells) * STRIP_FRAMES)) / (STRIP_FRAMES - 1)) * 100}% 0` }} />
                ))}
              </div>
              <div className="pointer-events-none absolute left-0 top-0 flex max-w-full items-center gap-2 bg-black/55 px-1.5 py-0.5 text-2xs text-white">
                <span className="truncate">{video.title}</span>
                <span className="timecode shrink-0 rounded bg-white/20 px-1">{formatTimecode(duration, fps).slice(0, 8)}</span>
              </div>
            </div>

            {/* tagged events: thin ticks, goals and the selected one in the accent colour */}
            <div className="absolute" style={{ left: 0, right: 0, top: tickTop }}>
              {markers.map((clip) => {
                const tag = tagById.get(clip.tagTypeId)
                const who = clip.playerId ? playerById.get(clip.playerId)?.name : null
                const hot = selected.has(clip.id) || tag?.name === 'Goal'
                return (
                  <button
                    key={clip.id}
                    type="button"
                    tabIndex={-1}
                    aria-label={`${tag?.name ?? 'Clip'} ${formatClock(clip.timeSec)}`}
                    title={`${tag?.name ?? 'Clip'} · ${formatClock(clip.timeSec)}${who ? ` · ${who}` : ''}${clip.notes ? ` — ${clip.notes}` : ''}`}
                    onPointerDown={(e) => onMarkerDown(e, clip.id, clip.startSec)}
                    data-clip-marker={clip.id}
                    className={cn('absolute top-0 w-[3px] rounded-full', hot ? 'bg-accent' : 'bg-foreground/35 hover:bg-foreground/70', selected.has(clip.id) && 'ring-1 ring-accent ring-offset-1 ring-offset-surface')}
                    style={{ left: xOf(clip.timeSec) - 1.5, height: TICK_H }}
                  />
                )
              })}
            </div>

            {/* drawings: one row per drawing */}
            <div className="absolute" style={{ left: 0, right: 0, top: drawTop }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="sticky left-0 flex items-center gap-2 whitespace-nowrap px-2 text-2xs" style={{ height: DRAW_HEAD, width: 'max-content', maxWidth: boxW }}>
                <span className="label">Çizimler</span>
                <span className="timecode rounded bg-raised px-1.5">{rows.length}</span>
                <span className="truncate text-muted" aria-live="polite" data-testid="drawing-status">{pickedText}</span>
              </div>
              {rows.length === 0 && <p className="sticky left-0 px-2 py-1 text-2xs text-muted" style={{ width: boxW }}>Henüz çizim yok. Videoya bir şey çizince burada satır olarak görünür.</p>}
              {rows.map((d, i) => {
                const { start, dur } = span(d)
                const left = xOf(start)
                const width = Math.max(12, dur * pps)
                const sel = d.id === selectedDrawing
                const wide = width > 90
                return (
                  <div key={d.id} className="absolute" style={{ top: DRAW_HEAD + i * (DRAW_ROW + DRAW_GAP), left, height: DRAW_ROW }} data-drawing-row={d.id}>
                    <div
                      role="button"
                      tabIndex={-1}
                      aria-label={`${drawingLabel(d)} ${formatTimecode(start, fps)}`}
                      aria-pressed={sel}
                      title={`${drawingLabel(d)} · ${formatTimecode(start, fps)} · ${d.hold > 0 ? `${d.hold} sn` : 'tek kare'} — sürükle: taşı, sağ kenar: süreyi değiştir`}
                      onPointerDown={(e) => drawingDown(e, d, 'move')}
                      onPointerMove={drawingMove}
                      onPointerUp={drawingUp}
                      data-drawing-block={d.id}
                      className={cn('relative flex h-full cursor-grab items-center overflow-hidden rounded border text-2xs active:cursor-grabbing', sel ? 'border-accent bg-accent/25 text-foreground' : 'border-border bg-raised text-foreground/80 hover:border-foreground/40')}
                      style={{ width }}
                    >
                      <span className="h-full w-1 shrink-0" style={{ background: d.color }} aria-hidden />
                      {wide && <span className="truncate px-1.5">{drawingLabel(d)}</span>}
                      <span
                        onPointerDown={(e) => drawingDown(e, d, 'edge')}
                        onPointerMove={drawingMove}
                        onPointerUp={drawingUp}
                        data-drawing-edge={d.id}
                        className="absolute right-0 top-0 h-full cursor-ew-resize bg-foreground/10 hover:bg-accent/60"
                        style={{ width: Math.min(EDGE, Math.max(3, width / 3)) }}
                        aria-hidden
                      />
                    </div>
                    {!wide && <span className="pointer-events-none absolute top-0 flex h-full items-center whitespace-nowrap pl-1 text-2xs text-muted" style={{ left: width }}>{drawingLabel(d)}</span>}
                  </div>
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
