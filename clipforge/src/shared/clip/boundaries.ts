import type { Segment } from '../types'

export interface ClipSuggestOptions {
  preRollSec: number
  postRollSec: number
  /** Verilirse klip bu süreyi aşmayacak biçimde cümle sınırlarında genişletilir (ör. 15/30/60) */
  targetDurationSec?: number
  /** Platform üst sınırı; aşılırsa uyarı verilir */
  maxDurationSec?: number
  minDurationSec: number
  assetDurationSec: number
  /** İlk kelimenin kesilmemesi için cümle başından önce/sonra bırakılan pay */
  padStartSec: number
  padEndSec: number
  /** Pre/post-roll cümleye yuvarlanırken izin verilen ek süre */
  maxSnapSec: number
}

export const DEFAULT_CLIP_OPTIONS: ClipSuggestOptions = {
  preRollSec: 5,
  postRollSec: 10,
  minDurationSec: 3,
  assetDurationSec: Infinity,
  padStartSec: 0.12,
  padEndSec: 0.3,
  maxSnapSec: 6
}

export type ClipWarningCode = 'exceeds_max' | 'hit_longer_than_target' | 'too_short' | 'no_sentence_info' | 'under_target'

export interface ClipWarning {
  code: ClipWarningCode
  message: string
}

export interface ClipSuggestion {
  start: number
  end: number
  duration: number
  /** Kapsanan cümle aralığı (indeks); cümle bilgisi yoksa null */
  sentenceRange: [number, number] | null
  warnings: ClipWarning[]
}

/** Bir kelime indeksini içeren bölütün indeksi */
export function segmentOfWord(segments: Segment[], wordIndex: number): number {
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segments[mid]
    if (wordIndex < s.firstWord) hi = mid - 1
    else if (wordIndex > s.lastWord) lo = mid + 1
    else return mid
  }
  return Math.min(Math.max(lo, 0), segments.length - 1)
}

/** Zamanı içeren ya da hemen öncesindeki bölüt; hiçbiri yoksa -1 */
function lastSegmentStartingAtOrBefore(segments: Segment[], t: number): number {
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

/** Cümle aralığını, komşu cümlelerle çakışmayacak biçimde küçük paylarla zamana çevirir. */
export function rangeToTimes(
  segments: Segment[],
  a: number,
  b: number,
  o: Pick<ClipSuggestOptions, 'padStartSec' | 'padEndSec' | 'assetDurationSec'>
): { start: number; end: number } {
  const first = segments[a]
  const last = segments[b]
  const prev = segments[a - 1]
  const next = segments[b + 1]
  const start = Math.max(first.start - o.padStartSec, prev ? (prev.end + first.start) / 2 : 0, 0)
  const end = Math.min(last.end + o.padEndSec, next ? (last.end + next.start) / 2 : o.assetDurationSec)
  return { start, end: Math.max(end, start) }
}

/**
 * Bir arama sonucu için klip başlangıç/bitişini önerir.
 *  - `targetDurationSec` yoksa: pre-roll / post-roll uygulanır, sınırlar cümleye yuvarlanır.
 *  - varsa: sonuç cümleleri etrafında, hedefi aşmayacak biçimde cümle ekleyerek genişletilir.
 * Başlangıç ve bitiş her zaman cümle sınırındadır; konuşma ortasında kesilmez.
 */
export function suggestClip(
  segments: Segment[],
  hit: { start: number; end: number; firstWord: number; lastWord: number },
  options: Partial<ClipSuggestOptions> = {}
): ClipSuggestion {
  const o: ClipSuggestOptions = { ...DEFAULT_CLIP_OPTIONS, ...options }
  const warnings: ClipWarning[] = []

  if (segments.length === 0) {
    const start = Math.max(0, hit.start - o.preRollSec)
    const end = Math.min(o.assetDurationSec, hit.end + o.postRollSec)
    warnings.push({ code: 'no_sentence_info', message: 'Cümle bilgisi yok; sınırlar konuşma ortasına denk gelebilir.' })
    return finish({ start, end }, null, o, warnings)
  }

  const hitA = segmentOfWord(segments, hit.firstWord)
  const hitB = Math.max(hitA, segmentOfWord(segments, hit.lastWord))
  let a = hitA
  let b = hitB

  if (o.targetDurationSec) {
    ;({ a, b } = expandToTarget(segments, hitA, hitB, o))
    const hitLen = segments[hitB].end - segments[hitA].start
    if (hitLen > o.targetDurationSec) {
      warnings.push({
        code: 'hit_longer_than_target',
        message: `Eşleşen konuşma bölümü (${hitLen.toFixed(0)} sn) hedef süreyi (${o.targetDurationSec} sn) aşıyor.`
      })
    }
  } else {
    ;({ a, b } = rollToSentences(segments, hit, hitA, hitB, o))
  }

  const times = rangeToTimes(segments, a, b, o)
  const sug = finish(times, [a, b], o, warnings)
  if (o.targetDurationSec && sug.duration < o.targetDurationSec * 0.6 && !warnings.some((w) => w.code === 'hit_longer_than_target')) {
    sug.warnings.push({ code: 'under_target', message: `Klip hedef süreden (${o.targetDurationSec} sn) belirgin kısa; çevresinde genişletilecek konuşma sınırlı.` })
  }
  return sug
}

function finish(
  t: { start: number; end: number },
  range: [number, number] | null,
  o: ClipSuggestOptions,
  warnings: ClipWarning[]
): ClipSuggestion {
  const start = Math.max(0, t.start)
  const end = Math.min(o.assetDurationSec, t.end)
  const duration = Math.max(0, end - start)
  if (o.maxDurationSec && duration > o.maxDurationSec + 1e-6) {
    warnings.push({ code: 'exceeds_max', message: `Klip ${duration.toFixed(1)} sn; hedef platform sınırı ${o.maxDurationSec} sn.` })
  }
  if (duration < o.minDurationSec) warnings.push({ code: 'too_short', message: `Klip çok kısa (${duration.toFixed(1)} sn).` })
  return { start, end, duration, sentenceRange: range, warnings }
}

function rollToSentences(
  segments: Segment[],
  hit: { start: number; end: number },
  hitA: number,
  hitB: number,
  o: ClipSuggestOptions
): { a: number; b: number } {
  const rawStart = Math.max(0, hit.start - o.preRollSec)
  const rawEnd = hit.end + o.postRollSec

  // Başlangıç: ham başlangıcı içeren cümlenin başına (geriye) yuvarla; çok geri gidiyorsa ileri yuvarla
  let a = lastSegmentStartingAtOrBefore(segments, rawStart)
  if (a < 0) a = 0
  else if (segments[a].end > rawStart + 1e-6 && segments[a].start < rawStart) {
    // cümlenin ortasındayız
    if (rawStart - segments[a].start > o.maxSnapSec && a + 1 <= hitA) a += 1
  } else if (segments[a].end <= rawStart + 1e-6 && a + 1 <= hitA) {
    // sessizlikteyiz → sonraki cümle başı
    a += 1
  }
  a = Math.min(a, hitA)

  // Bitiş: ham bitişi içeren cümlenin sonuna (ileri) yuvarla; çok ileri gidiyorsa geri yuvarla
  let b = lastSegmentStartingAtOrBefore(segments, rawEnd)
  if (b < 0) b = hitB
  if (segments[b].end > rawEnd && segments[b].end - rawEnd > o.maxSnapSec && b - 1 >= hitB) b -= 1
  b = Math.max(b, hitB)
  b = Math.min(b, segments.length - 1)
  return { a, b }
}

function expandToTarget(segments: Segment[], hitA: number, hitB: number, o: ClipSuggestOptions): { a: number; b: number } {
  const target = o.targetDurationSec as number
  let a = hitA
  let b = hitB
  const ratio = o.preRollSec / Math.max(0.001, o.preRollSec + o.postRollSec)
  const span = (x: number, y: number) => rangeSpan(segments, x, y, o)
  while (true) {
    const canBefore = a > 0 && span(a - 1, b) <= target
    const canAfter = b < segments.length - 1 && span(a, b + 1) <= target
    if (!canBefore && !canAfter) break
    const before = segments[hitA].start - segments[a].start
    const after = segments[b].end - segments[hitB].end
    const total = before + after
    const beforeShare = total === 0 ? 0 : before / total
    // hedef oranın gerisinde kalan tarafı genişlet
    const wantBefore = canBefore && (!canAfter || beforeShare < ratio)
    if (wantBefore) a -= 1
    else b += 1
  }
  return { a, b }
}

function rangeSpan(segments: Segment[], a: number, b: number, o: ClipSuggestOptions): number {
  const t = rangeToTimes(segments, a, b, { ...o, assetDurationSec: o.assetDurationSec })
  return t.end - t.start
}

/** Kullanıcı sınırı elle oynattıktan sonra "cümleye yapıştır" için en yakın cümle sınırı */
export function nearestBoundary(segments: Segment[], t: number, edge: 'start' | 'end', o: Pick<ClipSuggestOptions, 'padStartSec' | 'padEndSec' | 'assetDurationSec'> = DEFAULT_CLIP_OPTIONS): number {
  if (segments.length === 0) return t
  let best = t
  let bestDist = Infinity
  for (let i = 0; i < segments.length; i++) {
    const times = rangeToTimes(segments, i, i, o)
    const cand = edge === 'start' ? times.start : times.end
    const d = Math.abs(cand - t)
    if (d < bestDist) {
      bestDist = d
      best = cand
    }
  }
  return best
}
