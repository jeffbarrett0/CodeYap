import { describe, expect, it } from 'vitest'
import { draftTitles, findVideoIdeas } from '../../src/shared/ideas'
import type { TranscriptWord } from '../../src/shared/types'

/** Deterministik sahte yayın: konu blokları (her birinin kendi kelime dağarcığı) + ortak sohbet dolgusu */
function fakeStream(topics: { name: string; mins: number; vocab: string[] }[]): { words: TranscriptWord[]; bounds: number[] } {
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'ortada', 'oldukça', 'görüyorsunuz', 'bakıyoruz', 'düşünce', 'durum', 'mesele', 'taraf']
  const words: TranscriptWord[] = []
  const bounds: number[] = []
  let t = 0
  for (const tp of topics) {
    const end = t + tp.mins * 60
    while (t < end) {
      const n = 8 + Math.floor(rnd() * 5)
      for (let i = 0; i < n; i++) {
        const w = rnd() < 0.45 ? tp.vocab[Math.floor(rnd() * tp.vocab.length)] : common[Math.floor(rnd() * common.length)]
        words.push({ text: i === n - 1 ? `${w}.` : w, start: t, end: t + 0.4, confidence: 1 } as TranscriptWord)
        t += 0.45
      }
      t += 0.5
    }
    bounds.push(t)
  }
  return { words, bounds }
}

const AI = ['yapay', 'zeka', 'yapay', 'zeka', 'model', 'modeller', 'veri', 'eğitim', 'algoritma', 'öğrenme', 'chatbot', 'robot']
const FOOT = ['galatasaray', 'transfer', 'forvet', 'maçı', 'taraftar', 'gol', 'teknik', 'direktör', 'kadro', 'sezon', 'lig', 'penaltı']
const GAME = ['oyun', 'bölüm', 'boss', 'seviye', 'karakter', 'silah', 'görev', 'harita', 'sunucu', 'oyuncu', 'build', 'patch']
const FOOD = ['yemek', 'tarif', 'lezzet', 'restoran', 'mutfak', 'tavuk', 'pilav', 'çorba', 'tatlı', 'baharat', 'fırın', 'sosis']

describe('video önerileri (konu bölümleri)', () => {
  const { words, bounds } = fakeStream([
    { name: 'oyun', mins: 12, vocab: GAME },
    { name: 'ai', mins: 15, vocab: AI },
    { name: 'futbol', mins: 14, vocab: FOOT },
    { name: 'yemek', mins: 10, vocab: FOOD }
  ])
  const ideas = findVideoIdeas(words)

  it('konu sınırlarını bulur: her gerçek konu için bir bölüm, sınırlar ±2 dk içinde', () => {
    expect(ideas.length).toBeGreaterThanOrEqual(3)
    const real = [0, ...bounds]
    for (let i = 0; i < 4; i++) {
      const hit = ideas.find((x) => Math.abs(x.start - real[i]) < 120 && Math.abs(x.end - real[i + 1]) < 120)
      expect(hit, `${i}. konu bölümü bulunamadı: ${ideas.map((x) => `${Math.round(x.start)}-${Math.round(x.end)}`).join(', ')}`).toBeTruthy()
    }
  })
  it('yapay zekâ bölümü: anahtar kelimeler konuya özgü ("yapay zeka" birleşik), süre ≈ 15 dk, başlık taslağı var', () => {
    const ai = ideas.find((x) => Math.abs(x.start - bounds[0]) < 120)!
    expect(ai.keywords.join(' ')).toMatch(/yapay zeka|model|veri/)
    expect(ai.keywords[0]).toMatch(/^(yapay zeka|zeka yapay)$/)
    expect(ai.durationSec).toBeGreaterThan(13 * 60)
    expect(ai.durationSec).toBeLessThan(17 * 60)
    expect(ai.titles.length).toBeGreaterThanOrEqual(2)
    expect(ai.titles[0]).toMatch(/(Yapay zeka|Zeka yapay)/)
    expect(ai.titleSource).toBe('draft')
    expect(ai.summary.length).toBeGreaterThan(20)
    expect(ai.firstWord).toBeLessThan(ai.lastWord)
  })
  it('skorlar 0..1, sıralı; kısa/konusuz kayıtta öneri yok; taslak başlıklar', () => {
    expect(ideas.every((x) => x.score > 0 && x.score <= 1)).toBe(true)
    expect(ideas.map((x) => x.score)).toEqual([...ideas.map((x) => x.score)].sort((a, b) => b - a))
    expect(findVideoIdeas(words.slice(0, 40))).toEqual([])
    expect(draftTitles(['yapay zeka', 'model'], 900)[0]).toBe('Yapay zeka hakkında konuştuklarım')
    expect(draftTitles([], 60)).toHaveLength(1)
  })
})
