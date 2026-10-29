import { cn } from '@/lib/utils'
import { type Grid, gridDims, parseZone, zoneLabel } from './zones'

/** Clickable pitch grid. Attack direction is left → right; click the active cell again to clear. */
export function ZonePicker({ value, onChange, grid = '3x3', disabled, className }: {
  value: string | null
  onChange: (zone: string | null) => void
  grid?: Grid
  disabled?: boolean
  className?: string
}) {
  const { cols, rows } = gridDims(grid)
  const current = parseZone(value)
  return (
    <div className={cn('relative aspect-[3/2] w-full overflow-hidden rounded border border-border bg-[hsl(142_35%_18%)]', disabled && 'opacity-50', className)} role="group" aria-label="Pitch zone (attacking left to right)">
      {/* pitch markings */}
      <svg viewBox="0 0 150 100" className="pointer-events-none absolute inset-0 h-full w-full" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" aria-hidden>
        <rect x="1" y="1" width="148" height="98" />
        <path d="M75 1v98" />
        <circle cx="75" cy="50" r="12" />
        <rect x="1" y="22" width="24" height="56" />
        <rect x="125" y="22" width="24" height="56" />
      </svg>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {Array.from({ length: cols * rows }, (_, i) => {
          const zone = `${grid}:${i + 1}`
          const on = current?.grid === grid && current.index === i + 1
          return (
            <button
              key={zone}
              type="button"
              disabled={disabled}
              aria-label={zoneLabel(zone)}
              aria-pressed={on}
              onClick={() => onChange(on ? null : zone)}
              className={cn('border border-white/10 transition-colors', on ? 'bg-accent/80' : 'hover:bg-white/15')}
            />
          )
        })}
      </div>
    </div>
  )
}
