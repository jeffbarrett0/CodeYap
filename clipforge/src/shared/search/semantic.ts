import type { SearchResult, Segment } from '../types'

/** Metin → gömme vektörü sağlayıcısı (OpenAI uyumlu uç nokta, yerel sunucu ya da test sahtesi). */
export interface EmbeddingProvider {
  readonly id: string
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>
}

export interface SemanticWindow {
  firstSegment: number
  lastSegment: number
  start: number
  end: number
  text: string
}

/** Komşu cümleleri üst üste bindirerek (kayan pencere) anlamsal arama birimleri üretir. */
export function buildSemanticWindows(segments: Segment[], size = 3, stride = 1): SemanticWindow[] {
  const out: SemanticWindow[] = []
  if (segments.length === 0) return out
  for (let i = 0; i < segments.length; i += stride) {
    const j = Math.min(segments.length - 1, i + size - 1)
    out.push({
      firstSegment: i,
      lastSegment: j,
      start: segments[i].start,
      end: segments[j].end,
      text: segments.slice(i, j + 1).map((s) => s.text).join(' ')
    })
    if (j === segments.length - 1) break
  }
  return out
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

export interface SemanticOptions {
  topK: number
  /** Mutlak alt sınır */
  minSimilarity: number
  /** En iyi skora göre göreli alt sınır */
  relativeCutoff: number
}

export const DEFAULT_SEMANTIC_OPTIONS: SemanticOptions = { topK: 8, minSimilarity: 0.25, relativeCutoff: 0.8 }

/** Pencere vektörlerini sorgu vektörüne göre sıralar; çakışan pencerelerden yalnızca en iyisini tutar. */
export function rankWindows(
  query: number[],
  windows: SemanticWindow[],
  vectors: number[][],
  segments: Segment[],
  context: number,
  options: Partial<SemanticOptions> = {}
): SearchResult[] {
  const o = { ...DEFAULT_SEMANTIC_OPTIONS, ...options }
  const scored = windows.map((w, i) => ({ w, sim: cosine(query, vectors[i]) })).sort((a, b) => b.sim - a.sim)
  const best = scored[0]?.sim ?? 0
  const chosen: typeof scored = []
  for (const s of scored) {
    if (s.sim < o.minSimilarity || s.sim < best * o.relativeCutoff) break
    if (chosen.some((c) => s.w.start < c.w.end && c.w.start < s.w.end)) continue
    chosen.push(s)
    if (chosen.length >= o.topK) break
  }
  return chosen
    .map(({ w, sim }) => {
      // pencerenin ortasındaki cümleyi "eşleşen cümle" say
      const mid = Math.round((w.firstSegment + w.lastSegment) / 2)
      const seg = segments[mid]
      return {
        id: `s-${Math.round(w.start * 1000)}`,
        start: w.start,
        end: w.end,
        sentenceStart: seg.start,
        sentenceEnd: seg.end,
        sentence: seg.text,
        before: segments.slice(Math.max(0, mid - context), mid).map((s) => s.text),
        after: segments.slice(mid + 1, mid + 1 + context).map((s) => s.text),
        score: Math.max(0, Math.min(1, sim)),
        kind: 'semantic' as const,
        matchCount: 1,
        matchedWords: [],
        firstWord: seg.firstWord,
        lastWord: seg.lastWord
      }
    })
    .sort((a, b) => a.start - b.start)
}
