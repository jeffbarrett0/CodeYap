/**
 * Minimal yazılım rasterleştirici (RGB, sıfır bağımlılık): dolu çokgen (sıfırdan farklı sarım, 3 alt tarama + yatay kesirli kapsama
 * ile kenar yumuşatma) ve alfa karışımı. Futbol sahnesi gibi çok katmanlı 3B çizimleri libass'a yüklemeden kare kare üretmek içindir.
 */
export type Pt = [number, number]
export type Rgb = [number, number, number]

export function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16)
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0]
}

const SS = 3

export class Raster {
  readonly data: Uint8Array
  private acc: Float32Array
  private diff: Float32Array
  /** true: hiçbir şey çizilmez (konum/metin hesabı için kuru geçiş) */
  dry = false
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8Array(w * h * 3)
    this.acc = new Float32Array(w + 2)
    this.diff = new Float32Array(w + 2)
  }

  clear(c: Rgb): void {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = c[0]
      this.data[i + 1] = c[1]
      this.data[i + 2] = c[2]
    }
  }

  fill(pts: Pt[], c: Rgb, alpha = 1): void {
    if (this.dry || pts.length < 3 || alpha <= 0) return
    const { w, h } = this
    let ymin = Infinity
    let ymax = -Infinity
    let xmin = Infinity
    let xmax = -Infinity
    for (const p of pts) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return
      ymin = Math.min(ymin, p[1])
      ymax = Math.max(ymax, p[1])
      xmin = Math.min(xmin, p[0])
      xmax = Math.max(xmax, p[0])
    }
    if (ymax < 0 || ymin >= h || xmax < 0 || xmin >= w) return
    // kenarlar
    const edges: { x0: number; y0: number; x1: number; y1: number; d: number }[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (a[1] === b[1]) continue
      edges.push(a[1] < b[1] ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1], d: 1 } : { x0: b[0], y0: b[1], x1: a[0], y1: a[1], d: -1 })
    }
    if (edges.length === 0) return
    const y0 = Math.max(0, Math.floor(ymin))
    const y1 = Math.min(h - 1, Math.floor(ymax))
    const cross: { x: number; d: number }[] = []
    const { acc, diff, data } = this
    const wgt = 1 / SS
    const cl = (x: number) => Math.min(w, Math.max(0, x))
    for (let y = y0; y <= y1; y++) {
      let lo = w
      let hi = -1
      for (let s = 0; s < SS; s++) {
        const ys = y + (s + 0.5) / SS
        cross.length = 0
        for (const e of edges) if (ys >= e.y0 && ys < e.y1) cross.push({ x: e.x0 + ((ys - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0), d: e.d })
        if (cross.length < 2) continue
        cross.sort((p, q) => p.x - q.x)
        let wind = 0
        for (let i = 0; i < cross.length - 1; i++) {
          wind += cross[i].d
          if (wind === 0) continue
          const xa = cl(cross[i].x)
          const xb = cl(cross[i + 1].x)
          if (xb <= xa) continue
          const ia = Math.floor(xa)
          const ib = Math.floor(xb)
          lo = Math.min(lo, ia)
          hi = Math.max(hi, ib)
          if (ia === ib) acc[ia] += (xb - xa) * wgt
          else {
            acc[ia] += (ia + 1 - xa) * wgt
            acc[ib] += (xb - ib) * wgt
            if (ib > ia + 1) {
              diff[ia + 1] += wgt
              diff[ib] -= wgt
            }
          }
        }
      }
      if (hi < 0) continue
      let run = 0
      const base = y * w * 3
      for (let x = lo; x <= Math.min(hi, w - 1); x++) {
        run += diff[x]
        const cov = (acc[x] + run) * alpha
        acc[x] = 0
        diff[x] = 0
        if (cov <= 0.002) continue
        const o = base + x * 3
        const k = cov > 1 ? 1 : cov
        data[o] += (c[0] - data[o]) * k
        data[o + 1] += (c[1] - data[o + 1]) * k
        data[o + 2] += (c[2] - data[o + 2]) * k
      }
      acc[hi] = 0
      diff[hi] = 0
      if (hi + 1 < acc.length) (acc[hi + 1] = 0, (diff[hi + 1] = 0))
    }
  }

  circle(x: number, y: number, r: number, c: Rgb, alpha = 1): void {
    if (r < 0.3) return
    const n = r > 12 ? 28 : 14
    this.fill(Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * 2 * Math.PI), y + r * Math.sin((i / n) * 2 * Math.PI)] as Pt), c, alpha)
  }
}
