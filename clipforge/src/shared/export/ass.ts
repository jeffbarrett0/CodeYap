import type { Caption, CaptionStyle } from '../types'
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

/**
 * Altyazıları ASS biçiminde üretir. Yazı boyutu, kısa kenar 1080 px'e göre tanımlıdır ve çıkışa ölçeklenir.
 * Zamanlar `rangeStart`'a göre kaydırılır; aralık dışı altyazılar atılır.
 */
export function buildAss(captions: Caption[], style: CaptionStyle, W: number, H: number, rangeStart = 0, rangeEnd = Infinity): string {
  const scale = Math.min(W, H) / 1080
  const fs = Math.round(style.fontSize * scale)
  const outline = Math.round(style.outlineWidth * scale * 10) / 10
  const y = Math.round(H * (0.88 - 0.76 * style.positionY))
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
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  for (const c of captions) {
    const start = c.start - rangeStart
    const end = Math.min(c.end, rangeEnd) - rangeStart
    if (end <= 0 || start >= end) continue
    const text = style.uppercase ? c.text.toLocaleUpperCase('tr-TR') : c.text
    const body = escapeAss(wrapCaption(text, style.maxCharsPerLine).join('\n'))
    lines.push(`Dialogue: 0,${assTime(Math.max(0, start))},${assTime(end)},Default,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${y})}${body}`)
  }
  return lines.join('\n') + '\n'
}
