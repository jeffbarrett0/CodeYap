import { captionLayout, highlightedLines } from '@shared/export/ass'
import type { Caption, CaptionStyle } from '@shared/types'

let ctx: CanvasRenderingContext2D | null = null

/** Canvas yazı tipi dizgesi (önizleme çizimi ve ölçüm AYNI dizgeyi kullanır) */
export const captionFont = (st: CaptionStyle, fontPx: number) => `${st.italic ? 'italic ' : ''}${st.bold ? '700' : '400'} ${fontPx}px "${st.fontFamily}", Impact, Arial, sans-serif`

/** Altyazının önizlemedeki GERÇEK kapladığı alan (önizleme pikseli): seçim kutusu ve tutamaçlar yazıya oturur. */
export function measureCaption(st: CaptionStyle, cap: Caption, W: number, H: number): { w: number; h: number; cx: number; cy: number } {
  const lay = captionLayout(st, cap, W, H)
  ctx ??= document.createElement('canvas').getContext('2d')
  const lh = lay.fontPx * 1.15
  const pad = st.box?.enabled ? lay.fontPx * 0.22 : (st.outlineWidth * Math.min(W, H)) / 1080
  if (!ctx) return { w: lay.w, h: lay.h, cx: lay.cx, cy: lay.cy }
  ctx.font = captionFont(st, lay.fontPx)
  const upper = st.uppercase ? cap.text.toLocaleUpperCase('tr-TR') : cap.text
  const space = ctx.measureText(' ').width
  let widest = 0
  for (const line of highlightedLines(upper, lay.lines, cap.hl)) widest = Math.max(widest, line.reduce((n, w, i) => n + ctx!.measureText(w.text).width + (i ? space : 0), 0))
  return { w: Math.min(W, widest + pad * 2), h: lay.lines.length * lh + pad * 0.4 + (st.box?.enabled ? 0 : pad), cx: lay.cx, cy: lay.cy }
}
