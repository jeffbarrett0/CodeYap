import { useRef, useState } from 'react'
import { newId } from '@/lib/ids'
import { frameAt } from '@/lib/timecode'
import { DIM, arrowHead, ellipseOf, spotlightPath, useDrawing, type Shape } from './drawing'
import { player, usePlayback } from './playback'

type Drag =
  | { kind: 'draw' }
  | { kind: 'move'; id: string; start: { x: number; y: number }; orig: Shape }
  | { kind: 'handle'; id: string; which: 1 | 2 }

/**
 * Annotation layer in the video's native pixel space, so drawings scale/pan with the frame.
 * Shapes belong to the frame they were drawn on and show only while paused there.
 *
 * Interaction: with a draw tool, drag on empty space to create; drag any existing shape
 * (anywhere on its body, e.g. the middle of a line) to MOVE it; drag its handles to resize.
 * With the select tool only moving/resizing/selecting is active.
 */
export function DrawingLayer({ w, h, unit, onZoomRect }: { w: number; h: number; /** native px per screen px */ unit: number; onZoomRect: (r: { x1: number; y1: number; x2: number; y2: number }) => void }) {
  const { tool, color, width, shapes, selectedId, add, update, select } = useDrawing()
  const time = usePlayback((s) => s.time)
  const fps = usePlayback((s) => s.fps)
  const playing = usePlayback((s) => s.playing)
  const frame = frameAt(time, fps)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const scale = w / 1280
  const creating = tool !== 'select'
  const visible = playing ? [] : shapes.filter((s) => s.frame === frame)
  const hit = Math.max(18 * unit, 8)
  const handleR = 6.5 * unit

  const point = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }
  const grab = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (playing) player.pause()
    svgRef.current!.setPointerCapture(e.pointerId)
  }

  const onBodyDown = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    drag.current = { kind: 'move', id: s.id, start: point(e), orig: s }
  }
  const onHandleDown = (e: React.PointerEvent, s: Shape, which: 1 | 2) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    drag.current = { kind: 'handle', id: s.id, which }
  }

  const onDown = (e: React.PointerEvent) => {
    if (!creating || e.button !== 0) return
    grab(e)
    const p = point(e)
    const base = { id: newId('s'), color, width: width * scale, frame: frameAt(player.currentTime, fps), x1: p.x, y1: p.y, x2: p.x, y2: p.y }
    drag.current = { kind: 'draw' }
    setDraft({ ...base, type: tool === 'zoomrect' ? 'rect' : (tool as Shape['type']) })
    select(null)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (d.kind === 'draw') {
      setDraft((s) => {
        if (!s) return s
        let { x, y } = p
        // Shift = perfect circle / square: the shorter side follows the longer one.
        if (e.shiftKey && (s.type === 'circle' || s.type === 'spot' || s.type === 'rect')) {
          const m = Math.max(Math.abs(x - s.x1), Math.abs(y - s.y1))
          x = s.x1 + Math.sign(x - s.x1 || 1) * m
          y = s.y1 + Math.sign(y - s.y1 || 1) * m
        }
        return { ...s, x2: x, y2: y }
      })
    }
    else if (d.kind === 'move') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      update(d.id, { x1: d.orig.x1 + dx, y1: d.orig.y1 + dy, x2: d.orig.x2 + dx, y2: d.orig.y2 + dy })
    } else update(d.id, d.which === 1 ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y })
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'draw' && draft) {
      const big = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 6 * scale
      if (big) {
        if (tool === 'zoomrect') {
          onZoomRect({ x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2 })
          useDrawing.getState().setTool('select')
        } else add(draft)
      }
      setDraft(null)
    }
  }

  const stroke = (s: Shape) => ({ stroke: s.color, strokeWidth: s.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' })
  const spots = [...visible, ...(draft && draft.type === 'spot' && tool === 'spot' ? [draft] : [])].filter((s) => s.type === 'spot')

  const render = (s: Shape, preview = false) => {
    const sel = !preview && s.id === selectedId
    const cx = (s.x1 + s.x2) / 2
    const cy = (s.y1 + s.y2) / 2
    const common = { style: { cursor: preview ? undefined : 'move', pointerEvents: preview ? ('none' as const) : ('auto' as const) }, onPointerDown: preview ? undefined : (e: React.PointerEvent) => onBodyDown(e, s) }
    return (
      <g key={s.id} style={{ filter: s.type === 'spot' ? undefined : 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }} data-shape={s.type} data-selected={sel || undefined}>
        {s.type === 'circle' || s.type === 'spot' ? (
          <>
            <ellipse cx={ellipseOf(s).cx} cy={ellipseOf(s).cy} rx={Math.max(ellipseOf(s).rx, 0.5)} ry={Math.max(ellipseOf(s).ry, 0.5)} {...stroke(s)} fill="transparent" {...common} strokeDasharray={s.type === 'spot' ? `${10 * unit} ${6 * unit}` : undefined} />
            {sel && <rect x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} fill="none" stroke="hsl(var(--accent))" strokeWidth={unit} strokeDasharray={`${5 * unit} ${4 * unit}`} style={{ pointerEvents: 'none' }} />}
          </>
        ) : s.type === 'rect' ? (
          <rect x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} {...stroke(s)} fill="transparent" {...common} />
        ) : (
          <>
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...stroke(s)} style={{ pointerEvents: 'none' }} />
            {s.type === 'arrow' && <polygon points={arrowHead(s).map((p) => p.join(',')).join(' ')} fill={s.color} style={{ pointerEvents: 'none' }} />}
            {/* wide invisible stroke makes thin lines easy to grab anywhere along their length */}
            {!preview && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={hit} strokeLinecap="round" {...common} />}
            {sel && <circle cx={cx} cy={cy} r={handleR * 0.8} fill={s.color} stroke="#000" strokeWidth={unit} style={{ pointerEvents: 'none' }} />}
          </>
        )}
        {sel && (
          <g style={{ filter: 'none' }}>
            {[1, 2].map((wch) => {
              const x = wch === 1 ? s.x1 : s.x2
              const y = wch === 1 ? s.y1 : s.y2
              return <circle key={wch} cx={x} cy={y} r={handleR} fill="#fff" stroke="hsl(var(--accent))" strokeWidth={2 * unit} style={{ cursor: 'grab', pointerEvents: 'auto' }} onPointerDown={(e) => onHandleDown(e, s, wch as 1 | 2)} data-handle={wch} />
            })}
          </g>
        )}
      </g>
    )
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: creating ? 'auto' : 'none', cursor: creating ? 'crosshair' : undefined, touchAction: 'none' }}
      aria-label="Drawing overlay"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {spots.length > 0 && <path d={spotlightPath(w, h, spots)} fill={DIM} fillRule="evenodd" style={{ pointerEvents: 'none' }} />}
      {/* the selected shape is drawn last so its handles are never hidden under another shape */}
      {[...visible].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId)).map((s) => render(s))}
      {draft && (tool === 'zoomrect' ? (
        <rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.y1, draft.y2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.y2 - draft.y1)} fill="rgba(163,230,53,.12)" stroke="hsl(var(--accent))" strokeWidth={2 * unit} strokeDasharray={`${8 * unit} ${5 * unit}`} style={{ pointerEvents: 'none' }} />
      ) : render(draft, true))}
    </svg>
  )
}
