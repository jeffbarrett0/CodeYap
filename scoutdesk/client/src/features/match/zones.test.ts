import { describe, expect, it } from 'vitest'
import { parseZone, zoneAt, zoneCenter } from './zones'

describe('zones', () => {
  it('parses and rejects', () => {
    expect(parseZone('3x3:5')).toEqual({ grid: '3x3', index: 5 })
    expect(parseZone('9x9:1')).toBeNull()
    expect(parseZone(null)).toBeNull()
  })
  it('round-trips centre → zone for both grids', () => {
    for (const g of ['3x3', '6x4'] as const) {
      const n = g === '3x3' ? 9 : 24
      for (let i = 1; i <= n; i++) {
        const c = zoneCenter(`${g}:${i}`)!
        expect(zoneAt(c.x, c.y, g)).toBe(`${g}:${i}`)
      }
    }
  })
  it('clamps pitch edges', () => {
    expect(zoneAt(100, 100, '3x3')).toBe('3x3:9')
    expect(zoneAt(0, 0, '3x3')).toBe('3x3:1')
  })
})
