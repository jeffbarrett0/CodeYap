import { describe, expect, it } from 'vitest'
import { DENSITY, TOPIC_OPTIONS, chapterTimestamp, chapterWarnings, findChapters, formatChapters } from '../../src/shared/chapters'
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
    { mins: 1.5, vocab: GAME },
    { mins: 3, vocab: FOOT, name: 'Rafael' },
    { mins: 4, vocab: FOOT, name: 'Camavinga' },
    { mins: 4, vocab: FOOT, name: 'Ederson' },
    { mins: 4, vocab: FOOD }
  ])
  const chapters = findChapters(words)
  it('ardışık, boşluksuz bölümler; ilki 0; sınırlar konu/isim değişimine ±1,5 dk yakın', () => {
    expect(chapters.length).toBeGreaterThanOrEqual(4)
    expect(chapters[0].start).toBe(0)
    for (let i = 1; i < chapters.length; i++) expect(chapters[i].start).toBeGreaterThan(chapters[i - 1].start)
    for (const b of bounds.slice(0, 3)) expect(chapters.some((c) => Math.abs(c.start - b) < 90), `sınır ${Math.round(b)} bulunamadı: ${chapters.map((c) => Math.round(c.start)).join(',')}`).toBe(true)
  })
  it('başlıklar konuşulan kişi adlarıdır; ilk bölüm "Giriş"', () => {
    expect(chapters[0].title).toBe('Giriş')
    const titles = chapters.map((c) => c.title)
    for (const n of ['Rafael', 'Camavinga', 'Ederson']) expect(titles.some((t) => t.includes(n)), `${n} yok: ${titles.join(' | ')}`).toBe(true)
  })
  it('biçim: "00:00 Giriş" (1 saatin altı MM:SS, üstü HH:MM:SS); başlık/boş satır/tire yok', () => {
    expect(chapterTimestamp(0)).toBe('00:00:00')
    expect(chapterTimestamp(754)).toBe('00:12:34')
    expect(chapterTimestamp(3735)).toBe('01:02:15')
    const lines = formatChapters(chapters).split('\n')
    expect(lines[0]).toBe('00:00 Giriş')
    expect(lines).toHaveLength(chapters.length)
    for (const l of lines) expect(l).toMatch(/^\d\d:\d\d \S/)
    const long = formatChapters([{ start: 0, title: 'Giriş' }, { start: 3735, title: 'Son' }], 7200).split('\n')
    expect(long).toEqual(['00:00:00 Giriş', '01:02:15 Son'])
    expect(chapterWarnings(chapters)).toEqual([])
    expect(chapterWarnings([{ start: 0, end: 60 }])).toEqual(expect.arrayContaining([expect.stringMatching(/en az 3/)]))
    expect(chapterWarnings([{ start: 5, end: 8 }, { start: 8, end: 100 }, { start: 100, end: 200 }]).length).toBe(2)
  })
  it('sıklık: çok > orta > az bölüm; çok kısa/boş videoda bölüm yok', () => {
    const n = (d: 'low' | 'medium' | 'high') => findChapters(words, DENSITY[d]).length
    expect(n('high')).toBeGreaterThanOrEqual(n('medium'))
    expect(n('medium')).toBeGreaterThanOrEqual(n('low'))
    expect(findChapters([])).toEqual([])
    expect(findChapters(words.slice(0, 20))).toEqual([])
  })

  it('konuya göre kip: sıklık/süre sabit değil — 3 dk de 12 dk da bölüm olur; açılış her zaman Giriş; takım düzeyi başlık', () => {
    const names = ['Osimhen', 'Icardi', 'Torreira', 'Sara', 'Mertens', 'Barış']
    const pl = (i: number) => names[i % names.length]
    // 1,5 dk giriş (isimsiz) + 12 dk "Galatasaray" (6 farklı oyuncu, takım adı sık) + 3 dk tek oyuncu (Lemina) + 8 dk Beşiktaş
    const gs = stream([{ mins: 1.5, vocab: GAME }, { mins: 12, vocab: [...FOOT, 'Galatasaray', 'Galatasaray'], name: 'Osimhen' }, { mins: 3, vocab: FOOT, name: 'Lemina' }, { mins: 8, vocab: [...FOOT, 'Beşiktaş', 'Beşiktaş'], name: 'Rashica' }])
    void pl
    const ch = findChapters(gs.words, TOPIC_OPTIONS)
    expect(ch[0].title).toBe('Giriş')
    expect(ch[0].start).toBe(0)
    const lens = ch.map((c) => c.end - c.start)
    expect(Math.max(...lens)).toBeGreaterThan(8 * 60) // uzun konu bölünmedi
    expect(ch.some((c) => c.title.includes('Lemina'))).toBe(true)
    expect(chapterWarnings(ch)).toEqual([])
    // başlıklar tekrar etmez; metin YouTube sınırı içinde
    expect(formatChapters(ch).length).toBeLessThan(4800)
  })

  it('konuya göre kip: birçok farklı oyuncu + takım adı → "Galatasaray gündemi"; tek oyuncu → onun adı', () => {
    const gs = stream([
      { mins: 1.5, vocab: GAME },
      { mins: 9, vocab: ['Osimhen', 'Icardi', 'Torreira', 'Sara', 'Mertens', 'Galatasaray', 'Galatasaray', 'Galatasaray', 'transfer', 'forvet'] },
      { mins: 6, vocab: [...FOOT, 'Lemina', 'Lemina', 'Lemina'] }
    ])
    const ch = findChapters(gs.words, TOPIC_OPTIONS)
    const titles = ch.map((c) => c.title)
    expect(titles[0]).toBe('Giriş')
    expect(titles, titles.join(' | ')).toContain('Galatasaray gündemi')
    expect(titles.some((t) => t.includes('Lemina'))).toBe(true)
  })
})
