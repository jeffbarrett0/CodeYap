import { useRef, useState } from 'react'
import { newId } from '@/lib/ids'
import { frameAt } from '@/lib/timecode'
import { arrowHead, useDrawing, type Shape } from './drawing'
import { player, usePlayback } from './playback'

/**
 * SVG annotation layer in the video's native pixel space, so drawings scale and
 * pan with the frame. Shapes belong to the frame they were drawn on and show
 * only while paused there — the tactical "freeze and explain" workflow.
 */
export function DrawingLayer({ w, h }: { w: number; h: number }) {
  const { active, tool, color, width, shapes, add } = useDrawing()
  const time = usePlayback((s) => s.time)
  const fps = usePlayback((s) => s.fps)
  const playing = usePlayback((s) => s.playing)
  const frame = frameAt(time, fps)
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const scale = w / 1280

  const point = (e: React.PointerEvent) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }

  const visible = playing ? [] : shapes.filter((s) => s.frame === frame)
  const all = draft ? [...visible, draft] : visible

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: active ? 'auto' : 'none', cursor: active ? 'crosshair' : undefined, touchAction: 'none' }}
      aria-label="Drawing overlay"
      onPointerDown={(e) => {
        if (!active || e.button !== 0) return
        e.stopPropagation()
        if (playing) player.pause()
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = point(e)
        setDraft({ id: newId('s'), type: tool, color, width: width * scale, frame: frameAt(player.currentTime, fps), x1: p.x, y1: p.y, x2: p.x, y2: p.y })
      }}
      onPointerMove={(e) => {
        if (!draft) return
        const p = point(e)
        setDraft({ ...draft, x2: p.x, y2: p.y })
      }}
      onPointerUp={() => {
        if (draft && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 6 * scale) add(draft)
        setDraft(null)
      }}
    >
      {all.map((s) => (
        <g key={s.id} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" fill="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>
          {s.type === 'circle' ? (
            <circle cx={s.x1} cy={s.y1} r={Math.hypot(s.x2 - s.x1, s.y2 - s.y1)} />
          ) : (
            <>
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
              {s.type === 'arrow' && <polygon points={arrowHead(s).map((p) => p.join(',')).join(' ')} fill={s.color} />}
            </>
          )}
        </g>
      ))}
    </svg>
  )
}
