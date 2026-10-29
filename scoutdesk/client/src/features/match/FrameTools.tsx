import { Circle, Hand, Link2, ListOrdered, Minus, MousePointer2, MoveUpRight, Pentagon, Route, ScanEye, ScanSearch, Sparkles, Trash2, User, ZoomIn, ZoomOut } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ColorPicker } from './ColorPicker'
import { useDrawing, type Tool } from './drawing'

const TOOLS: { id: Tool; label: string; tip: string; hotkey?: string; icon: typeof Circle }[] = [
  { id: 'select', label: 'Seç', tip: 'Çizimi seç ve taşı', hotkey: 'D', icon: MousePointer2 },
  { id: 'arrow', label: 'Ok', tip: 'Ok çiz: videoda sürükle', icon: MoveUpRight },
  { id: 'circle', label: 'Daire', tip: 'Oyuncunun üstüne tıkla: halka. Sürüklersen istediğin boyda çizer', icon: Circle },
  { id: 'zoom', label: 'Zoom', tip: 'Oyuncunun üstüne daire çiz: solda "Player close up" büyütmesi açılır', icon: ScanEye },
  { id: 'line', label: 'Çizgi', tip: 'Düz çizgi çiz', icon: Minus },
  { id: 'link', label: 'Bağlantı', tip: 'Oyunculara sırayla tıkla, aralarında bağlantı çizilir. Bitirmek için sağ tık', icon: Link2 },
  { id: 'run', label: 'Koşu oku', tip: 'Oyuncunun koşusunu göster: sürükle', icon: Route },
  { id: 'area', label: 'Alan', tip: 'Köşelere tıkla; bitirmek için sağ tık', icon: Pentagon },
  { id: 'number', label: 'Numara', tip: 'Oyunculara sırayla tıkla: 1, 2, 3… Bitirmek için sağ tık', icon: ListOrdered },
  { id: 'player', label: 'Oyuncu', tip: 'Oyuncuya tıkla, adını sağdaki Çizim sekmesinden yaz', icon: User },
  { id: 'spot', label: 'Aydınlat', tip: 'Tıkla: tüm kareyi yukarıdan aşağı aydınlat. Sürüklersen sadece o alanı aydınlatır', icon: Sparkles },
  { id: 'pan', label: 'Kaydır', tip: 'Yakınlaştırılmış videoyu sürükleyerek kaydır', icon: Hand },
]

const icoBtn = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-foreground disabled:pointer-events-none disabled:opacity-35'

/**
 * "FRAME TOOLS" bar under the video: pick a tool, drag on the (paused) video. Drawings stay editable:
 * press one anywhere on its body to move it, drag its white dots to resize.
 */
export function FrameTools({ zoom, onZoom, onResetZoom }: { zoom: number; onZoom: (factor: number) => void; onResetZoom: () => void }) {
  const { tool, setTool, selectedId, remove, color, setColor, width, setWidth } = useDrawing()
  const on = (active: boolean) => (active ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground' : '')

  return (
    <div role="toolbar" aria-label="Frame tools" className="flex shrink-0 flex-wrap items-center gap-x-0 gap-y-1 border-t border-border bg-surface px-2 py-1">
      <span className="label mr-1.5 select-none">Frame tools</span>
      {TOOLS.map(({ id, label, tip, hotkey, icon: Icon }) => (
        <Tip key={id} label={tip} hotkey={hotkey} side="top">
          <button type="button" aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)} className={cn('flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-foreground', on(tool === id))}>
            <Icon className="h-4 w-4" />
            {/* names show on wide screens; on narrower ones only the active tool keeps its name (all have tooltips) so the bar stays on one row */}
            <span className={cn(tool === id ? 'inline' : 'hidden min-[1600px]:inline')}>{label}</span>
          </button>
        </Tip>
      ))}
      <Tip label={selectedId ? 'Seçili çizimi sil' : 'Silmek için önce bir çizim seç'} hotkey="Del" side="top">
        <button type="button" aria-label="Seçili çizimi sil" disabled={!selectedId} onClick={() => selectedId && remove(selectedId)} className={icoBtn}>
          <Trash2 className="h-4 w-4" />
        </button>
      </Tip>

      <Popover>
        <Tip label="Renk ve kalınlık" side="top">
          <PopoverTrigger asChild>
            <button type="button" aria-label="Renk ve kalınlık" className={icoBtn}><span className="h-3.5 w-3.5 rounded-full border border-white/40" style={{ background: color }} /></button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent className="w-72 space-y-2">
          <ColorPicker value={color} onChange={setColor} />
          <label className="flex items-center gap-2 text-2xs text-muted">Kalınlık
            <input type="range" min={2} max={14} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Çizgi kalınlığı" className="h-1 flex-1" />
          </label>
        </PopoverContent>
      </Popover>

      <Tip label="Bölgeye yakınlaştır: videoda bir kutu çiz" side="top">
        <button type="button" aria-label="Bölgeye yakınlaştır" aria-pressed={tool === 'zoomrect'} onClick={() => setTool(tool === 'zoomrect' ? 'select' : 'zoomrect')} className={cn(icoBtn, on(tool === 'zoomrect'))}>
          <ScanSearch className="h-4 w-4" />
        </button>
      </Tip>
      <Tip label="Uzaklaş" side="top"><button type="button" aria-label="Uzaklaş" disabled={zoom <= 1} onClick={() => onZoom(1 / 1.4)} className={icoBtn}><ZoomOut className="h-4 w-4" /></button></Tip>
      <Tip label="Zoom'u sıfırla (videoya çift tıklamak da sıfırlar)" side="top">
        <button type="button" aria-label={`Zoom'u sıfırla, şu an ${zoom.toFixed(2)}×`} onClick={onResetZoom} className="timecode w-12 rounded text-center text-xs text-foreground hover:bg-raised">{zoom.toFixed(2)}×</button>
      </Tip>
      <Tip label="Yakınlaş (veya videonun üstünde tekerleği çevir)" side="top"><button type="button" aria-label="Yakınlaş" onClick={() => onZoom(1.4)} className={icoBtn}><ZoomIn className="h-4 w-4" /></button></Tip>
    </div>
  )
}
