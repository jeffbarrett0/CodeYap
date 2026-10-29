export type Grid = '3x3' | '6x4'

const DIMS: Record<Grid, { cols: number; rows: number }> = { '3x3': { cols: 3, rows: 3 }, '6x4': { cols: 6, rows: 4 } }

export const gridDims = (g: Grid) => DIMS[g]

export function parseZone(zone: string | null): { grid: Grid; index: number } | null {
  if (!zone) return null
  const [g, i] = zone.split(':')
  if ((g !== '3x3' && g !== '6x4') || !i) return null
  return { grid: g, index: Number(i) }
}

/** Pitch coordinates (0–100, attack left→right) of a zone's centre. */
export function zoneCenter(zone: string | null): { x: number; y: number } | null {
  const z = parseZone(zone)
  if (!z) return null
  const { cols, rows } = DIMS[z.grid]
  const col = (z.index - 1) % cols
  const row = Math.floor((z.index - 1) / cols)
  return { x: ((col + 0.5) * 100) / cols, y: ((row + 0.5) * 100) / rows }
}

/** Zone (in the given grid) containing pitch point (x, y). */
export function zoneAt(x: number, y: number, grid: Grid): string {
  const { cols, rows } = DIMS[grid]
  const col = Math.min(cols - 1, Math.max(0, Math.floor((x / 100) * cols)))
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y / 100) * rows)))
  return `${grid}:${row * cols + col + 1}`
}

const THIRD = ['Defensive third', 'Middle third', 'Attacking third']
export function zoneLabel(zone: string | null): string {
  const z = parseZone(zone)
  if (!z) return 'No zone'
  const { cols } = DIMS[z.grid]
  const col = (z.index - 1) % cols
  const row = Math.floor((z.index - 1) / cols)
  return `${THIRD[Math.min(2, Math.floor((col / cols) * 3))]} · row ${row + 1}`
}
