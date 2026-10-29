import type { Segment, TranscriptWord } from '../types'

export interface SentenceOptions {
  /** Bu kadar sessizlik (sn) cümleyi böler */
  pauseSec: number
  /** Bir cümlenin azami süresi; aşılırsa en uzun duraksamada bölünür */
  maxSentenceSec: number
  maxWords: number
}

export const DEFAULT_SENTENCE_OPTIONS: SentenceOptions = { pauseSec: 0.9, maxSentenceSec: 14, maxWords: 40 }

const END_PUNCT = /[.!?…]+["'”’)\]]*$/u

/**
 * Kelime listesini cümle bölütlerine ayırır. Whisper noktalama üretiyorsa ona uyar;
 * üretmiyorsa (veya çok uzun akışlarda) duraksamalara göre böler.
 * Böylece klip sınırı "konuşmanın ortasına" denk gelmez.
 */
export function buildSegments(words: TranscriptWord[], opts: Partial<SentenceOptions> = {}): Segment[] {
  const o = { ...DEFAULT_SENTENCE_OPTIONS, ...opts }
  const segments: Segment[] = []
  let first = 0

  const push = (from: number, to: number) => {
    if (to < from) return
    segments.push({
      id: segments.length,
      start: words[from].start,
      end: words[to].end,
      text: words
        .slice(from, to + 1)
        .map((w) => w.text.trim())
        .join(' ')
        .replace(/\s+([,.;:!?…])/g, '$1'),
      firstWord: from,
      lastWord: to
    })
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const next = words[i + 1]
    const gap = next ? next.start - w.end : Infinity
    const endsSentence = END_PUNCT.test(w.text.trim())
    const tooLong = w.end - words[first].start >= o.maxSentenceSec || i - first + 1 >= o.maxWords
    // Noktalama sonrası kısa bir duraksama ya da uzun sessizlik → böl
    if (!next || gap >= o.pauseSec || (endsSentence && gap >= 0.05) || (endsSentence && tooLong)) {
      push(first, i)
      first = i + 1
    } else if (tooLong) {
      // Çok uzun akış: [first..i] içinde en uzun duraksamada böl
      let best = -1
      let bestGap = -1
      for (let k = first; k < i; k++) {
        const g = words[k + 1].start - words[k].end
        if (g > bestGap) {
          bestGap = g
          best = k
        }
      }
      if (best >= first) {
        push(first, best)
        first = best + 1
      }
    }
  }
  return segments
}

/** Verilen zamanı içeren (ya da en yakın sonraki) bölütün indeksi; yoksa -1. */
export function segmentIndexAt(segments: Segment[], t: number): number {
  let lo = 0
  let hi = segments.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
