import { create } from 'zustand'

export type DrawTool = 'arrow' | 'line' | 'circle' | 'rect' | 'spot'
/** `select` moves/edits existing shapes; `zoomrect` drags a region to zoom into. */
export type Tool = 'select' | DrawTool | 'zoomrect'

export interface Shape {
  id: string
  type: DrawTool
  color: string
  width: number
  /** Frame index the shape was drawn on; it is only shown while paused on that frame. */
  frame: number
  /** arrow/line: start → end. rect/circle/spot: opposite corners of the box the shape is drawn in. */
  x1: number
  y1: number
  x2: number
  y2: number
}

export const DRAW_COLORS = ['#ef4444', '#facc15', '#ffffff', '#a3e635', '#38bdf8'] as const

interface DrawingState {
  tool: Tool
  color: string
  width: number
  shapes: Shape[]
  selectedId: string | null
  setTool: (t: Tool) => void
  /** Also recolours the selected shape. */
  setColor: (c: string) => void
  setWidth: (w: number) => void
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
  shapes: [],
  selectedId: null,
  setTool: (tool) => set({ tool }),
  setColor: (color) => set((s) => ({ color, shapes: s.selectedId ? s.shapes.map((x) => (x.id === s.selectedId ? { ...x, color } : x)) : s.shapes })),
  setWidth: (width) => set((s) => ({ width, shapes: s.selectedId ? s.shapes.map((x) => (x.id === s.selectedId ? { ...x, width } : x)) : s.shapes })),
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

/** SVG path of the dimmed area for spotlights: whole frame minus every spot (even-odd fill). */
export function spotlightPath(w: number, h: number, spots: Shape[]): string {
  let d = `M0 0H${w}V${h}H0Z`
  for (const s of spots) {
    const { cx, cy, rx, ry } = ellipseOf(s)
    d += `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`
  }
  return d
}

export const DIM = 'rgba(0,0,0,0.58)'

/** Paint shapes onto a 2D canvas (used for snapshot export; mirrors the SVG rendering). */
export function paintShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], w = ctx.canvas.width, h = ctx.canvas.height) {
  const spots = shapes.filter((s) => s.type === 'spot')
  if (spots.length) {
    ctx.fillStyle = DIM
    ctx.fill(new Path2D(spotlightPath(w, h, spots)), 'evenodd')
  }
  for (const s of shapes) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (s.type === 'spot' || s.type === 'circle') {
      const { cx, cy, rx, ry } = ellipseOf(s)
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (s.type === 'rect') {
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))
    } else {
      ctx.beginPath()
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
      ctx.stroke()
      if (s.type === 'arrow') {
        const [a, b, c] = arrowHead(s)
        ctx.beginPath()
        ctx.moveTo(a![0], a![1])
        ctx.lineTo(b![0], b![1])
        ctx.lineTo(c![0], c![1])
        ctx.closePath()
        ctx.fill()
      }
    }
  }
}
