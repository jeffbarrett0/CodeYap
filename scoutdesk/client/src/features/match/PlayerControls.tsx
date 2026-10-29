import { Camera, Check, ChevronLeft, ChevronRight, Maximize, Minimize, Pause, PenLine, Play, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Tip } from '@/components/ui/tooltip'
import { formatHotkey } from '@/lib/hotkeys'
import { formatTimecode } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useDrawing } from './drawing'
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

export function PlayerControls({ fullscreen, onToggleFullscreen, onSnapshot }: { fullscreen: boolean; onToggleFullscreen: () => void; onSnapshot: () => void }) {
  const playing = usePlayback((s) => s.playing)
  const rate = usePlayback((s) => s.rate)
  const volume = usePlayback((s) => s.volume)
  const muted = usePlayback((s) => s.muted)
  const drawing = useDrawing((s) => s.active)
  const setDrawing = useDrawing((s) => s.setActive)

  return (
    <div role="toolbar" aria-label="Video controls" className="flex h-11 shrink-0 items-center gap-1 border-t border-border bg-surface px-2">
      <Tip label={playing ? 'Pause' : 'Play'} hotkey={formatHotkey('space')} side="top">
        <Button variant="primary" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={() => player.toggle()} className="mr-1 h-8 w-8">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </Button>
      </Tip>

      <div className="flex items-center gap-0.5">
        <Tip label="Back 10 seconds" hotkey={formatHotkey('alt+left')} side="top"><Button variant="ghost" className={skipBtn} aria-label="Back 10 seconds" onClick={() => player.skip(-10)}>−10s</Button></Tip>
        <Tip label="Back 5 seconds" hotkey={formatHotkey('shift+left')} side="top"><Button variant="ghost" className={skipBtn} aria-label="Back 5 seconds" onClick={() => player.skip(-5)}>−5s</Button></Tip>
        <Tip label="Previous frame" hotkey={formatHotkey('left')} side="top"><Button variant="secondary" size="icon" aria-label="Previous frame" onClick={() => player.stepFrames(-1)}><ChevronLeft className="h-4 w-4" /></Button></Tip>
        <Tip label="Next frame" hotkey={formatHotkey('right')} side="top"><Button variant="secondary" size="icon" aria-label="Next frame" onClick={() => player.stepFrames(1)}><ChevronRight className="h-4 w-4" /></Button></Tip>
        <Tip label="Forward 5 seconds" hotkey={formatHotkey('shift+right')} side="top"><Button variant="ghost" className={skipBtn} aria-label="Forward 5 seconds" onClick={() => player.skip(5)}>+5s</Button></Tip>
        <Tip label="Forward 10 seconds" hotkey={formatHotkey('alt+right')} side="top"><Button variant="ghost" className={skipBtn} aria-label="Forward 10 seconds" onClick={() => player.skip(10)}>+10s</Button></Tip>
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

        <div className="mx-1 h-5 w-px bg-border" />
        <Tip label="Draw on frame" hotkey="D" side="top">
          <Button variant={drawing ? 'primary' : 'ghost'} size="icon" aria-label="Draw on frame" aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>
            <PenLine className="h-4 w-4" />
          </Button>
        </Tip>
        <Tip label="Save frame as PNG (with drawings)" side="top">
          <Button variant="ghost" size="icon" aria-label="Save snapshot" onClick={onSnapshot}><Camera className="h-4 w-4" /></Button>
        </Tip>
        <Tip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} hotkey="F" side="top">
          <Button variant="ghost" size="icon" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onToggleFullscreen}>
            {fullscreen ? <Minimize className={cn('h-4 w-4')} /> : <Maximize className="h-4 w-4" />}
          </Button>
        </Tip>
      </div>
    </div>
  )
}
