import { describe, expect, it } from 'vitest'
import { clamp, formatBytes, initials, readableOn } from './utils'

describe('utils', () => {
  it('clamps', () => expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]))
  it('formats bytes', () => expect([formatBytes(512), formatBytes(1536), formatBytes(5 * 1024 ** 3)]).toEqual(['512 B', '1.5 KB', '5.0 GB']))
  it('makes initials', () => expect([initials('Marcus Hale'), initials('cher')]).toEqual(['MH', 'C']))
  it('picks readable text on any team colour (WCAG ≥ 4.5)', () => {
    expect(readableOn('#3b82f6')).toBe('#000000') // mid blue: white only reaches 3.7:1
    expect(readableOn('#dc2626')).toBe('#ffffff')
    expect(readableOn('#facc15')).toBe('#000000')
    expect(readableOn('#111827')).toBe('#ffffff')
  })
})
