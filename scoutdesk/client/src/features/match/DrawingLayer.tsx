import { useEffect, useRef, useState } from 'react'
import { newId } from '@/lib/ids'
import { frameAt } from '@/lib/timecode'
import { LIGHT_VEC, arrowHead, clickBox, ellipseOf, isVisible, lightFront, lightStops, markerGeom, tagCenterY, tagWidth, useDrawing, withBounds, zoomInset, type DrawTool, type Shape } from './drawing'
import { player, usePlayback } from './playback'

type Drag =
  | { kind: 'draw' }
  | { kind: 'move'; id: string; start: { x: number; y: number }; orig: Shape }
  | { kind: 'handle'; id: string; which: number }
  | { kind: 'size'; id: string }

type Pt = { x: number; y: number }

/** Tools where you click several points instead of dragging; the right mouse button ends them. */
const CLICK_TOOLS: DrawTool[] = ['link', 'area', 'number']
const YELLOW = '#facc15'

/**
 * Annotation layer in the video's native pixel space, so drawings scale/pan with the frame.
 * Drawings belong to the frame they were drawn on (and stay for `hold` seconds after it).
 *
 * - Drag tools (arrow, line, run arrow, circle, zoom, light) draw one shape and then hand you back the Select tool.
 * - Click tools: Bağlantı chains players one click at a time, Alan adds corners, Numara numbers players 1, 2, 3…
 *   The right mouse button ends them.
 * - Press any drawing on its body to move it; drag its white dots to resize.
 */
export function DrawingLayer({ w, h, unit, onZoomRect }: { w: number; h: number; /** native px per screen px */ unit: number; onZoomRect: (r: { x1: number; y1: number; x2: number; y2: number }) => void }) {
  const { tool, color, width, hold, shapes, selectedId, add, update, select, setTool } = useDrawing()
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
  const clickTool = CLICK_TOOLS.includes(tool as DrawTool)
  const visible = shapes.filter((s) => isVisible(s, frame, fps, playing))
  const zooms = visible.filter((s) => s.type === 'zoom')
  const hit = Math.max(18 * unit, 8)
  const handleR = 6.5 * unit

  // Leaving a click tool (or Esc) drops an unfinished chain / polygon.
  useEffect(() => { if (tool !== 'area' && tool !== 'link') setPoly([]) }, [tool])

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

  const onBodyDown = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    drag.current = { kind: 'move', id: s.id, start: point(e), orig: s }
  }
  const onHandleDown = (e: React.PointerEvent, s: Shape, which: number) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    drag.current = { kind: 'handle', id: s.id, which }
  }

  const onSizeDown = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    grab(e)
    select(s.id)
    drag.current = { kind: 'size', id: s.id }
  }

  /** Close a link chain / polygon; the Select tool takes over so the next click doesn't draw more. */
  const finishPoly = (pts: Pt[]) => {
    const need = tool === 'link' ? 2 : 3
    const clean = pts.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1]!.x, p.y - a[i - 1]!.y) > 2 * unit)
    if (clean.length >= need && (tool === 'link' || tool === 'area')) {
      add(withBounds({ ...base(), type: tool, ...(tool === 'link' ? { color: YELLOW } : {}), pts: clean.map((p) => [p.x, p.y] as [number, number]) }))
    }
    setPoly([])
    setCursor(null)
    setTool('select')
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
      if (tool === 'player') setTool('select') // numbering keeps going until the right click
      return
    }
    if (tool === 'link' || tool === 'area') {
      const cur = polyRef.current
      // Clicking back on the first corner closes a polygon.
      if (tool === 'area' && cur.length >= 3 && Math.hypot(p.x - cur[0]!.x, p.y - cur[0]!.y) < 21 * unit) return finishPoly(cur)
      setPoly([...cur, p])
      return
    }
    drag.current = { kind: 'draw' }
    setDraft({ ...base(), x1: p.x, y1: p.y, x2: p.x, y2: p.y, type: tool === 'zoomrect' ? 'circle' : (tool as Shape['type']) })
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if ((tool === 'area' || tool === 'link') && polyRef.current.length) setCursor(point(e))
    if (!d) return
    const p = point(e)
    if (d.kind === 'draw') {
      setDraft((s) => {
        if (!s) return s
        let { x, y } = p
        // Shift = perfect circle: the shorter side follows the longer one.
        if (e.shiftKey && (s.type === 'circle' || s.type === 'zoom' || s.type === 'spot')) {
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
    } else if (d.kind === 'size') {
      const s = useDrawing.getState().shapes.find((x) => x.id === d.id)
      if (!s) return
      // Number: the handle sits on the badge's edge; player: on the tag's right edge. Size follows the distance from the anchor.
      const size = s.type === 'number' ? Math.hypot(p.x - s.x1, p.y - s.y1) / g.badge : Math.abs(p.x - s.x1) / (tagWidth(s.text || 'Oyuncu', g.k) / 2)
      update(d.id, { size: Math.min(4, Math.max(0.5, size)) })
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
    if (d?.kind !== 'draw' || !draft) return
    setDraft(null)
    const moved = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1)
    const big = moved > 6 * scale
    if (tool === 'zoomrect') {
      if (big) {
        onZoomRect({ x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2 })
        setTool('select')
      }
    } else if (draft.type === 'spot') {
      // Light: a dragged box lights just that area; a plain click lights the whole frame. It sweeps in over 3 s unless you set another duration.
      add({ ...draft, ...(big ? {} : { x1: 0, y1: 0, x2: w, y2: h }), hold: hold || 3, ldir: 'down', lint: 0.6, lanim: true })
      setTool('select')
    } else if (big) {
      add(draft)
      setTool('select')
    } else if (draft.type === 'circle' || draft.type === 'zoom') {
      // A plain click on a player drops a ready-sized ring / close-up circle / light.
      add({ ...draft, ...clickBox(draft.type, draft.x1, draft.y1, w) })
      setTool('select')
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!creating) return
    e.preventDefault()
    // A right click always stops whatever is going on: playback, a drag in progress, an unfinished shape.
    if (playing) player.pause()
    if (drag.current?.kind === 'draw') { drag.current = null; setDraft(null); setTool('select'); return }
    if (tool === 'link' || tool === 'area') finishPoly(polyRef.current)
    else if (tool === 'number') setTool('select')
  }

  // Mouse wheel over a number / player marker resizes it (instead of zooming the whole video).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      const id = (e.target as Element).closest('[data-shape]')?.getAttribute('data-id')
      const s = id ? useDrawing.getState().shapes.find((x) => x.id === id) : undefined
      if (!s || (s.type !== 'number' && s.type !== 'player')) return
      e.preventDefault()
      e.stopPropagation()
      useDrawing.getState().update(s.id, { size: Math.min(4, Math.max(0.5, (s.size ?? 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Enter also finishes a chain / polygon.
  useEffect(() => {
    if ((tool !== 'area' && tool !== 'link') || poly.length === 0) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); finishPoly(polyRef.current) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const stroke = (s: Shape) => ({ stroke: s.color, strokeWidth: s.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' })
  const ringProps = (s: Shape) => ({ rx: g.rx, ry: g.ry, ...stroke(s), strokeWidth: Math.max(2, s.width * 0.6) })
  const bodiesOn = !clickTool // while clicking points, existing drawings must not steal the click

  const render = (s: Shape, preview = false) => {
    const sel = !preview && s.id === selectedId
    const cx = (s.x1 + s.x2) / 2
    const cy = (s.y1 + s.y2) / 2
    const common = { style: { cursor: preview ? undefined : 'move', pointerEvents: preview || !bodiesOn ? ('none' as const) : ('auto' as const) }, onPointerDown: preview ? undefined : (e: React.PointerEvent) => onBodyDown(e, s) }
    const dashed = { fill: 'none', stroke: 'hsl(var(--accent))', strokeWidth: unit, strokeDasharray: `${5 * unit} ${4 * unit}`, style: { pointerEvents: 'none' as const } }
    let body: React.ReactNode
    let handles: [number, number][] = [[s.x1, s.y1], [s.x2, s.y2]]
    if (s.type === 'spot') {
      // Light: white gradient from one edge of its box, travelling across while the drawing plays. The rect itself lets clicks through;
      // a small "Işık" tag in the corner is what you grab to move it.
      const x0 = Math.min(s.x1, s.x2), y0 = Math.min(s.y1, s.y2), bw = Math.abs(s.x2 - s.x1), bh = Math.abs(s.y2 - s.y1)
      const [gx1, gy1, gx2, gy2] = LIGHT_VEC[s.ldir ?? 'down']
      const lw = 58 * g.k, lh = 24 * g.k
      body = (
        <>
          <defs>
            <linearGradient id={`sd-l-${s.id}`} x1={gx1} y1={gy1} x2={gx2} y2={gy2}>
              {lightStops(s, lightFront(s, frame, fps)).map(([o, a], i) => <stop key={i} offset={o} stopColor="#fff" stopOpacity={a} />)}
            </linearGradient>
          </defs>
          <rect x={x0} y={y0} width={bw} height={bh} fill={`url(#sd-l-${s.id})`} style={{ pointerEvents: 'none' }} />
          {!preview && (
            <g {...common}>
              <rect x={x0 + 6 * g.k} y={y0 + 6 * g.k} width={lw} height={lh} rx={4 * g.k} fill="#0b1220" stroke="#fff" strokeWidth={1.5 * g.k} />
              <text x={x0 + 6 * g.k + lw / 2} y={y0 + 6 * g.k + lh / 2} dy="0.35em" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={14 * g.k} style={{ pointerEvents: 'none' }}>Işık</text>
            </g>
          )}
          {sel && <rect x={x0} y={y0} width={bw} height={bh} {...dashed} />}
        </>
      )
    } else if (s.type === 'circle' || s.type === 'zoom') {
      const e = ellipseOf(s)
      const z = s.type === 'zoom' ? zoomInset(s, Math.max(0, zooms.findIndex((x) => x.id === s.id)), Math.max(1, zooms.length), w, h) : null
      body = (
        <>
          <ellipse cx={e.cx} cy={e.cy} rx={Math.max(e.rx, 0.5)} ry={Math.max(e.ry, 0.5)} {...stroke(s)} fill="transparent" {...common} />
          {z && (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={z.cx} y1={z.cy} x2={z.icx} y2={z.icy} stroke="#fff" strokeWidth={2 * g.k} strokeDasharray={`${8 * g.k} ${6 * g.k}`} />
              <circle cx={z.icx} cy={z.icy} r={z.R + 1.5 * g.k} fill="none" stroke="#fff" strokeWidth={3 * g.k} />
              <rect x={z.icx - tagWidth('Player close up', g.k) / 2} y={z.icy - z.R - g.tagH - 4 * g.k} width={tagWidth('Player close up', g.k)} height={g.tagH} fill="#0b1220" />
              <text x={z.icx} y={z.icy - z.R - g.tagH / 2 - 4 * g.k} dy="0.35em" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={g.font}>Player close up</text>
            </g>
          )}
          {sel && <rect x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} {...dashed} />}
        </>
      )
    } else if ((s.type === 'area' || s.type === 'link') && s.pts) {
      const d = s.pts.map((p) => p.join(',')).join(' ')
      handles = s.pts
      body = s.type === 'area' ? (
        <>
          <polygon points={d} fill="url(#sd-hatch)" stroke="none" style={{ pointerEvents: 'none' }} />
          <polygon points={d} {...stroke(s)} fill="transparent" {...common} />
        </>
      ) : (
        <>
          <polyline points={d} {...stroke(s)} stroke="#000" strokeWidth={s.width + 3 * g.k} style={{ pointerEvents: 'none' }} />
          <polyline points={d} {...stroke(s)} style={{ pointerEvents: 'none' }} />
          {s.pts.map(([x, y], i) => (
            <g key={i} style={{ pointerEvents: 'none' }}>
              <ellipse cx={x} cy={y} {...ringProps(s)} stroke="#000" strokeWidth={Math.max(2, s.width * 0.7) + 3 * g.k} />
              <ellipse cx={x} cy={y} {...ringProps(s)} strokeWidth={Math.max(2, s.width * 0.7)} />
            </g>
          ))}
          {/* wide invisible stroke makes the chain easy to grab */}
          {!preview && <polyline points={d} stroke="transparent" fill="none" strokeWidth={hit} strokeLinecap="round" strokeLinejoin="round" {...common} />}
        </>
      )
    } else if (s.type === 'number' || s.type === 'player') {
      handles = []
      const sz = s.size ?? 1
      const text = s.text || (s.type === 'number' ? '1' : 'Oyuncu')
      const tw = tagWidth(text, g.k, sz)
      const tcy = tagCenterY(s, g)
      // Where the resize handle sits: number = right edge of the badge, player = right edge of the tag.
      const hx = s.type === 'number' ? s.x1 + g.badge * sz : s.x1 + tw / 2
      const hy = s.type === 'number' ? s.y1 : tcy
      body = (
        <>
          {s.type === 'number' ? (
            <g {...common}>
              <circle cx={s.x1} cy={s.y1} r={g.badge * sz} fill="#0b0b0b" stroke={s.color} strokeWidth={2 * g.k * sz} />
              <text x={s.x1} y={s.y1} dy="0.35em" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={g.numFont * sz} style={{ pointerEvents: 'none' }}>{text}</text>
            </g>
          ) : (
            <g {...common}>
              <rect x={s.x1 - tw / 2} y={tcy - (g.tagH * sz) / 2} width={tw} height={g.tagH * sz} fill="#0b1220" stroke={s.color} strokeWidth={2 * g.k * sz} />
              <text x={s.x1} y={tcy} dy="0.35em" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={g.font * sz} style={{ pointerEvents: 'none' }}>{text}</text>
            </g>
          )}
          {sel && <circle cx={hx} cy={hy} r={handleR} fill="#fff" stroke="hsl(var(--accent))" strokeWidth={2 * unit} style={{ cursor: 'ew-resize', pointerEvents: 'auto' }} onPointerDown={(e) => onSizeDown(e, s)} data-handle="size" />}
        </>
      )
    } else {
      const arrowish = s.type === 'arrow' || s.type === 'run'
      body = (
        <>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...stroke(s)} strokeDasharray={s.type === 'run' ? `${12 * g.k} ${8 * g.k}` : undefined} style={{ pointerEvents: 'none' }} />
          {arrowish && <polygon points={arrowHead(s).map((p) => p.join(',')).join(' ')} fill={s.color} style={{ pointerEvents: 'none' }} />}
          {/* wide invisible stroke makes thin lines easy to grab anywhere along their length */}
          {!preview && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={hit} strokeLinecap="round" {...common} />}
          {sel && <circle cx={cx} cy={cy} r={handleR * 0.8} fill={s.color} stroke="#000" strokeWidth={unit} style={{ pointerEvents: 'none' }} />}
        </>
      )
    }
    return (
      <g key={s.id} style={{ filter: s.type === 'spot' ? undefined : 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }} data-shape={s.type} data-id={s.id} data-selected={sel || undefined}>
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
  const chainColor = tool === 'link' ? YELLOW : color

  return (
    <>
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
        onContextMenu={onContextMenu}
        onDoubleClick={(e) => { if (creating) { e.stopPropagation(); if (tool === 'area') finishPoly(polyRef.current) } }}
      >
        <defs>
          <pattern id="sd-hatch" patternUnits="userSpaceOnUse" width={16 * g.k} height={16 * g.k}>
            <rect width={8 * g.k} height={16 * g.k} fill="rgba(0,0,0,0.45)" />
          </pattern>
        </defs>
        {/* the selected shape is drawn last so its handles are never hidden under another shape */}
        {[...visible].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId)).map((s) => render(s))}
        {poly.length > 0 && (
          <g style={{ pointerEvents: 'none' }}>
            {tool === 'link' && <polyline points={polyPts} fill="none" stroke="#000" strokeWidth={width * scale + 3 * g.k} strokeLinejoin="round" strokeLinecap="round" />}
            <polyline points={polyPts} fill={tool === 'area' ? 'rgba(0,0,0,.25)' : 'none'} stroke={chainColor} strokeWidth={width * scale} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={tool === 'area' ? `${8 * unit} ${5 * unit}` : undefined} />
            {poly.map((p, i) => tool === 'link'
              ? <g key={i}><ellipse cx={p.x} cy={p.y} rx={g.rx} ry={g.ry} fill="none" stroke="#000" strokeWidth={Math.max(2, width * scale * 0.7) + 3 * g.k} /><ellipse cx={p.x} cy={p.y} rx={g.rx} ry={g.ry} fill="none" stroke={YELLOW} strokeWidth={Math.max(2, width * scale * 0.7)} /></g>
              : <circle key={i} cx={p.x} cy={p.y} r={handleR} fill="#fff" stroke={i === 0 ? 'hsl(var(--accent))' : color} strokeWidth={2 * unit} />)}
          </g>
        )}
        {draft && (tool === 'zoomrect' ? (
          <rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.y1, draft.y2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.y2 - draft.y1)} fill="rgba(163,230,53,.12)" stroke="hsl(var(--accent))" strokeWidth={2 * unit} strokeDasharray={`${8 * unit} ${5 * unit}`} style={{ pointerEvents: 'none' }} />
        ) : render(draft, true))}
      </svg>
      <ZoomInsets w={w} h={h} zooms={zooms} />
    </>
  )
}

/**
 * The live magnified circle ("Player close up") for each zoom shape on screen: a canvas fed from the playing video.
 * Mouse: drag inside it to pan, wheel to zoom in/out, drag the small dot on its edge to resize the window.
 */
function ZoomInsets({ w, h, zooms }: { w: number; h: number; zooms: Shape[] }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  const key = zooms.map((z) => `${z.id}:${z.x1.toFixed(0)},${z.y1.toFixed(0)},${z.x2.toFixed(0)},${z.y2.toFixed(0)},${z.zk},${z.zdx},${z.zdy},${z.zs}`).join('|')
  useEffect(() => {
    if (!zooms.length) return
    let raf = 0
    const draw = () => {
      const v = player.el
      zooms.forEach((s, i) => {
        const c = refs.current[i]
        const ctx = c?.getContext('2d')
        if (!c || !ctx || !v || v.readyState < 2) return
        const z = zoomInset(s, i, zooms.length, w, h)
        const sx = (v.videoWidth || w) / w
        const sy = (v.videoHeight || h) / h
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(v, (z.scx - z.r) * sx, (z.scy - z.r) * sy, 2 * z.r * sx, 2 * z.r * sy, 0, 0, c.width, c.height)
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, w, h])

  // Wheel = zoom. Needs a non-passive native listener so the page / video does not zoom too.
  const wheelRefs = useRef<Map<string, { el: HTMLCanvasElement; fn: (e: WheelEvent) => void }>>(new Map())
  const attach = (id: string) => (el: HTMLCanvasElement | null) => {
    const prev = wheelRefs.current.get(id)
    if (prev) { prev.el.removeEventListener('wheel', prev.fn); wheelRefs.current.delete(id) }
    if (!el) return
    const fn = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const st = useDrawing.getState()
      const s = st.shapes.find((x) => x.id === id)
      if (s) st.update(id, { zk: Math.min(8, Math.max(0.4, (s.zk ?? 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) })
    }
    el.addEventListener('wheel', fn, { passive: false })
    wheelRefs.current.set(id, { el, fn })
  }

  const panning = useRef<{ id: string; x: number; y: number } | null>(null)
  const sizing = useRef<{ id: string; baseR: number; cx: number; cy: number } | null>(null)
  const down = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    useDrawing.getState().select(s.id)
    panning.current = { id: s.id, x: e.clientX, y: e.clientY }
  }
  const move = (e: React.PointerEvent, s: Shape, i: number) => {
    const p = panning.current
    if (!p || p.id !== s.id) return
    const rect = e.currentTarget.getBoundingClientRect()
    const z = zoomInset(s, i, zooms.length, w, h)
    // Dragging the picture right moves the visible area left (like grabbing the image).
    const dx = -((e.clientX - p.x) / rect.width) * 2 * z.r
    const dy = -((e.clientY - p.y) / rect.height) * 2 * z.r
    panning.current = { id: s.id, x: e.clientX, y: e.clientY }
    useDrawing.getState().update(s.id, { zdx: (s.zdx ?? 0) + dx, zdy: (s.zdy ?? 0) + dy })
  }
  // Moving the whole close-up window: grab its "Player close up" label and drag.
  const moving = useRef<{ id: string; x: number; y: number } | null>(null)
  const moveDown = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    useDrawing.getState().select(s.id)
    moving.current = { id: s.id, x: e.clientX, y: e.clientY }
  }
  const moveMove = (e: React.PointerEvent, s: Shape, i: number, canvas: HTMLCanvasElement | null) => {
    const m = moving.current
    if (!m || m.id !== s.id || !canvas) return
    const z = zoomInset(s, i, zooms.length, w, h)
    const scale = canvas.getBoundingClientRect().width / (2 * z.R) // screen px per video px
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
    moving.current = { id: s.id, x: e.clientX, y: e.clientY }
    useDrawing.getState().update(s.id, { zx: clamp(z.icx + (e.clientX - m.x) / scale, z.R, w - z.R), zy: clamp(z.icy + (e.clientY - m.y) / scale, z.R, h - z.R) })
  }
  const handleDown = (e: React.PointerEvent, s: Shape, canvas: HTMLCanvasElement | null) => {
    if (e.button !== 0 || !canvas) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = canvas.getBoundingClientRect()
    sizing.current = { id: s.id, baseR: r.width / 2 / (s.zs ?? 1), cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
  const handleMove = (e: React.PointerEvent, s: Shape) => {
    const z = sizing.current
    if (!z || z.id !== s.id) return
    useDrawing.getState().update(s.id, { zs: Math.min(2, Math.max(0.5, Math.hypot(e.clientX - z.cx, e.clientY - z.cy) / z.baseR)) })
  }

  return (
    <>
      {zooms.map((s, i) => {
        const z = zoomInset(s, i, zooms.length, w, h)
        const left = ((z.icx - z.R) / w) * 100
        const top = ((z.icy - z.R) / h) * 100
        const wp = ((2 * z.R) / w) * 100
        const hp = ((2 * z.R) / h) * 100
        return (
          <div key={s.id} data-overlay className="absolute" style={{ left: `${left}%`, top: `${top}%`, width: `${wp}%`, height: `${hp}%` }}>
            <canvas
              ref={(el) => { refs.current[i] = el; attach(s.id)(el) }}
              width={Math.round(2 * z.R)}
              height={Math.round(2 * z.R)}
              aria-label="Player close up: sürükleyerek kaydır, tekerlekle yakınlaştır"
              data-zoom-inset
              className="h-full w-full cursor-grab touch-none rounded-full active:cursor-grabbing"
              onPointerDown={(e) => down(e, s)}
              onPointerMove={(e) => move(e, s, i)}
              onPointerUp={() => { panning.current = null }}
            />
            {/* move handle: sits exactly over the "Player close up" label */}
            <div
              data-zoom-move
              title="Close-up penceresini taşımak için sürükle"
              className="absolute left-0 right-0 cursor-move touch-none"
              style={{ top: `-${(((markerGeom(w).tagH + 4 * markerGeom(w).k) / (2 * z.R)) * 100).toFixed(2)}%`, height: `${((markerGeom(w).tagH / (2 * z.R)) * 100).toFixed(2)}%` }}
              onPointerDown={(e) => moveDown(e, s)}
              onPointerMove={(e) => moveMove(e, s, i, refs.current[i] ?? null)}
              onPointerUp={() => { moving.current = null }}
            />
            {/* resize dot on the circle's lower-right edge */}
            <span
              role="presentation"
              data-zoom-resize
              className="absolute h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-accent bg-white"
              style={{ left: '85.4%', top: '85.4%', transform: 'translate(-50%,-50%)', touchAction: 'none' }}
              onPointerDown={(e) => handleDown(e, s, refs.current[i] ?? null)}
              onPointerMove={(e) => handleMove(e, s)}
              onPointerUp={() => { sizing.current = null }}
            />
          </div>
        )
      })}
    </>
  )
}
