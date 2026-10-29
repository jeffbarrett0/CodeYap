import { useEffect, useRef, useState } from 'react'
import { newId } from '@/lib/ids'
import { frameAt } from '@/lib/timecode'
import { arrowHead, clickBox, ellipseOf, isVisible, markerGeom, tagWidth, useDrawing, withBounds, zoomInset, type DrawTool, type Shape } from './drawing'
import { player, usePlayback } from './playback'

type Drag =
  | { kind: 'draw' }
  | { kind: 'move'; id: string; start: { x: number; y: number }; orig: Shape }
  | { kind: 'handle'; id: string; which: number }

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
    } else if (big) {
      add(draft)
      setTool('select')
    } else if (draft.type === 'circle' || draft.type === 'zoom' || draft.type === 'spot') {
      // A plain click on a player drops a ready-sized ring / close-up circle / light.
      add({ ...draft, ...clickBox(draft.type, draft.x1, draft.y1, w) })
      setTool('select')
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!creating) return
    e.preventDefault()
    if (tool === 'link' || tool === 'area') finishPoly(polyRef.current)
    else if (tool === 'number') setTool('select')
  }

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
    if (s.type === 'circle' || s.type === 'zoom' || s.type === 'spot') {
      const e = ellipseOf(s)
      const z = s.type === 'zoom' ? zoomInset(s, Math.max(0, zooms.findIndex((x) => x.id === s.id)), Math.max(1, zooms.length), w, h) : null
      body = (
        <>
          {s.type === 'spot' ? (
            <ellipse cx={e.cx} cy={e.cy} rx={Math.max(e.rx, 0.5)} ry={Math.max(e.ry, 0.5)} fill="url(#sd-glow)" stroke="none" {...common} />
          ) : (
            <ellipse cx={e.cx} cy={e.cy} rx={Math.max(e.rx, 0.5)} ry={Math.max(e.ry, 0.5)} {...stroke(s)} fill="transparent" {...common} />
          )}
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
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...stroke(s)} strokeDasharray={s.type === 'run' ? `${12 * g.k} ${8 * g.k}` : undefined} style={{ pointerEvents: 'none' }} />
          {arrowish && <polygon points={arrowHead(s).map((p) => p.join(',')).join(' ')} fill={s.color} style={{ pointerEvents: 'none' }} />}
          {s.type === 'run' && <ellipse cx={s.x1} cy={s.y1} {...ringProps(s)} style={{ pointerEvents: 'none' }} />}
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
          <radialGradient id="sd-glow">
            <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
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

/** The live magnified circle ("Player close up") for each zoom shape on screen: a canvas fed from the playing video. */
function ZoomInsets({ w, h, zooms }: { w: number; h: number; zooms: Shape[] }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  const key = zooms.map((z) => `${z.id}:${z.x1.toFixed(0)},${z.y1.toFixed(0)},${z.x2.toFixed(0)},${z.y2.toFixed(0)}`).join('|')
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
        ctx.drawImage(v, (z.cx - z.r) * sx, (z.cy - z.r) * sy, 2 * z.r * sx, 2 * z.r * sy, 0, 0, c.width, c.height)
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, w, h])
  return (
    <>
      {zooms.map((s, i) => {
        const z = zoomInset(s, i, zooms.length, w, h)
        return (
          <canvas
            key={s.id}
            ref={(el) => { refs.current[i] = el }}
            width={Math.round(2 * z.R)}
            height={Math.round(2 * z.R)}
            aria-hidden
            data-zoom-inset
            className="pointer-events-none absolute rounded-full"
            style={{ left: `${((z.icx - z.R) / w) * 100}%`, top: `${((z.icy - z.R) / h) * 100}%`, width: `${((2 * z.R) / w) * 100}%`, height: `${((2 * z.R) / h) * 100}%` }}
          />
        )
      })}
    </>
  )
}
