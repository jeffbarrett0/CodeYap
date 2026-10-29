import { Crosshair, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useHotkeys } from '@/lib/hotkeys'
import { formatClock, formatTimecode } from '@/lib/timecode'
import { clamp, cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { Clip } from '@/types'
import { patchClips, previewClip, useClips } from './clips'
import { player, usePlayback } from './playback'

const GUTTER = 104
const HEADER_H = 26
const RULER_H = 20
const DENSITY_H = 38
const OVERVIEW_H = 22
const PAD = 4
const LANE_GAP = 3
const EDGE = 5
const MIN_CLIP = 0.5
const MIN_SPAN = 2
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

interface View {
  t0: number
  t1: number
}
interface Item {
  clip: Clip
  lane: number
  color: string
}
type Hit = { item: Item; part: 'start' | 'end' | 'body' }

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const themed = (name: string, alpha?: number) => `hsl(${cssVar(name)}${alpha !== undefined ? ` / ${alpha}` : ''})`

export function Timeline({ visibleIds, canEdit }: { visibleIds: Set<string>; canEdit: boolean }) {
  const clips = useClips((s) => s.clips)
  const selectedIds = useClips((s) => s.selectedIds)
  const activeId = useClips((s) => s.activeId)
  const duration = usePlayback((s) => s.duration)
  const fps = usePlayback((s) => s.fps)
  const theme = useApp((s) => s.theme)
  const categories = useData((s) => s.categories)
  const { categoryOfTag, tagById, playerById } = useLookups()

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const miniHeadRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ t0: 0, t1: 1 })
  const [follow, setFollow] = useState(true)
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const followRef = useRef(follow)
  followRef.current = follow

  const laneCount = Math.max(1, categories.length)
  const laneH = clamp(Math.floor((size.h - HEADER_H - RULER_H - DENSITY_H - OVERVIEW_H - PAD * 4) / laneCount) - LANE_GAP, 12, 26)
  const lanesTop = RULER_H + DENSITY_H + PAD
  const lanesBottom = lanesTop + laneCount * (laneH + LANE_GAP)
  const overviewTop = lanesBottom + PAD
  const contentH = overviewTop + OVERVIEW_H + PAD
  const W = Math.max(0, size.w - GUTTER)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const items = useMemo<Item[]>(() => {
    const laneOf = new Map(categories.map((c, i) => [c.id, i]))
    return clips.map((clip) => {
      const cat = categoryOfTag.get(clip.tagTypeId)
      return { clip, lane: cat ? (laneOf.get(cat.id) ?? 0) : 0, color: cat?.color ?? '#94a3b8' }
    })
  }, [clips, categories, categoryOfTag])

  // View helpers ────────────────────────────────────────────────────────────
  const span = view.t1 - view.t0
  const xOf = useCallback((t: number, v = viewRef.current) => GUTTER + ((t - v.t0) / (v.t1 - v.t0)) * W, [W])
  const tOf = useCallback((x: number, v = viewRef.current) => v.t0 + ((x - GUTTER) / W) * (v.t1 - v.t0), [W])
  const clampView = useCallback((v: View): View => {
    const d = Math.max(duration, MIN_SPAN)
    const sp = clamp(v.t1 - v.t0, MIN_SPAN, d)
    const t0 = clamp(v.t0, 0, d - sp)
    return { t0, t1: t0 + sp }
  }, [duration])
  const zoomBy = useCallback((factor: number, anchor?: number) => {
    const v = viewRef.current
    const a = anchor ?? player.currentTime
    const sp = clamp((v.t1 - v.t0) / factor, MIN_SPAN, Math.max(duration, MIN_SPAN))
    const rel = (a - v.t0) / (v.t1 - v.t0)
    setView(clampView({ t0: a - rel * sp, t1: a - rel * sp + sp }))
  }, [clampView, duration])
  const fit = useCallback(() => setView({ t0: 0, t1: Math.max(duration, MIN_SPAN) }), [duration])

  useEffect(() => { if (duration > 0) fit() }, [duration, fit])

  useLayoutEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useHotkeys([
    { combo: '=', description: 'Zoom timeline in', group: 'Timeline', handler: () => zoomBy(1.5) },
    { combo: '+', description: 'Zoom timeline in', group: 'Timeline', hidden: true, handler: () => zoomBy(1.5) },
    { combo: '-', description: 'Zoom timeline out', group: 'Timeline', handler: () => zoomBy(1 / 1.5) },
    { combo: 'shift+f', description: 'Fit whole match in timeline', group: 'Timeline', hidden: true, handler: fit },
  ])

  // Playhead (DOM, updated outside React) + auto-follow ─────────────────────
  const placeHeads = useCallback((t: number) => {
    const v = viewRef.current
    const head = headRef.current
    if (head) {
      const x = xOf(t, v)
      head.style.transform = `translateX(${x}px)`
      head.style.opacity = t < v.t0 - 1e-6 || t > v.t1 + 1e-6 ? '0' : '1'
    }
    const mini = miniHeadRef.current
    if (mini && duration > 0) mini.style.transform = `translateX(${GUTTER + (t / duration) * W}px)`
  }, [xOf, duration, W])

  useEffect(() => {
    placeHeads(usePlayback.getState().time)
    return usePlayback.subscribe((s, prev) => {
      if (s.time === prev.time) return
      const v = viewRef.current
      const sp = v.t1 - v.t0
      if (followRef.current && s.playing && sp < duration - 0.5 && (s.time > v.t1 - sp * 0.04 || s.time < v.t0)) {
        setView(clampView({ t0: s.time - sp * 0.08, t1: s.time - sp * 0.08 + sp }))
      }
      placeHeads(s.time)
    })
  }, [placeHeads, view, duration, clampView])

  // Drawing ─────────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0 || duration === 0) return
    const dpr = window.devicePixelRatio || 1
    const cw = size.w
    const ch = Math.max(contentH, size.h - HEADER_H)
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)

    const border = themed('--border')
    const muted = themed('--muted')
    const fg = themed('--foreground')
    const accent = themed('--accent')
    const raised = themed('--raised')
    const v = view

    // lane backgrounds + gutter labels
    ctx.font = '600 10px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    categories.forEach((cat, i) => {
      const y = lanesTop + i * (laneH + LANE_GAP)
      ctx.fillStyle = raised
      ctx.globalAlpha = 0.45
      ctx.fillRect(GUTTER, y, W, laneH)
      ctx.globalAlpha = 1
      ctx.fillStyle = cat.color
      ctx.beginPath()
      ctx.arc(10, y + laneH / 2, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = muted
      ctx.fillText(cat.name, 20, y + laneH / 2 + 0.5, GUTTER - 26)
    })

    // ruler
    const step = STEPS.find((s) => (s / (v.t1 - v.t0)) * W >= 84) ?? STEPS[STEPS.length - 1]!
    ctx.strokeStyle = border
    ctx.fillStyle = muted
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'
    ctx.textBaseline = 'alphabetic'
    ctx.beginPath()
    for (let t = Math.ceil(v.t0 / step) * step; t <= v.t1; t += step) {
      const x = Math.round(xOf(t, v)) + 0.5
      ctx.moveTo(x, RULER_H - 6)
      ctx.lineTo(x, RULER_H)
      ctx.fillText(formatClock(t), x + 3, RULER_H - 8)
    }
    ctx.moveTo(GUTTER, RULER_H - 0.5)
    ctx.lineTo(cw, RULER_H - 0.5)
    ctx.stroke()

    // density "waveform": stacked per-category counts, mirrored around the centre line
    const binPx = 3
    const bins = Math.max(1, Math.floor(W / binPx))
    const counts: number[][] = Array.from({ length: bins }, () => new Array(categories.length).fill(0))
    const catIndex = new Map(categories.map((c, i) => [c.id, i]))
    for (const it of items) {
      if (!visibleIds.has(it.clip.id)) continue
      const b = Math.floor(((it.clip.timeSec - v.t0) / (v.t1 - v.t0)) * bins)
      if (b < 0 || b >= bins) continue
      const ci = catIndex.get(categoryOfTag.get(it.clip.tagTypeId)?.id ?? '') ?? 0
      counts[b]![ci]!++
    }
    const maxTotal = Math.max(1, ...counts.map((c) => c.reduce((a, b) => a + b, 0)))
    const mid = RULER_H + DENSITY_H / 2
    ctx.fillStyle = border
    ctx.fillRect(GUTTER, mid, W, 1)
    counts.forEach((c, b) => {
      const total = c.reduce((a, n) => a + n, 0)
      if (!total) return
      const half = Math.max(2, (Math.sqrt(total / maxTotal) * (DENSITY_H - 6)) / 2)
      let y = mid - half
      c.forEach((n, ci) => {
        if (!n) return
        const hh = (n / total) * half * 2
        ctx.fillStyle = categories[ci]!.color
        ctx.fillRect(GUTTER + b * binPx, y, binPx - 1, hh)
        y += hh
      })
    })

    // clips
    const visibleItems = items.filter((it) => it.clip.endSec >= v.t0 && it.clip.startSec <= v.t1)
    for (const it of visibleItems) {
      const { clip, lane, color } = it
      const y = lanesTop + lane * (laneH + LANE_GAP)
      const x0 = Math.max(GUTTER, xOf(clip.startSec, v))
      const x1 = Math.min(cw, xOf(clip.endSec, v))
      const w = Math.max(3, x1 - x0)
      const match = visibleIds.has(clip.id)
      const sel = selected.has(clip.id)
      ctx.fillStyle = hexA(color, !match ? 0.1 : sel ? 0.9 : 0.42)
      ctx.fillRect(x0, y, w, laneH)
      if (match) {
        ctx.fillStyle = color
        ctx.fillRect(x0, y, 2, laneH)
        const tx = xOf(clip.timeSec, v)
        if (tx >= x0 && tx <= x0 + w) {
          ctx.fillStyle = sel ? '#fff' : hexA('#ffffff', 0.75)
          ctx.fillRect(Math.round(tx), y + 2, 1, laneH - 4)
        }
      }
      if (sel) {
        ctx.strokeStyle = clip.id === activeId ? '#fff' : hexA('#ffffff', 0.7)
        ctx.lineWidth = 1.5
        ctx.strokeRect(x0 + 0.75, y + 0.75, w - 1.5, laneH - 1.5)
        ctx.lineWidth = 1
        ctx.fillStyle = '#fff'
        ctx.fillRect(x0, y + 2, 3, laneH - 4)
        ctx.fillRect(x0 + w - 3, y + 2, 3, laneH - 4)
      }
    }

    // overview (whole match) ───────────────────────────────────────────────
    ctx.fillStyle = raised
    ctx.globalAlpha = 0.55
    ctx.fillRect(GUTTER, overviewTop, W, OVERVIEW_H)
    ctx.globalAlpha = 1
    ctx.fillStyle = muted
    ctx.font = '600 10px Inter, system-ui, sans-serif'
    ctx.fillText('Overview', 8, overviewTop + OVERVIEW_H / 2 + 4)
    const obins = Math.max(1, Math.floor(W / 2))
    const ocounts = new Array(obins).fill(0)
    for (const it of items) if (visibleIds.has(it.clip.id)) ocounts[clamp(Math.floor((it.clip.timeSec / duration) * obins), 0, obins - 1)]++
    const omax = Math.max(1, ...ocounts)
    ocounts.forEach((n, b) => {
      if (!n) return
      const hh = Math.max(2, (n / omax) * (OVERVIEW_H - 6))
      ctx.fillStyle = hexA('#ffffff', 0.35)
      ctx.fillRect(GUTTER + b * 2, overviewTop + OVERVIEW_H - 3 - hh, 1.5, hh)
    })
    const wx0 = GUTTER + (v.t0 / duration) * W
    const wx1 = GUTTER + (v.t1 / duration) * W
    ctx.fillStyle = themed('--accent', 0.14)
    ctx.fillRect(wx0, overviewTop, Math.max(3, wx1 - wx0), OVERVIEW_H)
    ctx.strokeStyle = accent
    ctx.strokeRect(wx0 + 0.5, overviewTop + 0.5, Math.max(3, wx1 - wx0) - 1, OVERVIEW_H - 1)
    ctx.fillStyle = fg
  }, [size, view, items, selected, activeId, visibleIds, categories, categoryOfTag, duration, theme, W, laneH, lanesTop, overviewTop, contentH, xOf])

  // Pointer interaction ─────────────────────────────────────────────────────
  const drag = useRef<
    | { mode: 'scrub' }
    | { mode: 'overview'; offset: number }
    | { mode: 'resize'; id: string; edge: 'start' | 'end'; orig: Clip; next: Partial<Clip> }
    | null
  >(null)

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const hitTest = (x: number, y: number): Hit | null => {
    if (y < lanesTop || y >= lanesBottom) return null
    const lane = Math.floor((y - lanesTop) / (laneH + LANE_GAP))
    let best: Hit | null = null
    for (const it of items) {
      if (it.lane !== lane || !visibleIds.has(it.clip.id)) continue
      const x0 = xOf(it.clip.startSec)
      const x1 = Math.max(x0 + 3, xOf(it.clip.endSec))
      if (x < x0 - EDGE || x > x1 + EDGE) continue
      const wide = x1 - x0 > 14 || selected.has(it.clip.id)
      const part = wide && canEdit && Math.abs(x - x0) <= EDGE ? 'start' : wide && canEdit && Math.abs(x - x1) <= EDGE ? 'end' : x >= x0 && x <= x1 ? 'body' : null
      if (!part) continue
      // prefer edges of selected clips, then the latest-drawn clip
      if (!best || part !== 'body' || best.part === 'body') best = { item: it, part }
    }
    return best
  }

  const quantize = (t: number) => Math.round(t * fps) / fps
  const seekToX = (x: number) => player.seek(clamp(tOf(clamp(x, GUTTER, GUTTER + W)), 0, duration))
  const centerViewOn = (t: number) => {
    const sp = viewRef.current.t1 - viewRef.current.t0
    setView(clampView({ t0: t - sp / 2, t1: t + sp / 2 }))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || duration === 0) return
    const { x, y } = localPoint(e)
    if (x < GUTTER && y < overviewTop) return
    e.currentTarget.setPointerCapture(e.pointerId)

    if (y >= overviewTop) {
      const t = clamp(((x - GUTTER) / W) * duration, 0, duration)
      const v = viewRef.current
      const inside = t >= v.t0 && t <= v.t1
      drag.current = { mode: 'overview', offset: inside ? t - (v.t0 + v.t1) / 2 : 0 }
      centerViewOn(t - (inside ? drag.current.offset : 0))
      return
    }
    if (y >= lanesTop) {
      const hit = hitTest(x, y)
      if (hit) {
        const { clip } = hit.item
        if (hit.part === 'body') {
          const multi = e.metaKey || e.ctrlKey || e.shiftKey
          if (multi) useClips.getState().toggle(clip.id)
          else useClips.getState().select([clip.id])
          player.skip(0)
          player.seek(clip.startSec)
        } else {
          if (!selected.has(clip.id)) useClips.getState().select([clip.id])
          drag.current = { mode: 'resize', id: clip.id, edge: hit.part, orig: clip, next: {} }
        }
        return
      }
      if (!(e.metaKey || e.ctrlKey || e.shiftKey)) useClips.getState().select([])
    }
    drag.current = { mode: 'scrub' }
    seekToX(x)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localPoint(e)
    const d = drag.current
    if (d) {
      if (d.mode === 'scrub') seekToX(x)
      else if (d.mode === 'overview') centerViewOn(clamp(((x - GUTTER) / W) * duration, 0, duration) - d.offset)
      else {
        const t = quantize(clamp(tOf(x), 0, duration))
        const o = d.orig
        const next: Partial<Clip> = d.edge === 'start' ? { startSec: Math.min(t, o.endSec - MIN_CLIP) } : { endSec: Math.max(t, o.startSec + MIN_CLIP) }
        d.next = next
        previewClip(d.id, next)
      }
      return
    }
    const hit = hitTest(x, y)
    const canvas = canvasRef.current!
    canvas.style.cursor = hit ? (hit.part === 'body' ? 'pointer' : 'ew-resize') : y >= overviewTop ? 'grab' : 'col-resize'
    setHover(hit ? { item: hit.item, x, y } : null)
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'resize' && Object.keys(d.next).length) {
      // One undo step for the whole drag: restore, then apply through the history-aware path.
      const o = d.orig
      previewClip(d.id, { startSec: o.startSec, endSec: o.endSec })
      void patchClips([{ id: d.id, patch: d.next }], 'Adjust clip range')
    }
  }

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x } = localPoint(e)
      if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, tOf(clamp(x, GUTTER, GUTTER + W)))
      else {
        const dt = ((e.deltaX || e.deltaY) / Math.max(W, 1)) * (viewRef.current.t1 - viewRef.current.t0)
        setView((v) => clampView({ t0: v.t0 + dt, t1: v.t1 + dt }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const hoverTag = hover ? tagById.get(hover.item.clip.tagTypeId) : null
  const hoverPlayer = hover?.item.clip.playerId ? playerById.get(hover.item.clip.playerId) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2" style={{ height: HEADER_H }}>
        <span className="label mr-1">Timeline</span>
        <Tip label="Zoom out" hotkey="-" side="top"><Button variant="ghost" size="icon-sm" aria-label="Zoom timeline out" onClick={() => zoomBy(1 / 1.5)}><ZoomOut className="h-3.5 w-3.5" /></Button></Tip>
        <Tip label="Zoom in" hotkey="=" side="top"><Button variant="ghost" size="icon-sm" aria-label="Zoom timeline in" onClick={() => zoomBy(1.5)}><ZoomIn className="h-3.5 w-3.5" /></Button></Tip>
        <Tip label="Fit whole match" side="top"><Button variant="ghost" size="icon-sm" aria-label="Fit whole match" onClick={fit}><Maximize2 className="h-3.5 w-3.5" /></Button></Tip>
        <Tip label="Keep the playhead in view while playing" side="top">
          <Button variant={follow ? 'secondary' : 'ghost'} size="xs" aria-pressed={follow} onClick={() => setFollow((f) => !f)} className="ml-1 gap-1">
            <Crosshair className="h-3 w-3" /> Follow
          </Button>
        </Tip>
        <span className="timecode ml-auto text-2xs text-muted">
          {formatTimecode(view.t0, fps)} – {formatTimecode(view.t1, fps)} <span className="ml-1">({span >= duration - 0.01 ? 'full' : `${Math.round(span)}s`})</span>
        </span>
        <span className="timecode ml-3 text-2xs text-muted">{visibleIds.size}/{clips.length} clips</span>
      </div>

      <div ref={wrapRef} tabIndex={0} role="region" aria-label="Timeline lanes" className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {duration === 0 ? (
          <p className="p-4 text-xs text-muted">Waiting for video metadata…</p>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Timeline with ${clips.length} tagged clips`}
              className="block touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setHover(null)}
              data-testid="timeline-canvas"
            />
            {/* playhead: spans ruler → lanes */}
            <div ref={headRef} className="pointer-events-none absolute left-0 top-0 z-10 will-change-transform" style={{ height: overviewTop - 2 }} data-testid="playhead">
              <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
              <div className="absolute bottom-0 left-0 top-0 w-px bg-accent shadow-[0_0_0_0.5px_hsl(var(--accent)/0.4)]" />
            </div>
            <div ref={miniHeadRef} className="pointer-events-none absolute left-0 z-10 w-px bg-foreground will-change-transform" style={{ top: overviewTop + 2, height: OVERVIEW_H - 4 }} />
          </>
        )}
        {hover && (
          <div
            className={cn('pointer-events-none absolute z-20 max-w-xs rounded border border-border bg-raised px-2 py-1 text-xs shadow-lg')}
            style={{ left: clamp(hover.x + 12, 4, Math.max(4, size.w - 220)), top: hover.y + 14 }}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ background: hover.item.color }} />
              {hoverTag?.name}
              <span className="timecode font-normal text-muted">{formatTimecode(hover.item.clip.timeSec, fps)}</span>
            </div>
            {(hoverPlayer || hover.item.clip.notes) && <div className="text-muted">{hoverPlayer?.name}{hoverPlayer && hover.item.clip.notes ? ' — ' : ''}{hover.item.clip.notes}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
