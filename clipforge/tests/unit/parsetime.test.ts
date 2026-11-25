import { describe, expect, it } from 'vitest'
import { parseTime } from '../../src/renderer/components/SportPlus'

describe('süre yazımı', () => {
  it('1:48 = 108 sn; saniye ve ondalık da kabul; saçma yazım reddedilir', () => {
    expect(parseTime('1:48')).toBe(108)
    expect(parseTime('108')).toBe(108)
    expect(parseTime('0:03,5')).toBe(3.5)
    expect(parseTime('1:02:03')).toBe(3723)
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(parseTime('1:2:3:4')).toBeNull()
  })
})
