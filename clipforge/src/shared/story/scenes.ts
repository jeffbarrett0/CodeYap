import { assColor } from '../export/ass'
import { wrapCaption } from '../timeline/captions'
import { findTeam, readableTeamColor } from './teams'
import type { StatCard, StoryContent, StoryItem, StoryTheme, StoryTone, TimelinePeriod } from './types'

/**
 * Anlatım sahneleri → ASS (libass) vektör animasyonu. ffmpeg tek geçişte videoya çevirir; ek bağımlılık yok, çıktı deterministiktir.
 * Düzen 1080 tabanlıdır ve çıkış boyutuna ölçeklenir; dikey (9:16) kareler için ayrı yerleşim kullanılır.
 */
type Pt = [number, number]
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const esc = (t: string) => t.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')
const upper = (s: string) => s.toLocaleUpperCase('tr-TR')

/** Köşeleri yuvarlatılmış dikdörtgen yolu (sol üst köşe 0,0) */
export function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2)
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
    }
  }
  arc(w - rr, rr, -Math.PI / 2)
  arc(w - rr, h - rr, 0)
  arc(rr, h - rr, Math.PI / 2)
  arc(rr, rr, Math.PI)
  return `m ${Math.round(pts[0][0])} ${Math.round(pts[0][1])} l ${pts.slice(1).map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join(' ')}`
}
const circlePath = (r: number): string => {
  const pts: Pt[] = Array.from({ length: 24 }, (_, i) => [r + r * Math.cos((i / 24) * 2 * Math.PI), r + r * Math.sin((i / 24) * 2 * Math.PI)])
  return `m ${Math.round(pts[0][0])} ${Math.round(pts[0][1])} l ${pts.slice(1).map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join(' ')}`
}

export class StoryAss {
  private lines: string[] = []
  /** 1080 tabanlı ölçek */
  readonly k: number
  constructor(readonly W: number, readonly H: number, readonly theme: StoryTheme, readonly dur: number) {
    this.k = Math.min(W, H) / 1080
  }
  get portrait(): boolean {
    return this.H > this.W
  }
  toneColor(t?: StoryTone): string {
    return t === 'good' ? this.theme.good : t === 'warn' ? this.theme.warn : t === 'bad' ? this.theme.bad : this.theme.muted
  }
  private fadeMove(from?: Pt, to?: Pt, inMs = 380, outMs = 0): string {
    const fad = `\\fad(${inMs},${outMs})`
    return from && to ? `\\move(${Math.round(from[0])},${Math.round(from[1])},${Math.round(to[0])},${Math.round(to[1])},0,${inMs})${fad}` : fad
  }
  /** Çizim: (x, y) sol üst; slide: yukarı kayarak belir */
  shape(t0: number, path: string, x: number, y: number, color: string, opacity = 1, opts: { slide?: number; layer?: number; extra?: string; end?: number; border?: { color: string; w: number } } = {}): void {
    if (t0 >= this.dur) return
    const a = Math.round((1 - clamp01(opacity)) * 255).toString(16).padStart(2, '0').toUpperCase()
    const pos = opts.slide ? this.fadeMove([x, y + opts.slide], [x, y]) : `\\pos(${Math.round(x)},${Math.round(y)})${this.fadeMove()}`
    const bord = opts.border ? `\\bord${opts.border.w}\\3c${assColor(opts.border.color)}&` : '\\bord0'
    this.lines.push(`Dialogue: ${opts.layer ?? 2},${assTime(t0)},${assTime(opts.end ?? this.dur)},Draw,,0,0,0,,{\\an7${pos}\\p1${bord}\\shad0\\1c${assColor(color)}&\\1a&H${a}&${opts.extra ?? ''}}${path}{\\p0}`)
  }
  rrect(t0: number, x: number, y: number, w: number, h: number, r: number, color: string, opacity = 1, opts: Parameters<StoryAss['shape']>[6] = {}): void {
    this.shape(t0, roundedRectPath(w, h, r), x, y, color, opacity, opts)
  }
  rect(t0: number, x: number, y: number, w: number, h: number, color: string, opacity = 1, opts: Parameters<StoryAss['shape']>[6] = {}): void {
    this.shape(t0, `m 0 0 l ${Math.round(w)} 0 l ${Math.round(w)} ${Math.round(h)} l 0 ${Math.round(h)}`, x, y, color, opacity, opts)
  }
  dot(t0: number, cx: number, cy: number, r: number, color: string, opts: Parameters<StoryAss['shape']>[6] = {}): void {
    this.shape(t0, circlePath(r), cx - r, cy - r, color, 1, opts)
  }
  /** Soldan sağa büyüyen çubuk */
  grow(t0: number, x: number, y: number, w: number, h: number, color: string, growMs = 600, opacity = 1, layer = 2): void {
    if (t0 >= this.dur) return
    const a = Math.round((1 - clamp01(opacity)) * 255).toString(16).padStart(2, '0').toUpperCase()
    this.lines.push(`Dialogue: ${layer},${assTime(t0)},${assTime(this.dur)},Draw,,0,0,0,,{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\bord0\\shad0\\1c${assColor(color)}&\\1a&H${a}&\\fscx1\\t(0,${growMs},\\fscx100)}m 0 0 l ${Math.round(w)} 0 l ${Math.round(w)} ${Math.round(h)} l 0 ${Math.round(h)}{\\p0}`)
  }
  /** Metin; style: Head | Num | Kick | Item | Small | Brand */
  text(t0: number, style: 'Head' | 'Num' | 'Kick' | 'Item' | 'Small' | 'Brand', x: number, y: number, text: string, opts: { an?: number; color?: string; slide?: number; layer?: number; fs?: number; dimAt?: { at: number; color: string }; end?: number; raw?: boolean } = {}): void {
    if (t0 >= this.dur) return
    const pos = opts.slide ? this.fadeMove([x, y + opts.slide], [x, y]) : `\\pos(${Math.round(x)},${Math.round(y)})${this.fadeMove()}`
    const col = opts.color ? `\\1c${assColor(opts.color)}&` : ''
    const fs = opts.fs ? `\\fs${Math.round(opts.fs)}` : ''
    const dim = opts.dimAt ? `\\t(${Math.round(Math.max(0, opts.dimAt.at - t0) * 1000)},${Math.round(Math.max(0, opts.dimAt.at - t0) * 1000) + 350},\\1c${assColor(opts.dimAt.color)}&)` : ''
    this.lines.push(`Dialogue: ${opts.layer ?? 5},${assTime(t0)},${assTime(opts.end ?? this.dur)},${style},,0,0,0,,{\\an${opts.an ?? 7}${pos}${col}${fs}${dim}}${opts.raw ? text : esc(text)}`)
  }
  /** Zemin: hafif ızgara ve yeşil parıltı */
  backdrop(): void {
    const { W, H, theme } = this
    for (let i = 0; i < 14; i++) {
      const r = (0.62 - i * 0.04) * W
      this.shape(0, circlePath(r), W * 0.5 - r, H * 0.62 - r, theme.accent, 0.0055, { layer: 0, extra: '' })
    }
    const step = Math.round(64 * this.k)
    for (let x = step; x < W; x += step) this.rect(0, x, 0, Math.max(1, this.k), H, theme.accent, 0.035, { layer: 0 })
    for (let y = step; y < H; y += step) this.rect(0, 0, y, W, Math.max(1, this.k), theme.accent, 0.035, { layer: 0 })
    if (theme.brand) this.text(0.2, 'Brand', W - 64 * this.k, 56 * this.k, theme.brand, { an: 9, color: theme.text })
  }
  header(kicker?: string, title?: string): number {
    const { k } = this
    const x = 80 * k
    let y = 70 * k
    if (kicker) {
      this.rect(0.1, x, y + 12 * k, 28 * k, 4 * k, this.theme.accent)
      this.text(0.1, 'Kick', x + 44 * k, y, upper(kicker))
      y += 44 * k
    }
    if (title) {
      this.text(0.2, 'Head', x, y, upper(title), { slide: 14 * k })
      y += 96 * k
    }
    return y
  }
  build(): string {
    const { W, H, theme, k } = this
    const hf = theme.fontHead.replace(/,/g, ' ')
    const bf = theme.fontBody.replace(/,/g, ' ')
    const st = (name: string, font: string, size: number, color: string, bold: number, spacing = 0) =>
      `Style: ${name},${font},${Math.round(size * k)},${assColor(color)},${assColor(color)},${assColor('#000000')},${assColor('#000000', 140)},${bold},0,0,0,100,100,${spacing},0,1,0,0,7,40,40,0,1`
    return [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${W}`,
      `PlayResY: ${H}`,
      'WrapStyle: 2',
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Draw,Arial,20,${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor('#000000')},${assColor('#000000', 128)},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
      st('Head', hf, 62, theme.text, -1),
      st('Num', hf, 150, theme.text, -1),
      st('Kick', bf, 24, theme.accent, -1, 3),
      st('Item', bf, 25, theme.text, -1),
      st('Small', bf, 21, theme.muted, -1, 1),
      st('Brand', hf, 34, theme.text, -1, 2),
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...this.lines,
      ''
    ].join('\n')
  }
}

/** Sahne süresine göre açılış zamanları: verilmemişse eşit aralıklı */
function spread(n: number, dur: number, start = 0.5): number[] {
  const span = Math.max(0.4, dur * 0.8 - start)
  return Array.from({ length: n }, (_, i) => start + (n <= 1 ? 0 : (span * i) / (n - 1)))
}

const lines = (text: string, n: number): string => wrapCaption(text, n).join('\n')

function statsScene(a: StoryAss, c: Extract<StoryContent, { type: 'stats' }>): void {
  const { W, H, k, theme } = a
  const top = a.header(c.kicker, c.title)
  const n = c.cards.length
  const auto = spread(n, a.dur, 0.5)
  const portrait = a.portrait
  const gap = 28 * k
  const areaX = 80 * k
  const areaW = W - 160 * k
  const areaY = Math.max(top, H * (portrait ? 0.22 : 0.32))
  const cw = portrait ? areaW : (areaW - gap * (n - 1)) / n
  const ch = portrait ? Math.min(280 * k, (H * 0.7 - gap * (n - 1)) / n) : Math.min(340 * k, H - areaY - 120 * k)
  c.cards.forEach((card: StatCard, i) => {
    const t = card.at !== undefined ? 0.2 + card.at : auto[i]
    const x = portrait ? areaX : areaX + i * (cw + gap)
    const y = portrait ? areaY + i * (ch + gap) : areaY
    const tone = card.tone && card.tone !== 'neutral' ? a.toneColor(card.tone) : theme.accent
    a.rrect(t, x, y, cw, ch, 22 * k, theme.card, 0.94, { slide: 26 * k, border: { color: tone, w: Math.max(1, 1.5 * k) } })
    a.rect(t, x + 22 * k, y, cw - 44 * k, 5 * k, tone, 1, { slide: 26 * k, layer: 3 })
    if (card.label) a.text(t + 0.1, 'Kick', x + 36 * k, y + 34 * k, upper(card.label), { color: tone, slide: 26 * k })
    const numFs = Math.min(150, (portrait ? 120 : 130) - Math.max(0, card.value.length - 3) * 14) * k
    const unitFs = numFs * 0.36
    const body = `${esc(card.value)}${card.unit ? `{\\fs${Math.round(unitFs)}}  ${esc(upper(card.unit))}` : ''}`
    a.text(t + 0.15, 'Num', x + 36 * k, y + (card.label ? 78 : 50) * k, body, { fs: numFs, slide: 26 * k, raw: true })
    if (card.sub) a.text(t + 0.3, 'Small', x + 36 * k, y + ch - 92 * k, lines(card.sub, Math.max(14, Math.floor(cw / (13 * k)))), { slide: 26 * k })
  })
}

function itemCard(a: StoryAss, t: number, x: number, y: number, w: number, h: number, item: StoryItem): void {
  const { k, theme } = a
  const tone = a.toneColor(item.tone)
  a.rrect(t, x, y, w, h, 12 * k, theme.card, 0.95, { slide: 16 * k, border: { color: tone, w: Math.max(1, k) }, layer: 3 })
  a.dot(t, x + 28 * k, y + h / 2, 11 * k, tone, { slide: 16 * k, layer: 4 })
  a.text(t + 0.05, 'Item', x + 54 * k, y + h / 2, lines(upper(item.text), Math.max(12, Math.floor((w - 70 * k) / (16 * k)))), { an: 4, slide: 16 * k, layer: 5, fs: 24 * k })
}

function timelineScene(a: StoryAss, c: Extract<StoryContent, { type: 'timeline' }>): void {
  const { W, H, k, theme } = a
  const top = a.header(c.kicker, c.title)
  const n = c.periods.length
  const left = 80 * k
  const colW = (W - 160 * k) / Math.max(n, 3)
  const lineY = Math.max(top + 30 * k, H * 0.3)
  const autoAt = spread(n, a.dur, 0.6)
  const times = c.periods.map((p, i) => (p.at !== undefined ? 0.2 + p.at : autoAt[i]))
  const itemH = 76 * k
  a.rect(0.4, left, lineY, W - 160 * k, 2 * k, theme.muted, 0.35)
  c.periods.forEach((p: TimelinePeriod, i) => {
    const x = left + i * colW
    const t = times[i]
    if (i > 0) a.grow(Math.max(0, t - 0.5), left + (i - 1) * colW, lineY, colW, 3 * k, theme.accent, 500)
    a.dot(t, x + 10 * k, lineY + 1 * k, 9 * k, theme.accent, { layer: 4 })
    const next = times[i + 1]
    a.text(t, 'Head', x, lineY + 26 * k, p.label, { fs: 44 * k, color: theme.accent, dimAt: next !== undefined ? { at: next, color: theme.muted } : undefined, slide: 10 * k })
    const itemAuto = spread(p.items.length, Math.max(1, (next ?? a.dur) - t), 0.5)
    p.items.forEach((it, j) => {
      const ti = it.at !== undefined ? 0.2 + it.at : t + 0.3 + itemAuto[j]
      itemCard(a, Math.max(ti, t + 0.15), x, lineY + 96 * k + j * (itemH + 14 * k), colW - 24 * k, itemH, it)
    })
  })
}

function listScene(a: StoryAss, c: Extract<StoryContent, { type: 'list' }>): void {
  const { W, H, k } = a
  const top = a.header(c.kicker, c.title)
  const auto = spread(c.items.length, a.dur, 0.5)
  const h = Math.min(92 * k, (H - top - 100 * k) / Math.max(1, c.items.length) - 14 * k)
  c.items.forEach((it, i) => itemCard(a, it.at !== undefined ? 0.2 + it.at : auto[i], 80 * k, Math.max(top, H * 0.26) + i * (h + 14 * k), Math.min(W - 160 * k, 980 * k), h, it))
}

function personScene(a: StoryAss, c: Extract<StoryContent, { type: 'person' }>): void {
  const { W, H, k, theme } = a
  const parts = c.name.trim().split(/\s+/)
  const last = parts.length > 1 ? parts.pop()! : ''
  const first = parts.join(' ') || c.name
  const x = 80 * k
  let y = H * (a.portrait ? 0.5 : 0.52)
  if (c.role) {
    const w = (c.role.length * 15 + 40) * k
    a.rect(0.2, x, y, w, 40 * k, theme.accent, 1, { slide: 20 * k })
    a.text(0.25, 'Kick', x + 18 * k, y + 8 * k, upper(c.role), { color: '#0A0A0A', slide: 20 * k, fs: 22 * k })
    y += 62 * k
  }
  const w1 = Math.min(W - 160 * k, (first.length * 40 + 60) * k)
  a.rect(0.3, x, y, w1, 88 * k, '#000000', 0.82, { slide: 20 * k })
  a.text(0.35, 'Head', x + 24 * k, y + 12 * k, upper(first), { fs: 58 * k, slide: 20 * k })
  y += 96 * k
  if (last) {
    const w2 = Math.min(W - 160 * k, (last.length * 78 + 70) * k)
    a.rect(0.45, x, y, w2, 150 * k, '#000000', 0.82, { slide: 20 * k })
    a.text(0.5, 'Head', x + 28 * k, y + 14 * k, upper(last), { fs: 108 * k, slide: 20 * k })
    y += 160 * k
  }
  if (c.sub) {
    const w3 = (c.sub.length * 14 + 40) * k
    a.rect(0.65, x, y, w3, 40 * k, theme.accent, 1, { slide: 20 * k })
    a.text(0.7, 'Kick', x + 18 * k, y + 8 * k, upper(c.sub), { color: '#0A0A0A', slide: 20 * k, fs: 21 * k })
  }
}

function quoteScene(a: StoryAss, c: Extract<StoryContent, { type: 'quote' }>): void {
  const { W, H, k, theme } = a
  a.text(0.2, 'Num', 110 * k, H * 0.2, '“', { color: theme.accent, fs: 230 * k })
  a.text(0.45, 'Head', 120 * k, H * 0.4, lines(c.text, a.portrait ? 18 : 34), { fs: 54 * k, slide: 18 * k })
  if (c.by) a.text(1.2, 'Kick', 124 * k, H * 0.4 + (Math.ceil(c.text.length / (a.portrait ? 18 : 34)) * 66 + 50) * k, `— ${upper(c.by)}`)
  void W
}

function titleScene(a: StoryAss, c: Extract<StoryContent, { type: 'title'; text: string }>): void {
  const { W, H, k, theme } = a
  const bw = Math.min(W * 0.5, 760 * k)
  a.grow(0.2, (W - bw) / 2, H * 0.5 + 70 * k, bw, 6 * k, theme.accent, 700)
  a.text(0.15, 'Head', W / 2, H * 0.5, lines(upper(c.text), a.portrait ? 14 : 26), { an: 5, fs: 76 * k, slide: 20 * k })
  if (c.sub) a.text(0.5, 'Kick', W / 2, H * 0.5 + 118 * k, upper(c.sub), { an: 5 })
}


const fmtVal = (v: number | null | undefined): string => (v === null || v === undefined ? '' : Number.isInteger(v) ? String(v) : String(v).replace('.', ','))

function leaderboardScene(a: StoryAss, c: Extract<StoryContent, { type: 'leaderboard' }>): void {
  const { W, H, k, theme } = a
  const top = a.header(c.kicker, c.title)
  const rows = c.rows.slice(0, 10)
  const n = rows.length
  if (n === 0) return
  const x0 = 80 * k
  const rowH = Math.min(92 * k, (H - top - 150 * k) / n)
  const gap = Math.min(14 * k, rowH * 0.16)
  const barX = x0 + (a.portrait ? 360 : 520) * k
  const barMax = W - 80 * k - barX - 150 * k
  const vals = rows.map((r) => (typeof r.value === 'number' ? r.value : 0))
  const max = Math.max(...vals, 1)
  const order = c.reveal === 'down' ? rows.map((_, i) => i) : rows.map((_, i) => n - 1 - i) // varsayılan: sondan başa (birinci en son belirir)
  const auto = spread(n, a.dur, 0.5)
  const top0 = Math.max(top, H * 0.24)
  rows.forEach((r, i) => {
    const t = r.at !== undefined ? 0.2 + r.at : auto[order.indexOf(i)]
    const y = top0 + i * (rowH + gap)
    const hl = !!r.highlight
    const color = readableTeamColor(r.team, theme, hl ? theme.accent : theme.muted)
    a.rrect(t, x0, y, W - 160 * k, rowH, 14 * k, hl ? '#2A2410' : theme.card, 0.95, { slide: 18 * k, border: { color: hl ? theme.accent : '#2B2B2B', w: Math.max(1, (hl ? 2.5 : 1) * k) }, layer: 2 })
    const rank = r.rank ?? i + 1
    a.text(t + 0.05, 'Head', x0 + 26 * k, y + rowH / 2, String(rank), { an: 4, fs: rowH * 0.5, color: hl ? theme.accent : theme.muted, slide: 18 * k, layer: 5 })
    const nameFs = Math.min(rowH * 0.36, 30 * k)
    a.text(t + 0.1, 'Item', x0 + 96 * k, y + rowH / 2 - (r.team || r.note ? nameFs * 0.35 : 0), upper(r.name), { an: 4, fs: nameFs, slide: 18 * k, layer: 5, color: hl ? theme.text : theme.text })
    const sub = [r.team, r.note].filter(Boolean).join(' · ')
    if (sub) a.text(t + 0.1, 'Small', x0 + 96 * k, y + rowH / 2 + nameFs * 0.62, upper(sub), { an: 4, fs: Math.min(rowH * 0.24, 19 * k), slide: 18 * k, layer: 5 })
    if (typeof r.value === 'number') {
      const w = Math.max(6 * k, (r.value / max) * barMax)
      a.grow(t + 0.15, barX, y + rowH * 0.3, w, rowH * 0.4, color, 700, 1, 4)
      a.text(t + 0.7, 'Head', barX + w + 16 * k, y + rowH / 2, `${fmtVal(r.value)}${c.metric ? ' ' + c.metric : ''}`, { an: 4, fs: Math.min(rowH * 0.4, 32 * k), color: hl ? theme.accent : theme.text, layer: 5 })
    }
  })
  if (c.note) a.text(1.0, 'Small', 80 * k, H - 92 * k, upper(c.note), { an: 1 })
}

function compareScene(a: StoryAss, c: Extract<StoryContent, { type: 'compare' }>): void {
  const { W, H, k, theme } = a
  const top = a.header(c.kicker, c.title)
  const lc = readableTeamColor(c.left.team, theme, theme.accent)
  let rc = readableTeamColor(c.right.team, theme, '#E8E8E8')
  if (rc === lc) rc = '#E8E8E8'
  const cx = W / 2
  const side = (s: typeof c.left, x: number, an: number, col: string) => {
    a.text(0.3, 'Head', x, Math.max(top, H * 0.24), upper(s.name), { an, fs: 54 * k, color: col, slide: 14 * k })
    if (s.team) a.text(0.4, 'Small', x, Math.max(top, H * 0.24) + 70 * k, upper(s.team), { an })
  }
  side(c.left, cx - 70 * k, 9, lc)
  side(c.right, cx + 70 * k, 7, rc)
  const ms = c.metrics.slice(0, 6)
  const auto = spread(ms.length, a.dur, 0.8)
  const rowH = Math.min(100 * k, (H - top - 330 * k) / Math.max(1, ms.length))
  const maxW = W / 2 - 330 * k
  ms.forEach((m, i) => {
    const t = m.at !== undefined ? 0.2 + m.at : auto[i]
    const y = Math.max(top, H * 0.24) + 130 * k + i * rowH
    const mx = Math.max(m.left, m.right, 1e-9)
    const lw = Math.max(6 * k, (m.left / mx) * maxW)
    const rw = Math.max(6 * k, (m.right / mx) * maxW)
    a.text(t, 'Small', cx, y - 6 * k, upper(m.label), { an: 8, fs: 22 * k, color: theme.muted })
    // sol çubuk sola doğru büyür: sağ kenar merkeze yaslı; ASS'te soldan büyüme olduğundan sabit dikdörtgen + belirme kullanılır
    a.rect(t + 0.1, cx - 40 * k - lw, y + 22 * k, lw, rowH * 0.34, lc, 1, { slide: 14 * k, layer: 3 })
    a.rect(t + 0.1, cx + 40 * k, y + 22 * k, rw, rowH * 0.34, rc, 1, { slide: 14 * k, layer: 3 })
    const better = (side2: number, other: number) => (m.lowerBetter ? side2 < other : side2 > other)
    a.text(t + 0.3, 'Head', cx - 52 * k - lw, y + 22 * k + rowH * 0.17, fmtVal(m.left), { an: 6, fs: 36 * k, color: better(m.left, m.right) ? theme.accent : theme.text, layer: 5 })
    a.text(t + 0.3, 'Head', cx + 52 * k + rw, y + 22 * k + rowH * 0.17, fmtVal(m.right), { an: 4, fs: 36 * k, color: better(m.right, m.left) ? theme.accent : theme.text, layer: 5 })
  })
}

function teamcardScene(a: StoryAss, c: Extract<StoryContent, { type: 'teamcard' }>): void {
  const { W, H, k, theme } = a
  const team = findTeam(c.team)
  const top = a.header(c.kicker ?? 'TAKIM', undefined)
  const name = team?.name ?? c.team
  const x0 = 80 * k
  const y0 = Math.max(top, H * 0.26)
  a.text(0.2, 'Head', x0, y0, lines(upper(name), a.portrait ? 14 : 22), { fs: 96 * k, slide: 16 * k })
  // forma şeridi: desen (düz / yarım / çubuklu)
  const kit = team?.home
  const bw = Math.min(W - 160 * k, 760 * k)
  const by = y0 + 150 * k
  const bh = 44 * k
  if (kit) {
    if (kit.pattern === 'halves') {
      a.rect(0.4, x0, by, bw / 2, bh, kit.primary, 1, { slide: 12 * k })
      a.rect(0.4, x0 + bw / 2, by, bw / 2, bh, kit.secondary, 1, { slide: 12 * k })
    } else if (kit.pattern === 'stripes') {
      const n = 10
      for (let i = 0; i < n; i++) a.rect(0.4, x0 + (bw / n) * i, by, bw / n + 1, bh, i % 2 ? kit.secondary : kit.primary, 1, { slide: 12 * k })
    } else a.rect(0.4, x0, by, bw, bh, kit.primary, 1, { slide: 12 * k })
  }
  const facts = (c.facts ?? []).slice(0, 4)
  const fy = by + 90 * k
  const cw = Math.min(520 * k, (W - 160 * k - 24 * k * (Math.min(facts.length, 2) - 1)) / Math.max(1, Math.min(facts.length, 2)))
  const accent = readableTeamColor(c.team, theme, theme.accent)
  facts.forEach((f, i) => {
    const t = 0.9 + i * 0.45
    const x = x0 + (i % 2) * (cw + 24 * k)
    const y = fy + Math.floor(i / 2) * 150 * k
    a.rrect(t, x, y, cw, 128 * k, 16 * k, theme.card, 0.95, { slide: 20 * k, border: { color: accent, w: Math.max(1, 1.5 * k) } })
    a.text(t + 0.05, 'Kick', x + 26 * k, y + 20 * k, upper(f.label), { color: accent, slide: 20 * k, fs: 19 * k })
    a.text(t + 0.15, 'Head', x + 26 * k, y + 56 * k, f.value, { fs: 38 * k, slide: 20 * k })
  })
}

/** Medya sahnesi: görüntünün üstüne alt gölge + sarı çizgi + başlık/yazı (görüntünün kendisi ffmpeg'de hazırlanır) */
function mediaScene(a: StoryAss, c: Extract<StoryContent, { type: 'media' }>): void {
  const { W, H, k, theme } = a
  if (!c.title && !c.caption) return
  const barH = (c.caption && c.title ? 300 : 230) * k
  for (let i = 0; i < 14; i++) a.rect(0, 0, H - barH + (i * barH) / 14, W, barH / 14 + 1, '#000000', 0.06 + i * 0.05, { layer: 1 })
  let y = H - 120 * k
  if (c.caption) {
    a.text(0.3, 'Head', 80 * k, y, lines(upper(c.caption), a.portrait ? 24 : 46), { an: 1, fs: 46 * k, slide: 14 * k })
    y -= (Math.ceil(c.caption.length / (a.portrait ? 24 : 46)) * 56 + 14) * k
  }
  if (c.title) {
    a.rect(0.2, 80 * k, y - 36 * k, 28 * k, 4 * k, theme.accent)
    a.text(0.2, 'Kick', 124 * k, y - 44 * k, upper(c.title), { an: 1 })
  }
}

/** Harita dışındaki sahnelerin tam ASS metni. Harita sahnesi `main/story/render.ts` içinde mevcut harita çiziciyle yapılır. */
export function buildStoryAss(content: Exclude<StoryContent, { type: 'place' }>, theme: StoryTheme, W: number, H: number, dur: number): string {
  const a = new StoryAss(W, H, theme, dur)
  if ('source' in content && typeof content.source === 'string' && content.source) a.text(0.8, 'Small', 80 * a.k, H - 50 * a.k, `KAYNAK: ${upper(content.source)}`, { an: 1, slide: 0 })
  switch (content.type) {
    case 'stats':
      statsScene(a, content)
      break
    case 'timeline':
      timelineScene(a, content)
      break
    case 'list':
      listScene(a, content)
      break
    case 'person':
      personScene(a, content)
      break
    case 'quote':
      quoteScene(a, content)
      break
    case 'title':
      titleScene(a, content)
      break
    case 'media':
      mediaScene(a, content)
      break
    case 'leaderboard':
      leaderboardScene(a, content)
      break
    case 'compare':
      compareScene(a, content)
      break
    case 'teamcard':
      teamcardScene(a, content)
      break
  }
  return a.build()
}

/** Tüm sahnelerin ortak zemini (ızgara + parıltı + marka): bir kez PNG'ye çizilip her sahnede arka plan olarak kullanılır — kodlama çok hızlanır */
export function buildBackdropAss(theme: StoryTheme, W: number, H: number): string {
  const a = new StoryAss(W, H, theme, 4)
  a.backdrop()
  return a.build()
}
