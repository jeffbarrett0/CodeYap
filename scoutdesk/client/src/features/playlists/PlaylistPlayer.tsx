import { AlertTriangle, Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import type { Video } from '@/types'

export interface PlayItem {
  id: string
  title: string
  subtitle?: string
  videoId: string | null
  start: number
  end: number
  transition: 'cut' | 'fade'
}

const FADE = 0.45

/**
 * Continuous playback over a list of clips: auto-advances, swaps sources across
 * videos, shows a lower-third title at the start of each item and dips through
 * black on "fade" transitions. Shared by the playlist builder and public share pages.
 */
export function PlaylistPlayer({ items, videos, index, onIndexChange, className, autoPlay = false }: {
  items: PlayItem[]
  videos: Video[]
  index: number
  onIndexChange: (i: number) => void
  className?: string
  autoPlay?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [dim, setDim] = useState(false)
  const [titleKey, setTitleKey] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const wantPlay = useRef(autoPlay)
  const loadedFor = useRef<{ src: string | null; index: number }>({ src: null, index: -1 })
  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos])
  const item = items[index]
  const src = item?.videoId ? (videoById.get(item.videoId)?.streamUrl ?? null) : null

  const starts = useMemo(() => {
    let acc = 0
    return items.map((it) => { const s = acc; acc += Math.max(0, it.end - it.start); return s })
  }, [items])
  const total = items.length ? starts[items.length - 1]! + (items[items.length - 1]!.end - items[items.length - 1]!.start) : 0

  const next = useCallback(() => {
    if (index < items.length - 1) onIndexChange(index + 1)
    else if (loop && items.length) onIndexChange(0)
    else { wantPlay.current = false; ref.current?.pause() }
  }, [index, items.length, loop, onIndexChange])

  // Load / seek when the active item changes ────────────────────────────────
  useEffect(() => {
    const v = ref.current
    if (!v || !item) return
    setErr(null)
    if (!src) { setErr(item.videoId ? 'Video is unavailable' : 'This clip has no video'); return }
    const begin = () => {
      v.currentTime = item.start
      setTitleKey((k) => k + 1)
      if (item.transition === 'fade' && index > 0) { setDim(true); requestAnimationFrame(() => requestAnimationFrame(() => setDim(false))) }
      if (wantPlay.current) void v.play().catch(() => {})
    }
    if (loadedFor.current.src !== src) {
      loadedFor.current = { src, index }
      v.src = src
      v.addEventListener('loadedmetadata', begin, { once: true })
    } else {
      loadedFor.current.index = index
      begin()
    }
  }, [item, src, index])

  // Watch for the end of the current item ───────────────────────────────────
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = ref.current
      if (v && item && src && !v.seeking && v.readyState >= 2) {
        const t = v.currentTime
        setElapsed(Math.max(0, t - item.start))
        const nextItem = items[index + 1]
        if (nextItem?.transition === 'fade' && t >= item.end - FADE && !v.paused) setDim(true)
        if (t >= item.end - 0.03) next()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [item, items, index, next, src])

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      wantPlay.current = true
      if (item && (v.currentTime >= item.end - 0.05 || v.currentTime < item.start - 0.1)) v.currentTime = item.start
      void v.play().catch(() => {})
    } else { wantPlay.current = false; v.pause() }
  }
  useEffect(() => { /* expose toggle to hotkeys via a window event */
    const h = () => toggle()
    window.addEventListener('scoutdesk:playlist-toggle', h)
    return () => window.removeEventListener('scoutdesk:playlist-toggle', h)
  })

  const pct = total ? ((starts[index] ?? 0) + Math.min(elapsed, item ? item.end - item.start : 0)) / total : 0

  return (
    <div className={cn('flex min-h-0 flex-col bg-black', className)}>
      <div className="relative min-h-0 flex-1">
        <video ref={ref} playsInline preload="auto" className="h-full w-full" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle} aria-label="Playlist video" />
        <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: dim ? 1 : 0, transition: `opacity ${FADE}s linear` }} aria-hidden />
        {item && (
          <div key={titleKey} className="pointer-events-none absolute bottom-6 left-0 animate-[sdtitle_3.6s_ease-out_forwards] border-l-4 border-accent bg-black/70 py-2 pl-3 pr-6 text-white">
            <p className="text-sm font-semibold">{item.title}</p>
            {item.subtitle && <p className="text-xs text-white/70">{item.subtitle}</p>}
          </div>
        )}
        {err && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center text-xs text-white"><AlertTriangle className="h-6 w-6 text-warning" />{err}<Button size="sm" onClick={next}>Skip clip</Button></div>}
        {items.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">Add clips to preview the playlist</div>}
      </div>
      <div className="shrink-0 border-t border-border bg-surface">
        <div className="flex h-1.5 gap-px bg-background" aria-hidden>
          {items.map((it, i) => <div key={i} className={cn('h-full', i < index ? 'bg-accent/60' : i === index ? 'bg-accent' : 'bg-raised')} style={{ width: `${total ? ((it.end - it.start) / total) * 100 : 0}%` }} />)}
        </div>
        <div role="toolbar" aria-label="Playlist controls" className="flex h-11 items-center gap-1 px-2">
          <Tip label="Previous clip" hotkey="," side="top"><Button variant="ghost" size="icon" aria-label="Previous clip" disabled={index <= 0} onClick={() => onIndexChange(index - 1)}><SkipBack className="h-4 w-4" /></Button></Tip>
          <Tip label={playing ? 'Pause' : 'Play'} hotkey="Space" side="top"><Button variant="primary" size="icon" className="h-8 w-8" aria-label={playing ? 'Pause' : 'Play'} disabled={!item} onClick={toggle}>{playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}</Button></Tip>
          <Tip label="Next clip" hotkey="." side="top"><Button variant="ghost" size="icon" aria-label="Next clip" disabled={index >= items.length - 1} onClick={() => onIndexChange(index + 1)}><SkipForward className="h-4 w-4" /></Button></Tip>
          <span className="timecode ml-2 whitespace-nowrap text-xs"><strong>{items.length ? index + 1 : 0}</strong> / {items.length}</span>
          <span className="timecode ml-3 whitespace-nowrap text-2xs text-muted">{formatClock((starts[index] ?? 0) + elapsed)} / {formatClock(total)}</span>
          <Tip label="Loop playlist" side="top"><Button variant={loop ? 'secondary' : 'ghost'} size="icon" className="ml-auto" aria-label="Loop playlist" aria-pressed={loop} onClick={() => setLoop((l) => !l)}><Repeat className="h-4 w-4" /></Button></Tip>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{item?.title}</span>
      <span hidden data-progress={pct.toFixed(3)} />
    </div>
  )
}
