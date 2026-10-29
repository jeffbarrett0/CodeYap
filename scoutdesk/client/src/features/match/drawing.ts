import { create } from 'zustand'

export type DrawTool = 'arrow' | 'line' | 'circle' | 'zoom' | 'spot' | 'link' | 'run' | 'area' | 'number' | 'player'
/** `select` moves/edits drawings, `pan` drags the zoomed video, `zoomrect` drags a region to zoom into. */
export type Tool = 'select' | 'pan' | DrawTool | 'zoomrect'

export interface Shape {
  id: string
  type: DrawTool
  color: string
  width: number
  /** Frame index the shape was drawn on; it shows there while paused (and for `hold` seconds after). */
  frame: number
  /** Seconds the drawing stays on screen after its frame; 0 = only while paused on that frame. */
  hold: number
  /** arrow/line/run: start → end. circle/zoom/spot: opposite corners of the box. number/player: both are the anchor. link/area: bounding box of `pts`. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** link: the chain of players; area: polygon vertices. */
  pts?: [number, number][]
  /** player: name shown in the label. number: the digit. */
  text?: string
}

export const DRAW_COLORS = ['#ef4444', '#facc15', '#ffffff', '#a3e635', '#38bdf8'] as const

/** Is the drawing on screen at this frame? Shapes with hold>0 also stay visible while playing. */
export function isVisible(s: Shape, frame: number, fps: number, playing: boolean): boolean {
  if (playing && s.hold <= 0) return false
  return frame >= s.frame && frame <= s.frame + Math.round(s.hold * fps)
}

/** Recompute an area's bounding box (x1..y2) from its vertices. */
export function withBounds<T extends Shape>(s: T): T {
  if (!s.pts?.length) return s
  const xs = s.pts.map((p) => p[0])
  const ys = s.pts.map((p) => p[1])
  return { ...s, x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

interface DrawingState {
  tool: Tool
  color: string
  width: number
  /** Seconds new drawings (and the selected one) stay visible after their frame. */
  hold: number
  shapes: Shape[]
  selectedId: string | null
  setTool: (t: Tool) => void
  /** Also recolours the selected shape. */
  setColor: (c: string) => void
  setWidth: (w: number) => void
  setHold: (h: number) => void
  add: (s: Shape) => void
  update: (id: string, patch: Partial<Shape>) => void
  remove: (id: string) => void
  select: (id: string | null) => void
  undoLast: (frame: number) => void
  clearFrame: (frame: number) => void
}

export const useDrawing = create<DrawingState>((set) => ({
  tool: 'select',
  color: DRAW_COLORS[0],
  width: 4,
  hold: 0,
  shapes: [],
  selectedId: null,
  setTool: (tool) => set({ tool }),
  setColor: (color) => set((s) => ({ color, shapes: s.selectedId ? s.shapes.map((x) => (x.id === s.selectedId ? { ...x, color } : x)) : s.shapes })),
  setWidth: (width) => set((s) => ({ width, shapes: s.selectedId ? s.shapes.map((x) => (x.id === s.selectedId ? { ...x, width } : x)) : s.shapes })),
  setHold: (hold) => set((s) => ({ hold, shapes: s.selectedId ? s.shapes.map((x) => (x.id === s.selectedId ? { ...x, hold } : x)) : s.shapes })),
  add: (shape) => set((s) => ({ shapes: [...s.shapes, shape], selectedId: shape.id })),
  update: (id, patch) => set((s) => ({ shapes: s.shapes.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  remove: (id) => set((s) => ({ shapes: s.shapes.filter((x) => x.id !== id), selectedId: s.selectedId === id ? null : s.selectedId })),
  select: (selectedId) => set({ selectedId }),
  undoLast: (frame) =>
    set((s) => {
      let idx = -1
      for (let i = s.shapes.length - 1; i >= 0; i--) if (s.shapes[i]!.frame === frame) { idx = i; break }
      if (idx === -1) return s
      const gone = s.shapes[idx]!.id
      return { shapes: s.shapes.filter((_, i) => i !== idx), selectedId: s.selectedId === gone ? null : s.selectedId }
    }),
  clearFrame: (frame) => set((s) => ({ shapes: s.shapes.filter((x) => x.frame !== frame), selectedId: null })),
}))

/** Size of the on-pitch markers (ring, number badge, name tag), relative to a 1280px-wide frame. */
export function markerGeom(w: number) {
  const k = w / 1280
  return { k, rx: 20 * k, ry: 8 * k, lift: 30 * k, badge: 13 * k, tagH: 22 * k, font: 13 * k }
}
/** Name-tag width for a player label. */
export const tagWidth = (text: string, k: number) => (Math.max(text.length, 3) * 8 + 16) * k

/** Arrow head polygon points for a line ending at (x2,y2). */
export function arrowHead(s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2' | 'width'>): [number, number][] {
  const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
  const len = Math.max(14, s.width * 4.5)
  const spread = Math.PI / 7
  return [
    [s.x2, s.y2],
    [s.x2 - len * Math.cos(ang - spread), s.y2 - len * Math.sin(ang - spread)],
    [s.x2 - len * Math.cos(ang + spread), s.y2 - len * Math.sin(ang + spread)],
  ]
}

/** Ellipse inscribed in the shape's bounding box (a circle when the box is square). */
export const ellipseOf = (s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'>) => ({ cx: (s.x1 + s.x2) / 2, cy: (s.y1 + s.y2) / 2, rx: Math.abs(s.x2 - s.x1) / 2, ry: Math.abs(s.y2 - s.y1) / 2 })

/** What a single click (no drag) creates for the circle-like tools, sized for a player in a 1280px-wide frame. */
export function clickBox(type: 'circle' | 'zoom' | 'spot', x: number, y: number, w: number): Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'> {
  const k = w / 1280
  const [rx, ry] = type === 'circle' ? [24 * k, 10 * k] : type === 'zoom' ? [38 * k, 38 * k] : [46 * k, 46 * k]
  return { x1: x - rx, y1: y - ry, x2: x + rx, y2: y + ry }
}

/** Where the "player close up" window of a zoom shape sits (left side of the frame) and what part of the video it magnifies. */
export function zoomInset(s: Shape, index: number, count: number, w: number, h: number) {
  const { cx, cy, rx, ry } = ellipseOf(s)
  const r = Math.max(Math.max(rx, ry), 12 * (w / 1280))
  const R = Math.min(0.17 * h, 0.15 * w)
  const gap = 2 * R + 34 * (w / 1280)
  const icy = clamp(h / 2 + (index - (count - 1) / 2) * gap, R + 24 * (w / 1280), h - R - 8)
  return { cx, cy, r, R, icx: 20 * (w / 1280) + R, icy }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))


/** Paint shapes onto a 2D canvas (used for snapshot export; mirrors the SVG rendering in DrawingLayer). */
export function paintShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], w = ctx.canvas.width, h = ctx.canvas.height, video?: CanvasImageSource) {
  const g = markerGeom(w)
  const ring = (x: number, y: number, color: string, lw: number, casing = false) => {
    ctx.beginPath()
    ctx.ellipse(x, y, g.rx, g.ry, 0, 0, Math.PI * 2)
    if (casing) { ctx.strokeStyle = '#000'; ctx.lineWidth = lw + 3 * g.k; ctx.stroke() }
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.stroke()
  }
  const zooms = shapes.filter((x) => x.type === 'zoom')
  for (const s of shapes) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    if (s.type === 'spot') {
      const { cx, cy, rx, ry } = ellipseOf(s)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(Math.max(rx, 1), Math.max(ry, 1))
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      grad.addColorStop(0, 'rgba(255,255,255,0.75)')
      grad.addColorStop(0.55, 'rgba(255,255,255,0.35)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else if (s.type === 'circle' || s.type === 'zoom') {
      const { cx, cy, rx, ry } = ellipseOf(s)
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2)
      ctx.stroke()
      if (s.type === 'zoom' && video) {
        const z = zoomInset(s, zooms.indexOf(s), zooms.length, w, h)
        ctx.save()
        ctx.setLineDash([8 * g.k, 6 * g.k])
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2 * g.k
        ctx.beginPath()
        ctx.moveTo(z.cx, z.cy)
        ctx.lineTo(z.icx, z.icy)
        ctx.stroke()
        ctx.restore()
        ctx.save()
        ctx.beginPath()
        ctx.arc(z.icx, z.icy, z.R, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(video, z.cx - z.r, z.cy - z.r, 2 * z.r, 2 * z.r, z.icx - z.R, z.icy - z.R, 2 * z.R, 2 * z.R)
        ctx.restore()
        ctx.beginPath()
        ctx.arc(z.icx, z.icy, z.R, 0, Math.PI * 2)
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 3 * g.k
        ctx.stroke()
        const tw = tagWidth('Player close up', g.k)
        ctx.fillStyle = '#0b1220'
        ctx.fillRect(z.icx - tw / 2, z.icy - z.R - g.tagH - 4 * g.k, tw, g.tagH)
        ctx.fillStyle = '#fff'
        ctx.font = `700 ${g.font}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Player close up', z.icx, z.icy - z.R - g.tagH / 2 - 3 * g.k)
      }
    } else if (s.type === 'area' && s.pts) {
      const path = () => { ctx.beginPath(); s.pts!.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath() }
      ctx.save()
      path()
      ctx.clip()
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      for (let x = Math.floor(s.x1 / (16 * g.k)) * 16 * g.k; x < s.x2; x += 16 * g.k) ctx.fillRect(x, s.y1, 8 * g.k, s.y2 - s.y1)
      ctx.restore()
      path()
      ctx.stroke()
    } else if (s.type === 'link' && s.pts) {
      const line = () => { ctx.beginPath(); s.pts!.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))) }
      line()
      ctx.strokeStyle = '#000'
      ctx.lineWidth = s.width + 3 * g.k
      ctx.stroke()
      line()
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width
      ctx.stroke()
      for (const [x, y] of s.pts) ring(x, y, s.color, Math.max(2, s.width * 0.7), true)
    } else if (s.type === 'number' || s.type === 'player') {
      ring(s.x1, s.y1, s.color, Math.max(2, s.width * 0.6))
      const cy = s.y1 - g.lift
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (s.type === 'number') {
        ctx.beginPath()
        ctx.arc(s.x1, cy, g.badge, 0, Math.PI * 2)
        ctx.fillStyle = '#0b0b0b'
        ctx.fill()
        ctx.lineWidth = 2 * g.k
        ctx.strokeStyle = '#fff'
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = `700 ${15 * g.k}px sans-serif`
        ctx.fillText(s.text ?? '1', s.x1, cy + g.k)
      } else {
        const text = s.text || 'Oyuncu'
        const tw = tagWidth(text, g.k)
        ctx.fillStyle = '#0b1220'
        ctx.fillRect(s.x1 - tw / 2, cy - g.tagH / 2, tw, g.tagH)
        ctx.fillStyle = '#fff'
        ctx.font = `700 ${g.font}px sans-serif`
        ctx.fillText(text, s.x1, cy + g.k)
      }
    } else {
      if (s.type === 'run') ctx.setLineDash([12 * g.k, 8 * g.k])
      ctx.beginPath()
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
      ctx.stroke()
      ctx.setLineDash([])
      if (s.type === 'arrow' || s.type === 'run') {
        const [a, b, c] = arrowHead(s)
        ctx.beginPath()
        ctx.moveTo(a![0], a![1])
        ctx.lineTo(b![0], b![1])
        ctx.lineTo(c![0], c![1])
        ctx.closePath()
        ctx.fillStyle = s.color
        ctx.fill()
      }
      if (s.type === 'run') ring(s.x1, s.y1, s.color, Math.max(2, s.width * 0.6))
    }
  }
}
