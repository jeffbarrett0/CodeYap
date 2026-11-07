import { describe, expect, it } from 'vitest'
import { applyVocabulary, buildPrompt, fixWord, parseVocabulary, uncertainIndexes } from '@shared/transcript/vocabulary'
import { buildSegments } from '@shared/transcript/sentences'
import type { Transcript, TranscriptWord } from '@shared/types'

const W = (text: string, start: number, confidence?: number): TranscriptWord => ({ text, start, end: start + 0.3, confidence })

describe('özel sözlük', () => {
  it('ayrıştırma: satır/virgül/noktalı virgül, tekrarlar ve boşluklar', () => {
    expect(parseVocabulary('Kavukçu, Dursun Özbek\nkavukcu ;  \n Galatasaray')).toEqual(['Kavukçu', 'Dursun Özbek', 'Galatasaray'])
    expect(parseVocabulary('')).toEqual([])
  })

  it('whisper ipucu: sözlük terimleri ve dolgu örneği; uzunluk sınırı', () => {
    expect(buildPrompt('Kavukçu, Özbek', true)).toBe('Şey, ııı, eee, hımm, yani. Kavukçu, Özbek.')
    expect(buildPrompt('Kavukçu', false)).toBe('Kavukçu.')
    expect(buildPrompt('', false)).toBe('')
    expect(buildPrompt(Array.from({ length: 200 }, (_, i) => `Terim${i}`).join(', '), true).length).toBeLessThanOrEqual(500)
  })
})

describe('sözlükle otomatik düzeltme', () => {
  const vocab = ['Abdullah Kavukçu', 'Dursun Özbek', 'Galatasaray']
  const fix = (...texts: string[]) => applyVocabulary(texts.map((t, i) => W(t, i)), vocab)

  it('"kabukçu" → "Kavukçu"; çekim eki, kesme işareti ve noktalama korunur', () => {
    const r = fix('Kabukçu', 'kabukçu', "Kabukçu'nun", 'kabukçunun', 'Kabukçu,', 'Abdullah', 'Kabukçu.')
    expect(r.words.map((w) => w.text)).toEqual(['Kavukçu', 'Kavukçu', "Kavukçu'nun", 'Kavukçunun', 'Kavukçu,', 'Abdullah', 'Kavukçu.'])
    expect(r.words[0].corrected).toBe('Kabukçu')
    expect(r.corrections).toHaveLength(6)
  })

  it('küçük hatalar: "Dursun Ozbek", "Galata Saray" parçaları, "Galatasaray\'ın"', () => {
    const r = fix('Dursun', 'Ozbek', 'Galatasarey', "Galatasaray'ın")
    expect(r.words.map((w) => w.text)).toEqual(['Dursun', 'Özbek', 'Galatasaray', "Galatasaray'ın"])
  })

  it('gerçek sözcüklere dokunmaz: kısa/farklı kelimeler, zaten doğru olanlar', () => {
    const r = fix('kabuk', 'kavun', 'kabuklu', 'Kavukçu', 'özbeğin', 'galata', 'Abdul', 'ağabey')
    expect(r.words.map((w) => w.text)).toEqual(['kabuk', 'kavun', 'kabuklu', 'Kavukçu', 'özbeğin', 'galata', 'Abdul', 'ağabey'])
    expect(r.corrections).toEqual([])
  })

  it('elle düzeltilmiş kelimeye ve sözlüksüz çağrıya dokunmaz', () => {
    const w = [{ ...W('kabukçu', 0), corrected: 'x' }]
    expect(applyVocabulary(w, vocab).words[0].text).toBe('kabukçu')
    expect(applyVocabulary([W('kabukçu', 0)], []).corrections).toEqual([])
  })
})

describe('güvensiz kelimeler ve elle düzeltme', () => {
  const words = [W('Abdullah', 0, 0.97), W('Kabukçu', 0.4, 0.31), W('geldi.', 0.8, 0.9), W('kabukçu', 1.2, 0.4), W('ve', 1.6, 0.2), W('...', 2, 0.1)]
  const t: Transcript = { id: 't', assetId: 'a', language: 'tr', model: 'm', provider: 'mock', audioTrack: 0, createdAt: '', durationSec: 10, words, segments: buildSegments(words) }

  it('eşiğin altındaki harfli kelimeler işaretlenir', () => {
    expect(uncertainIndexes(words, 0.5)).toEqual([1, 3, 4]) // noktalama-only atlanır
  })

  it('tek kelimeyi ya da tümünü düzeltir; ek ve noktalama korunur; özgün yazım saklanır', () => {
    const one = fixWord(t, 1, 'Kavukçu')
    expect(one.replaced).toBe(1)
    expect(one.transcript.words[1]).toMatchObject({ text: 'Kavukçu', corrected: 'Kabukçu', confidence: 1 })
    expect(one.transcript.words[3].text).toBe('kabukçu')
    const all = fixWord(t, 1, 'Kavukçu', true)
    expect(all.replaced).toBe(2)
    expect(all.transcript.words.map((w) => w.text).slice(0, 4)).toEqual(['Abdullah', 'Kavukçu', 'geldi.', 'Kavukçu'])
    // cümle metinleri güncellenir, kelime zamanları aynı kalır
    expect(all.transcript.segments.map((s) => s.text).join(' ')).toContain('Kavukçu')
    expect(all.transcript.words.map((w) => w.start)).toEqual(words.map((w) => w.start))
    // kesme işaretli ek korunur
    const t2 = { ...t, words: [W("Kabukçu'nun", 0), W('kabukçunun', 1)] }
    const r = fixWord(t2, 0, 'Kavukçu', true)
    expect(r.transcript.words.map((w) => w.text)).toEqual(["Kavukçu'nun", 'Kavukçunun'])
  })
})

describe('yerleşik (futbol) sözlüğü ve bölünmüş terimler', () => {
  const W2 = (text: string, i: number, conf = 0.4) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4, confidence: conf })
  const soft = ['Osimhen', 'Galatasaray', 'Lemina', 'Barış Alper Yılmaz', 'Icardi']
  it('yanlış yazılmış özel ad düzeltilir, ek korunur; küçük harfli ve emin olunan sıradan sözcüğe dokunulmaz', () => {
    const r = applyVocabulary([W2("Osimen'in", 0), W2('golü', 1, 0.9), W2('Lemine', 2), W2('limon', 3, 0.9), W2('icardi', 4, 0.9)], [], soft)
    expect(r.words.map((w) => w.text)).toEqual(["Osimhen'in", 'golü', 'Lemina', 'limon', 'icardi'])
    expect(r.words[0].corrected).toBe("Osimen'in")
  })
  it('bölünmüş terim birleşir: "Galata saray" → "Galatasaray"; zamanlar korunur; farklı kelimeler birleşmez', () => {
    const r = applyVocabulary([W2('Galata', 0), W2("saray'da", 1), W2('maç', 2, 0.9), W2('var', 3, 0.9)], [], soft)
    expect(r.words.map((w) => w.text)).toEqual(["Galatasaray'da", 'maç', 'var'])
    expect(r.words[0].start).toBe(0)
    expect(r.words[0].end).toBeCloseTo(0.9, 5)
    const same = applyVocabulary([W2('bu', 0, 0.9), W2('akşam', 1, 0.9)], [], soft)
    expect(same.words).toHaveLength(2)
  })
  it('kullanıcı sözlüğü yine önceliklidir (eski davranış bozulmaz)', () => {
    expect(applyVocabulary([W2('kabukçu', 0)], ['Kavukçu']).words[0].text).toBe('Kavukçu')
  })
})

describe('sözlük düzeltme hızı', () => {
  it('uzun yayın (30 bin kelime) ve büyük yerleşik sözlük (1500 terim) saniyeler içinde biter; aynı kelimeler önbelleğe alınır', () => {
    const soft = Array.from({ length: 1500 }, (_, i) => `Oyuncu${String.fromCharCode(97 + (i % 26))}${i}son Takimadi${i}`)
    const base = ['Osimhen', 'galatasaray', 'şimdi', 'arkadaşlar', 'Lemina', 'konuşuyoruz', 'Batrakov', 'maç', 'çok', 'gerçekten', 'Zaha', 'bence', 'yani', 'Barış', 'Alper', 'Yılmaz']
    const words = Array.from({ length: 30000 }, (_, i) => ({ text: base[i % 16] + (i % 97 === 0 ? 'x' : ''), start: i * 0.4, end: i * 0.4 + 0.3, confidence: 1 }))
    const t0 = Date.now()
    applyVocabulary(words, ['Osimhen', 'Lemina'], soft)
    expect(Date.now() - t0).toBeLessThan(5000) // önceden dakikalar sürüyordu
  })
})
