import { describe, expect, it } from 'vitest'
import { mergeChunkResults, planChunks, type ChunkResult } from '@shared/transcript/chunking'
import { buildSegments } from '@shared/transcript/sentences'
import type { TranscriptWord } from '@shared/types'

describe('planChunks', () => {
  it('örtüşen pencereler tüm süreyi kapsar', () => {
    const plan = planChunks(3600, 600, 15)
    expect(plan[0]).toMatchObject({ start: 0, end: 600 })
    expect(plan[1].start).toBe(585)
    expect(plan.at(-1)!.end).toBe(3600)
    for (let i = 1; i < plan.length; i++) expect(plan[i - 1].end - plan[i].start).toBeGreaterThanOrEqual(15 - 1e-9)
  })
  it('kısa kayıt tek pencere', () => {
    expect(planChunks(100)).toEqual([{ index: 0, start: 0, end: 100 }])
    expect(planChunks(0)).toEqual([])
  })
})

/** Gerçek kelime akışı: 0.4 sn aralıkla, ara sıra sessizlik */
function truthWords(total: number): TranscriptWord[] {
  const out: TranscriptWord[] = []
  let t = 0
  let i = 0
  while (t < total) {
    out.push({ text: `w${i}`, start: t, end: t + 0.3 })
    t += 0.4
    if (i % 17 === 16) t += 1.2
    i++
  }
  return out
}

/** Bir pencerenin dökümünü taklit eder: kenarda kalan/kesilen kelimeler kaybolur, zaman damgalarında küçük sapma olur */
function simulate(truth: TranscriptWord[], start: number, end: number, seed: number): ChunkResult {
  const jitter = (k: number) => Math.sin(k * 12.9898 + seed) * 0.04
  const words = truth
    .filter((w) => w.start >= start + 0.6 && w.end <= end - 0.6) // kenar kelimeleri güvenilmez/kayıp
    .map((w, k) => ({ ...w, start: w.start + jitter(k), end: w.end + jitter(k) }))
  return { start, end, words }
}

describe('mergeChunkResults', () => {
  it('örtüşmeli pencereler birleşince kelime kaybı ve tekrarı olmaz', () => {
    const truth = truthWords(2000)
    const plan = planChunks(2000, 600, 15)
    const merged = mergeChunkResults(plan.map((c, i) => simulate(truth, c.start, c.end, i + 1)))
    const texts = merged.map((w) => w.text)
    expect(new Set(texts).size).toBe(texts.length) // tekrar yok
    // gerçek akıştaki her kelime (kaydın en başı/sonu hariç) bulunur
    const missing = truth.filter((w) => w.start > 1 && w.end < 1999).filter((w) => !texts.includes(w.text))
    expect(missing).toEqual([])
    // sıra korunur
    const nums = texts.map((t) => Number(t.slice(1)))
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
  })

  it('pencere sınırındaki cümle bölünmez', () => {
    const truth = truthWords(1300)
    const plan = planChunks(1300, 600, 15)
    const merged = mergeChunkResults(plan.map((c, i) => simulate(truth, c.start, c.end, i + 3)))
    const segs = buildSegments(merged)
    expect(segs.length).toBeGreaterThan(10)
    // 585-600 sn arası (ilk sınır) kelime akışı kesintisiz
    const around = merged.filter((w) => w.start > 580 && w.start < 605)
    for (let i = 1; i < around.length; i++) expect(around[i].start - around[i - 1].end).toBeLessThan(1.7)
  })

  it('tek pencere olduğu gibi döner; boş girdi boş döner', () => {
    const truth = truthWords(50)
    expect(mergeChunkResults([{ start: 0, end: 50, words: truth }])).toHaveLength(truth.length)
    expect(mergeChunkResults([])).toEqual([])
  })
})

describe('buildSegments', () => {
  it('noktalamada ve duraksamada böler, uzun akışı en uzun boşlukta keser', () => {
    const w = (text: string, start: number): TranscriptWord => ({ text, start, end: start + 0.3 })
    const words = [w('Merhaba', 0), w('dostlar.', 0.4), w('Bugün', 1.0), w('çok', 1.4), w('güzel', 1.8), w('bir', 4.0), w('gün', 4.4)]
    const segs = buildSegments(words)
    expect(segs.map((s) => s.text)).toEqual(['Merhaba dostlar.', 'Bugün çok güzel', 'bir gün'])
    const long = Array.from({ length: 60 }, (_, i) => w(`k${i}`, i * 0.5 + (i === 30 ? 0.6 : 0)))
    const segs2 = buildSegments(long)
    expect(segs2.length).toBeGreaterThan(1)
    expect(segs2[0].lastWord + 1).toBe(segs2[1].firstWord)
  })
})
