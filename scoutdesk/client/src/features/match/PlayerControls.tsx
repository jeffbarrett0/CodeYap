import { Camera, Check, Clapperboard, ChevronLeft, ChevronRight, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { useAngles } from './angles'
import type { Video } from '@/types'
import { Tip } from '@/components/ui/tooltip'
import { formatHotkey } from '@/lib/hotkeys'
import { formatTimecode } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { SPEEDS, player, usePlayback } from './playback'

const skipBtn = 'h-7 min-w-[34px] px-1.5 font-mono text-2xs'

export function Timecode() {
  const time = usePlayback((s) => s.time)
  const duration = usePlayback((s) => s.duration)
  const fps = usePlayback((s) => s.fps)
  return (
    <div className="timecode flex items-baseline gap-1.5 text-sm" aria-live="off">
      <span className="font-semibold text-foreground" data-testid="timecode">{formatTimecode(time, fps)}</span>
      <span className="text-2xs text-muted">/ {formatTimecode(duration, fps)}</span>
    </div>
  )
}

export function PlayerControls({ fullscreen, onToggleFullscreen, onSnapshot, canSave, angles = [], primaryId }: { fullscreen: boolean; onToggleFullscreen: () => void; onSnapshot: (save: boolean) => void; canSave: boolean; angles?: Video[]; primaryId?: string }) {
  const { secondaryId, setPrimary, setSecondary } = useAngles()
  const playing = usePlayback((s) => s.playing)
  const rate = usePlayback((s) => s.rate)
  const volume = usePlayback((s) => s.volume)
  const muted = usePlayback((s) => s.muted)

  return (
    <div role="toolbar" aria-label="Video controls" className="flex h-11 shrink-0 items-center gap-1 border-t border-border bg-surface px-2">
      <Tip label={playing ? 'Pause' : 'Play'} hotkey={formatHotkey('space')} side="top">
        <Button variant="primary" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={() => player.toggle()} className="mr-1 h-8 w-8">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </Button>
      </Tip>

      <div className="flex items-center gap-0.5">
        <Tip label="Back 10 seconds" hotkey={formatHotkey('alt+left')} side="top"><Button variant="ghost" className={skipBtn} aria-label="−10s, back 10 seconds" onClick={() => player.skip(-10)}>−10s</Button></Tip>
        <Tip label="Back 5 seconds" hotkey={formatHotkey('shift+left')} side="top"><Button variant="ghost" className={skipBtn} aria-label="−5s, back 5 seconds" onClick={() => player.skip(-5)}>−5s</Button></Tip>
        <Tip label="Previous frame" hotkey={formatHotkey('left')} side="top"><Button variant="secondary" size="icon" aria-label="Previous frame" onClick={() => player.stepFrames(-1)}><ChevronLeft className="h-4 w-4" /></Button></Tip>
        <Tip label="Next frame" hotkey={formatHotkey('right')} side="top"><Button variant="secondary" size="icon" aria-label="Next frame" onClick={() => player.stepFrames(1)}><ChevronRight className="h-4 w-4" /></Button></Tip>
        <Tip label="Forward 5 seconds" hotkey={formatHotkey('shift+right')} side="top"><Button variant="ghost" className={skipBtn} aria-label="+5s, forward 5 seconds" onClick={() => player.skip(5)}>+5s</Button></Tip>
        <Tip label="Forward 10 seconds" hotkey={formatHotkey('alt+right')} side="top"><Button variant="ghost" className={skipBtn} aria-label="+10s, forward 10 seconds" onClick={() => player.skip(10)}>+10s</Button></Tip>
      </div>

      <div className="mx-3 h-5 w-px bg-border" />
      <Timecode />

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <Tip label="Playback speed" hotkey="[ ]" side="top">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-7 w-12 font-mono text-xs" aria-label={`Playback speed ${rate}x`}>{rate}x</Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" side="top" className="min-w-[6rem]">
            {SPEEDS.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => player.setRate(s)} className="font-mono">
                <span className="w-3">{rate === s && <Check className="h-3 w-3 text-accent" />}</span>
                {s}x
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1">
          <Tip label={muted ? 'Unmute' : 'Mute'} hotkey="M" side="top">
            <Button variant="ghost" size="icon" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => player.toggleMute()}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </Tip>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => player.setVolume(Number(e.target.value))} aria-label="Volume" className="h-1 w-16" />
        </div>

        {angles.length > 1 && (
          <DropdownMenu>
            <Tip label="Camera angles" side="top"><DropdownMenuTrigger asChild><Button variant={secondaryId ? 'primary' : 'ghost'} size="icon" aria-label="Camera angles"><Clapperboard className="h-4 w-4" /></Button></DropdownMenuTrigger></Tip>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuLabel>Main view</DropdownMenuLabel>
              {angles.map((v) => <DropdownMenuItem key={v.id} onSelect={() => setPrimary(v.id)}><span className="w-3">{v.id === primaryId && <Check className="h-3 w-3 text-accent" />}</span>{v.angle}</DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Second view (synced)</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setSecondary(null)}><span className="w-3">{!secondaryId && <Check className="h-3 w-3 text-accent" />}</span>None</DropdownMenuItem>
              {angles.filter((v) => v.id !== primaryId).map((v) => <DropdownMenuItem key={v.id} onSelect={() => setSecondary(v.id)}><span className="w-3">{v.id === secondaryId && <Check className="h-3 w-3 text-accent" />}</span>{v.angle}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="mx-1 h-5 w-px bg-border" />
        <DropdownMenu>
          <Tip label="Snapshot of this frame (with drawings)" side="top">
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Snapshot"><Camera className="h-4 w-4" /></Button></DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" side="top" className="w-60">
            <DropdownMenuItem disabled={!canSave} onSelect={() => onSnapshot(true)}>Save to report library</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSnapshot(false)}>Download PNG</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} hotkey="F" side="top">
          <Button variant="ghost" size="icon" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onToggleFullscreen}>
            {fullscreen ? <Minimize className={cn('h-4 w-4')} /> : <Maximize className="h-4 w-4" />}
          </Button>
        </Tip>
      </div>
    </div>
  )
}
