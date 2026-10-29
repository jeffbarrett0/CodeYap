import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ListTree, Minus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dot, EmptyState } from '@/components/ui/misc'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useLookups } from '@/store/hooks'
import { useClips } from './clips'
import { player, usePlayback } from './playback'
import { useVisibleClips } from './visible'

/** Index of the last event at or before `t` (−1 if none). Events are time-sorted. */
export function activeEventIndex(times: number[], t: number): number {
  let lo = 0
  let hi = times.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= t + 1e-6) (ans = mid, (lo = mid + 1))
    else hi = mid - 1
  }
  return ans
}

/** Play-by-play text view, synced with the playhead. */
export function EventLog() {
  const { list } = useVisibleClips()
  const { tagById, categoryOfTag, playerById, teamById } = useLookups()
  const [follow, setFollow] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const times = useMemo(() => list.map((c) => c.timeSec), [list])
  const activeIdx = usePlayback(useCallback((s) => activeEventIndex(times, s.time), [times]))
  const select = useClips((s) => s.select)

  const virt = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => 30, overscan: 12 })
  useEffect(() => {
    if (follow && activeIdx >= 0) virt.scrollToIndex(activeIdx, { align: 'center' })
  }, [activeIdx, follow, virt])

  if (list.length === 0) return <EmptyState icon={ListTree} title="No events to show" description="Tagged clips appear here as a play-by-play log that follows the video." className="h-full" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
        <span className="text-2xs text-muted">Play-by-play · {list.length} events</span>
        <Button variant={follow ? 'secondary' : 'ghost'} size="xs" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>Follow video</Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" role="log" aria-label="Event log">
        <div className="relative" style={{ height: virt.getTotalSize() }}>
          {virt.getVirtualItems().map((v) => {
            const c = list[v.index]!
            const cat = categoryOfTag.get(c.tagTypeId)
            const p = c.playerId ? playerById.get(c.playerId) : undefined
            const team = c.teamId ? teamById.get(c.teamId) : undefined
            const past = v.index <= activeIdx
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { select([c.id]); player.skip(0); player.seek(c.startSec) }}
                className={cn('absolute left-0 right-0 flex items-center gap-3 border-b border-border/50 px-3 text-left text-xs hover:bg-raised/50', v.index === activeIdx && 'bg-accent/10 shadow-[inset_2px_0_0_hsl(var(--accent))]', !past && 'text-muted')}
                style={{ height: 30, transform: `translateY(${v.start}px)` }}
                aria-current={v.index === activeIdx}
              >
                <span className="timecode w-12 shrink-0 text-muted">{formatClock(c.timeSec)}</span>
                <Dot color={cat?.color ?? '#888'} />
                <span className="w-32 shrink-0 truncate font-semibold">{tagById.get(c.tagTypeId)?.name}</span>
                <span className="w-44 shrink-0 truncate">{p ? `${p.name}${c.jersey != null ? ` #${c.jersey}` : ''}` : (team?.name ?? '')}{p && team ? <span className="text-muted"> · {team.shortName}</span> : null}</span>
                <span className={cn('w-4 shrink-0', c.outcome === 'success' ? 'text-success' : c.outcome === 'fail' ? 'text-danger' : 'text-muted')} aria-label={c.outcome}>
                  {c.outcome === 'success' ? <Check className="h-3 w-3" /> : c.outcome === 'fail' ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                </span>
                <span className="truncate text-muted">{c.notes}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
