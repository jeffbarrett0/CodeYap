import { describe, expect, it } from 'vitest'
import { parseRange } from '../src/lib/range.js'

describe('parseRange', () => {
  it('returns full when no header', () => expect(parseRange(undefined, 100)).toEqual({ kind: 'full' }))
  it('parses start-end', () => expect(parseRange('bytes=10-19', 100)).toEqual({ kind: 'partial', start: 10, end: 19 }))
  it('parses open-ended', () => expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 }))
  it('clamps end to size', () => expect(parseRange('bytes=90-500', 100)).toEqual({ kind: 'partial', start: 90, end: 99 }))
  it('parses suffix ranges', () => expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 }))
  it('rejects start beyond size', () => expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' }))
  it('rejects inverted ranges', () => expect(parseRange('bytes=20-10', 100)).toEqual({ kind: 'unsatisfiable' }))
  it('ignores multi-range and garbage', () => {
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'full' })
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'full' })
  })
})
