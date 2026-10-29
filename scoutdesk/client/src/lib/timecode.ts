/** Timecode helpers. Display format is HH:MM:SS.ff where `ff` is the frame within the second. */

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Frame index containing time `sec` (epsilon guards against 0.12 * 25 = 2.9999999999999996). */
export const frameAt = (sec: number, fps: number) => Math.floor(Math.max(0, sec) * fps + 1e-4)

export function formatTimecode(sec: number, fps = 25): string {
  const nominal = Math.max(1, Math.round(fps))
  const n = frameAt(sec, fps)
  const ff = n % nominal
  const total = Math.floor(n / nominal)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ff)}`
}

/** Compact m:ss (or h:mm:ss) for lists and axes. */
export function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec + 1e-6))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatDuration(sec: number): string {
  return sec > 0 ? formatClock(sec) : '—'
}

/**
 * Parse "SS", "MM:SS", "HH:MM:SS" with an optional ".ff" *frame* suffix
 * (matching what formatTimecode prints). Returns null when unparsable.
 */
export function parseTimecode(input: string, fps = 25): number | null {
  const m = /^\s*(?:(?:(\d+):)?(\d+):)?(\d+)(?:\.(\d+))?\s*$/.exec(input)
  if (!m) return null
  const [, h, min, s, ff] = m
  const secs = Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s)
  const frames = ff ? Number(ff) : 0
  return secs + frames / fps
}
