import { Camera, Circle, Maximize, Minus, MousePointer2, MoveUpRight, ScanSearch, Sparkles, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DRAW_COLORS, useDrawing, type Tool } from './drawing'

const TOOLS: { id: Tool; label: string; hotkey?: string; icon: typeof Circle }[] = [
  { id: 'select', label: 'Select & move', hotkey: 'D', icon: MousePointer2 },
  { id: 'arrow', label: 'Arrow', icon: MoveUpRight },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'spot', label: 'Spotlight (dims everything outside)', icon: Sparkles },
  { id: 'rect', label: 'Box', icon: Maximize },
]

const btn = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-foreground disabled:pointer-events-none disabled:opacity-35'

/**
 * Always-visible "FRAME TOOLS" bar above the video: select/move, arrow, circle, line,
 * spotlight, box, delete, zoom-to-region and zoom −/+. Drawn shapes stay editable —
 * grab one anywhere on its body to move it, drag the handles to resize.
 */
export function FrameTools({ zoom, onZoom, onResetZoom, onScreenshot }: { zoom: number; onZoom: (factor: number) => void; onResetZoom: () => void; onScreenshot: () => void }) {
  const { tool, setTool, selectedId, remove, color, setColor, width, setWidth } = useDrawing()
  const on = (active: boolean) => (active ? 'bg-accent/15 text-accent hover:text-accent' : '')

  return (
    <div role="toolbar" aria-label="Frame tools" className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-surface px-2">
      <span className="label mr-2 select-none">Frame tools</span>
      {TOOLS.map(({ id, label, hotkey, icon: Icon }) => (
        <Tip key={id} label={label} hotkey={hotkey} side="bottom">
          <button type="button" aria-label={label.split(' (')[0]} aria-pressed={tool === id} onClick={() => setTool(id)} className={cn(btn, on(tool === id))}>
            <Icon className="h-4 w-4" />
          </button>
        </Tip>
      ))}
      <Tip label={selectedId ? 'Delete selected drawing' : 'Select a drawing to delete it'} hotkey="Del" side="bottom">
        <button type="button" aria-label="Delete selected drawing" disabled={!selectedId} onClick={() => selectedId && remove(selectedId)} className={btn}>
          <Trash2 className="h-4 w-4" />
        </button>
      </Tip>

      <Popover>
        <Tip label="Colour and thickness" side="bottom">
          <PopoverTrigger asChild>
            <button type="button" aria-label="Colour and thickness" className={btn}><span className="h-3.5 w-3.5 rounded-full border border-white/40" style={{ background: color }} /></button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent className="w-44 space-y-2">
          <div className="flex gap-1.5">
            {DRAW_COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn('h-6 w-6 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />)}
          </div>
          <label className="flex items-center gap-2 text-2xs text-muted">Thickness
            <input type="range" min={2} max={14} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Stroke width" className="h-1 flex-1" />
          </label>
        </PopoverContent>
      </Popover>

      <span className="mx-1.5 h-4 w-px bg-border" aria-hidden />
      <Tip label="Zoom into a region: drag a box on the video" side="bottom">
        <button type="button" aria-label="Zoom to region" aria-pressed={tool === 'zoomrect'} onClick={() => setTool(tool === 'zoomrect' ? 'select' : 'zoomrect')} className={cn(btn, on(tool === 'zoomrect'))}>
          <ScanSearch className="h-4 w-4" />
        </button>
      </Tip>
      <Tip label="Zoom out" side="bottom"><button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => onZoom(1 / 1.4)} className={btn}><ZoomOut className="h-4 w-4" /></button></Tip>
      <Tip label="Reset zoom (double-click the video also resets)" side="bottom">
        <button type="button" aria-label={`Reset zoom, currently ${zoom.toFixed(2)}×`} onClick={onResetZoom} className="timecode w-12 rounded text-center text-xs text-foreground hover:bg-raised">{zoom.toFixed(2)}×</button>
      </Tip>
      <Tip label="Zoom in (or scroll over the video)" side="bottom"><button type="button" aria-label="Zoom in" onClick={() => onZoom(1.4)} className={btn}><ZoomIn className="h-4 w-4" /></button></Tip>

      <Tip label="Download a clean PNG of the match footage (no drawings, no interface)" side="bottom">
        <button type="button" aria-label="Screenshot" onClick={onScreenshot} className="ml-auto flex h-7 items-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-raised">
          <Camera className="h-3.5 w-3.5" /> Screenshot
        </button>
      </Tip>
    </div>
  )
}
