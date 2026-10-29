export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/**
 * Parse an HTTP `Range: bytes=…` header against a resource of `size` bytes.
 * Only single ranges are supported (what browsers send for media); multi-range
 * requests fall back to a full response, which RFC 9110 allows.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return { kind: 'full' }
  const [, a, b] = m
  if (a === '' && b === '') return { kind: 'full' }

  let start: number
  let end: number
  if (a === '') {
    // suffix range: last N bytes
    const n = Number(b)
    if (n === 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (start >= size || start > end) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end }
}
