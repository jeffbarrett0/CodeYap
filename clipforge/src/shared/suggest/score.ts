import type { ChatMessage, ClipCandidate, Marker, Segment, SignalReason, TranscriptWord } from '../types'
import { foldTr } from '../text'
import { messageRateSeries, movingSum } from '../chat/parse'
import { rangeToTimes } from '../clip/boundaries'

/** Genel tepki ünlemleri / kahkaha. Konu veya kişi adı içermez; ayarlardan genişletilebilir. */
export const DEFAULT_KEYWORDS = ['haha', 'ahaha', 'lan', 'oha', 'yok artik', 'inanamiyorum', 'bu ne', 'vay', 'aman allahim', 'kral', 'efsane']

const LAUGH_RE = /^(?:a?(?:h[aeı]){2,}h?|ha+h[ah]*|lol|kkk+|xd+)$/

export interface SuggestInput {
  durationSec: number
  /** 1 sn'lik kutular için ortalama ses seviyesi (dBFS) */
  audioDb?: number[]
  chat?: ChatMessage[]
  words?: TranscriptWord[]
  keywords?: string[]
  markers?: Marker[]
  /** Sahne değişimi zaman damgaları (sn) */
  sceneCuts?: number[]
}

export interface SuggestOptions {
  maxCandidates: number
  minScore: number
  /** Tepeden önce / sonra alınacak süre */
  beforeSec: number
  afterSec: number
  minDistanceSec: number
}

export const DEFAULT_SUGGEST_OPTIONS: SuggestOptions = { maxCandidates: 30, minScore: 0.3, beforeSec: 8, afterSec: 12, minDistanceSec: 30 }

const WEIGHTS = { audio: 0.35, chat: 0.35, keyword: 0.2, scene: 0.1 }
const MARKER_WEIGHT = 0.7

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function rollingMedian(series: number[], half: number, step = 5): number[] {
  const out = new Array<number>(series.length)
  let last = 0
  for (let i = 0; i < series.length; i++) {
    if (i % step === 0) {
      const slice = series.slice(Math.max(0, i - half), Math.min(series.length, i + half + 1)).sort((a, b) => a - b)
      last = slice[Math.floor(slice.length / 2)] ?? 0
    }
    out[i] = last
  }
  return out
}

/** Ses: 1 sn'lik dB serisinde yerel medyana göre ani artış (kahkaha, bağırma). Güç = artış/12 dB. */
export function audioStrength(db: number[]): { strength: number[]; deltaDb: number[] } {
  const sm = db.map((_, i) => {
    const a = db.slice(Math.max(0, i - 1), i + 2)
    return a.reduce((s, x) => s + x, 0) / a.length
  })
  const med = rollingMedian(sm, 60)
  const deltaDb = sm.map((x, i) => x - med[i])
  return { strength: deltaDb.map((d) => clamp01((d - 3) / 9)), deltaDb }
}

/** Sohbet: 10 sn'lik mesaj sayısı z-skoru → güç = z/5. */
export function chatStrength(chat: ChatMessage[], durationSec: number): { strength: number[]; counts: number[]; z: number[] } {
  const per = messageRateSeries(chat, durationSec, 1)
  const counts = movingSum(per, 10)
  const n = counts.length
  const z = new Array<number>(n).fill(0)
  const med = rollingMedian(counts, 120)
  const sd = Math.max(1.5, Math.sqrt(counts.reduce((s, x) => s + (x - counts.reduce((a, b) => a + b, 0) / n) ** 2, 0) / n))
  for (let i = 0; i < n; i++) z[i] = (counts[i] - med[i]) / sd
  return { strength: z.map((v) => clamp01((v - 1) / 4)), counts, z }
}

/** Anahtar kelime / kahkaha yoğunluğu: 10 sn pencerede eşleşen kelime sayısı. */
export function keywordStrength(words: TranscriptWord[], durationSec: number, keywords: string[]): { strength: number[]; hits: number[]; sample: string[] } {
  const n = Math.max(1, Math.ceil(durationSec))
  const per = new Array<number>(n).fill(0)
  const sample = new Array<string>(n).fill('')
  const kws = keywords.map((k) => foldTr(k).trim()).filter(Boolean)
  const single = new Set(kws.filter((k) => !k.includes(' ')))
  const multi = kws.filter((k) => k.includes(' '))
  const folded = words.map((w) => (foldTr(w.text).match(/[\p{L}\p{N}]+/gu) ?? []).join(''))
  for (let i = 0; i < words.length; i++) {
    let hit = single.has(folded[i]) || LAUGH_RE.test(folded[i])
    let label = folded[i]
    if (!hit && multi.length) {
      for (const m of multi) {
        const parts = m.split(' ').length
        if (folded.slice(i, i + parts).join(' ') === m) {
          hit = true
          label = m
        }
      }
    }
    if (hit) {
      const b = Math.min(n - 1, Math.floor(words[i].start))
      per[b] += 1
      if (!sample[b]) sample[b] = label
    }
  }
  const hits = movingSum(per, 10)
  return { strength: hits.map((h) => clamp01(h / 3)), hits, sample }
}

export function sceneStrength(cuts: number[], durationSec: number): { strength: number[]; counts: number[] } {
  const per = new Array<number>(Math.max(1, Math.ceil(durationSec))).fill(0)
  for (const c of cuts) {
    const b = Math.floor(c)
    if (b >= 0 && b < per.length) per[b] += 1
  }
  const counts = movingSum(per, 10)
  return { strength: counts.map((c) => clamp01((c - 2) / 6)), counts }
}

export function markerStrength(markers: Marker[], durationSec: number): number[] {
  const out = new Array<number>(Math.max(1, Math.ceil(durationSec))).fill(0)
  for (const m of markers) {
    for (let d = -4; d <= 4; d++) {
      const i = Math.round(m.time) + d
      if (i >= 0 && i < out.length) out[i] = Math.max(out[i], 1 - Math.abs(d) / 6)
    }
  }
  return out
}

/** Tüm sinyalleri birleştirip skorlanmış ve gerekçeli aday listesi döner. */
export function scoreCandidates(assetId: string, input: SuggestInput, options: Partial<SuggestOptions> = {}): ClipCandidate[] {
  const o = { ...DEFAULT_SUGGEST_OPTIONS, ...options }
  const n = Math.max(1, Math.ceil(input.durationSec))
  const total = new Array<number>(n).fill(0)
  const wsum: number[] = new Array<number>(n).fill(0)

  const audio = input.audioDb && input.audioDb.length > 0 ? audioStrength(input.audioDb) : null
  const chat = input.chat && input.chat.length > 0 ? chatStrength(input.chat, input.durationSec) : null
  const kw = input.words && input.words.length > 0 ? keywordStrength(input.words, input.durationSec, input.keywords ?? DEFAULT_KEYWORDS) : null
  const scene = input.sceneCuts && input.sceneCuts.length > 0 ? sceneStrength(input.sceneCuts, input.durationSec) : null
  const marker = input.markers && input.markers.length > 0 ? markerStrength(input.markers, input.durationSec) : null

  const used: { w: number; s: number[] }[] = []
  if (audio) used.push({ w: WEIGHTS.audio, s: audio.strength })
  if (chat) used.push({ w: WEIGHTS.chat, s: chat.strength })
  if (kw) used.push({ w: WEIGHTS.keyword, s: kw.strength })
  if (scene) used.push({ w: WEIGHTS.scene, s: scene.strength })
  const wTotal = used.reduce((s, u) => s + u.w, 0)
  if (wTotal === 0 && !marker) return []

  for (let i = 0; i < n; i++) {
    // Mevcut sinyallerin ağırlıkları 1'e normalize edilir: sohbet yoksa skor sınırlanmaz.
    let v = 0
    for (const u of used) v += (u.w / wTotal) * (u.s[i] ?? 0)
    if (used.length > 1) {
      // Birden çok bağımsız sinyalin aynı anda yükselmesi daha güvenilirdir
      const agree = used.filter((u) => (u.s[i] ?? 0) > 0.4).length
      v *= 0.75 + 0.25 * Math.min(1, agree / 2)
    }
    if (marker) v = Math.max(v, 0) + MARKER_WEIGHT * marker[i]
    total[i] = Math.min(1, v)
    wsum[i] = v
  }

  const series = total.map((x) => x * 100)
  const peaks = pickPeaks(series, o)
  const out: ClipCandidate[] = []
  for (const p of peaks) {
    const i = p
    const reasons: SignalReason[] = []
    if (marker && marker[i] > 0.3) {
      const near = input.markers!.reduce((b, m) => (Math.abs(m.time - i) < Math.abs(b.time - i) ? m : b))
      reasons.push({ signal: 'marker', strength: marker[i], label: `Yayıncı işareti: "${near.label}" (${fmt(near.time)})` })
    }
    if (audio && audio.strength[i] > 0.15) reasons.push({ signal: 'audio', strength: audio.strength[i], label: `Ses seviyesi ani yükseldi (+${audio.deltaDb[i].toFixed(1)} dB)` })
    if (chat && chat.strength[i] > 0.15) {
      reasons.push({ signal: 'chat', strength: chat.strength[i], label: `Sohbet hızı ${chat.z[i].toFixed(1)}σ yükseldi (10 sn'de ${chat.counts[i]} mesaj)` })
    }
    if (kw && kw.strength[i] > 0.15) {
      const sample = kw.sample.slice(Math.max(0, i - 10), i + 1).find(Boolean)
      reasons.push({ signal: 'keyword', strength: kw.strength[i], label: `Tepki sözcükleri yoğun (${kw.hits[i]}${sample ? `, ör. "${sample}"` : ''})` })
    }
    if (scene && scene.strength[i] > 0.15) reasons.push({ signal: 'scene', strength: scene.strength[i], label: `Sahne değişimi yoğun (10 sn'de ${scene.counts[i]} kesim)` })
    reasons.sort((a, b) => b.strength - a.strength)
    if (reasons.length === 0) continue
    out.push({
      id: `cand-${assetId}-${i}`,
      assetId,
      start: Math.max(0, i - o.beforeSec),
      end: Math.min(input.durationSec, i + o.afterSec),
      peak: i,
      score: Math.min(1, total[i]),
      reasons,
      status: 'pending'
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, o.maxCandidates).sort((a, b) => a.start - b.start)
}

function pickPeaks(series: number[], o: SuggestOptions): number[] {
  // Birleşik skor zaten normalize: eşik + yerel maksimum + asgari mesafe yeterli
  const cands: number[] = []
  const smooth = series.map((_, i) => {
    const a = series.slice(Math.max(0, i - 1), i + 2)
    return a.reduce((s, x) => s + x, 0) / a.length
  })
  for (let i = 0; i < smooth.length; i++) {
    const l = smooth[i - 1] ?? -1
    const r = smooth[i + 1] ?? -1
    if (smooth[i] >= o.minScore * 100 && smooth[i] >= l && smooth[i] > r) cands.push(i)
  }
  cands.sort((a, b) => smooth[b] - smooth[a])
  const chosen: number[] = []
  for (const c of cands) if (chosen.every((x) => Math.abs(x - c) >= o.minDistanceSec)) chosen.push(c)
  return chosen
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

/** Aday sınırlarını cümle sınırlarına yapıştırır (konuşma ortasında kesmemek için). */
export function snapCandidate(segments: Segment[], c: ClipCandidate, durationSec: number): ClipCandidate {
  if (segments.length === 0) return c
  const find = (t: number) => {
    let ans = 0
    for (let i = 0; i < segments.length; i++) if (segments[i].start <= t) ans = i
    return ans
  }
  const a = find(c.start)
  let b = find(c.end)
  b = Math.max(a, b)
  const t = rangeToTimes(segments, a, b, { padStartSec: 0.12, padEndSec: 0.3, assetDurationSec: durationSec })
  return { ...c, start: t.start, end: t.end }
}
