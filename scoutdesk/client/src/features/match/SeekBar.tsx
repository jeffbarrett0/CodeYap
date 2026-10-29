import { useEffect, useRef, useState } from 'react'
import { formatClock } from '@/lib/timecode'
import { clamp } from '@/lib/utils'
import { player, usePlayback } from './playback'

/** Pick a minute-tick step so labels never crowd, whatever the match length. */
const tickStep = (duration: number, width: number) => {
  for (const m of [1, 2, 5, 10, 15, 30, 45]) if ((m * 60 * width) / duration >= 56) return m * 60
  return 3600
}

/**
 * Full-width seek bar right under the video: click or drag anywhere to jump (e.g. straight to minute 3),
 * with minute ticks, a hover preview of the time under the cursor, and the elapsed / total readout.
 */
export function SeekBar() {
  const time = usePlayback((s) => s.time)
  const duration = usePlayback((s) => s.duration)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])

  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration)
  }
  const jump = (t: number) => {
    usePlayback.setState({ clipRange: null })
    player.seek(t)
  }
  const pct = duration ? (time / duration) * 100 : 0
  const step = duration ? tickStep(duration, width) : 60
  const ticks: number[] = []
  if (duration) for (let t = step; t < duration; t += step) ticks.push(t)

  return (
    <div className="flex shrink-0 items-start gap-3 border-t border-border bg-surface px-3 pb-0.5 pt-1.5">
      <span className="timecode mt-0.5 w-14 shrink-0 text-right text-xs">{formatClock(time)}</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
        className="group relative h-7 flex-1 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          if (!duration || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          jump(at(e.clientX))
        }}
        onPointerMove={(e) => {
          if (!duration) return
          setHover(at(e.clientX))
          if (dragging.current) jump(at(e.clientX))
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="absolute inset-x-0 top-[7px] h-1.5 rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        {ticks.map((t) => (
          <span key={t} className="pointer-events-none absolute top-1.5" style={{ left: `${(t / duration) * 100}%` }}>
            <span className="absolute -left-px top-0 h-1.5 w-px bg-background/80" />
            <span className="timecode absolute left-0 top-3 -translate-x-1/2 text-[10px] text-muted">{formatClock(t)}</span>
          </span>
        ))}
        <span className="pointer-events-none absolute top-[3px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-accent shadow" style={{ left: `${pct}%` }} />
        {hover !== null && (
          <span className="timecode pointer-events-none absolute -top-5 -translate-x-1/2 rounded bg-raised px-1.5 py-0.5 text-[10px] shadow" style={{ left: `${(hover / duration) * 100}%` }}>{formatClock(hover)}</span>
        )}
      </div>
      <span className="timecode mt-0.5 w-14 shrink-0 text-xs text-muted">{formatClock(duration)}</span>
      <GoTo duration={duration} />
    </div>
  )
}

/** Type a time ("3", "3:30", "1:02:03") and press Enter to jump there. A bare number means minutes. */
function GoTo({ duration }: { duration: number }) {
  const [v, setV] = useState('')
  const go = () => {
    const t = v.trim()
    if (!t) return
    const parts = t.split(':').map(Number)
    if (parts.some((n) => !Number.isFinite(n))) return
    const sec = parts.length === 1 ? parts[0]! * 60 : parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
    usePlayback.setState({ clipRange: null })
    player.seek(clamp(sec, 0, duration))
    setV('')
  }
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^\d:]/g, ''))}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') e.currentTarget.blur() }}
      aria-label="Go to time (minutes or m:ss)"
      title="Go to… type 3 for minute 3, or 3:30, then Enter"
      placeholder="Go to 3:30"
      inputMode="numeric"
      className="timecode h-7 w-24 shrink-0 rounded border border-border bg-background px-2 text-center text-xs placeholder:text-muted/70 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    />
  )
}
