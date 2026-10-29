import { useEffect, useRef, useState } from 'react'
import { newId } from '@/lib/ids'
import { frameAt } from '@/lib/timecode'
import { DIM, arrowHead, ellipseOf, isVisible, markerGeom, spotlightPath, tagWidth, useDrawing, withBounds, type Shape } from './drawing'
import { player, usePlayback } from './playback'

type Drag =
  | { kind: 'draw' }
  | { kind: 'move'; id: string; start: { x: number; y: number }; orig: Shape }
  | { kind: 'handle'; id: string; which: number }

type Pt = { x: number; y: number }

/**
 * Annotation layer in the video's native pixel space, so drawings scale/pan with the frame.
 * Drawings belong to the frame they were drawn on (and stay for `hold` seconds after it).
 *
 * Interaction: with a draw tool, drag (or click, for numbers/players/areas) on empty space to create;
 * press any existing drawing anywhere on its body to MOVE it; drag its white dots to resize.
 */
export function DrawingLayer({ w, h, unit, onZoomRect }: { w: number; h: number; /** native px per screen px */ unit: number; onZoomRect: (r: { x1: number; y1: number; x2: number; y2: number }) => void }) {
  const { tool, color, width, hold, shapes, selectedId, add, update, select } = useDrawing()
  const time = usePlayback((s) => s.time)
  const fps = usePlayback((s) => s.fps)
  const playing = usePlayback((s) => s.playing)
  const frame = frameAt(time, fps)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [poly, setPolyState] = useState<Pt[]>([])
  // Mirrors `poly` synchronously: a fast double-click fires before React re-renders.
  const polyRef = useRef<Pt[]>([])
  const setPoly = (pts: Pt[]) => { polyRef.current = pts; setPolyState(pts) }
  const [cursor, setCursor] = useState<Pt | null>(null)
  const g = markerGeom(w)
  const scale = g.k
  const creating = tool !== 'select' && tool !== 'pan'
  const visible = shapes.filter((s) => isVisible(s, frame, fps, playing))
  const hit = Math.max(18 * unit, 8)
  const handleR = 6.5 * unit

  // Leaving the Area tool (or Esc) drops an unfinished polygon.
  useEffect(() => { if (tool !== 'area') setPoly([]) }, [tool])

  const point = (e: { clientX: number; clientY: number }): Pt => {
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
  const nowFrame = () => frameAt(player.currentTime, fps)
  const base = () => ({ id: newId('s'), color, width: width * scale, frame: nowFrame(), hold, x1: 0, y1: 0, x2: 0, y2: 0 })

  // Pointer capture swallows dblclick on the shape itself, so a quick second press on a player tag is the "rename" gesture.
  const lastPress = useRef({ id: '', t: 0 })
  const onBodyDown = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    const now = Date.now()
    if (s.type === 'player' && lastPress.current.id === s.id && now - lastPress.current.t < 450) { lastPress.current = { id: '', t: 0 }; setTimeout(() => rename(s), 0); return }
    lastPress.current = { id: s.id, t: now }
    drag.current = { kind: 'move', id: s.id, start: point(e), orig: s }
  }
  const onHandleDown = (e: React.PointerEvent, s: Shape, which: number) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    drag.current = { kind: 'handle', id: s.id, which }
  }

  const finishArea = (pts: Pt[]) => {
    if (pts.length >= 3) add(withBounds({ ...base(), type: 'area', pts: pts.map((p) => [p.x, p.y] as [number, number]) }))
    setPoly([])
  }

  const onDown = (e: React.PointerEvent) => {
    if (!creating || e.button !== 0) return
    grab(e)
    const p = point(e)
    select(null)
    if (tool === 'number' || tool === 'player') {
      const f = nowFrame()
      const used = shapes.filter((s) => s.type === 'number' && s.frame === f).length
      add({ ...base(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, text: tool === 'number' ? String(used + 1) : 'Oyuncu' })
      return
    }
    if (tool === 'area') {
      // Clicking back on the first point closes the shape.
      const cur = polyRef.current
      if (cur.length >= 3 && Math.hypot(p.x - cur[0]!.x, p.y - cur[0]!.y) < 14 * unit * 1.5) return finishArea(cur)
      setPoly([...cur, p])
      return
    }
    drag.current = { kind: 'draw' }
    setDraft({ ...base(), x1: p.x, y1: p.y, x2: p.x, y2: p.y, type: tool === 'zoomrect' ? 'circle' : (tool as Shape['type']) })
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (tool === 'area' && poly.length) setCursor(point(e))
    if (!d) return
    const p = point(e)
    if (d.kind === 'draw') {
      setDraft((s) => {
        if (!s) return s
        let { x, y } = p
        // Shift = perfect circle: the shorter side follows the longer one.
        if (e.shiftKey && (s.type === 'circle' || s.type === 'spot')) {
          const m = Math.max(Math.abs(x - s.x1), Math.abs(y - s.y1))
          x = s.x1 + Math.sign(x - s.x1 || 1) * m
          y = s.y1 + Math.sign(y - s.y1 || 1) * m
        }
        return { ...s, x2: x, y2: y }
      })
    } else if (d.kind === 'move') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      update(d.id, { x1: d.orig.x1 + dx, y1: d.orig.y1 + dy, x2: d.orig.x2 + dx, y2: d.orig.y2 + dy, ...(d.orig.pts ? { pts: d.orig.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) } : {}) })
    } else {
      const s = useDrawing.getState().shapes.find((x) => x.id === d.id)
      if (!s) return
      if (s.pts) update(d.id, withBounds({ ...s, pts: s.pts.map((q, i) => (i === d.which - 1 ? ([p.x, p.y] as [number, number]) : q)) }))
      else update(d.id, d.which === 1 ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y })
    }
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

  // Enter finishes a polygon.
  useEffect(() => {
    if (tool !== 'area' || poly.length < 3) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); finishArea(poly) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const rename = (s: Shape) => {
    if (s.type !== 'player') return
    const name = window.prompt('Oyuncu adı', s.text ?? '')
    if (name !== null) update(s.id, { text: name.trim() || 'Oyuncu' })
  }

  const stroke = (s: Shape) => ({ stroke: s.color, strokeWidth: s.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' })
  const spots = [...visible, ...(draft && draft.type === 'spot' && tool === 'spot' ? [draft] : [])].filter((s) => s.type === 'spot')
  const ringProps = (s: Shape) => ({ rx: g.rx, ry: g.ry, ...stroke(s), strokeWidth: Math.max(2, s.width * 0.6) })

  const render = (s: Shape, preview = false) => {
    const sel = !preview && s.id === selectedId
    const cx = (s.x1 + s.x2) / 2
    const cy = (s.y1 + s.y2) / 2
    const common = { style: { cursor: preview ? undefined : 'move', pointerEvents: preview ? ('none' as const) : ('auto' as const) }, onPointerDown: preview ? undefined : (e: React.PointerEvent) => onBodyDown(e, s) }
    const dashed = { fill: 'none', stroke: 'hsl(var(--accent))', strokeWidth: unit, strokeDasharray: `${5 * unit} ${4 * unit}`, style: { pointerEvents: 'none' as const } }
    let body: React.ReactNode
    let handles: [number, number][] = [[s.x1, s.y1], [s.x2, s.y2]]
    if (s.type === 'circle' || s.type === 'spot') {
      const e = ellipseOf(s)
      body = (
        <>
          <ellipse cx={e.cx} cy={e.cy} rx={Math.max(e.rx, 0.5)} ry={Math.max(e.ry, 0.5)} {...stroke(s)} fill="transparent" {...common} strokeDasharray={s.type === 'spot' ? `${10 * unit} ${6 * unit}` : undefined} />
          {sel && <rect x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} {...dashed} />}
        </>
      )
    } else if (s.type === 'area' && s.pts) {
      const d = s.pts.map((p) => p.join(',')).join(' ')
      handles = s.pts
      body = (
        <>
          <polygon points={d} fill="url(#sd-hatch)" stroke="none" style={{ pointerEvents: 'none' }} />
          <polygon points={d} {...stroke(s)} fill="transparent" {...common} />
        </>
      )
    } else if (s.type === 'number' || s.type === 'player') {
      handles = []
      const by = s.y1 - g.lift
      const text = s.text || (s.type === 'number' ? '1' : 'Oyuncu')
      const tw = tagWidth(text, g.k)
      body = (
        <>
          <ellipse cx={s.x1} cy={s.y1} {...ringProps(s)} fill="transparent" {...common} />
          {s.type === 'number' ? (
            <g {...common}>
              <circle cx={s.x1} cy={by} r={g.badge} fill="#0b0b0b" stroke="#fff" strokeWidth={2 * g.k} />
              <text x={s.x1} y={by} dy="0.35em" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={15 * g.k} style={{ pointerEvents: 'none' }}>{text}</text>
            </g>
          ) : (
            <g {...common}>
              <rect x={s.x1 - tw / 2} y={by - g.tagH / 2} width={tw} height={g.tagH} fill="#0b1220" />
              <text x={s.x1} y={by} dy="0.35em" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={g.font} style={{ pointerEvents: 'none' }}>{text}</text>
            </g>
          )}
          {sel && <ellipse cx={s.x1} cy={s.y1} rx={g.rx + 5 * unit} ry={g.ry + 4 * unit} {...dashed} />}
        </>
      )
    } else {
      const arrowish = s.type === 'arrow' || s.type === 'run'
      body = (
        <>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...stroke(s)} style={{ pointerEvents: 'none' }} />
          {arrowish && <polygon points={arrowHead(s).map((p) => p.join(',')).join(' ')} fill={s.color} style={{ pointerEvents: 'none' }} />}
          {(s.type === 'link' || s.type === 'run') && <ellipse cx={s.x1} cy={s.y1} {...ringProps(s)} style={{ pointerEvents: 'none' }} />}
          {s.type === 'link' && <ellipse cx={s.x2} cy={s.y2} {...ringProps(s)} style={{ pointerEvents: 'none' }} />}
          {/* wide invisible stroke makes thin lines easy to grab anywhere along their length */}
          {!preview && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={hit} strokeLinecap="round" {...common} />}
          {sel && <circle cx={cx} cy={cy} r={handleR * 0.8} fill={s.color} stroke="#000" strokeWidth={unit} style={{ pointerEvents: 'none' }} />}
        </>
      )
    }
    return (
      <g key={s.id} style={{ filter: s.type === 'spot' ? undefined : 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }} data-shape={s.type} data-selected={sel || undefined}>
        {body}
        {sel && (
          <g style={{ filter: 'none' }}>
            {handles.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={handleR} fill="#fff" stroke="hsl(var(--accent))" strokeWidth={2 * unit} style={{ cursor: 'grab', pointerEvents: 'auto' }} onPointerDown={(e) => onHandleDown(e, s, i + 1)} data-handle={i + 1} />
            ))}
          </g>
        )}
      </g>
    )
  }

  const polyPts = [...poly, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')

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
      onDoubleClick={(e) => { if (creating) { e.stopPropagation(); if (tool === 'area') finishArea(polyRef.current.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1]!.x, p.y - a[i - 1]!.y) > 2 * unit)) } }}
    >
      <defs>
        <pattern id="sd-hatch" patternUnits="userSpaceOnUse" width={16 * g.k} height={16 * g.k}>
          <rect width={8 * g.k} height={16 * g.k} fill="rgba(0,0,0,0.45)" />
        </pattern>
      </defs>
      {spots.length > 0 && <path d={spotlightPath(w, h, spots)} fill={DIM} fillRule="evenodd" style={{ pointerEvents: 'none' }} />}
      {/* the selected shape is drawn last so its handles are never hidden under another shape */}
      {[...visible].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId)).map((s) => render(s))}
      {poly.length > 0 && (
        <g style={{ pointerEvents: 'none' }}>
          <polyline points={polyPts} fill="rgba(0,0,0,.25)" stroke={color} strokeWidth={width * scale} strokeLinejoin="round" strokeDasharray={`${8 * unit} ${5 * unit}`} />
          {poly.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={handleR} fill="#fff" stroke={i === 0 ? 'hsl(var(--accent))' : color} strokeWidth={2 * unit} />)}
        </g>
      )}
      {draft && (tool === 'zoomrect' ? (
        <rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.y1, draft.y2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.y2 - draft.y1)} fill="rgba(163,230,53,.12)" stroke="hsl(var(--accent))" strokeWidth={2 * unit} strokeDasharray={`${8 * unit} ${5 * unit}`} style={{ pointerEvents: 'none' }} />
      ) : render(draft, true))}
    </svg>
  )
}
