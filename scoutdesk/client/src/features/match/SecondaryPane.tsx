import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useData } from '@/store/data'
import { useCan } from '@/store/hooks'
import type { Video } from '@/types'
import { useAngles } from './angles'
import { player, usePlayback } from './playback'

/**
 * Second camera angle. It is slaved to the main video; the offset slider is the
 * sync tool: drag until both pictures show the same moment, then save (stored per video).
 */
export function SecondaryPane({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [offset, setOffset] = useState(video.syncOffset)
  const [saved, setSaved] = useState(video.syncOffset)
  const fps = usePlayback((s) => s.fps)
  const setSecondary = useAngles((s) => s.setSecondary)
  const { canWrite } = useCan()

  useEffect(() => {
    const el = ref.current!
    el.muted = true
    player.attachSecondary(el, offset)
    return () => player.detachSecondary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id])
  useEffect(() => player.setSecondaryOffset(offset), [offset])

  const nudge = (d: number) => setOffset((o) => Math.round((o + d) * 1000) / 1000)
  const save = async () => {
    try {
      useData.getState().upsertVideo(await api.patchVideo(video.id, { syncOffset: offset }))
      setSaved(offset)
      toast.success(`Sync offset saved (${offset >= 0 ? '+' : ''}${offset.toFixed(2)} s)`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save offset') }
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col border-l border-border bg-black" aria-label={`Second angle: ${video.angle}`}>
      <video ref={ref} src={video.streamUrl} muted playsInline preload="auto" className="min-h-0 flex-1" />
      <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-0.5 text-2xs font-semibold text-white">{video.angle}
        <button type="button" aria-label="Close second angle" className="ml-1 text-white/70 hover:text-white" onClick={() => setSecondary(null)}><X className="h-3 w-3" /></button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-white/10 bg-surface px-2 py-1.5 text-xs" role="group" aria-label="Sync offset">
        <span className="label">Sync</span>
        <Tip label="−1 s" side="top"><Button variant="ghost" size="xs" onClick={() => nudge(-1)}>−1s</Button></Tip>
        <Tip label="One frame earlier" side="top"><Button variant="ghost" size="icon-sm" aria-label="Offset minus one frame" onClick={() => nudge(-1 / fps)}><Minus className="h-3 w-3" /></Button></Tip>
        <input type="range" min={-60} max={60} step={0.04} value={offset} onChange={(e) => setOffset(Number(e.target.value))} aria-label="Sync offset in seconds" className="h-1 min-w-[80px] flex-1" />
        <Tip label="One frame later" side="top"><Button variant="ghost" size="icon-sm" aria-label="Offset plus one frame" onClick={() => nudge(1 / fps)}><Plus className="h-3 w-3" /></Button></Tip>
        <Tip label="+1 s" side="top"><Button variant="ghost" size="xs" onClick={() => nudge(1)}>+1s</Button></Tip>
        <span className="timecode w-16 text-right">{offset >= 0 ? '+' : ''}{offset.toFixed(2)} s</span>
        <Button size="xs" variant={offset !== saved ? 'primary' : 'ghost'} disabled={!canWrite || offset === saved} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  )
}
