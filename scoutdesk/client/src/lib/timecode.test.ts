import { describe, expect, it } from 'vitest'
import { formatClock, formatTimecode, frameAt, parseTimecode } from './timecode'

describe('formatTimecode', () => {
  it('formats HH:MM:SS.ff', () => {
    expect(formatTimecode(0, 25)).toBe('00:00:00.00')
    expect(formatTimecode(1.04, 25)).toBe('00:00:01.01')
    expect(formatTimecode(61.5, 25)).toBe('00:01:01.12')
    expect(formatTimecode(3725.96, 25)).toBe('01:02:05.24')
  })
  it('is not fooled by float error (0.12s @ 25fps is frame 3)', () => {
    expect(frameAt(0.12, 25)).toBe(3)
    expect(formatTimecode(0.12, 25)).toBe('00:00:00.03')
  })
  it('uses nominal rate for 29.97 (non-drop timecode)', () => {
    expect(formatTimecode(1, 29.97)).toBe('00:00:00.29')
    expect(formatTimecode(1.0345, 29.97)).toBe('00:00:01.01')
  })
  it('clamps negatives', () => expect(formatTimecode(-3)).toBe('00:00:00.00'))
})

describe('formatClock', () => {
  it('uses m:ss under an hour and h:mm:ss above', () => {
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(3725)).toBe('1:02:05')
  })
})

describe('parseTimecode', () => {
  it('round-trips with formatTimecode', () => {
    for (const t of [0, 12.4, 61.52, 3725.96]) {
      expect(parseTimecode(formatTimecode(t, 25), 25)).toBeCloseTo(Math.floor(t * 25) / 25, 5)
    }
  })
  it('accepts short forms', () => {
    expect(parseTimecode('90')).toBe(90)
    expect(parseTimecode('1:30')).toBe(90)
    expect(parseTimecode('1:01:30')).toBe(3690)
  })
  it('rejects garbage', () => {
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('')).toBeNull()
  })
})
