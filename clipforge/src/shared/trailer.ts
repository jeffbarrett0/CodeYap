import { buildSegments } from './transcript/sentences'
import type { TranscriptWord } from './types'

/**
 * Fragman: kullanıcı vlogdan 10–60 sn'lik parçalar seçer; en güçlü anlar (vurgulu/heyecanlı/sayılı cümleler) kısa planlara kesilip
 * en iyisi "kanca" olarak başa alınır, hızlı kurguyla dizilir ve kapanış kartıyla biter.
 */
export const TRAILER_MIN_SEG = 10
export const TRAILER_MAX_SEG = 60

export interface TrailerSegment {
  id: string
  /** timeline: projenin zaman çizelgesindeki aralık; asset: kütüphanedeki bir videonun kaynak aralığı */
  kind: 'timeline' | 'asset'
  start: number
  end: number
  assetId?: string
  label?: string
}

export interface TrailerShot {
  segmentId: string
  kind: 'timeline' | 'asset'
  assetId?: string
  a: number
  b: number
  score: number
  text: string
}

/** moments: 10–60 sn'lik parçalardan en güçlü anları bul · exact: seçilen klipleri OLDUĞU GİBİ sırayla birleştir · auto: hiçbir şey seçilmez, tüm vlog taranır */
export type TrailerMode = 'moments' | 'exact' | 'auto'
/** exact modunda bir klibin süre sınırları */
export const TRAILER_EXACT_MIN = 2

export interface TrailerOptions {
  /** hedef toplam süre (sn, kapanış kartı dahil) */
  targetSec: number
  /** kapanış kartı süresi (0: yok) */
  endCardSec: number
}
export const DEFAULT_TRAILER_OPTIONS: TrailerOptions = { targetSec: 45, endCardSec: 3 }

/** Parça süresi 10–60 sn mi? Sorun varsa Türkçe mesaj, yoksa null */
export function validateSegments(segs: TrailerSegment[], mode: TrailerMode = 'moments'): string | null {
  if (mode === 'auto') return null
  const min = mode === 'exact' ? TRAILER_EXACT_MIN : TRAILER_MIN_SEG
  if (segs.length === 0) return mode === 'exact' ? 'Fragman için en az bir klip seçin.' : 'Fragman için en az bir parça seçin (her biri 10–60 saniye).'
  for (const [i, s] of segs.entries()) {
    const d = s.end - s.start
    if (!(d >= min - 0.01)) return `${i + 1}. ${mode === 'exact' ? 'klip' : 'parça'} ${d.toFixed(1)} sn: en az ${min} saniye olmalı.`
    if (!(d <= TRAILER_MAX_SEG + 0.01)) return `${i + 1}. ${mode === 'exact' ? 'klip' : 'parça'} ${d.toFixed(1)} sn: en çok ${TRAILER_MAX_SEG} saniye olmalı.`
  }
  return null
}

const INTENSE = ['inanılmaz', 'harika', 'vay', 'çılgın', 'korkunç', 'muhteşem', 'yok artık', 'şok', 'bomba', 'sonunda', 'asla', 'gerçekten', 'delirdim', 'olamaz', 'bak', 'dehşet']

/** Cümlenin "fragmanlık" olma puanı: vurgu, soru, sayı, özel ad, güçlü sözcükler; çok kısa/bağlaçla başlayan cümle düşer */
export function scoreSentence(text: string): number {
  const t = text.trim()
  const words = t.split(/\s+/).filter(Boolean)
  let s = 0
  if (/!/.test(t)) s += 2
  if (/\?/.test(t)) s += 1.5
  if (/\d/.test(t)) s += 1
  s += Math.min(3, (t.match(/\s\p{Lu}\p{L}+/gu) ?? []).length) * 0.7
  const low = t.toLocaleLowerCase('tr-TR')
  s += Math.min(3, INTENSE.filter((w) => low.includes(w)).length)
  if (words.length >= 6 && words.length <= 18) s += 1
  if (words.length < 4) s -= 2
  if (/^(ve|ama|yani|işte|şey|ki)\b/i.test(t)) s -= 1
  return s
}

interface Cand {
  a: number
  b: number
  score: number
  text: string
}

function candidates(words: TranscriptWord[], segStart: number, segEnd: number, shotLen: number): Cand[] {
  const inside = words.filter((w) => w.end > segStart && w.start < segEnd)
  const out: Cand[] = []
  if (inside.length >= 5) {
    const sents = buildSegments(inside)
    for (const g of sents) {
      const a = Math.max(segStart, g.start - 0.15)
      let b = Math.min(segEnd, Math.max(g.end + 0.25, a + 2.5))
      if (b - a > shotLen * 1.4) b = a + shotLen * 1.4
      if (b - a < 1.5) continue
      out.push({ a, b, score: scoreSentence(g.text), text: g.text })
    }
  }
  if (out.length === 0) {
    // konuşma yok / transkript yok: parçanın ortasından eşit aralıklı planlar
    const d = segEnd - segStart
    for (const f of [0.5, 0.2, 0.75]) {
      const a = Math.max(segStart, Math.min(segEnd - shotLen, segStart + d * f - shotLen / 2))
      out.push({ a, b: Math.min(segEnd, a + shotLen), score: 0, text: '' })
    }
  }
  return out
}

/**
 * Parçalardan fragman planları: her parçadan en güçlü an alınır, bütçe kalırsa en yüksek puanlı ek anlar eklenir; en iyi plan başa (kanca),
 * kalanlar kullanıcının verdiği sırayla dizilir. `wordsFor`: parçanın kelimeleri (parçanın zaman düzleminde).
 */
export function planShots(segs: TrailerSegment[], wordsFor: (s: TrailerSegment) => TranscriptWord[], options: Partial<TrailerOptions> & { mode?: TrailerMode } = {}): TrailerShot[] {
  // exact: kullanıcının seçtiği klipler olduğu gibi, verdiği sırayla
  if (options.mode === 'exact') return segs.map((s) => ({ segmentId: s.id, kind: s.kind, assetId: s.assetId, a: s.start, b: s.end, score: 0, text: '' }))
  const o = { ...DEFAULT_TRAILER_OPTIONS, ...options }
  const budget = Math.max(8, o.targetSec - o.endCardSec)
  const nShots = Math.max(segs.length, Math.min(14, Math.round(budget / 4)))
  const shotLen = Math.min(7, Math.max(2.5, budget / nShots))
  const per = segs.map((s) => ({ s, c: candidates(wordsFor(s), s.start, s.end, shotLen).sort((x, y) => y.score - x.score) }))
  const picked: { s: TrailerSegment; c: Cand }[] = []
  for (const p of per) if (p.c[0]) picked.push({ s: p.s, c: p.c[0] })
  // bütçe kalırsa: tüm parçalardan en yüksek puanlı, önceki seçimlerle çakışmayan ek anlar
  const extra = per.flatMap((p) => p.c.slice(1).map((c) => ({ s: p.s, c }))).sort((x, y) => y.c.score - x.c.score)
  for (const e of extra) {
    if (picked.length >= nShots) break
    if (picked.some((p) => p.s.id === e.s.id && e.c.a < p.c.b + 1 && p.c.a < e.c.b + 1)) continue
    picked.push(e)
  }
  const toShot = (p: { s: TrailerSegment; c: Cand }): TrailerShot => ({ segmentId: p.s.id, kind: p.s.kind, assetId: p.s.assetId, a: p.c.a, b: Math.min(p.c.b, p.c.a + shotLen * 1.4), score: p.c.score, text: p.c.text })
  // sıralama: kanca (en yüksek puan) başa; diğerleri parça sırası + zaman
  const order = new Map(segs.map((s, i) => [s.id, i]))
  const hook = [...picked].sort((x, y) => y.c.score - x.c.score)[0]
  const rest = picked.filter((p) => p !== hook).sort((x, y) => (order.get(x.s.id)! - order.get(y.s.id)!) || x.c.a - y.c.a)
  return (hook ? [hook, ...rest] : rest).map(toShot)
}

export interface TrailerRequest {
  /** vlog projesi (parçalar bunun zaman çizelgesinden ya da kütüphanesinden seçilir) */
  projectPath: string
  segments: TrailerSegment[]
  /** varsayılan moments */
  mode?: TrailerMode
  /** çıktı yönü: yatay 16:9 (varsayılan) ya da dikey 9:16 */
  aspect?: '16:9' | '9:16'
  /** hedef toplam süre (sn), varsayılan 45 */
  targetSec?: number
  /** kapanış kartındaki başlık (vlog adı); boşsa kart eklenmez */
  title?: string
  subtitle?: string
}

export interface TrailerResult {
  projectPath: string
  durationSec: number
  shots: { segmentId: string; a: number; b: number; text: string }[]
}

/** Otomatik fragman: vlogun başı/sonundan %3 pay bırakıp tamamını eşit bölgelere ayırır; her bölgeden en güçlü an seçilir */
export function autoSegments(totalSec: number, targetSec = DEFAULT_TRAILER_OPTIONS.targetSec): TrailerSegment[] {
  const n = Math.max(5, Math.min(12, Math.round(targetSec / 4.5)))
  const from = totalSec * 0.03
  const len = (totalSec * 0.94) / n
  return Array.from({ length: n }, (_, i) => ({ id: `auto${i + 1}`, kind: 'timeline' as const, start: from + i * len, end: from + (i + 1) * len }))
}

/** "1:10", "01:10:05", "70", "70,5" → saniye; anlaşılmazsa null */
export function parseClock(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}
