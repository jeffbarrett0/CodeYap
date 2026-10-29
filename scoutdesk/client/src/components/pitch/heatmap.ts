export interface HeatGrid {
  cols: number
  rows: number
  /** Row-major, normalised so the hottest cell is 1 (all zeros when there are no points). */
  cells: number[]
  max: number
}

/**
 * Gaussian-smoothed density of points on the 0–100 pitch space.
 * `sigma` is in pitch percent; each point contributes to nearby cells.
 */
export function computeHeat(points: { x: number; y: number }[], cols = 24, rows = 16, sigma = 7): HeatGrid {
  const cells = new Array<number>(cols * rows).fill(0)
  const reach = Math.ceil((sigma * 3 * cols) / 100)
  const reachY = Math.ceil((sigma * 3 * rows) / 100)
  const inv = 1 / (2 * sigma * sigma)
  for (const p of points) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((p.x / 100) * cols)))
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((p.y / 100) * rows)))
    for (let r = Math.max(0, cy - reachY); r <= Math.min(rows - 1, cy + reachY); r++) {
      for (let c = Math.max(0, cx - reach); c <= Math.min(cols - 1, cx + reach); c++) {
        const dx = ((c + 0.5) / cols) * 100 - p.x
        const dy = ((r + 0.5) / rows) * 100 - p.y
        cells[r * cols + c]! += Math.exp(-(dx * dx + dy * dy) * inv)
      }
    }
  }
  const max = Math.max(0, ...cells)
  return { cols, rows, max, cells: max > 0 ? cells.map((v) => v / max) : cells }
}
