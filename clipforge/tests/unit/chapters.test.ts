import { describe, expect, it } from 'vitest'
import { chapterTimestamp, chapterWarnings, findChapters, formatChapters } from '../../src/shared/chapters'
import type { TranscriptWord } from '../../src/shared/types'

/** Konu blokları: her blok kendi kelime dağarcığı; isimli bloklarda büyük harfli özel ad cümle ortasında geçer */
function stream(blocks: { mins: number; vocab: string[]; name?: string }[]): { words: TranscriptWord[]; bounds: number[] } {
  let seed = 3
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'oldukça', 'durum', 'mesele', 'taraf']
  const words: TranscriptWord[] = []
  const bounds: number[] = []
  let t = 0
  for (const b of blocks) {
    const end = t + b.mins * 60
    while (t < end) {
      for (let i = 0; i < 9; i++) {
        let w = rnd() < 0.45 ? b.vocab[Math.floor(rnd() * b.vocab.length)] : common[Math.floor(rnd() * common.length)]
        if (b.name && i === 4 && rnd() < 0.5) w = b.name
        words.push({ text: i === 8 ? `${w}.` : i === 0 ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w, start: t, end: t + 0.4, confidence: 1 } as TranscriptWord)
        t += 0.45
      }
      t += 0.5
    }
    bounds.push(t)
  }
  return { words, bounds }
}

const GAME = ['oyun', 'bölüm', 'boss', 'seviye', 'karakter', 'silah', 'görev', 'harita']
const AI = ['yapay', 'zeka', 'model', 'veri', 'eğitim', 'algoritma', 'öğrenme', 'chatbot']
const FOOT = ['transfer', 'forvet', 'taraftar', 'penaltı', 'kadro', 'sezon', 'lig', 'teknik']
const FOOD = ['yemek', 'tarif', 'lezzet', 'restoran', 'mutfak', 'tavuk', 'pilav', 'çorba']

describe('YouTube bölüm zamanları', () => {
  const { words, bounds } = stream([
    { mins: 14, vocab: GAME },
    { mins: 16, vocab: AI },
    { mins: 15, vocab: FOOT, name: 'Batrakov' },
    { mins: 13, vocab: FOOD }
  ])
  const chapters = findChapters(words)
  it('bütün videoyu ardışık, boşluksuz bölümlere ayırır; ilki 0:00; sınırlar konu değişimlerine ±2 dk yakın', () => {
    expect(chapters.length).toBeGreaterThanOrEqual(4)
    expect(chapters[0].start).toBe(0)
    for (let i = 1; i < chapters.length; i++) expect(chapters[i].start).toBeGreaterThan(chapters[i - 1].start)
    for (const b of bounds.slice(0, 3)) expect(chapters.some((c) => Math.abs(c.start - b) < 120), `sınır ${Math.round(b)} bulunamadı: ${chapters.map((c) => Math.round(c.start)).join(',')}`).toBe(true)
    expect(chapters.every((c) => c.end - c.start >= 100)).toBe(true)
  })
  it('özel ad başlığı: Batrakov bölümü "Batrakov hakkında"; konusu belirgin olmayan açılış değil', () => {
    expect(chapters.some((c) => c.title === 'Batrakov hakkında')).toBe(true)
    expect(new Set(chapters.map((c) => c.title)).size).toBe(chapters.length) // başlıklar benzersiz
  })
  it('YouTube biçimi ve kuralları', () => {
    expect(chapterTimestamp(0)).toBe('0:00')
    expect(chapterTimestamp(754)).toBe('12:34')
    expect(chapterTimestamp(3735)).toBe('1:02:15')
    const text = formatChapters(chapters)
    expect(text.split('\n')[0]).toMatch(/^0:00 \S+/)
    expect(text.split('\n')).toHaveLength(chapters.length)
    expect(chapterWarnings(chapters)).toEqual([])
    expect(chapterWarnings([{ start: 0, end: 60 }])).toEqual(expect.arrayContaining([expect.stringMatching(/en az 3/)]))
    expect(chapterWarnings([{ start: 5, end: 8 }, { start: 8, end: 100 }, { start: 100, end: 200 }]).length).toBe(2)
  })
  it('çok kısa video / boş: bölüm yok; orta uzunlukta en az 3 bölüm', () => {
    expect(findChapters([])).toEqual([])
    expect(findChapters(words.slice(0, 20))).toEqual([])
    const mid = stream([{ mins: 4, vocab: GAME }, { mins: 4, vocab: AI }, { mins: 4, vocab: FOOT }]).words
    expect(findChapters(mid, { minSec: 90 }).length).toBeGreaterThanOrEqual(3)
  })
})
