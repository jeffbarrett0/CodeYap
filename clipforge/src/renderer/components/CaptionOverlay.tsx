import { useRef } from 'react'
import { captionLayout } from '@shared/export/ass'
import { MAX_CAPTION_SCALE, MIN_CAPTION_SCALE } from '@shared/timeline/ops'
import { cmd } from '@shared/timeline/commands'
import { localizeCaption } from '@shared/timeline/captions'
import { previewSize } from '../preview/engine'
import { measureCaption } from '../preview/measure'
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
  /** Köşe/kenar tutamaçlarıyla boyutlandırma: karşı kenar sabit kalır, yazı boyutu genişliğe göre ölçeklenir */
  const resize = useRef<{ id: string; handle: string; x0: number; w0: number; h0: number; cx0: number; cy0: number; s0: number } | null>(null)
  const { width: W, height: H } = previewSize(tl)
  if (!tl.captionStyle.enabled) return null
  const active = tl.captions.filter((c) => playhead >= c.start && playhead < c.end)

  const down = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const cap = localizeCaption(tl.captions.find((c) => c.id === id)!, tl.captionLang)
    const lay = captionLayout(tl.captionStyle, cap, W, H)
    selectCaption(id)
    drag.current = { id, x0: e.clientX, y0: e.clientY, cx: lay.cx / W, cy: lay.cy / H, moved: false }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    const box = ref.current?.getBoundingClientRect()
    if (!d || !box) return
    if (e.buttons === 0) {
      drag.current = null
      return
    }
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return
    d.moved = true
    let x = d.cx + (e.clientX - d.x0) / box.width
    let y = d.cy + (e.clientY - d.y0) / box.height
    // yatay ortaya yapış
    if (Math.abs(x - 0.5) < 0.012) x = 0.5
    exec(cmd.captionPos(d.id, { x, y }))
  }

  const downHandle = (e: React.PointerEvent, id: string, handle: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const cap = localizeCaption(tl.captions.find((c) => c.id === id)!, tl.captionLang)
    const m = measureCaption(tl.captionStyle, cap, W, H)
    resize.current = { id, handle, x0: e.clientX, w0: m.w, h0: m.h, cx0: m.cx, cy0: m.cy, s0: cap.scale ?? 1 }
  }
  const moveHandle = (e: React.PointerEvent) => {
    const r = resize.current
    const box = ref.current?.getBoundingClientRect()
    if (!r || !box) return
    if (e.buttons === 0) {
      resize.current = null
      return
    }
    const dx = ((e.clientX - r.x0) / box.width) * W
    const east = r.handle.includes('e')
    const w1 = Math.max(12, r.w0 + (east ? dx : -dx))
    const s1 = Math.min(MAX_CAPTION_SCALE, Math.max(MIN_CAPTION_SCALE, r.s0 * (w1 / r.w0)))
    const k = s1 / r.s0
    const w = r.w0 * k
    const h = r.h0 * k
    const cx = east ? r.cx0 - r.w0 / 2 + w / 2 : r.cx0 + r.w0 / 2 - w / 2
    const cy = r.handle.includes('s') ? r.cy0 - r.h0 / 2 + h / 2 : r.handle.includes('n') ? r.cy0 + r.h0 / 2 - h / 2 : r.cy0
    exec(cmd.captionBox(r.id, { scale: s1, pos: { x: cx / W, y: cy / H } }))
  }

  return (
    <div className="caption-overlay" ref={ref}>
      {active.map((c) => {
        const lay = measureCaption(tl.captionStyle, localizeCaption(c, tl.captionLang), W, H)
        const sel = c.id === selected
        return (
          <div
            key={c.id}
            className={`cap-box${sel ? ' sel' : ''}${c.pos ? ' custom' : ''}`}
            style={{ left: `${((lay.cx - lay.w / 2) / W) * 100}%`, top: `${((lay.cy - lay.h / 2) / H) * 100}%`, width: `${(lay.w / W) * 100}%`, height: `${(lay.h / H) * 100}%` }}
            onPointerDown={(e) => down(e, c.id)}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onLostPointerCapture={() => (drag.current = null)}
            data-testid="cap-box"
            data-caption-id={c.id}
            title="Altyazıyı seçmek için tıklayın, taşımak için sürükleyin; kenar ve köşelerden çekerek büyütüp küçültün"
          >
            {sel &&
              ['nw', 'ne', 'sw', 'se', 'w', 'e'].map((h) => (
                <span
                  key={h}
                  className={`cap-h cap-h-${h}`}
                  onPointerDown={(e) => downHandle(e, c.id, h)}
                  onPointerMove={moveHandle}
                  onPointerUp={() => (resize.current = null)}
                  onPointerCancel={() => (resize.current = null)}
                  onLostPointerCapture={() => (resize.current = null)}
                  data-testid={`cap-h-${h}`}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
