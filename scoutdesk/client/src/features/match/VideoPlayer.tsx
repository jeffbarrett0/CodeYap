import { AlertTriangle, Camera } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Spinner } from '@/components/ui/misc'
import { frameAt, formatTimecode } from '@/lib/timecode'
import { clamp, cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useData } from '@/store/data'
import { useCan } from '@/store/hooks'
import { useTagging } from './tagging'
import type { Video } from '@/types'
import { DrawingLayer } from './DrawingLayer'
import { SecondaryPane } from './SecondaryPane'
import { PlayerControls } from './PlayerControls'
import { FrameTools } from './FrameTools'
import { SeekBar } from './SeekBar'
import { isVisible, useDrawing } from './drawing'
import { player, usePlayback } from './playback'
import { captureSnapshot, downloadBlob } from './snapshot'

interface Zoom {
  s: number
  x: number
  y: number
}
const MIN_ZOOM = 1
const MAX_ZOOM = 8

export function VideoPlayer({ video, secondary, angles }: { video: Video; secondary?: Video | null; angles?: Video[] }) {
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
  const drawing = useDrawing((s) => s.tool !== 'select' && s.tool !== 'pan')
  const panTool = useDrawing((s) => s.tool === 'pan')
  const hold = useDrawing((s) => s.hold)
  const setHold = useDrawing((s) => s.setHold)
  const [sizePct, setSizePct] = useState(100)
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
  const full = stage.w / stage.h > aspect ? { w: stage.h * aspect, h: stage.h } : { w: stage.w, h: stage.w / aspect }
  const fit = { w: full.w * (sizePct / 100), h: full.h * (sizePct / 100) }

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

  /** Fit a native-pixel rectangle to the stage (the "zoom to region" tool). */
  const zoomToRect = useCallback((r: { x1: number; y1: number; x2: number; y2: number }) => {
    const fx = Math.abs(r.x2 - r.x1) / native.w
    const fy = Math.abs(r.y2 - r.y1) / native.h
    const s = clamp(Math.min(1 / Math.max(fx, 1e-3), 1 / Math.max(fy, 1e-3)), 1, 8)
    const cx = ((r.x1 + r.x2) / 2 / native.w - 0.5) * fit.w
    const cy = ((r.y1 + r.y2) / 2 / native.h - 0.5) * fit.h
    setZoom(s === 1 ? { s: 1, x: 0, y: 0 } : { s, x: -s * cx, y: -s * cy })
  }, [native.w, native.h, fit.w, fit.h])

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
    if (d && d.moved < 4 && !drawing) {
      // With a drawing selected, a click on empty video just deselects it (it must not start playback and hide it).
      const ds = useDrawing.getState()
      if (ds.selectedId) ds.select(null)
      else player.toggle()
    }
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

  const { canWrite } = useCan()
  /** `clean` = footage only (no drawings), used by the Screenshot button. */
  const snapshot = async (save = false, clean = false) => {
    const el = videoRef.current
    if (!el) return
    try {
      const { fps } = usePlayback.getState()
      const frame = frameAt(el.currentTime, fps)
      const shapes = clean ? [] : useDrawing.getState().shapes.filter((s) => isVisible(s, frame, fps, false))
      const blob = await captureSnapshot(el, shapes)
      if (save) {
        const ctx = useTagging.getState()
        await api.uploadSnapshot(blob, { matchId: video.matchId ?? '', videoId: video.id, timeSec: String(+el.currentTime.toFixed(2)), playerId: ctx.playerId ?? '', caption: shapes.length ? 'Annotated frame' : '' })
        toast.success(`Saved to the report library${shapes.length ? ` with ${shapes.length} drawing${shapes.length > 1 ? 's' : ''}` : ''}`)
      } else {
        downloadBlob(blob, `${video.title.replace(/[^\w-]+/g, '_')}_${formatTimecode(el.currentTime, fps).replace(/[:.]/g, '-')}.png`)
        toast.success(clean ? 'Screenshot saved (footage only)' : shapes.length ? `Snapshot downloaded with ${shapes.length} drawing${shapes.length > 1 ? 's' : ''}` : 'Snapshot downloaded')
      }
    } catch {
      toast.error('Could not capture this frame')
    }
  }
  useEffect(() => {
    const onSnap = () => void snapshot(false)
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <h2 className="text-sm font-semibold">Match footage</h2>
        <div className="flex items-center gap-3">
          <span className="text-2xs text-muted">Video analysis</span>
          <button type="button" aria-label="Ekran görüntüsü al" onClick={() => void snapshot(false, true)} className="flex h-7 items-center gap-1.5 rounded border border-accent/50 px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10">
            <Camera className="h-3.5 w-3.5" /> Ekran görüntüsü al
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
      <div
        ref={stageRef}
        className={cn('relative min-h-0 min-w-0 flex-1 touch-none select-none overflow-hidden', (zoom.s > 1 || panTool) && !drawing && 'cursor-grab active:cursor-grabbing')}
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
          <DrawingLayer w={native.w} h={native.h} unit={native.w / Math.max(1, fit.w * zoom.s)} onZoomRect={zoomToRect} />
        </div>

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
      {secondary && <SecondaryPane key={secondary.id} video={secondary} />}
      </div>
      <PlayerControls fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} onSnapshot={(save) => void snapshot(save)} canSave={canWrite} angles={angles} primaryId={video.id} />
      <SeekBar />
      <FrameTools zoom={zoom.s} onZoom={(f) => zoomAt(f)} onResetZoom={() => setZoom({ s: 1, x: 0, y: 0 })} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-4 py-1 text-xs text-muted">
        <p className="min-w-[12rem] flex-1 truncate" title="Çizimin üzerine tıklayıp taşı; köşelerinden büyüt veya küçült. Oynatınca gizlenir. Videoda devam etmesini istersen çizim süresini uzat.">Çizimi tıklayıp taşı, köşelerinden büyüt. Bağlantı/Numara/Alan: sağ tık bitirir. Oynatınca gizlenir; kalsın istersen süreyi uzat.</p>
        <label className="flex items-center gap-1.5 whitespace-nowrap">Çizim süresi
          <select value={hold} onChange={(e) => setHold(Number(e.target.value))} aria-label="Çizim süresi" className="h-6 rounded border border-border bg-raised px-1 text-foreground">
            <option value={0}>Sadece bu kare</option>
            {[2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} sn</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 whitespace-nowrap">Video boyutu
          <input type="range" min={40} max={100} step={5} value={sizePct} onChange={(e) => setSizePct(Number(e.target.value))} aria-label="Video boyutu" className="h-1 w-24" />
          <span className="timecode w-9 text-foreground">{sizePct}%</span>
        </label>
        <button type="button" onClick={() => setZoom((z) => ({ ...z, x: 0, y: 0 }))} className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-raised">Ortala</button>
      </div>
    </div>
  )
}
