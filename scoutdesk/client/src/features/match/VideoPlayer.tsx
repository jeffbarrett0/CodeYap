import { AlertTriangle, Circle, Eraser, Minus, MoveUpRight, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { Tip } from '@/components/ui/tooltip'
import { frameAt, formatTimecode } from '@/lib/timecode'
import { clamp, cn } from '@/lib/utils'
import { useData } from '@/store/data'
import type { Video } from '@/types'
import { DrawingLayer } from './DrawingLayer'
import { PlayerControls } from './PlayerControls'
import { DRAW_COLORS, useDrawing, type DrawTool } from './drawing'
import { player, usePlayback } from './playback'
import { captureSnapshot, downloadBlob } from './snapshot'

interface Zoom {
  s: number
  x: number
  y: number
}
const MIN_ZOOM = 1
const MAX_ZOOM = 8

export function VideoPlayer({ video }: { video: Video }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [native, setNative] = useState({ w: video.width || 1280, h: video.height || 720 })
  const [zoom, setZoom] = useState<Zoom>({ s: 1, x: 0, y: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const error = usePlayback((s) => s.error)
  const ready = usePlayback((s) => s.ready)
  const clipRange = usePlayback((s) => s.clipRange)
  const drawing = useDrawing((s) => s.active)
  const retried = useRef(false)

  // Controller wiring ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = videoRef.current!
    player.attach(el)
    const st = usePlayback.getState()
    el.volume = st.volume
    el.muted = st.muted
    el.playbackRate = st.rate
    usePlayback.setState({ fps: video.fps > 0 ? video.fps : 25, duration: video.durationSec, error: null })
    return () => player.detach()
  }, [video.id, video.fps, video.durationSec])

  // Fit the video's aspect inside the stage ─────────────────────────────────
  useEffect(() => {
    const el = stageRef.current!
    const ro = new ResizeObserver(([e]) => setStage({ w: e!.contentRect.width, h: e!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = native.w / native.h
  const fit = stage.w / stage.h > aspect ? { w: stage.h * aspect, h: stage.h } : { w: stage.w, h: stage.w / aspect }

  // Zoom around a stage point, keeping that point fixed under the cursor ────
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setZoom((z) => {
      const s = clamp(z.s * factor, MIN_ZOOM, MAX_ZOOM)
      if (s === MIN_ZOOM) return { s, x: 0, y: 0 }
      const mx = (cx ?? stage.w / 2) - stage.w / 2
      const my = (cy ?? stage.h / 2) - stage.h / 2
      return { s, x: mx - (s * (mx - z.x)) / z.s, y: my - (s * (my - z.y)) / z.s }
    })
  }, [stage.w, stage.h])

  useEffect(() => {
    const el = stageRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Drag-to-pan (when zoomed), click-to-toggle-play ─────────────────────────
  const drag = useRef<{ x: number; y: number; zx: number; zy: number; moved: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-overlay]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, moved: 0 }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y))
    if (zoom.s > 1 && d.moved > 3) setZoom((z) => ({ ...z, x: d.zx + e.clientX - d.x, y: d.zy + e.clientY - d.y }))
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d && d.moved < 4 && !drawing) player.toggle()
  }

  // Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen?.()
  }, [])
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    const onFs = () => toggleFullscreen()
    window.addEventListener('scoutdesk:toggle-fullscreen', onFs)
    return () => window.removeEventListener('scoutdesk:toggle-fullscreen', onFs)
  }, [toggleFullscreen])

  const snapshot = async () => {
    const el = videoRef.current
    if (!el) return
    try {
      const { fps } = usePlayback.getState()
      const frame = frameAt(el.currentTime, fps)
      const shapes = useDrawing.getState().shapes.filter((s) => s.frame === frame)
      const blob = await captureSnapshot(el, shapes)
      downloadBlob(blob, `${video.title.replace(/[^\w-]+/g, '_')}_${formatTimecode(el.currentTime, fps).replace(/[:.]/g, '-')}.png`)
      toast.success(shapes.length ? `Snapshot saved with ${shapes.length} drawing${shapes.length > 1 ? 's' : ''}` : 'Snapshot saved')
    } catch {
      toast.error('Could not capture this frame')
    }
  }
  useEffect(() => {
    const onSnap = () => void snapshot()
    window.addEventListener('scoutdesk:snapshot', onSnap)
    return () => window.removeEventListener('scoutdesk:snapshot', onSnap)
  })

  const onError = () => {
    const err = videoRef.current?.error
    if (!err) return
    // 403 on an expired signed URL surfaces as a network/src error: refresh links once and retry.
    if (!retried.current && (err.code === MediaError.MEDIA_ERR_NETWORK || err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
      retried.current = true
      void useData.getState().refreshVideos()
    }
    usePlayback.setState({
      error:
        err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'This browser can’t decode the video. MP4 (H.264/AAC) is the safest format — re-upload as MP4 or try another browser.'
          : err.code === MediaError.MEDIA_ERR_DECODE
            ? 'The video failed to decode (the file may be corrupt).'
            : 'The video could not be loaded. Check your connection and the server.',
    })
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col bg-black">
      <div
        ref={stageRef}
        className={cn('relative min-h-0 flex-1 touch-none select-none overflow-hidden', zoom.s > 1 && !drawing && 'cursor-grab active:cursor-grabbing')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => (zoom.s !== 1 ? setZoom({ s: 1, x: 0, y: 0 }) : toggleFullscreen())}
      >
        <div
          className="absolute"
          style={{
            width: fit.w, height: fit.h,
            left: (stage.w - fit.w) / 2, top: (stage.h - fit.h) / 2,
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`,
          }}
        >
          <video
            key={video.id}
            ref={videoRef}
            src={video.streamUrl}
            preload="auto"
            playsInline
            className="h-full w-full"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              if (v.videoWidth) setNative({ w: v.videoWidth, h: v.videoHeight })
              usePlayback.setState({ duration: v.duration || video.durationSec, ready: true, error: null })
              setBuffering(false)
            }}
            onPlay={() => usePlayback.setState({ playing: true })}
            onPause={() => usePlayback.setState({ playing: false })}
            onEnded={() => usePlayback.setState({ playing: false })}
            onWaiting={() => setBuffering(true)}
            onCanPlay={() => setBuffering(false)}
            onSeeked={(e) => usePlayback.setState({ time: e.currentTarget.currentTime })}
            onError={onError}
          />
          <DrawingLayer w={native.w} h={native.h} />
        </div>

        {/* overlays (marked so they don't start a pan / play toggle) */}
        <div data-overlay className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-white/10 bg-black/60 p-0.5 backdrop-blur">
          <Tip label="Zoom out" side="bottom"><Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.4)}><ZoomOut className="h-3.5 w-3.5" /></Button></Tip>
          <button type="button" className="timecode w-11 text-center text-2xs text-white/90 hover:text-white" aria-label="Reset zoom" onClick={() => setZoom({ s: 1, x: 0, y: 0 })}>{Math.round(zoom.s * 100)}%</button>
          <Tip label="Zoom in (or scroll)" side="bottom"><Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" aria-label="Zoom in" onClick={() => zoomAt(1.4)}><ZoomIn className="h-3.5 w-3.5" /></Button></Tip>
        </div>

        {drawing && <DrawingToolbar />}

        {clipRange && (
          <div data-overlay className="pointer-events-none absolute left-2 top-2 rounded bg-accent px-2 py-0.5 text-2xs font-semibold text-accent-foreground">Playing clip · Esc to stop</div>
        )}
        {(buffering || !ready) && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status"><Spinner className="h-7 w-7 text-white/70" /></div>
        )}
        {error && (
          <div data-overlay className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-8 text-center">
            <AlertTriangle className="h-7 w-7 text-warning" />
            <p className="max-w-md text-xs text-white/90">{error}</p>
          </div>
        )}
      </div>
      <PlayerControls fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} onSnapshot={() => void snapshot()} />
    </div>
  )
}

const TOOLS: { id: DrawTool; label: string; icon: typeof Minus }[] = [
  { id: 'arrow', label: 'Arrow', icon: MoveUpRight },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'circle', label: 'Circle', icon: Circle },
]

function DrawingToolbar() {
  const { tool, setTool, color, setColor, width, setWidth, undoLast, clearFrame } = useDrawing()
  const frameNow = () => frameAt(player.currentTime, usePlayback.getState().fps)
  return (
    <div data-overlay className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/10 bg-black/70 p-1 backdrop-blur" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <Tip key={id} label={label} side="top">
          <Button variant={tool === id ? 'primary' : 'ghost'} size="icon-sm" className={tool !== id ? 'text-white hover:bg-white/10' : ''} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)}>
            <Icon className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      ))}
      <div className="mx-1 h-4 w-px bg-white/20" />
      {DRAW_COLORS.map((c) => (
        <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn('h-4 w-4 rounded-full border-2', color === c ? 'border-white' : 'border-transparent')} style={{ background: c }} />
      ))}
      <div className="mx-1 h-4 w-px bg-white/20" />
      <input type="range" min={2} max={12} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Stroke width" className="h-1 w-14" />
      <div className="mx-1 h-4 w-px bg-white/20" />
      <Tip label="Undo last shape" hotkey="Ctrl+Z" side="top"><Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" aria-label="Undo last shape" onClick={() => undoLast(frameNow())}><Undo2 className="h-3.5 w-3.5" /></Button></Tip>
      <Tip label="Clear this frame" side="top"><Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10" aria-label="Clear drawings on this frame" onClick={() => clearFrame(frameNow())}><Eraser className="h-3.5 w-3.5" /></Button></Tip>
    </div>
  )
}
