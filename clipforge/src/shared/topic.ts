import { key } from './graphics/geo'
import { buildSegments } from './transcript/sentences'
import type { Segment, TranscriptWord } from './types'

/**
 * Konu klibi: "Osimhen'le ilgili klip çıkar" → çizelge transkriptinde konunun geçtiği yerleri bulur, yakın geçişleri
 * tek konuşma bloğunda toplar, cümle sınırlarına oturtur ve skora göre aday klipler önerir. Adayları SEÇEN kullanıcıdır.
 */
export interface TopicOptions {
  /** bir klibin en uzun süresi (sn) */
  maxSec: number
  /** en kısa süre (sn); kısa kalırsa komşu cümlelerle genişletilir */
  minSec: number
  /** iki geçiş arası bu süreden kısaysa aynı blokta sayılır */
  mergeGapSec: number
  /** sınırlara eklenen pay (sn) */
  padSec: number
  /** bağlam/genişletme için komşu cümle en fazla bu kadar uzakta olabilir (sn) */
  contextGapSec: number
  limit: number
}

export const DEFAULT_TOPIC_OPTIONS: TopicOptions = { maxSec: 60, minSec: 8, mergeGapSec: 25, padSec: 0.25, contextGapSec: 8, limit: 10 }

export interface TopicCandidate {
  id: string
  start: number
  end: number
  durationSec: number
  /** konunun bu klipte kaç kez geçtiği */
  hits: number
  score: number
  mentions: { t: number; text: string }[]
  /** klibin konuşma metni (kısaltılmış) */
  text: string
}

function lev(a: string, b: string): number {
  if (a === b) return 0
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

/** Sorgudan anahtar kelimeler (Türkçe/aksan duyarsız, 3+ harf) */
export function topicTokens(query: string): string[] {
  return key(query).split(' ').filter((t) => t.length >= 3)
}

/** Kelime bir konu sözcüğüne uyar mı: tam, Türkçe ek ("Osimhen'in", "Osimhen'e"), ya da Whisper yazım hatası ("Osimen") */
export function wordMatches(word: string, token: string): string | null {
  const w = key(word).split(' ')[0] ?? ''
  if (!w) return null
  if (w === token) return token
  if (token.length >= 4 && w.startsWith(token) && w.length - token.length <= 4) return token
  const d = lev(w, token)
  if (token.length >= 7 ? d <= 2 : token.length >= 5 ? d <= 1 : false) return token
  return null
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function findTopicCandidates(words: TranscriptWord[], query: string, options: Partial<TopicOptions> = {}): TopicCandidate[] {
  const o = { ...DEFAULT_TOPIC_OPTIONS, ...options }
  const tokens = topicTokens(query)
  if (tokens.length === 0 || words.length === 0) return []
  const segs: Segment[] = buildSegments(words)
  if (segs.length === 0) return []
  const total = segs[segs.length - 1].end

  // her cümlede konunun geçiş sayısı ve geçen kelimeler
  const segHits: { t: number; text: string; token: string }[][] = segs.map(() => [])
  let si = 0
  for (const [wi, w] of words.entries()) {
    while (si < segs.length - 1 && wi > segs[si].lastWord) si++
    const tok = tokens.map((t) => wordMatches(w.text, t)).find(Boolean)
    if (tok) segHits[si].push({ t: w.start, text: w.text.trim(), token: tok })
  }
  const hitSegs = segHits.map((h, i) => (h.length ? i : -1)).filter((i) => i >= 0)
  if (hitSegs.length === 0) return []

  // yakın geçişleri bloklarda topla (cümle aralıkları)
  const blocks: [number, number][] = []
  for (const i of hitSegs) {
    const last = blocks[blocks.length - 1]
    if (last && segs[i].start - segs[last[1]].end <= o.mergeGapSec) last[1] = i
    else blocks.push([i, i])
  }

  const dur = (a: number, b: number) => segs[b].end - segs[a].start
  const hitsIn = (a: number, b: number) => segHits.slice(a, b + 1).reduce((n, h) => n + h.length, 0)
  const out: { a: number; b: number }[] = []

  const place = (a: number, b: number) => {
    // 1 cümle bağlam (önce/sonra), sonra süre sınırlarına uydur
    // bağlam yalnızca yakın cümleler olabilir (aradaki sessizlik/konu kopukluğu uzunsa alakasız içerik katılmasın)
    const near = (i: number, j: number) => Math.abs(segs[Math.max(i, j)].start - segs[Math.min(i, j)].end) <= o.contextGapSec
    let lo = a > 0 && near(a - 1, a) ? a - 1 : a
    let hi = b < segs.length - 1 && near(b, b + 1) ? b + 1 : b
    if (dur(lo, hi) > o.maxSec) {
      // en çok geçişi içeren, maxSec'e sığan pencereyi seç; kalan geçişler için tekrarla
      let best: [number, number] | null = null
      let bestHits = -1
      for (let s = a; s <= b; s++) {
        let e = s
        while (e + 1 <= b && dur(s, e + 1) <= o.maxSec) e++
        if (dur(s, e) > o.maxSec) continue // tek cümle bile sığmıyor: yine de al
        const h = hitsIn(s, e)
        if (h > bestHits) (bestHits = h, (best = [s, e]))
      }
      const [s, e] = best ?? [a, a]
      out.push({ a: s, b: e })
      if (s > a && hitsIn(a, s - 1) > 0) place(a, s - 1)
      if (e < b && hitsIn(e + 1, b) > 0) place(e + 1, b)
      return
    }
    // çok kısaysa komşu cümlelerle genişlet
    while (dur(lo, hi) < o.minSec && (lo > 0 || hi < segs.length - 1)) {
      if (lo > 0 && near(lo - 1, lo) && dur(lo - 1, hi) <= o.maxSec) lo--
      else if (hi < segs.length - 1 && near(hi, hi + 1) && dur(lo, hi + 1) <= o.maxSec) hi++
      else break
    }
    out.push({ a: lo, b: hi })
  }
  for (const [a, b] of blocks) place(a, b)

  const cands = out.map(({ a, b }) => {
    const mentions = segHits.slice(a, b + 1).flat().map((h) => ({ t: h.t, text: h.text }))
    const distinct = new Set(segHits.slice(a, b + 1).flat().map((h) => h.token)).size
    const start = Math.max(0, segs[a].start - o.padSec)
    const end = Math.min(total, segs[b].end + o.padSec)
    const duration = end - start
    return {
      start,
      end,
      durationSec: duration,
      hits: mentions.length,
      score: Math.round((mentions.length * 2 + distinct + (mentions.length / Math.max(duration, 1)) * 10) * 100) / 100,
      mentions,
      text: clip(segs.slice(a, b + 1).map((s) => s.text).join(' '), 600)
    }
  })
  return cands
    .filter((c) => c.hits > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, o.limit)
    .map((c, i) => ({ id: `c${i + 1}`, ...c }))
}
