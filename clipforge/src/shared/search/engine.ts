import type { MatchKind, SearchOptions, SearchResult, Segment, TranscriptWord } from '../types'
import { foldTr, isStopword, phoneticFold, similarity } from '../text'
import { segmentIndexAt } from '../transcript/sentences'

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  fuzzyThreshold: 0.8,
  fuzzy: true,
  windowSec: 10,
  mergeGapSec: 12,
  contextSentences: 2,
  allowPartial: true,
  maxResults: 200
}

/** Sonek (Türkçe çekim eki) uzunluğu üst sınırı: "Nelson" ↔ "Nelson'ın", "Nelsonun" */
const MAX_SUFFIX = 5
const MIN_FUZZY_LEN = 4

interface VocabEntry {
  norm: string
  ph: string
  /** token indeksleri */
  positions: number[]
}

interface IndexToken {
  word: number
  vocab: VocabEntry
}

/**
 * Bellekte tutulan transkript indeksi. 1 saatlik kayıt (~10-15 bin kelime) için
 * kurulum birkaç ms, sorgu birkaç ms sürer; SQLite FTS gerektirmez (bkz. DECISIONS.md).
 */
export class TranscriptIndex {
  readonly words: TranscriptWord[]
  readonly segments: Segment[]
  readonly vocab = new Map<string, VocabEntry>()
  readonly tokens: IndexToken[] = []
  /** kelime indeksi → cümle indeksi */
  private readonly wordSegment: Int32Array

  constructor(words: TranscriptWord[], segments: Segment[]) {
    this.words = words
    this.segments = segments
    this.wordSegment = new Int32Array(words.length).fill(-1)
    for (const s of segments) for (let i = s.firstWord; i <= s.lastWord; i++) this.wordSegment[i] = s.id

    words.forEach((w, wi) => {
      const parts = foldTr(w.text).match(/[\p{L}\p{N}]+/gu) ?? []
      for (const norm of parts) {
        let v = this.vocab.get(norm)
        if (!v) {
          v = { norm, ph: phoneticFold(norm), positions: [] }
          this.vocab.set(norm, v)
        }
        v.positions.push(this.tokens.length)
        this.tokens.push({ word: wi, vocab: v })
      }
    })
  }

  segmentOfWord(wordIndex: number): number {
    const s = this.wordSegment[wordIndex]
    return s >= 0 ? s : Math.max(0, segmentIndexAt(this.segments, this.words[wordIndex]?.start ?? 0))
  }
}

export interface QueryTerm {
  norm: string
  ph: string
}

/** Sorguyu içerik terimlerine ayırır; "… ile ilgili konuştuğum yer" gibi dolgu sözcükleri atılır. */
export function parseQuery(query: string): QueryTerm[] {
  const all = (foldTr(query).match(/[\p{L}\p{N}]+/gu) ?? []).filter((t, i, a) => a.indexOf(t) === i)
  const content = all.filter((t) => !isStopword(t))
  const chosen = content.length > 0 ? content : all
  return chosen.map((norm) => ({ norm, ph: phoneticFold(norm) }))
}

/** Bir sorgu terimi ile sözlük girdisi arasındaki eşleşme gücü (0 = eşleşmez). */
export function termMatchScore(q: QueryTerm, v: VocabEntry, opts: Pick<SearchOptions, 'fuzzy' | 'fuzzyThreshold'>): number {
  if (q.norm === v.norm) return 1
  const extra = v.norm.length - q.norm.length
  // Çekim eki: "nelsonun", "victordan"
  if (q.norm.length >= MIN_FUZZY_LEN && extra > 0 && extra <= MAX_SUFFIX && v.norm.startsWith(q.norm)) {
    return Math.max(0.85, 0.96 - 0.02 * extra)
  }
  if (!opts.fuzzy || q.norm.length < MIN_FUZZY_LEN || v.norm.length < MIN_FUZZY_LEN) return 0
  // Hızlı eleme: uzunluk farkı eşiği zaten aşıyorsa (ve ek almış biçim de değilse) mesafe hesaplama
  const maxLen = Math.max(q.norm.length, v.norm.length)
  const maybeSuffixed = extra > 0 && extra <= MAX_SUFFIX
  if (!maybeSuffixed && Math.abs(extra) / maxLen > 1 - opts.fuzzyThreshold) return 0
  let s = similarity(q.norm, v.norm)
  if (extra > 0 && extra <= MAX_SUFFIX) {
    // Ek almış ve yazım hatalı: gövdeyi karşılaştır ("nelsenin" ↔ "nelson")
    s = Math.max(s, similarity(q.norm, v.norm.slice(0, q.norm.length)) * 0.97)
  }
  return s >= opts.fuzzyThreshold ? s : 0
}

interface Occurrence {
  token: number
  word: number
  term: number
  score: number
  start: number
  end: number
}

interface RawHit {
  firstWord: number
  lastWord: number
  start: number
  end: number
  score: number
  coverage: number
  exactAll: boolean
  adjacent: boolean
  multiTerm: boolean
  matched: { index: number; text: string; similarity: number }[]
  missing: string[]
}

function collectOccurrences(index: TranscriptIndex, terms: QueryTerm[], opts: SearchOptions): Occurrence[][] {
  return terms.map((q, term) => {
    const occ: Occurrence[] = []
    for (const v of index.vocab.values()) {
      const score = termMatchScore(q, v, opts)
      if (score <= 0) continue
      for (const token of v.positions) {
        const word = index.tokens[token].word
        occ.push({ token, word, term, score, start: index.words[word].start, end: index.words[word].end })
      }
    }
    return occ.sort((a, b) => a.token - b.token)
  })
}

function findHits(index: TranscriptIndex, terms: QueryTerm[], occ: Occurrence[][], opts: SearchOptions, minCoverage: number): RawHit[] {
  const n = terms.length
  const needed = Math.max(1, Math.ceil(n * minCoverage - 1e-9))
  const events = occ.flat().sort((a, b) => a.token - b.token)
  const hits: RawHit[] = []

  for (let i = 0; i < events.length; i++) {
    const anchor = events[i]
    // pencerede her terim için en iyi olayı seç
    const best = new Map<number, Occurrence>()
    for (let j = i; j < events.length; j++) {
      const e = events[j]
      if (e.start - anchor.start > opts.windowSec) break
      const cur = best.get(e.term)
      if (!cur || e.score > cur.score + 1e-9) best.set(e.term, e)
    }
    // Pencerenin ilk olayı bu çapa olmalı, aksi halde aynı küme tekrar sayılır
    if (!best.has(anchor.term) || best.get(anchor.term)!.token !== anchor.token) {
      if (n > 1) continue
    }
    if (best.size < needed) continue
    const chosen = [...best.values()].sort((a, b) => a.token - b.token)
    // Aynı kelime iki terimi birden karşılıyorsa tek say
    const uniqueWords = new Set(chosen.map((c) => c.word))
    if (uniqueWords.size < needed) continue

    const coverage = best.size / n
    const mean = chosen.reduce((s, c) => s + c.score, 0) / chosen.length
    const first = chosen[0]
    const last = chosen[chosen.length - 1]
    const span = Math.max(0, last.end - first.start)
    const proximity = n > 1 ? 1 - 0.15 * Math.min(1, span / Math.max(1, opts.windowSec)) : 1
    const adjacent = chosen.length > 1 && chosen.every((c, k) => k === 0 || c.token - chosen[k - 1].token === 1)
    const orderBonus = adjacent ? 0.05 : 0
    const score = Math.min(1, mean * coverage * proximity + orderBonus)

    hits.push({
      firstWord: first.word,
      lastWord: last.word,
      start: first.start,
      end: last.end,
      score,
      coverage,
      exactAll: chosen.every((c) => c.score === 1),
      adjacent,
      multiTerm: n > 1,
      matched: chosen.map((c) => ({ index: c.word, text: index.words[c.word].text, similarity: c.score })),
      missing: terms.filter((_, t) => !best.has(t)).map((t) => t.norm)
    })
  }

  // Çakışan pencereleri ele: en iyi skorlu olan kalır
  hits.sort((a, b) => a.firstWord - b.firstWord || b.score - a.score)
  const kept: RawHit[] = []
  for (const h of hits) {
    const prev = kept[kept.length - 1]
    if (prev && h.firstWord <= prev.lastWord) {
      if (h.score > prev.score + 1e-9 || (Math.abs(h.score - prev.score) <= 1e-9 && h.lastWord - h.firstWord < prev.lastWord - prev.firstWord)) {
        kept[kept.length - 1] = h
      }
      continue
    }
    kept.push(h)
  }
  return kept
}

function kindOf(h: RawHit): MatchKind {
  if (!h.exactAll) return 'fuzzy'
  if (h.multiTerm && !h.adjacent) return 'window'
  return 'exact'
}

interface Group {
  hits: RawHit[]
  best: RawHit
  start: number
  end: number
}

function mergeNearby(index: TranscriptIndex, hits: RawHit[], opts: SearchOptions): Group[] {
  const groups: Group[] = []
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    const g = groups[groups.length - 1]
    const sameSentence = g && index.segmentOfWord(g.best.firstWord) === index.segmentOfWord(h.firstWord)
    if (g && (h.start - g.end <= opts.mergeGapSec || sameSentence)) {
      g.hits.push(h)
      g.end = Math.max(g.end, h.end)
      if (h.score > g.best.score) g.best = h
    } else {
      groups.push({ hits: [h], best: h, start: h.start, end: h.end })
    }
  }
  return groups
}

function toResult(index: TranscriptIndex, g: Group, opts: SearchOptions, partial: boolean): SearchResult {
  const seg = index.segmentOfWord(g.best.firstWord)
  const segs = index.segments
  const n = opts.contextSentences
  const before = segs.slice(Math.max(0, seg - n), seg).map((s) => s.text)
  const after = segs.slice(seg + 1, seg + 1 + n).map((s) => s.text)
  const matched = new Map<number, { index: number; text: string; similarity: number }>()
  for (const h of g.hits) for (const m of h.matched) matched.set(m.index, m)
  const firstWord = Math.min(...g.hits.map((h) => h.firstWord))
  const lastWord = Math.max(...g.hits.map((h) => h.lastWord))
  const bonus = Math.min(0.05, 0.01 * (g.hits.length - 1))
  const score = Math.min(1, g.best.score + bonus) * (partial ? 0.8 : 1)
  return {
    id: `r-${Math.round(g.start * 1000)}`,
    start: g.start,
    end: g.end,
    sentenceStart: segs[seg]?.start ?? g.start,
    sentenceEnd: segs[seg]?.end ?? g.end,
    sentence: segs[seg]?.text ?? '',
    before,
    after,
    score,
    kind: kindOf(g.best),
    matchCount: g.hits.length,
    matchedWords: [...matched.values()].sort((a, b) => a.index - b.index),
    firstWord,
    lastWord,
    missingTerms: partial ? g.best.missing : undefined
  }
}

/**
 * Transkript içinde arar. Sonuçlar zamana göre sıralıdır.
 *
 *  1. Sorgu içerik terimlerine ayrılır (dolgu sözcükler atılır).
 *  2. Her terim sözlükte tam / ek almış / bulanık olarak eşlenir.
 *  3. Terimlerin `windowSec` içinde birlikte geçtiği pencereler aday olur.
 *  4. Aynı konuşma bölümündeki adaylar tek sonuca birleştirilir.
 *  5. Tüm terimler hiçbir yerde bir arada yoksa (ve izin varsa) kısmi sonuçlar döner.
 */
export function searchTranscript(index: TranscriptIndex, query: string, options: Partial<SearchOptions> = {}): SearchResult[] {
  const opts: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, ...options }
  const terms = parseQuery(query)
  if (terms.length === 0 || index.words.length === 0) return []

  const occ = collectOccurrences(index, terms, opts)
  let hits = findHits(index, terms, occ, opts, 1)
  let partial = false
  if (hits.length === 0 && terms.length > 1 && opts.allowPartial) {
    hits = findHits(index, terms, occ, opts, 0.5)
    partial = hits.length > 0
  }
  const results = mergeNearby(index, hits, opts).map((g) => toResult(index, g, opts, partial))
  const top =
    results.length > opts.maxResults ? [...results].sort((a, b) => b.score - a.score).slice(0, opts.maxResults) : results
  return top.sort((a, b) => a.start - b.start)
}

/** Sonuç listesindeki tek bir sonucu, ayrı bir sorgu yazmadan, indeks üzerinden yeniden kurmak için yardımcı. */
export function buildIndex(words: TranscriptWord[], segments: Segment[]): TranscriptIndex {
  return new TranscriptIndex(words, segments)
}
