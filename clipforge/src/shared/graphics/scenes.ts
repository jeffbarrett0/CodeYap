import { assColor } from '../export/ass'
import { ease, fromVec, orthographic, slerp, toVec, type Country, type Place, type World } from './geo'

/**
 * Hareketli grafik sahneleri (2D harita, 3D küre, başlık, grafik) — ASS vektör çizimi olarak üretilir ve ffmpeg'in
 * libass'ı ile videoya çevrilir. Ek bağımlılık yok; çıktı deterministiktir. 3D küre gerçek ortografik izdüşümle kare kare hesaplanır.
 */
export interface SceneBase {
  width: number
  height: number
  fps: number
  durationSec: number
  /** zemin rengi (ffmpeg color kaynağı için de kullanılır) */
  bg: string
  accent: string
  fontFamily?: string
}
export interface GlobeSpec extends SceneBase {
  type: 'globe'
  to: Place
  from?: Place
  label?: string
  sub?: string
  /** rota üzerinde giden araç (varsayılan: from varsa uçak) */
  vehicle?: 'plane' | 'none'
}
export interface MapSpec extends SceneBase {
  type: 'map'
  to: Place
  from?: Place
  label?: string
  sub?: string
  vehicle?: 'plane' | 'none'
}
export interface TitleSpec extends SceneBase {
  type: 'title'
  text: string
  sub?: string
}
export interface ChartSpec extends SceneBase {
  type: 'chart'
  title?: string
  data: { label: string; value: number }[]
}
export type SceneSpec = GlobeSpec | MapSpec | TitleSpec | ChartSpec

export const DEFAULT_SCENE: Omit<SceneBase, 'width' | 'height'> = { fps: 30, durationSec: 4, bg: '#0B1220', accent: '#FFE600', fontFamily: 'Impact' }

type Pt = [number, number]
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const esc = (t: string) => t.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')

const path = (pts: Pt[]): string => (pts.length < 3 ? '' : `m ${Math.round(pts[0][0])} ${Math.round(pts[0][1])} l ${pts.slice(1).map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join(' ')}`)

/** Ardışık noktalar arasında `min` pikselden yakın olanları atar */
function decimate(pts: Pt[], min: number): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) out.push(p)
  }
  return out
}

function circle(cx: number, cy: number, r: number, n = 28): Pt[] {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)] as Pt)
}

/** Çoklu çizgiyi `w` kalınlığında dolu çokgene çevirir (ASS çizimlerinde çizgi yok) */
export function strokePolygon(pts: Pt[], w: number): Pt[] {
  if (pts.length < 2) return []
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * (w / 2)
    const ny = (dx / len) * (w / 2)
    left.push([pts[i][0] + nx, pts[i][1] + ny])
    right.push([pts[i][0] - nx, pts[i][1] - ny])
  }
  return [...left, ...right.reverse()]
}

/** Uçak silüeti (burun +x yönünde); merkez (cx,cy), boyut s px, açı rad */
export function planePoly(cx: number, cy: number, s: number, ang: number): Pt[] {
  const P: Pt[] = [[1, 0], [0.35, 0.12], [0.2, 0.12], [-0.15, 0.78], [-0.35, 0.78], [-0.2, 0.12], [-0.7, 0.1], [-0.9, 0.38], [-1, 0.38], [-0.92, 0], [-1, -0.38], [-0.9, -0.38], [-0.7, -0.1], [-0.2, -0.12], [-0.35, -0.78], [-0.15, -0.78], [0.2, -0.12], [0.35, -0.12]]
  const c = Math.cos(ang)
  const si = Math.sin(ang)
  return P.map(([x, y]) => [cx + (x * c - y * si) * s, cy + (x * si + y * c) * s] as Pt)
}

class Ass {
  private lines: string[] = []
  constructor(readonly s: SceneBase) {}

  /** hex renk, opaklık 0..1 */
  draw(t0: number, t1: number, pts: Pt[] | string, color: string, opacity = 1, extra = '', layer = 0): void {
    const p = typeof pts === 'string' ? pts : path(pts)
    if (!p || t1 <= t0) return
    const a = Math.round((1 - clamp01(opacity)) * 255)
    this.lines.push(`Dialogue: ${layer},${assTime(t0)},${assTime(t1)},Draw,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c${assColor(color)}&\\1a&H${a.toString(16).padStart(2, '0').toUpperCase()}&${extra}}${p}{\\p0}`)
  }
  /** kenarlıklı çizim (kıyı çizgisi) */
  drawBorder(t0: number, t1: number, pts: Pt[], fill: string, border: string, bw: number, layer = 0): void {
    const p = path(pts)
    if (!p || t1 <= t0) return
    this.lines.push(`Dialogue: ${layer},${assTime(t0)},${assTime(t1)},Draw,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord${bw}\\shad0\\1c${assColor(fill)}&\\3c${assColor(border)}&}${p}{\\p0}`)
  }
  text(t0: number, t1: number, style: 'Big' | 'Mid' | 'Small', x: number, y: number, text: string, tags = '', layer = 5, an = 5): void {
    this.lines.push(`Dialogue: ${layer},${assTime(t0)},${assTime(t1)},${style},,0,0,0,,{\\an${an}\\pos(${Math.round(x)},${Math.round(y)})${tags}}${esc(text)}`)
  }
  /** Soldan sağa büyüyen dikdörtgen (\fscx animasyonu); sol üst köşe (x, y) */
  growRect(t0: number, t1: number, x: number, y: number, w: number, h: number, color: string, growSec = 0.6, layer = 3): void {
    const p = `m 0 0 l ${Math.round(w)} 0 l ${Math.round(w)} ${Math.round(h)} l 0 ${Math.round(h)}`
    this.lines.push(`Dialogue: ${layer},${assTime(t0)},${assTime(t1)},Draw,,0,0,0,,{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\bord0\\shad0\\1c${assColor(color)}&\\fscx1\\t(0,${Math.round(growSec * 1000)},\\fscx100)}${p}{\\p0}`)
  }
  build(): string {
    const { width: W, height: H, accent } = this.s
    const font = (this.s.fontFamily ?? 'Impact').replace(/,/g, ' ')
    const m = Math.min(W, H)
    const big = Math.round(m * 0.1)
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
      `Style: Big,${font},${big},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor('#000000')},${assColor('#000000', 120)},-1,-1,0,0,100,100,0,0,1,${Math.round(big * 0.07)},3,5,40,40,0,1`,
      `Style: Mid,${font},${Math.round(big * 0.6)},${assColor(accent)},${assColor(accent)},${assColor('#000000')},${assColor('#000000', 120)},-1,-1,0,0,100,100,0,0,1,${Math.round(big * 0.05)},2,5,40,40,0,1`,
      `Style: Small,${font},${Math.round(big * 0.42)},${assColor('#DDE6F5')},${assColor('#DDE6F5')},${assColor('#000000')},${assColor('#000000', 120)},0,0,0,0,100,100,0,0,1,${Math.round(big * 0.03)},1,5,40,40,0,1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...this.lines,
      ''
    ].join('\n')
  }
}

const OCEAN = '#10223E'
const LAND = '#2F4C78'
const COAST = '#5C82B8'

function countryOf(world: World, p?: Place): Country | undefined {
  return p?.iso ? world.countries.find((c) => c.iso === p.iso) : undefined
}

function labels(a: Ass, s: SceneBase, label: string, sub: string | undefined, y: number): void {
  const d = s.durationSec
  const t0 = d * 0.42
  a.text(t0, d, 'Big', s.width / 2, y, label, `\\fad(300,0)\\fscx70\\fscy70\\t(0,350,\\fscx100\\fscy100)`)
  if (sub) a.text(t0 + 0.25, d, 'Small', s.width / 2, y + Math.round(Math.min(s.width, s.height) * 0.095), sub, '\\fad(300,0)')
}

/** Basılı noktadan nabız atan halka ve nokta */
function marker(a: Ass, t0: number, t1: number, x: number, y: number, r: number, accent: string, tNow: number): void {
  const pulse = ((tNow - t0) * 0.9) % 1
  a.draw(t0, t1, circle(x, y, r * (1 + 3 * pulse)), accent, 0.45 * (1 - pulse), '', 3)
  a.draw(t0, t1, circle(x, y, r * 1.5), '#000000', 0.6, '', 3)
  a.draw(t0, t1, circle(x, y, r), accent, 1, '', 4)
}

// ───────────────────────────── 3D KÜRE ─────────────────────────────

export function buildGlobe(spec: GlobeSpec, world: World): string {
  const { width: W, height: H, fps, durationSec: dur, accent } = spec
  const a = new Ass(spec)
  const frames = Math.max(1, Math.round(dur * fps))
  const R0 = Math.min(W * 0.46, H * 0.33)
  const cx = W / 2
  const cy = H * 0.4
  const hi = countryOf(world, spec.to)
  const hiFrom = countryOf(world, spec.from)
  const startLon = spec.from ? spec.from.lon : spec.to.lon - 80
  const startLat = spec.from ? spec.from.lat * 0.6 : 12
  const endLat = spec.to.lat * 0.75
  let dLon = spec.to.lon - startLon
  while (dLon > 180) dLon -= 360
  while (dLon < -180) dLon += 360
  const vFrom = spec.from ? toVec(spec.from.lon, spec.from.lat) : null
  const vTo = toVec(spec.to.lon, spec.to.lat)

  for (let i = 0; i < frames; i++) {
    const t0 = Math.round((i / fps) * 100) / 100
    const t1 = Math.round(((i + 1) / fps) * 100) / 100
    const u = i / frames
    const e = ease.inOut(clamp01((u - 0.04) / 0.62))
    const lon0 = startLon + dLon * e
    const lat0 = lerp(startLat, endLat, e)
    const R = R0 * (0.9 + 0.1 * ease.outCubic(u / 0.8))
    const proj = (lon: number, lat: number, lift = 1) => {
      const p = orthographic(lon, lat, lon0, lat0, lift)
      return { x: cx + R * p.x, y: cy - R * p.y, cosc: p.cosc, nx: p.x, ny: p.y }
    }
    // okyanus + hafif hale
    a.draw(t0, t1, circle(cx, cy, R * 1.05, 60), '#1B3A66', 0.35, '', 0)
    a.draw(t0, t1, circle(cx, cy, R, 72), OCEAN, 1, '', 1)
    for (const c of world.countries) {
      const isHi = c === hi || c === hiFrom
      for (const poly of c.polys) {
        const pts: Pt[] = []
        let front = 0
        for (const [lon, lat] of poly) {
          const p = proj(lon, lat)
          if (p.cosc >= 0) {
            front++
            pts.push([p.x, p.y])
          } else {
            // arka yüz: kenar çemberine it (kıyıdan taşmasın)
            const l = Math.hypot(p.nx, p.ny) || 1
            pts.push([cx + (R * p.nx) / l, cy - (R * p.ny) / l])
          }
        }
        if (front === 0) continue
        const d = decimate(pts, 1.4)
        if (d.length < 3) continue
        a.drawBorder(t0, t1, d, isHi ? (c === hi ? accent : '#7C9CC6') : LAND, isHi ? '#FFFFFF' : COAST, isHi ? 2 : 1, 2)
      }
    }
    // rota yayı (yüzeyden yükselen)
    if (vFrom) {
      const prog = ease.inOut(clamp01((u - 0.32) / 0.42))
      const N = 72
      let run: Pt[] = []
      let tail: Pt[] = []
      const flush = () => {
        if (run.length >= 2) a.draw(t0, t1, strokePolygon(run, Math.max(3, R * 0.012)), accent, 1, '', 4)
        run = []
      }
      for (let k = 0; k <= N; k++) {
        const s = k / N
        if (s > prog) break
        const ll = fromVec(slerp(vFrom, vTo, s))
        const lift = 1 + 0.16 * Math.sin(Math.PI * s)
        const base = orthographic(ll.lon, ll.lat, lon0, lat0, 1)
        if (base.cosc < 0.03) {
          flush()
          continue
        }
        const p = orthographic(ll.lon, ll.lat, lon0, lat0, lift)
        run.push([cx + R * p.x, cy - R * p.y])
        tail = run.slice(-2)
      }
      flush()
      if (spec.vehicle !== 'none' && tail.length === 2 && prog > 0.02) {
        const ang = Math.atan2(tail[1][1] - tail[0][1], tail[1][0] - tail[0][0])
        a.draw(t0, t1, planePoly(tail[1][0], tail[1][1], R * 0.075, ang), '#000000', 0.55, '', 6)
        a.draw(t0, t1, planePoly(tail[1][0], tail[1][1], R * 0.062, ang), '#FFFFFF', 1, '', 7)
      }
      const pf = proj(spec.from!.lon, spec.from!.lat)
      if (pf.cosc > 0.05) a.draw(t0, t1, circle(pf.x, pf.y, R * 0.022), '#FFFFFF', 1, '', 4)
    }
    // hedef işareti
    const pt = proj(spec.to.lon, spec.to.lat)
    const mu = clamp01((u - 0.6) / 0.12)
    if (pt.cosc > 0.1 && mu > 0) marker(a, t0, t1, pt.x, pt.y, R * 0.03 * ease.outCubic(mu), accent, t0)
  }
  labels(a, spec, spec.label ?? spec.to.name, spec.sub, Math.min(H * 0.83, cy + R0 + Math.min(W, H) * 0.1))
  return a.build()
}

// ───────────────────────────── 2D HARİTA ─────────────────────────────

function bbox(c: Country | undefined): { lon: [number, number]; lat: [number, number] } | null {
  if (!c) return null
  let l0 = 999, l1 = -999, a0 = 999, a1 = -999
  for (const poly of c.polys) for (const [lo, la] of poly) (l0 = Math.min(l0, lo), l1 = Math.max(l1, lo), a0 = Math.min(a0, la), a1 = Math.max(a1, la))
  return { lon: [l0, l1], lat: [a0, a1] }
}

export function buildMap(spec: MapSpec, world: World): string {
  const { width: W, height: H, fps, durationSec: dur, accent } = spec
  const a = new Ass(spec)
  const frames = Math.max(1, Math.round(dur * fps))
  const hi = countryOf(world, spec.to)
  const cyScreen = H * 0.46
  const mid: Place = spec.from ? { name: '', lon: (spec.from.lon + spec.to.lon) / 2, lat: (spec.from.lat + spec.to.lat) / 2 } : spec.to
  // son kare ölçeği
  const bb = bbox(hi)
  const cosM = Math.cos((mid.lat * Math.PI) / 180)
  let spanLon = (bb ? bb.lon[1] - bb.lon[0] : 14) * 1.5
  let spanLat = (bb ? bb.lat[1] - bb.lat[0] : 10) * 1.5
  if (spec.from) {
    spanLon = Math.max(spanLon, Math.abs(spec.to.lon - spec.from.lon) * 1.7)
    spanLat = Math.max(spanLat, Math.abs(spec.to.lat - spec.from.lat) * 2.2)
  }
  const k0 = (W / 360) * 1.25
  const k1 = Math.min(Math.max(Math.min((W * 0.86) / (spanLon * cosM), (H * 0.5) / spanLat), k0), W / 7)
  const c0 = { lon: 15, lat: 25 }
  const arcPts = (s: number, proj: (lon: number, lat: number) => Pt): Pt[] => {
    if (!spec.from) return []
    const p0 = proj(spec.from.lon, spec.from.lat)
    const p1 = proj(spec.to.lon, spec.to.lat)
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const ctrl: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - dist * 0.28]
    const out: Pt[] = []
    const n = 48
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * s
      out.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * ctrl[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * ctrl[1] + t * t * p1[1]])
    }
    return out
  }

  for (let i = 0; i < frames; i++) {
    const t0 = Math.round((i / fps) * 100) / 100
    const t1 = Math.round(((i + 1) / fps) * 100) / 100
    const u = i / frames
    const e = ease.inOut(clamp01((u - 0.05) / 0.6))
    const k = k0 * (k1 / k0) ** e
    const clon = lerp(c0.lon, mid.lon, e)
    const clat = lerp(c0.lat, mid.lat, e)
    const cosc = Math.cos((clat * Math.PI) / 180)
    const proj = (lon: number, lat: number): Pt => [W / 2 + (lon - clon) * cosc * k, cyScreen - (lat - clat) * k]
    for (const c of world.countries) {
      const isHi = c === hi
      for (const poly of c.polys) {
        const pts = decimate(poly.map(([lo, la]) => proj(lo, la)), 1.5)
        if (pts.length < 3) continue
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
        for (const [x, y] of pts) (x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y))
        if (x1 < -50 || x0 > W + 50 || y1 < -50 || y0 > H + 50) continue
        a.drawBorder(t0, t1, pts, isHi ? accent : LAND, isHi ? '#FFFFFF' : COAST, isHi ? 3 : 1.2, 1)
      }
    }
    if (spec.from) {
      const prog = ease.inOut(clamp01((u - 0.4) / 0.4))
      const line = arcPts(prog, proj)
      if (prog > 0.01) a.draw(t0, t1, strokePolygon(line, Math.max(4, W * 0.006)), accent, 1, '', 4)
      const pf = proj(spec.from.lon, spec.from.lat)
      a.draw(t0, t1, circle(pf[0], pf[1], W * 0.011), '#FFFFFF', 1, '', 4)
      if (prog > 0.01 && prog < 0.995) {
        const head = line[line.length - 1]
        const prev = line[Math.max(0, line.length - 3)]
        if (spec.vehicle === 'none') a.draw(t0, t1, circle(head[0], head[1], W * 0.012), '#FFFFFF', 1, '', 5)
        else {
          const ang = Math.atan2(head[1] - prev[1], head[0] - prev[0])
          a.draw(t0, t1, planePoly(head[0], head[1], W * 0.034, ang), '#000000', 0.55, '', 5)
          a.draw(t0, t1, planePoly(head[0], head[1], W * 0.028, ang), '#FFFFFF', 1, '', 6)
        }
      }
    }
    const pt = proj(spec.to.lon, spec.to.lat)
    const mu = clamp01((u - 0.62) / 0.12)
    if (mu > 0) marker(a, t0, t1, pt[0], pt[1], W * 0.014 * ease.outCubic(mu), accent === '#FFFFFF' ? '#FF3B30' : '#FF3B30', t0)
  }
  labels(a, spec, spec.label ?? spec.to.name, spec.sub, Math.min(H * 0.83, cyScreen + H * 0.36))
  return a.build()
}

// ───────────────────────────── BAŞLIK ─────────────────────────────

export function buildTitle(spec: TitleSpec): string {
  const { width: W, height: H, durationSec: dur, accent } = spec
  const a = new Ass(spec)
  const y = H * 0.5
  // vurgu çizgisi soldan büyür
  const barW = W * 0.5
  a.growRect(0.15, dur, (W - barW) / 2, y + Math.min(W, H) * 0.075, barW, Math.max(6, H * 0.008), accent, 0.7)
  a.text(0.1, dur, 'Big', W / 2, y, spec.text, '\\fad(250,200)\\fscx80\\fscy80\\t(0,400,\\fscx100\\fscy100)')
  if (spec.sub) a.text(0.35, dur, 'Small', W / 2, y + Math.min(W, H) * 0.12, spec.sub, '\\fad(300,200)')
  return a.build()
}

// ───────────────────────────── GRAFİK ─────────────────────────────

export function buildChart(spec: ChartSpec): string {
  const { width: W, height: H, durationSec: dur, accent } = spec
  const a = new Ass(spec)
  const data = spec.data.slice(0, 8)
  const max = Math.max(...data.map((d) => d.value), 1)
  const left = W * 0.08
  const maxW = W * 0.62
  const top = H * (spec.title ? 0.26 : 0.18)
  const rowH = Math.min(H * 0.09, (H * 0.62) / Math.max(1, data.length))
  const barH = rowH * 0.62
  if (spec.title) a.text(0.05, dur, 'Big', W / 2, H * 0.14, spec.title, '\\fad(250,200)')
  data.forEach((d, i) => {
    const y = top + i * rowH
    const t0 = 0.3 + i * 0.18
    const w = Math.max(4, (d.value / max) * maxW)
    // çubuk: sağa doğru büyür (\fscx animasyonu)
    a.growRect(t0, dur, left, y, w, barH, i === 0 ? accent : '#5C82B8', 0.7)
    a.text(t0 + 0.6, dur, 'Small', left + w + W * 0.02, y + barH / 2, String(d.value), '\\fad(200,0)', 6, 4)
    a.text(t0, dur, 'Small', left, y - barH * 0.38, d.label, '\\fad(200,0)', 6, 4)
  })
  return a.build()
}
