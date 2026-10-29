import { describe, expect, it } from 'vitest'
import { computeHeat } from './heatmap'

describe('computeHeat', () => {
  it('is all zeros without points', () => {
    const h = computeHeat([])
    expect(h.max).toBe(0)
    expect(h.cells.every((v) => v === 0)).toBe(true)
  })
  it('peaks at the cell containing a lone point and normalises to 1', () => {
    const h = computeHeat([{ x: 50, y: 50 }], 10, 10, 8)
    expect(Math.max(...h.cells)).toBe(1)
    const peak = h.cells.indexOf(1)
    expect([44, 45, 54, 55]).toContain(peak)
  })
  it('puts more heat where more points are', () => {
    const h = computeHeat([{ x: 10, y: 50 }, { x: 11, y: 50 }, { x: 10, y: 52 }, { x: 90, y: 50 }], 20, 10, 6)
    const at = (x: number, y: number) => h.cells[Math.floor((y / 100) * 10) * 20 + Math.floor((x / 100) * 20)]!
    expect(at(10, 50)).toBeGreaterThan(at(90, 50))
  })
  it('clamps points on the edge', () => {
    expect(() => computeHeat([{ x: 100, y: 100 }, { x: 0, y: 0 }])).not.toThrow()
  })
})
