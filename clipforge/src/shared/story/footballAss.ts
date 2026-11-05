import { assColor } from '../export/ass'
import { strokePolygon } from '../graphics/scenes'
import { hexRgb, Raster } from './raster'
import { resolveKits, type Kit, type ResolvedKits } from './teams'
import { GOAL_TARGETS, PITCH_L, PITCH_W, simulateFootball, type FootballSim } from './football'
import type { FbCameraMode, FootballContent, StoryTheme } from './types'

type V3 = [number, number, number]
type Pt = [number, number]
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const smooth = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}
const assTime = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100))
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
const esc = (t: string) => t.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, ' ')

/** Kamera konumu/hedefi: mod, hedefe göre ofset ve görüş açısı */
const MODES: Record<FbCameraMode, { off: V3; fov: number }> = {
  broadcast: { off: [0, -34, 21], fov: 42 },
  follow: { off: [-7, -21, 11], fov: 42 },
  top: { off: [0, -3, 62], fov: 40 },
  behind: { off: [-21, 0, 8], fov: 44 },
  goal: { off: [23, 0, 8.5], fov: 44 }
}

interface Cam { e: V3; r: V3; u: V3; f: V3; F: number; W: number; H: number }
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

function makeCam(e: V3, target: V3, fovDeg: number, W: number, H: number): Cam {
  const f = norm(sub3(target, e))
  let r = cross(f, [0, 0, 1])
  if (Math.hypot(...r) < 1e-4) r = [1, 0, 0]
  r = norm(r)
  const u = cross(r, f)
  return { e, r, u, f, F: H / 2 / Math.tan((fovDeg * Math.PI) / 360), W, H }
}
/** Dünya → görünüm uzayı (cx, cy, cz) */
const view = (c: Cam, p: V3): V3 => {
  const v = sub3(p, c.e)
  return [dot(v, c.r), dot(v, c.u), dot(v, c.f)]
}
const NEAR = 0.6
const toScreen = (c: Cam, v: V3): Pt => [c.W / 2 + (v[0] / v[2]) * c.F, c.H / 2 - (v[1] / v[2]) * c.F]
const project = (c: Cam, p: V3): { s: Pt; z: number } | null => {
  const v = view(c, p)
  return v[2] < NEAR ? null : { s: toScreen(c, v), z: v[2] }
}
/** Çokgeni yakın düzleme göre keser (Sutherland–Hodgman) ve ekrana yansıtır */
function projectPoly(c: Cam, pts: V3[]): Pt[] {
  const vs = pts.map((p) => view(c, p))
  const out: V3[] = []
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i]
    const b = vs[(i + 1) % vs.length]
    const ain = a[2] >= NEAR
    const bin = b[2] >= NEAR
    if (ain) out.push(a)
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2])
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR])
    }
  }
  return out.map((v) => toScreen(c, v))
}
/** Yeryüzü çizgisi (polyline): görünür parçaları ekranda kalın şerit yapar; kalınlık metre cinsinden */
function ribbon(c: Cam, pts: V3[], widthM: number): Pt[][] {
  const runs: { s: Pt; z: number }[][] = [[]]
  for (const p of pts) {
    const q = project(c, p)
    if (q) runs[runs.length - 1].push(q)
    else if (runs[runs.length - 1].length) runs.push([])
  }
  return runs.filter((r) => r.length >= 2).map((r) => {
    const avgZ = r.reduce((n, q) => n + q.z, 0) / r.length
    return strokePolygon(r.map((q) => q.s), Math.max(1, (widthM * c.F) / avgZ))
  })
}

/** Çizim hedefi: çokgenler yazılım rasterleştiriciye, metinler ASS olaylarına gider (etiket arka planları sona ertelenir: hep üstte) */
class Painter {
  texts: string[] = []
  private deferred: (() => void)[] = []
  constructor(readonly r: Raster, readonly t0: number, readonly t1: number) {}
  poly(pts: Pt[], color: string, opacity = 1, _layer = 0): void {
    void _layer
    this.r.fill(pts, hexRgb(color), opacity)
  }
  circle(x: number, y: number, r: number, color: string, opacity = 1, _layer = 0): void {
    void _layer
    this.r.circle(x, y, r, hexRgb(color), opacity)
  }
  later(fn: () => void): void {
    this.deferred.push(fn)
  }
  flush(): void {
    for (const fn of this.deferred) fn()
    this.deferred = []
  }
  text(x: number, y: number, text: string, size: number, color: string, _layer = 90, an = 5): void {
    void _layer
    this.texts.push(`Dialogue: 0,${assTime(this.t0)},${assTime(this.t1)},Tag,,0,0,0,,{\\an${an}\\pos(${Math.round(x)},${Math.round(y)})\\fs${Math.round(size)}\\1c${assColor(color)}&}${esc(text)}`)
  }
}

const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 28, z = 0): V3[] => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI), z] as V3)
const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n = 14): V3[] => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + ((a1 - a0) * i) / n), cy + r * Math.sin(a0 + ((a1 - a0) * i) / n), 0] as V3)

/** Saha çizgileri (dünya koordinatları, z=0) */
const LINES: V3[][] = (() => {
  const L = PITCH_L
  const Wd = PITCH_W
  const m = Wd / 2
  const box = (x0: number, x1: number, hw: number): V3[] => [[x0, m - hw, 0], [x1, m - hw, 0], [x1, m + hw, 0], [x0, m + hw, 0], [x0, m - hw, 0]]
  return [
    [[0, 0, 0], [L, 0, 0], [L, Wd, 0], [0, Wd, 0], [0, 0, 0]],
    [[L / 2, 0, 0], [L / 2, Wd, 0]],
    ellipse(L / 2, m, 9.15, 9.15, 40).concat([[L / 2 + 9.15, m, 0]]),
    box(0, 16.5, 20.15),
    box(L - 16.5, L, 20.15),
    box(0, 5.5, 9.16),
    box(L - 5.5, L, 9.16),
    arcPts(11, m, 9.15, -0.93, 0.93),
    arcPts(L - 11, m, 9.15, Math.PI - 0.93, Math.PI + 0.93)
  ]
})()

/** Tribün renkleri: ev sahibi takımın renginin tonları (kalabalık o takımın taraftarı) */
function standPalette(base: string): string[] {
  const [r, g, b] = hexRgb(base)
  const mix = (m: number, to: number) => `#${[r, g, b].map((v) => Math.round(v + (to - v) * m).toString(16).padStart(2, '0')).join('')}`
  return [mix(0.55, 0), mix(0.3, 0), mix(0, 0), mix(0.45, 0), mix(0.15, 255), mix(0.35, 0), mix(0.2, 0)]
}

export interface FootballScene {
  frames: number
  fps: number
  /** i. kareyi çizer (kareler SIRAYLA çağrılmalı: kamera yumuşatması durum taşır). Dönen: o karenin ASS metin olayları */
  draw(i: number, r: Raster): string[]
}

/**
 * Futbol sahnesi üreticisi. Çokgenler `Raster`a (ffmpeg'e ham kare olarak verilir), yalnızca yazılar ASS'e gider:
 * libass binlerce çokgenle bellek/zaman patlatmasın diye.
 */
export function footballScene(c: FootballContent, theme: StoryTheme, W: number, H: number, dur: number, fps = 30): FootballScene {
  const sim = simulateFootball(c, dur)
  const k = H / 1080
  const frames = Math.max(1, Math.round(dur * fps))
  const kits = resolveKits(c.home, c.away, { home: theme.accent, away: '#F2F2F2' })
  const stands = standPalette(kits.stand)
  let tgt: V3 | null = null
  const dt = 1 / fps
  const camAt = (t: number, ball: V3): { e: V3; target: V3; fov: number } => {
    if (!tgt) tgt = [ball[0], ball[1], 0]
    const alpha = 1 - Math.exp(-dt / 0.5)
    tgt = [tgt[0] + (clamp(ball[0], 6, PITCH_L - 6) - tgt[0]) * alpha, tgt[1] + (clamp(ball[1], 6, PITCH_W - 6) - tgt[1]) * alpha, 0]
    let idx = 0
    for (let i = 0; i < sim.camera.length; i++) if (sim.camera[i].at <= t) idx = i
    const cur = MODES[sim.camera[idx].mode]
    const prev = MODES[sim.camera[Math.max(0, idx - 1)].mode]
    const u = idx === 0 ? 1 : smooth((t - sim.camera[idx].at) / 1.2)
    const s = c.attack === 'left' ? -1 : 1
    const off: V3 = [(prev.off[0] + (cur.off[0] - prev.off[0]) * u) * s, (prev.off[1] + (cur.off[1] - prev.off[1]) * u) * s, prev.off[2] + (cur.off[2] - prev.off[2]) * u]
    const fov = prev.fov + (cur.fov - prev.fov) * u
    return { e: [tgt[0] + off[0] + Math.sin(t * 0.5) * 0.6, tgt[1] + off[1], off[2]], target: [tgt[0], tgt[1] + 2, 0], fov }
  }
  return {
    frames,
    fps,
    draw(i, r) {
      const t = i / fps
      const ballS = sim.ball(t)
      const cam = camAt(t, [ballS.x, ballS.y, 0])
      const f = new Painter(r, Math.round(t * 100) / 100, Math.round(((i + 1) / fps) * 100) / 100)
      drawFrame(f, c, sim, makeCam(cam.e, cam.target, cam.fov, W, H), t, ballS, k, kits, stands, theme)
      f.flush()
      return f.texts
    }
  }
}

/** ASS başlığı + yalnızca metin olayları (kuru geçişle hesaplanır) */
export function footballTextAss(c: FootballContent, theme: StoryTheme, W: number, H: number, dur: number, fps = 30): string {
  const sc = footballScene(c, theme, W, H, dur, fps)
  const r = new Raster(2, 2)
  r.dry = true
  const out: string[] = []
  for (let i = 0; i < sc.frames; i++) out.push(...sc.draw(i, r))
  const k = H / 1080
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
    `Style: Tag,${theme.fontBody.replace(/,/g, ' ')},${Math.round(22 * k)},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor('#000000')},${assColor('#000000', 128)},-1,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...out,
    ''
  ].join('\n')
}

function drawFrame(f: Painter, c: FootballContent, sim: FootballSim, cam: Cam, t: number, ball: { x: number; y: number; z: number; holder?: string }, k: number, kits: ResolvedKits, stands: string[], theme: StoryTheme): void {
  const W = cam.W
  const H = cam.H
  // 1) tribünler (dört kenar: eğimli basamak sıraları)
  const rows = 6
  const stand = (a: (r: number) => V3, b: (r: number) => V3, tint: number) => {
    const segs = 12
    for (let r = 0; r < rows; r++) {
      const lerp3 = (p: V3, q: V3, u: number): V3 => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]
      for (let s = 0; s < segs; s++) {
        // koltuk blokları: bitişik parçalar birbirinden hafif farklı renkte (kalabalık dokusu)
        const col = stands[((r * 3 + s * 5 + tint) * 7) % 7]
        f.poly(projectPoly(cam, [lerp3(a(r), b(r), s / segs), lerp3(a(r), b(r), (s + 1) / segs), lerp3(a(r + 1), b(r + 1), (s + 1) / segs), lerp3(a(r + 1), b(r + 1), s / segs)]), col, 1, 0)
      }
    }
  }
  const sy = (r: number) => 3 + r * 5.5
  const sz = (r: number) => 1.2 + r * 3.4
  stand((r) => [-45, PITCH_W + sy(r), sz(r)], (r) => [PITCH_L + 45, PITCH_W + sy(r), sz(r)], 0)
  stand((r) => [-45, -sy(r), sz(r)], (r) => [PITCH_L + 45, -sy(r), sz(r)], 1)
  stand((r) => [-sy(r) - 2, -30, sz(r)], (r) => [-sy(r) - 2, PITCH_W + 30, sz(r)], 3)
  stand((r) => [PITCH_L + sy(r) + 2, -30, sz(r)], (r) => [PITCH_L + sy(r) + 2, PITCH_W + 30, sz(r)], 2)
  // 2) zemin + şeritler
  f.poly(projectPoly(cam, [[-14, -10, 0], [PITCH_L + 14, -10, 0], [PITCH_L + 14, PITCH_W + 10, 0], [-14, PITCH_W + 10, 0]]), '#1F6B2B', 1, 1)
  const stripes = 14
  for (let s = 0; s < stripes; s++) {
    const x0 = (PITCH_L * s) / stripes
    const x1 = (PITCH_L * (s + 1)) / stripes
    f.poly(projectPoly(cam, [[x0, 0, 0], [x1, 0, 0], [x1, PITCH_W, 0], [x0, PITCH_W, 0]]), s % 2 ? '#2E8C3A' : '#37A044', 1, 2)
  }
  // reklam panoları
  f.poly(projectPoly(cam, [[-14, PITCH_W + 2, 0], [PITCH_L + 14, PITCH_W + 2, 0], [PITCH_L + 14, PITCH_W + 2, 1], [-14, PITCH_W + 2, 1]]), '#0F1116', 1, 2)
  f.poly(projectPoly(cam, [[-14, -2, 0], [PITCH_L + 14, -2, 0], [PITCH_L + 14, -2, 1], [-14, -2, 1]]), '#0F1116', 1, 2)
  // 3) çizgiler + penaltı noktaları
  for (const l of LINES) for (const poly of ribbon(cam, l, 0.16)) f.poly(poly, '#F4F4F4', 0.95, 3)
  for (const sp of [[11, PITCH_W / 2], [PITCH_L - 11, PITCH_W / 2], [PITCH_L / 2, PITCH_W / 2]]) {
    const q = project(cam, [sp[0], sp[1], 0])
    if (q) f.circle(q.s[0], q.s[1], (0.22 * cam.F) / q.z, '#F4F4F4', 0.95, 3)
  }
  // kaleler: direkler, üst direk, file
  for (const gx of [0, PITCH_L]) {
    const d = gx === 0 ? -2.2 : 2.2
    const y0 = PITCH_W / 2 - 3.66
    const y1 = PITCH_W / 2 + 3.66
    f.poly(projectPoly(cam, [[gx, y0, 0], [gx + d, y0, 0], [gx + d, y1, 0], [gx, y1, 0]]), '#FFFFFF', 0.1, 3)
    f.poly(projectPoly(cam, [[gx, y0, 0], [gx + d, y0, 0], [gx + d, y0, 2.44], [gx, y0, 2.44]]), '#FFFFFF', 0.12, 3)
    f.poly(projectPoly(cam, [[gx, y1, 0], [gx + d, y1, 0], [gx + d, y1, 2.44], [gx, y1, 2.44]]), '#FFFFFF', 0.12, 3)
    f.poly(projectPoly(cam, [[gx + d, y0, 0], [gx + d, y1, 0], [gx + d, y1, 2.44], [gx + d, y0, 2.44]]), '#FFFFFF', 0.16, 3)
    for (const poly of ribbon(cam, [[gx, y0, 0], [gx, y0, 2.44], [gx, y1, 2.44], [gx, y1, 0]], 0.13)) f.poly(poly, '#FFFFFF', 1, 4)
  }
  // 4) bölgeler
  for (const z of sim.zones) {
    if (t < z.t0 || t > z.t1) continue
    const a = smooth((t - z.t0) / 0.35) * smooth((z.t1 - t) / 0.35)
    f.poly(projectPoly(cam, ellipse(z.center[0], z.center[1], z.rx, z.ry, 32)), theme.accent, 0.28 * a, 4)
    for (const poly of ribbon(cam, ellipse(z.center[0], z.center[1], z.rx, z.ry, 32).concat([[z.center[0] + z.rx, z.center[1], 0]]), 0.22)) f.poly(poly, theme.accent, 0.9 * a, 4)
    if (z.text) {
      const q = project(cam, [z.center[0], z.center[1], 0.2])
      if (q) tag(f, q.s[0], q.s[1] - 6 * k, z.text, k, theme)
    }
  }
  // 5) pas/şut/çizgi izleri
  for (const tr of sim.trails) {
    if (t < tr.t0 || t > tr.t1) continue
    const fade = smooth((tr.t1 - t) / 0.8)
    let to = tr.to
    if (tr.travel) {
      const u = clamp((t - tr.t0) / Math.max(0.01, tr.t1 - tr.t0 - (tr.kind === 'shoot' ? 1.2 : 1.4)), 0, 1)
      to = [tr.from[0] + (tr.to[0] - tr.from[0]) * u, tr.from[1] + (tr.to[1] - tr.from[1]) * u]
    }
    const grow = tr.travel ? 1 : smooth((t - tr.t0) / 0.4)
    const end: Pt = [tr.from[0] + (to[0] - tr.from[0]) * grow, tr.from[1] + (to[1] - tr.from[1]) * grow]
    const pts: V3[] = [[tr.from[0], tr.from[1], 0.05], [end[0], end[1], 0.05]]
    for (const poly of ribbon(cam, pts, tr.kind === 'shoot' ? 0.3 : 0.34)) f.poly(poly, tr.kind === 'shoot' ? '#FFFFFF' : theme.accent, 0.9 * fade, 5)
  }
  // 6) oyuncular (uzaktan yakına)
  const drawn = sim.players
    .map((p) => {
      const pos = sim.pos(p.id, t)
      const q = project(cam, [pos[0], pos[1], 0])
      return { p, pos, q }
    })
    .filter((x) => x.q)
    .sort((a, b) => b.q!.z - a.q!.z)
  drawn.forEach(({ p, pos, q }, i) => {
    const layer = 10 + i
    const px = (m: number) => (m * cam.F) / q!.z
    f.poly(projectPoly(cam, ellipse(pos[0], pos[1], 0.75, 0.55, 12)), '#000000', 0.32, layer)
    const kit: Kit = p.keeper ? kits.keeper : p.team === 'home' ? kits.home : kits.away
    // çorap (alt bacak) → şort → gövde (desenli): uzaktan yakına tek tek boyanır
    for (const poly of ribbon(cam, [[pos[0], pos[1], 0.05], [pos[0], pos[1], 0.58]], 0.34)) f.poly(poly, kit.socks, 1, layer)
    for (const poly of ribbon(cam, [[pos[0], pos[1], 0.52], [pos[0], pos[1], 0.97]], 0.44)) f.poly(poly, kit.shorts, 1, layer)
    const lo: V3 = [pos[0], pos[1], 0.93]
    const hi: V3 = [pos[0], pos[1], 1.55]
    const side = (n: number): V3[] => [[lo[0] + cam.r[0] * n, lo[1] + cam.r[1] * n, lo[2]], [hi[0] + cam.r[0] * n, hi[1] + cam.r[1] * n, hi[2]]]
    if (kit.pattern === 'halves') {
      for (const poly of ribbon(cam, side(-0.125), 0.25)) f.poly(poly, kit.primary, 1, layer)
      for (const poly of ribbon(cam, side(0.125), 0.25)) f.poly(poly, kit.secondary, 1, layer)
    } else if (kit.pattern === 'stripes') {
      for (let n = 0; n < 4; n++) for (const poly of ribbon(cam, side(-0.19 + n * 0.127), 0.127)) f.poly(poly, n % 2 ? kit.secondary : kit.primary, 1, layer)
    } else for (const poly of ribbon(cam, side(0), 0.5)) f.poly(poly, kit.primary, 1, layer)
    const hq = project(cam, [pos[0], pos[1], 1.7])
    if (hq) f.circle(hq.s[0], hq.s[1], px(0.14), '#E2B48C', 1, layer)
    if (ball.holder === p.id) {
      for (const poly of ribbon(cam, ellipse(pos[0], pos[1], 1.25, 1.25, 24).concat([[pos[0] + 1.25, pos[1], 0]]), 0.16)) f.poly(poly, theme.accent, 1, layer)
    }
    // etiketler: adlı oyuncular her zaman, "label" eylemleri süresince
    const extra = sim.labels.filter((l) => l.player === p.id && t >= l.t0 && t <= l.t1)
    const top = project(cam, [pos[0], pos[1], 2.15])
    if (top && (p.name || extra.length)) {
      const a = extra.length ? smooth((t - extra[0].t0) / 0.25) : 1
      let y = top.s[1] - 8 * k
      if (extra.length && a > 0) tag(f, top.s[0], y - (p.name ? 30 * k : 0), extra[0].text, k, theme, true)
      if (p.name) tag(f, top.s[0], y, p.name.toLocaleUpperCase('tr-TR'), k, theme)
    }
  })
  // 7) top (+ gölge)
  const bs = project(cam, [ball.x, ball.y, ball.z])
  const bg = project(cam, [ball.x, ball.y, 0])
  if (bg && ball.z > 0.3) f.poly(projectPoly(cam, ellipse(ball.x, ball.y, 0.3, 0.22, 10)), '#000000', 0.3, 60)
  if (bs) {
    f.circle(bs.s[0], bs.s[1], Math.max(2.5, (0.26 * cam.F) / bs.z), '#FFFFFF', 1, 61)
    f.circle(bs.s[0], bs.s[1], Math.max(1, (0.1 * cam.F) / bs.z), '#222222', 0.85, 62)
  }
  // 8) gol yazısı
  for (const g of sim.goals) {
    if (t >= g.t && t <= g.t + 2) {
      const a = smooth((t - g.t) / 0.2) * smooth((g.t + 2 - t) / 0.4)
      f.text(W / 2, H * 0.16, 'GOL!', 120 * k * (0.85 + 0.15 * a), theme.accent, 95)
    }
  }
  const head = c.title ?? [kits.homeName ?? c.home?.name, kits.awayName ?? c.away?.name].filter(Boolean).join('  -  ')
  if (head) f.text(60 * k, 56 * k, head.toLocaleUpperCase('tr-TR'), 30 * k, '#FFFFFF', 95, 4)
  void GOAL_TARGETS
}

/** Koyu etiket: oyuncu adı ya da vurgu metni */
function tag(f: Painter, x: number, y: number, text: string, k: number, theme: StoryTheme, accent = false): void {
  const w = (text.length * 12.5 + 26) * k
  const h = 32 * k
  const r = h / 2
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 5; i++) pts.push([cx + r * Math.cos(a0 + (i / 5) * (Math.PI / 2)), cy + r * Math.sin(a0 + (i / 5) * (Math.PI / 2))])
  }
  const x0 = x - w / 2
  const y0 = y - h
  arc(x0 + w - r, y0 + r, -Math.PI / 2)
  arc(x0 + w - r, y0 + h - r, 0)
  arc(x0 + r, y0 + h - r, Math.PI / 2)
  arc(x0 + r, y0 + r, Math.PI)
  f.later(() => f.poly(pts, accent ? theme.accent : '#0B0B0B', accent ? 1 : 0.86, 80))
  f.text(x, y0 + h / 2, text, 21 * k, accent ? '#0A0A0A' : '#FFFFFF', 90)
}
