import type { Caption, CaptionStyle, TextSpec } from '../types'
import { wrapCaption } from '../timeline/captions'

/** #RRGGBB → ASS &HAABBGGRR (AA=00 opak) */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const [r, g, b] = m ? [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)] : ['FF', 'FF', 'FF']
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase()
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')
}

export interface TextEvent {
  /** çıkış zamanı (sn) */
  start: number
  end: number
  spec: TextSpec
  /** piksel cinsinden yerleşim dikdörtgeni */
  rect: { x: number; y: number; w: number; h: number }
}

/**
 * Bir altyazının çıkış karesindeki yerleşimi (merkez, yaklaşık kutu, satırlar). Dışa aktarma, önizleme ve
 * sürükleme katmanı AYNI hesabı kullanır; böylece görülen konum çıktıdakiyle eşleşir.
 */
export function captionLayout(style: CaptionStyle, cap: Caption, W: number, H: number) {
  const scale = Math.min(W, H) / 1080
  const fontPx = Math.round(style.fontSize * scale)
  const text = style.uppercase ? cap.text.toLocaleUpperCase('tr-TR') : cap.text
  const lines = wrapCaption(text, style.maxCharsPerLine)
  const cx = Math.round(cap.pos ? cap.pos.x * W : W / 2)
  const cy = Math.round(cap.pos ? cap.pos.y * H : H * (0.88 - 0.76 * style.positionY))
  const pad = style.outlineWidth * scale
  const longest = Math.max(1, ...lines.map((l) => l.length))
  const w = Math.min(W, longest * fontPx * 0.55 + pad * 2)
  const h = lines.length * fontPx * 1.15 + pad * 2
  return { cx, cy, w, h, lines, fontPx }
}

/** Metni dikdörtgen genişliğine göre sarar (satır sonları korunur). Önizleme ve dışa aktarma aynı kuralı kullanır. */
export function wrapTextForRect(spec: TextSpec, rectW: number, scale: number): { lines: string[]; fontPx: number } {
  const fontPx = Math.max(8, Math.round(spec.fontSize * scale))
  const maxChars = Math.max(6, Math.floor(rectW / (fontPx * 0.52)))
  const lines = spec.text.split(/\r?\n/).flatMap((l) => (l.trim() ? wrapCaption(l, maxChars) : ['']))
  return { lines, fontPx }
}

function textTags(spec: TextSpec, cx: number, cy: number, dur: number): string {
  const pos = `\\an5\\pos(${cx},${cy})`
  switch (spec.animation) {
    case 'fade':
      return `{${pos}\\fad(350,350)}`
    case 'slide-up':
      return `{\\an5\\move(${cx},${cy + 48},${cx},${cy},0,350)\\fad(250,0)}`
    case 'pulse': {
      let t = ''
      for (let s = 0.4, n = 0; s < dur - 0.6 && n < 80; s += 1.2, n++) {
        const a = Math.round(s * 1000)
        t += `\\t(${a},${a + 300},\\fscx108\\fscy108)\\t(${a + 300},${a + 600},\\fscx100\\fscy100)`
      }
      return `{${pos}${t}}`
    }
    default:
      return `{${pos}}`
  }
}

/**
 * Altyazıları (ve varsa metin katmanı olaylarını) ASS biçiminde üretir. Yazı boyutu, kısa kenar 1080 px'e göre tanımlıdır ve çıkışa ölçeklenir.
 * Zamanlar `rangeStart`'a göre kaydırılır; aralık dışı altyazılar atılır.
 */
export function buildAss(captions: Caption[], style: CaptionStyle, W: number, H: number, rangeStart = 0, rangeEnd = Infinity, texts: TextEvent[] = []): string {
  const scale = Math.min(W, H) / 1080
  const fs = Math.round(style.fontSize * scale)
  const outline = Math.round(style.outlineWidth * scale * 10) / 10
  const y = Math.round(H * (0.88 - 0.76 * style.positionY))
  const styleKeys: string[] = []
  const textStyles = texts.map((t) => {
    const key = JSON.stringify([t.spec.fontFamily, t.spec.fontSize, t.spec.color, t.spec.outlineColor, t.spec.outlineWidth, t.spec.bold, t.spec.italic])
    let i = styleKeys.indexOf(key)
    if (i < 0) i = styleKeys.push(key) - 1
    return i
  })
  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontFamily.replace(/,/g, ' ')},${fs},${assColor(style.color)},${assColor(style.color)},${assColor(style.outlineColor)},${assColor('#000000', 128)},${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${outline},0,5,${Math.round(W * 0.06)},${Math.round(W * 0.06)},0,1`,
    ...styleKeys.map((k, i) => {
      const [font, size, color, oc, ow, bold, italic] = JSON.parse(k) as [string, number, string, string, number, boolean, boolean | undefined]
      return `Style: Txt${i},${String(font).replace(/,/g, ' ')},${Math.round(size * scale)},${assColor(color)},${assColor(color)},${assColor(oc)},${assColor('#000000', 128)},${bold ? -1 : 0},${italic ? -1 : 0},0,0,100,100,0,0,1,${Math.round(ow * scale * 10) / 10},0,5,0,0,0,1`
    }),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  for (const c of captions) {
    const start = c.start - rangeStart
    const end = Math.min(c.end, rangeEnd) - rangeStart
    if (end <= 0 || start >= end) continue
    const lay = captionLayout(style, c, W, H)
    const body = escapeAss(lay.lines.join('\n'))
    lines.push(`Dialogue: 0,${assTime(Math.max(0, start))},${assTime(end)},Default,,0,0,0,,{\\an5\\pos(${lay.cx},${lay.cy})}${body}`)
  }
  texts.forEach((t, i) => {
    const start = Math.max(0, t.start)
    const end = t.end
    if (end <= start) return
    const { lines: wrapped } = wrapTextForRect(t.spec, t.rect.w, scale)
    const body = wrapped.map(escapeAss).join('\\N')
    lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Txt${textStyles[i]},,0,0,0,,${textTags(t.spec, Math.round(t.rect.x + t.rect.w / 2), Math.round(t.rect.y + t.rect.h / 2), end - start)}${body}`)
  })
  return lines.join('\n') + '\n'
}
