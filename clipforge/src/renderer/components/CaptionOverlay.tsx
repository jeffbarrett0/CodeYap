import { useRef } from 'react'
import { captionLayout } from '@shared/export/ass'
import { cmd } from '@shared/timeline/commands'
import { previewSize } from '../preview/engine'
import { useStore } from '../store'

/**
 * Önizlemede o an görünen altyazıları tıklanabilir yapar: tıkla → seç, sürükle → konumunu değiştir.
 * Kutu, dışa aktarmayla aynı yerleşim hesabını (captionLayout) kullanır.
 */
export function CaptionOverlay() {
  const tl = useStore((s) => s.project.timeline)
  const playhead = useStore((s) => s.playhead)
  const selected = useStore((s) => s.selectedCaptionId)
  const selectCaption = useStore((s) => s.selectCaption)
  const exec = useStore((s) => s.exec)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; x0: number; y0: number; cx: number; cy: number; moved: boolean } | null>(null)
  const { width: W, height: H } = previewSize(tl)
  if (!tl.captionStyle.enabled) return null
  const active = tl.captions.filter((c) => playhead >= c.start && playhead < c.end)

  const down = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const cap = tl.captions.find((c) => c.id === id)!
    const lay = captionLayout(tl.captionStyle, cap, W, H)
    selectCaption(id)
    drag.current = { id, x0: e.clientX, y0: e.clientY, cx: lay.cx / W, cy: lay.cy / H, moved: false }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    const box = ref.current?.getBoundingClientRect()
    if (!d || !box) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return
    d.moved = true
    let x = d.cx + (e.clientX - d.x0) / box.width
    let y = d.cy + (e.clientY - d.y0) / box.height
    // yatay ortaya yapış
    if (Math.abs(x - 0.5) < 0.012) x = 0.5
    exec(cmd.captionPos(d.id, { x, y }))
  }

  return (
    <div className="caption-overlay" ref={ref}>
      {active.map((c) => {
        const lay = captionLayout(tl.captionStyle, c, W, H)
        const sel = c.id === selected
        return (
          <div
            key={c.id}
            className={`cap-box${sel ? ' sel' : ''}${c.pos ? ' custom' : ''}`}
            style={{ left: `${((lay.cx - lay.w / 2) / W) * 100}%`, top: `${((lay.cy - lay.h / 2) / H) * 100}%`, width: `${(lay.w / W) * 100}%`, height: `${(lay.h / H) * 100}%` }}
            onPointerDown={(e) => down(e, c.id)}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            data-testid="cap-box"
            data-caption-id={c.id}
            title="Altyazıyı seçmek için tıklayın, taşımak için sürükleyin"
          />
        )
      })}
    </div>
  )
}
