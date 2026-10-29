import type { TranscriptWord } from '../types'

export interface ChunkPlan {
  index: number
  start: number
  end: number
}

export interface ChunkResult {
  start: number
  end: number
  /** MUTLAK (kayıt başından itibaren) zamanlı kelimeler */
  words: TranscriptWord[]
}

/**
 * Uzun kaydı örtüşen pencerelere böler. Pencere i+1, pencere i'nin son `overlapSec` saniyesini
 * yeniden kapsar; böylece pencere kenarındaki (en güvenilmez) kelimeler her zaman en az bir
 * pencerenin ortasında kalır.
 */
export function planChunks(durationSec: number, chunkSec = 600, overlapSec = 15): ChunkPlan[] {
  if (!(durationSec > 0)) return []
  if (overlapSec * 2 >= chunkSec) throw new Error('Örtüşme, pencere uzunluğunun yarısından küçük olmalı.')
  const stride = chunkSec - overlapSec
  const out: ChunkPlan[] = []
  for (let start = 0, i = 0; ; start += stride, i++) {
    const end = Math.min(durationSec, start + chunkSec)
    out.push({ index: i, start, end })
    if (end >= durationSec) break
  }
  return out
}

const center = (w: TranscriptWord) => (w.start + w.end) / 2

/**
 * Örtüşen pencerelerin sonuçlarını kelime kaybı/tekrarı olmadan birleştirir.
 * Her sınırda, iki pencerenin de sessiz olduğu bir noktada (yoksa örtüşmenin ortasında) kesilir.
 */
export function mergeChunkResults(chunks: ChunkResult[]): TranscriptWord[] {
  const sorted = [...chunks].sort((a, b) => a.start - b.start)
  if (sorted.length === 0) return []
  const cuts: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) cuts.push(chooseCut(sorted[i], sorted[i + 1]))

  const out: TranscriptWord[] = []
  sorted.forEach((c, i) => {
    const lo = i === 0 ? -Infinity : cuts[i - 1]
    const hi = i === sorted.length - 1 ? Infinity : cuts[i]
    for (const w of c.words) {
      const m = center(w)
      if (m >= lo && m < hi) out.push(w)
    }
  })
  return out.sort((a, b) => a.start - b.start)
}

function chooseCut(cur: ChunkResult, next: ChunkResult): number {
  const lo = next.start
  const hi = cur.end
  if (hi <= lo) return (lo + hi) / 2
  const mid = (lo + hi) / 2
  const margin = Math.min(2, (hi - lo) / 4)
  const inner = (w: TranscriptWord) => w.end > lo + margin && w.start < hi - margin
  const all = [...cur.words, ...next.words].filter(inner).sort((a, b) => a.start - b.start)

  // Kesim, hiçbir kelimenin üzerinden geçmemeli: boşlukların orta noktalarını aday al
  const straddles = (t: number) => all.some((w) => w.start < t && w.end > t)
  let best = mid
  let bestScore = -Infinity
  const edges: number[] = [lo + margin, ...all.flatMap((w) => [w.start, w.end]), hi - margin].sort((a, b) => a - b)
  for (let i = 0; i < edges.length - 1; i++) {
    const gap = edges[i + 1] - edges[i]
    const t = (edges[i] + edges[i + 1]) / 2
    if (gap < 0.05 || t < lo + margin || t > hi - margin || straddles(t)) continue
    // geniş sessizlik iyidir; örtüşmenin ortasına yakınlık da tercih edilir
    const score = Math.min(gap, 1.5) - Math.abs(t - mid) / (hi - lo)
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}
