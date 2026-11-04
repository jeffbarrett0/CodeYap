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
  /** başlığın dayandığı özel ad / anahtar kelimeler */
  keywords: string[]
  titleSource: 'draft' | 'ai'
}

export interface ChapterOptions {
  /** bir bölümün en kısa süresi (sn) */
  minSec: number
  /** hedef ortalama bölüm süresi (sn): bölüm sayısı = süre / bu değer */
  targetSec: number
  maxChapters: number
}
export const DEFAULT_CHAPTER_OPTIONS: ChapterOptions = { minSec: 150, targetSec: 420, maxChapters: 25 }

export interface ChaptersResult {
  chapters: Chapter[]
  totalSec: number
  /** YouTube açıklamasına yapıştırılacak metin */
  text: string
  warnings: string[]
  ai: { requested: boolean; used: boolean; error?: string }
}

/** 0:00 · 12:34 · 1:02:15 (YouTube her iki biçimi de kabul eder) */
export function chapterTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export const formatChapters = (chapters: Pick<Chapter, 'start' | 'title'>[]): string => chapters.map((c) => `${chapterTimestamp(c.start)} ${c.title}`).join('\n')

/** YouTube kurallarına uyum: boşsa liste döner */
export function chapterWarnings(chapters: Pick<Chapter, 'start' | 'end'>[]): string[] {
  const w: string[] = []
  if (chapters.length < 3) w.push('YouTube bölüm zamanları için en az 3 bölüm gerekir (video çok kısa ya da tek konulu olabilir).')
  if (chapters[0] && chapters[0].start > 0.5) w.push('İlk bölüm 0:00\'da başlamalı.')
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

/** Bir cümle aralığının başlığı için: önce sık anılan özel adlar ("Batrakov"), yoksa anahtar kelimeler */
function labelFor(words: TranscriptWord[], segs: Segment[], firstWords: Set<number>, a: number, b: number, idf: (k: string) => number): { title: string; keywords: string[] } {
  const ents = new Map<string, { n: number; surf: Map<string, number> }>()
  for (let wi = segs[a].firstWord; wi <= segs[b].lastWord; wi++) {
    if (firstWords.has(wi)) continue // cümle başı
    const surface = clean(words[wi].text.trim())
    if (surface.length < 3 || !isUpper(surface) || /^\d/.test(surface)) continue
    const k = key(surface).replace(/ /g, '')
    if (NOT_ENTITY.has(k) || STOP_KEYS.has(k)) continue
    const e = ents.get(k.slice(0, 6)) ?? { n: 0, surf: new Map() }
    e.n++
    e.surf.set(surface, (e.surf.get(surface) ?? 0) + 1)
    ents.set(k.slice(0, 6), e)
  }
  const topEnts = [...ents.values()].filter((e) => e.n >= 2).sort((x, y) => y.n - x.n).slice(0, 2).map((e) => [...e.surf].sort((x, y) => y[1] - x[1])[0][0])
  const tf: Vec = new Map()
  const surf = new Map<string, Map<string, number>>()
  for (let q = a; q <= b; q++) {
    for (const t of tokens(segs[q].text)) {
      tf.set(t.stem, (tf.get(t.stem) ?? 0) + 1)
      const m = surf.get(t.stem) ?? new Map<string, number>()
      m.set(t.surface, (m.get(t.surface) ?? 0) + 1)
      surf.set(t.stem, m)
    }
  }
  const kws = [...tf].filter(([, c]) => c >= 2).map(([k, c]) => [k, c * idf(k)] as const).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => [...(surf.get(k) ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0] ?? k)
  if (topEnts.length >= 2) return { title: `${topEnts[0]} ve ${topEnts[1]} hakkında`, keywords: topEnts }
  if (topEnts.length === 1) return { title: `${topEnts[0]} hakkında`, keywords: [...topEnts, ...kws.slice(0, 1)] }
  if (kws.length >= 2) return { title: `${cap(kws[0])} ve ${kws[1]}`, keywords: kws }
  if (kws.length === 1) return { title: cap(kws[0]), keywords: kws }
  return { title: 'Sohbet', keywords: [] }
}

/** Düzenlenmiş videonun kelimelerinden (çizelge zamanı) ardışık YouTube bölümleri */
export function findChapters(words: TranscriptWord[], options: Partial<ChapterOptions> = {}): Chapter[] {
  const o = { ...DEFAULT_CHAPTER_OPTIONS, ...options }
  if (words.length === 0) return []
  const total = words[words.length - 1].end
  const segs = buildSegments(words)
  if (segs.length === 0 || total < 30) return []

  const firstWords = new Set(segs.map((g) => g.firstWord))

  // ~40 sn'lik birimler → tf-idf → komşu pencere benzerliği
  const UNIT = 40
  interface U { a: number; b: number; start: number; end: number; tf: Vec }
  const units: U[] = []
  let cur: U | null = null
  for (const [i, s] of segs.entries()) {
    if (!cur) cur = { a: i, b: i, start: s.start, end: s.end, tf: new Map() }
    cur.b = i
    cur.end = s.end
    for (const t of tokens(s.text)) cur.tf.set(t.stem, (cur.tf.get(t.stem) ?? 0) + 1)
    if (cur.end - cur.start >= UNIT) (units.push(cur), (cur = null))
  }
  if (cur) units.push(cur)
  const df = new Map<string, number>()
  for (const u of units) for (const k of u.tf.keys()) df.set(k, (df.get(k) ?? 0) + 1)
  const idf = (k: string) => Math.log(1 + units.length / (df.get(k) ?? 1))
  const wu = units.map((u) => new Map([...u.tf].map(([k, v]) => [k, (1 + Math.log(v)) * idf(k)] as const)))

  const K = 4
  const sim: number[] = []
  for (let i = 0; i < units.length - 1; i++) {
    const l: Vec = new Map()
    const r: Vec = new Map()
    for (let j = Math.max(0, i - K + 1); j <= i; j++) add(l, wu[j])
    for (let j = i + 1; j <= Math.min(units.length - 1, i + K); j++) add(r, wu[j])
    sim.push(cosine(l, r))
  }
  const depth = sim.map((s, i) => Math.max(...sim.slice(Math.max(0, i - 3), i + 1)) + Math.max(...sim.slice(i, Math.min(sim.length, i + 4))) - 2 * s)

  // bölüm sayısı süreye göre; en belirgin sınırlar, en kısa bölüm süresine uyularak seçilir
  const unitSec = total / units.length
  const minUnits = Math.max(1, Math.round(o.minSec / unitSec))
  const want = Math.min(o.maxChapters, Math.max(3, Math.round(total / o.targetSec)))
  const cuts: number[] = []
  for (const i of sim.map((_, k) => k).sort((x, y) => depth[y] - depth[x])) {
    if (cuts.length >= want - 1) break
    const startOk = units[i].end - units[0].start >= o.minSec
    const endOk = units[units.length - 1].end - units[i].end >= o.minSec
    if (startOk && endOk && cuts.every((c) => Math.abs(c - i) >= minUnits)) cuts.push(i)
  }
  cuts.sort((x, y) => x - y)
  const bounds = [-1, ...cuts, units.length - 1]
  const out: Chapter[] = []
  for (let k = 0; k + 1 < bounds.length; k++) {
    const ua = bounds[k] + 1
    const ub = bounds[k + 1]
    if (ub < ua) continue
    const sa = units[ua].a
    const sb = units[ub].b
    const lab = labelFor(words, segs, firstWords, sa, sb, idf)
    out.push({ start: k === 0 ? 0 : segs[sa].start, end: segs[sb].end, title: lab.title, keywords: lab.keywords, titleSource: 'draft' })
  }
  // ilk bölüm "Giriş": açılış konusu belirgin değilse ve kısaysa
  if (out.length >= 2 && out[0].keywords.length === 0) out[0].title = 'Giriş'
  // art arda aynı başlık: numara ekle
  const seen = new Map<string, number>()
  for (const c of out) {
    const n = (seen.get(c.title) ?? 0) + 1
    seen.set(c.title, n)
    if (n > 1) c.title = `${c.title} (${n})`
  }
  return out
}
