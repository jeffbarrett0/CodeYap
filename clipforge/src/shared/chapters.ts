import { key } from './graphics/geo'
import { cap, NOT_ENTITY, STOP_KEYS, tokens } from './ideas'
import { buildSegments } from './transcript/sentences'
import type { Segment, TranscriptWord } from './types'

/**
 * YouTube bölüm zamanları (timestamp): düzenlenmiş videonun (çizelge zamanındaki) transkriptini konu değişimlerine göre
 * ardışık bölümlere ayırır ve her birine kısa bir başlık verir. YouTube kuralları: ilk bölüm 0:00'da başlar, en az 3 bölüm,
 * her bölüm en az 10 sn.
 */
export interface Chapter {
  start: number
  end: number
  title: string
  /** başlığın dayandığı özel adlar / anahtar kelimeler */
  keywords: string[]
  titleSource: 'draft' | 'ai'
}

export type ChapterDensity = 'low' | 'medium' | 'high'

export interface ChapterOptions {
  /** bir bölümün en kısa süresi (sn) */
  minSec: number
  /** hedef ortalama bölüm süresi (sn); çok uzun bölümler (3×) konu sınırından bölünür */
  targetSec: number
  maxChapters: number
}
/** Sıklık: az ≈ her 7 dk, orta ≈ her 3,5 dk (varsayılan), çok ≈ her 2 dk */
export const DENSITY: Record<ChapterDensity, ChapterOptions> = {
  low: { minSec: 120, targetSec: 420, maxChapters: 40 },
  medium: { minSec: 60, targetSec: 210, maxChapters: 60 },
  high: { minSec: 45, targetSec: 120, maxChapters: 90 }
}
export const DEFAULT_CHAPTER_OPTIONS: ChapterOptions = DENSITY.medium

export interface ChaptersResult {
  chapters: Chapter[]
  totalSec: number
  /** Kullanıcının biçimi: "Saniyeler:" başlığı + "00:12:42 - Ederson" satırları */
  text: string
  warnings: string[]
  ai: { requested: boolean; used: boolean; error?: string }
}

/** 00:00:00 (her zaman SS:DD:ss) */
export function chapterTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export const CHAPTERS_HEADER = 'Saniyeler:'

/** Yalnızca zaman damgası satırları: "00:12:42 - Ederson" */
export const chapterLines = (chapters: Pick<Chapter, 'start' | 'title'>[]): string[] => chapters.map((c) => `${chapterTimestamp(c.start)} - ${c.title}`)

/** Kullanıcının örneğindeki tam metin: "Saniyeler:" + boş satır + satırlar */
export const formatChapters = (chapters: Pick<Chapter, 'start' | 'title'>[]): string => `${CHAPTERS_HEADER}\n\n${chapterLines(chapters).join('\n')}`

/** YouTube kurallarına uyum: boşsa liste döner */
export function chapterWarnings(chapters: Pick<Chapter, 'start' | 'end'>[]): string[] {
  const w: string[] = []
  if (chapters.length < 3) w.push('YouTube bölüm zamanları için en az 3 bölüm gerekir (video çok kısa ya da tek konulu olabilir).')
  if (chapters[0] && chapters[0].start > 0.5) w.push("İlk bölüm 0:00'da başlamalı.")
  if (chapters.some((c) => c.end - c.start < 10)) w.push('YouTube bölümleri en az 10 saniye olmalı.')
  return w
}

type Vec = Map<string, number>
const add = (a: Vec, b: Vec) => {
  for (const [k, v] of b) a.set(k, (a.get(k) ?? 0) + v)
  return a
}
function cosine(a: Vec, b: Vec): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of a) (na += v * v, (dot += v * (b.get(k) ?? 0)))
  for (const v of b.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const clean = (t: string) => t.replace(/[^\p{L}\p{N}'’]/gu, '').split(/['’]/)[0]
const isUpper = (s: string) => s.charAt(0) !== s.charAt(0).toLocaleLowerCase('tr-TR') && s.charAt(0) === s.charAt(0).toLocaleUpperCase('tr-TR')
/** Yayın sohbetinde sık geçen ama konu olmayan büyük harfli sözcükler */
const NOT_NAME = new Set(['youtube', 'kick', 'twitter', 'instagram', 'discord', 'chat', 'hocam', 'abi'])

interface NameTok {
  /** kök anahtar (ilk 6 harf) */
  stem: string
  surface: string
}

/** Özel ad adayı sözcükler (büyük harf, sayı değil, listede yok). Cümle başı sözcük yalnızca ardından büyük harfli ad geliyorsa ("Rafael Leao") sayılır. */
function nameTokens(words: TranscriptWord[], firstWords: Set<number>): (NameTok | null)[] {
  const base = words.map((w) => {
    const surface = clean(w.text.trim())
    if (surface.length < 3 || !isUpper(surface) || /^\d/.test(surface)) return null
    const k = key(surface).replace(/ /g, '')
    if (k.length < 3 || NOT_ENTITY.has(k) || STOP_KEYS.has(k) || NOT_NAME.has(k)) return null
    return { stem: k.slice(0, 6), surface } as NameTok
  })
  return base.map((t, i) => {
    if (!t) return null
    if (!firstWords.has(i)) return t
    // cümle başı: yalnızca soyadı gibi büyük harfli bir ad izliyorsa
    const nx = base[i + 1]
    return nx && !firstWords.has(i + 1) ? t : null
  })
}

/** Aralıktaki anılan adlar: "Papa Gueye" gibi yan yana adlar birleştirilir; [ad, sayı] sıralı */
function namesIn(words: TranscriptWord[], toks: (NameTok | null)[], from: number, to: number): { name: string; n: number }[] {
  const single = new Map<string, { n: number; surf: Map<string, number> }>()
  const pairs = new Map<string, { n: number; surf: Map<string, number>; a: string; b: string }>()
  for (let i = from; i <= to; i++) {
    const t = toks[i]
    if (!t) continue
    const e = single.get(t.stem) ?? { n: 0, surf: new Map() }
    e.n++
    e.surf.set(t.surface, (e.surf.get(t.surface) ?? 0) + 1)
    single.set(t.stem, e)
    const nx = toks[i + 1]
    if (nx && i + 1 <= to && nx.stem !== t.stem) {
      const k = `${t.stem}|${nx.stem}`
      const p = pairs.get(k) ?? { n: 0, surf: new Map(), a: t.stem, b: nx.stem }
      p.n++
      const full = `${t.surface} ${nx.surface}`
      p.surf.set(full, (p.surf.get(full) ?? 0) + 1)
      pairs.set(k, p)
    }
  }
  const top = (m: Map<string, number>) => [...m].sort((x, y) => y[1] - x[1])[0][0]
  const used = new Set<string>()
  const out: { name: string; n: number }[] = []
  for (const p of [...pairs.values()].sort((x, y) => y.n - x.n)) {
    if (p.n < 2 || used.has(p.a) || used.has(p.b)) continue
    // iki ad çoğunlukla birlikte anılıyorsa tam ad
    const minSingle = Math.min(single.get(p.a)!.n, single.get(p.b)!.n)
    if (p.n >= 0.5 * minSingle) {
      out.push({ name: top(p.surf), n: p.n })
      used.add(p.a)
      used.add(p.b)
    }
  }
  for (const [stem, e] of single) if (!used.has(stem) && e.n >= 2) out.push({ name: top(e.surf), n: e.n })
  return out.sort((x, y) => y.n - x.n)
}

/** Düzenlenmiş videonun kelimelerinden (çizelge zamanı) ardışık YouTube bölümleri; konu = konuşulan kişi/takım adı */
export function findChapters(words: TranscriptWord[], options: Partial<ChapterOptions> = {}): Chapter[] {
  const o = { ...DEFAULT_CHAPTER_OPTIONS, ...options }
  if (words.length === 0) return []
  const total = words[words.length - 1].end
  const segs = buildSegments(words)
  if (segs.length === 0 || total < 30) return []
  const firstWords = new Set(segs.map((g) => g.firstWord))
  const toks = nameTokens(words, firstWords)

  // 30 sn'lik birimler (cümle sınırlarında): ad sayıları + tf-idf (konu sınırı yedeği için)
  const UNIT = 30
  interface U { a: number; b: number; start: number; end: number; tf: Vec; names: Map<string, number> }
  const units: U[] = []
  let cur: U | null = null
  for (const [i, s] of segs.entries()) {
    if (!cur) cur = { a: i, b: i, start: s.start, end: s.end, tf: new Map(), names: new Map() }
    cur.b = i
    cur.end = s.end
    for (const t of tokens(s.text)) cur.tf.set(t.stem, (cur.tf.get(t.stem) ?? 0) + 1)
    for (let wi = s.firstWord; wi <= s.lastWord; wi++) {
      const t = toks[wi]
      if (t) cur.names.set(t.stem, (cur.names.get(t.stem) ?? 0) + 1)
    }
    if (cur.end - cur.start >= UNIT) (units.push(cur), (cur = null))
  }
  if (cur) units.push(cur)
  const df = new Map<string, number>()
  for (const u of units) for (const k of u.tf.keys()) df.set(k, (df.get(k) ?? 0) + 1)
  const idf = (k: string) => Math.log(1 + units.length / (df.get(k) ?? 1))
  const wu = units.map((u) => new Map([...u.tf].map(([k, v]) => [k, (1 + Math.log(v)) * idf(k)] as const)))
  const sim: number[] = []
  for (let i = 0; i < units.length - 1; i++) {
    const l: Vec = new Map()
    const r: Vec = new Map()
    for (let j = Math.max(0, i - 3); j <= i; j++) add(l, wu[j])
    for (let j = i + 1; j <= Math.min(units.length - 1, i + 4); j++) add(r, wu[j])
    sim.push(cosine(l, r))
  }
  const depth = sim.map((s, i) => Math.max(...sim.slice(Math.max(0, i - 3), i + 1)) + Math.max(...sim.slice(i, Math.min(sim.length, i + 4))) - 2 * s)

  // 1) birim başına baskın ad (komşularla yumuşatılmış); aynı adın ardışık birimleri bir bölüm
  const dom: (string | null)[] = units.map((_, i) => {
    const w = new Map<string, number>()
    for (const [d, wt] of [[-1, 0.5], [0, 1], [1, 0.5]] as const) {
      const u = units[i + d]
      if (u) for (const [k, n] of u.names) w.set(k, (w.get(k) ?? 0) + n * wt)
    }
    const best = [...w].sort((x, y) => y[1] - x[1])[0]
    return best && best[1] >= 2 ? best[0] : null
  })
  // adsız (null) birimler önceki baskın adı sürdürür: kısa ad boşlukları bölümü parçalamasın
  const filled = dom.map((d, i) => {
    if (d) return d
    let j = i
    while (j >= 0 && !dom[j]) j--
    const gap = i - j
    return j >= 0 && gap <= 3 ? dom[j] : null
  })
  let runs: { ua: number; ub: number; dom: string | null }[] = []
  for (let i = 0; i < units.length; i++) {
    const last = runs[runs.length - 1]
    if (last && last.dom === filled[i]) last.ub = i
    else runs.push({ ua: i, ub: i, dom: filled[i] })
  }
  const secOf = (ua: number, ub: number) => units[ub].end - units[ua].start
  // 2) çok kısa bölümleri komşuya kat
  const mergeShort = () => {
    for (let guard = 0; guard < 500; guard++) {
      const i = runs.findIndex((r) => secOf(r.ua, r.ub) < o.minSec)
      if (i < 0 || runs.length === 1) return
      const into = i > 0 ? i - 1 : i + 1
      const a = runs[Math.min(i, into)]
      const b = runs[Math.max(i, into)]
      const keep = secOf(a.ua, a.ub) >= secOf(b.ua, b.ub) ? a.dom : b.dom
      runs.splice(Math.min(i, into), 2, { ua: a.ua, ub: b.ub, dom: keep })
    }
  }
  mergeShort()
  // 3) çok uzun bölümleri konu sınırından (en belirgin benzerlik düşüşü) böl
  const maxLen = o.targetSec * 3
  const split = (r: { ua: number; ub: number; dom: string | null }): { ua: number; ub: number; dom: string | null }[] => {
    if (secOf(r.ua, r.ub) <= maxLen) return [r]
    const minU = Math.max(1, Math.round(o.minSec / (total / units.length)))
    let best = -1
    let bd = -Infinity
    for (let i = r.ua + minU - 1; i <= r.ub - minU; i++) if (depth[i] > bd) (bd = depth[i], (best = i))
    return best < 0 ? [r] : [...split({ ua: r.ua, ub: best, dom: r.dom }), ...split({ ua: best + 1, ub: r.ub, dom: r.dom })]
  }
  runs = runs.flatMap(split)
  // 4) en çok bölüm sayısını aşarsa en kısa komşuları birleştir
  while (runs.length > o.maxChapters) {
    let k = 0
    let bs = Infinity
    for (let i = 0; i + 1 < runs.length; i++) {
      const sum = secOf(runs[i].ua, runs[i + 1].ub)
      if (sum < bs) (bs = sum, (k = i))
    }
    runs.splice(k, 2, { ua: runs[k].ua, ub: runs[k + 1].ub, dom: runs[k].dom })
  }

  // 5) başlıklar: aralıkta anılan adlar ("Chevalier, Salah, Guirassy"); ad yoksa anahtar kelimeler
  // ANA KONU: bölümlerin çoğunda öne çıkan ad (ör. videonun tamamı Galatasaray hakkındaysa "Galatasaray") her başlığa yazılmaz;
  // başlık yalnızca o bölüme özgü adları (oyuncu, rakip…) taşır
  const perRun = runs.map((r) => {
    const l = namesIn(words, toks, segs[units[r.ua].a].firstWord, segs[units[r.ub].b].lastWord)
    const t = l[0]?.n ?? 0
    return l.filter((x) => x.n >= Math.max(2, 0.4 * t)).slice(0, 4).map((x) => x.name)
  })
  const share = new Map<string, number>()
  for (const ns of perRun) for (const n of new Set(ns)) share.set(n, (share.get(n) ?? 0) + 1)
  const dominant = new Set(runs.length >= 4 ? [...share].filter(([, c]) => c / runs.length >= 0.6).map(([n]) => n) : [])
  const out: Chapter[] = runs.map((r, k) => {
    const sa = units[r.ua].a
    const sb = units[r.ub].b
    const names = perRun[k].filter((n) => !dominant.has(n))
    let title = names.join(', ')
    let keywords = names
    if (!title) {
      const tf: Vec = new Map()
      const surf = new Map<string, Map<string, number>>()
      for (let q = sa; q <= sb; q++) {
        for (const t of tokens(segs[q].text)) {
          tf.set(t.stem, (tf.get(t.stem) ?? 0) + 1)
          const m = surf.get(t.stem) ?? new Map<string, number>()
          m.set(t.surface, (m.get(t.surface) ?? 0) + 1)
          surf.set(t.stem, m)
        }
      }
      const kws = [...tf].filter(([, c]) => c >= 2).map(([kk, c]) => [kk, c * idf(kk)] as const).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([kk]) => [...(surf.get(kk) ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0] ?? kk)
      keywords = []
      title = kws.length ? kws.map(cap).join(', ') : 'Sohbet'
    }
    return { start: k === 0 ? 0 : segs[sa].start, end: segs[sb].end, title, keywords, titleSource: 'draft' as const }
  })
  // açılış: kısa ilk bölüm "Giriş" (ad yok ya da ≤2 dk)
  if (out.length >= 2 && (out[0].keywords.length === 0 || out[0].end - out[0].start <= 120)) out[0].title = 'Giriş'
  // art arda aynı başlık tek bölüm olsun
  const merged: Chapter[] = []
  for (const c of out) {
    const last = merged[merged.length - 1]
    if (last && last.title === c.title) last.end = c.end
    else merged.push({ ...c })
  }
  return merged
}
