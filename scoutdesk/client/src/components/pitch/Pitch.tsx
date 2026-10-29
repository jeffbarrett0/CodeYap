import { forwardRef, useImperativeHandle, useRef } from 'react'
import { cn } from '@/lib/utils'
import { computeHeat } from './heatmap'

/** Pitch space is 0–100 on both axes (attack left → right); drawn on a 105 × 68 m canvas. */
export const PITCH_W = 105
export const PITCH_H = 68
export const px = (x: number) => (x / 100) * PITCH_W
export const py = (y: number) => (y / 100) * PITCH_H

export interface PitchHandle {
  /** Client coordinates → pitch percent (clamped to 0–100). */
  toPitch: (clientX: number, clientY: number) => { x: number; y: number }
}

const L = 'rgba(255,255,255,0.55)'

export const Pitch = forwardRef<PitchHandle, {
  children?: React.ReactNode
  className?: string
  /** Optional zone grid overlay. */
  grid?: { cols: number; rows: number } | null
  /** Heat points to render under the children. */
  heat?: { x: number; y: number }[] | null
  heatColor?: string
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void
  cursor?: string
  label?: string
}>(function Pitch({ children, className, grid, heat, heatColor = '#fde047', onPointerDown, onPointerMove, onPointerUp, cursor, label = 'Pitch' }, ref) {
  const svg = useRef<SVGSVGElement>(null)
  useImperativeHandle(ref, () => ({
    toPitch: (cx, cy) => {
      const el = svg.current!
      const pt = el.createSVGPoint()
      pt.x = cx
      pt.y = cy
      const p = pt.matrixTransform(el.getScreenCTM()!.inverse())
      return { x: Math.min(100, Math.max(0, (p.x / PITCH_W) * 100)), y: Math.min(100, Math.max(0, (p.y / PITCH_H) * 100)) }
    },
  }))
  const hg = heat && heat.length ? computeHeat(heat) : null

  return (
    <svg
      ref={svg}
      viewBox={`-2 -2 ${PITCH_W + 4} ${PITCH_H + 4}`}
      role="img"
      aria-label={label}
      className={cn('h-full w-full touch-none select-none rounded bg-[hsl(142_38%_20%)]', className)}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => i % 2 === 0 && <rect key={i} x={(PITCH_W / 10) * i} y={0} width={PITCH_W / 10} height={PITCH_H} fill="rgba(255,255,255,0.035)" />)}
      {hg && (
        <g aria-hidden>
          {hg.cells.map((v, i) =>
            v > 0.04 ? (
              <rect key={i} x={((i % hg.cols) * PITCH_W) / hg.cols} y={(Math.floor(i / hg.cols) * PITCH_H) / hg.rows} width={PITCH_W / hg.cols + 0.05} height={PITCH_H / hg.rows + 0.05} fill={heatColor} opacity={Math.min(0.9, v * 0.95)} />
            ) : null,
          )}
        </g>
      )}
      <g fill="none" stroke={L} strokeWidth={0.35} aria-hidden>
        <rect x={0} y={0} width={PITCH_W} height={PITCH_H} />
        <path d={`M${PITCH_W / 2} 0V${PITCH_H}`} />
        <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={9.15} />
        <rect x={0} y={(PITCH_H - 40.32) / 2} width={16.5} height={40.32} />
        <rect x={PITCH_W - 16.5} y={(PITCH_H - 40.32) / 2} width={16.5} height={40.32} />
        <rect x={0} y={(PITCH_H - 18.32) / 2} width={5.5} height={18.32} />
        <rect x={PITCH_W - 5.5} y={(PITCH_H - 18.32) / 2} width={5.5} height={18.32} />
        <rect x={-1.8} y={(PITCH_H - 7.32) / 2} width={1.8} height={7.32} />
        <rect x={PITCH_W} y={(PITCH_H - 7.32) / 2} width={1.8} height={7.32} />
        <path d={`M16.5 ${PITCH_H / 2 - 7.3}A9.15 9.15 0 0 1 16.5 ${PITCH_H / 2 + 7.3}`} />
        <path d={`M${PITCH_W - 16.5} ${PITCH_H / 2 - 7.3}A9.15 9.15 0 0 0 ${PITCH_W - 16.5} ${PITCH_H / 2 + 7.3}`} />
      </g>
      <g fill={L} aria-hidden>
        <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={0.45} />
        <circle cx={11} cy={PITCH_H / 2} r={0.4} />
        <circle cx={PITCH_W - 11} cy={PITCH_H / 2} r={0.4} />
      </g>
      {grid && (
        <g stroke="rgba(255,255,255,0.18)" strokeWidth={0.2} strokeDasharray="1 1" aria-hidden>
          {Array.from({ length: grid.cols - 1 }, (_, i) => <path key={`c${i}`} d={`M${((i + 1) * PITCH_W) / grid.cols} 0V${PITCH_H}`} />)}
          {Array.from({ length: grid.rows - 1 }, (_, i) => <path key={`r${i}`} d={`M0 ${((i + 1) * PITCH_H) / grid.rows}H${PITCH_W}`} />)}
        </g>
      )}
      <g fill="rgba(255,255,255,0.4)" fontSize={2.4} aria-hidden>
        <text x={PITCH_W / 2} y={PITCH_H + 1.6} textAnchor="middle" fontSize={1.8}>Attacking direction →</text>
      </g>
      {children}
    </svg>
  )
})
