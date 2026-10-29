import type { ID, Timeline, Transcript, TranscriptWord } from '../types'
import { clipEnd } from './model'

export interface TimelineWord extends TranscriptWord {
  /** zaman çizelgesi zamanı (start/end zaten çizelge zamanındadır); kaynak bilgisi */
  assetId: ID
  sourceStart: number
}

/**
 * Zaman çizelgesindeki kliplerin kaynaklarının transkriptlerinden, çizelge zamanında kelime listesi üretir.
 * Aynı kaynağın birden çok izde (görüntü + ses) kullanılması kelimeleri tekrarlamaz.
 * Kırpılmış/bölünmüş klipler yalnızca kullanılan aralığın kelimelerini verir.
 */
export function timelineWords(tl: Timeline, transcripts: Record<ID, Transcript | undefined>): TimelineWord[] {
  const out: TimelineWord[] = []
  const seen = new Set<string>()
  const clips = tl.tracks.filter((t) => t.kind === 'video' || t.kind === 'audio').flatMap((t) => t.clips)
  for (const c of clips.sort((a, b) => a.start - b.start)) {
    const tr = transcripts[c.assetId]
    if (!tr) continue
    for (const w of tr.words) {
      if (w.end <= c.srcIn || w.start >= c.srcOut) continue
      const start = c.start + (Math.max(w.start, c.srcIn) - c.srcIn)
      const end = Math.min(clipEnd(c), c.start + (Math.min(w.end, c.srcOut) - c.srcIn))
      const key = `${c.assetId}|${w.start.toFixed(3)}|${start.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: w.text, start, end, confidence: w.confidence, assetId: c.assetId, sourceStart: w.start })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Seçili kelimelerin [i, j] kesim aralığı: sessizliğin yarısı komşu kelimeye, yarısı kesilene verilir;
 * böylece kesim ne bir kelimeyi bölen ne de arkasında uzun bir boşluk bırakan bir noktaya düşer.
 */
export function cutBoundsForWords(words: { start: number; end: number }[], i: number, j: number): [number, number] {
  const a = Math.min(i, j)
  const b = Math.max(i, j)
  const prev = words[a - 1]
  const next = words[b + 1]
  const start = prev ? (prev.end + words[a].start) / 2 : Math.max(0, words[a].start - 0.04)
  const end = next ? (words[b].end + next.start) / 2 : words[b].end + 0.05
  return [Math.min(start, words[a].start), Math.max(end, words[b].end)]
}

/** Çizelge zamanını içeren (ya da sonraki) kelimenin indeksi; yoksa -1 */
export function wordIndexAt(words: { start: number; end: number }[], t: number): number {
  let lo = 0
  let hi = words.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
