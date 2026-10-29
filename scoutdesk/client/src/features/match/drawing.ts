import { create } from 'zustand'

export type DrawTool = 'arrow' | 'line' | 'circle'

export interface Shape {
  id: string
  type: DrawTool
  color: string
  width: number
  /** Frame index the shape was drawn on; it is only shown while paused on that frame. */
  frame: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export const DRAW_COLORS = ['#ef4444', '#facc15', '#ffffff', '#a3e635', '#38bdf8'] as const

interface DrawingState {
  active: boolean
  tool: DrawTool
  color: string
  width: number
  shapes: Shape[]
  setActive: (a: boolean) => void
  setTool: (t: DrawTool) => void
  setColor: (c: string) => void
  setWidth: (w: number) => void
  add: (s: Shape) => void
  undoLast: (frame: number) => void
  clearFrame: (frame: number) => void
}

export const useDrawing = create<DrawingState>((set) => ({
  active: false,
  tool: 'arrow',
  color: DRAW_COLORS[0],
  width: 4,
  shapes: [],
  setActive: (active) => set({ active }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setWidth: (width) => set({ width }),
  add: (s) => set((st) => ({ shapes: [...st.shapes, s] })),
  undoLast: (frame) =>
    set((st) => {
      let idx = -1
      for (let i = st.shapes.length - 1; i >= 0; i--) if (st.shapes[i]!.frame === frame) { idx = i; break }
      return idx === -1 ? st : { shapes: st.shapes.filter((_, i) => i !== idx) }
    }),
  clearFrame: (frame) => set((st) => ({ shapes: st.shapes.filter((s) => s.frame !== frame) })),
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

/** Paint shapes onto a 2D canvas (used for snapshot export; mirrors the SVG rendering). */
export function paintShapes(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  for (const s of shapes) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    if (s.type === 'circle') {
      ctx.arc(s.x1, s.y1, Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0, Math.PI * 2)
      ctx.stroke()
      continue
    }
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
