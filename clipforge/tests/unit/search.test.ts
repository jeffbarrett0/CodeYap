import { describe, expect, it } from 'vitest'
import { searchTranscript, TranscriptIndex } from '@shared/search/engine'
import { indexFromLines, longTranscriptLines, wordsFromLines } from './helpers'
import { buildSegments } from '@shared/transcript/sentences'

// 23:14, 41:02 ve 41:30 civarında konuşma geçiyor; 23:14 ve 41:02/41:30 farklı bölümler.
const INJECT = [
  { at: 23 * 60 + 14, text: "Geçen sene Victor Nelson'dan bahsetmiştim hatırlıyor musunuz." },
  { at: 23 * 60 + 20, text: 'Adam gerçekten çok komik bir tipti.' },
  { at: 41 * 60 + 2, text: 'Viktor Nelsen diye bir yayıncı vardı ya.' },
  { at: 41 * 60 + 30, text: 'Victor Nelson yine geldi.' },
  { at: 50 * 60, text: 'Victor bugün yayına gelmedi.' },
  { at: 50 * 60 + 40, text: 'Nelson ise başka bir hikaye.' },
  { at: 55 * 60, text: 'Sadece Nelson geçiyor burada.' }
]

describe('arama motoru', () => {
  const { index, words } = indexFromLines(longTranscriptLines(3600, INJECT))

  it('1 saatlik kayıtta (~7 bin kelime) hızlı çalışır', () => {
    expect(words.length).toBeGreaterThan(6000)
    const t0 = performance.now()
    const r = searchTranscript(index, 'Victor Nelson')
    const dt = performance.now() - t0
    expect(r.length).toBeGreaterThan(0)
    expect(dt).toBeLessThan(250)
  })

  it('"Victor Nelson" tüm geçişleri zamana göre sıralı listeler', () => {
    const r = searchTranscript(index, 'Victor Nelson')
    const starts = r.map((x) => Math.round(x.start))
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(starts.some((s) => Math.abs(s - (23 * 60 + 14)) < 4)).toBe(true) // ek almış biçim: Nelson'dan
    expect(starts.some((s) => Math.abs(s - (41 * 60 + 2)) < 4)).toBe(true) // yazım hatası
    expect(starts.some((s) => Math.abs(s - (41 * 60 + 30)) < 4)).toBe(true)
    // 41:02 ve 41:30 arası 28 sn: ayrı bölümler
    expect(r.filter((x) => x.start > 40 * 60 && x.start < 42 * 60).length).toBe(2)
  })

  it('yazım hatalı sorgu "Viktor Nelsen" aynı bölümleri bulur', () => {
    const a = searchTranscript(index, 'Victor Nelson').map((x) => Math.round(x.start))
    const b = searchTranscript(index, 'Viktor Nelsen').map((x) => Math.round(x.start))
    expect(b).toEqual(a)
  })

  it('serbest cümle sorgusu dolgu sözcükleri atarak çalışır', () => {
    const a = searchTranscript(index, 'Victor Nelson').map((x) => Math.round(x.start))
    const b = searchTranscript(index, 'Victor Nelson ile ilgili konuştuğum yer').map((x) => Math.round(x.start))
    expect(b).toEqual(a)
  })

  it('büyük/küçük harf ve Türkçe karakterlere duyarsızdır', () => {
    const r = searchTranscript(index, 'GEÇEN SENE')
    expect(r.length).toBeGreaterThan(0)
    const r2 = searchTranscript(index, 'gecen sene')
    expect(r2.map((x) => x.start)).toEqual(r.map((x) => x.start))
    expect(searchTranscript(index, 'kahvemi alip').length).toBeGreaterThan(0)
  })

  it('pencere dışındaki ayrı kelimeler tam eşleşme sayılmaz; kısmi sonuç düşük skorlu ve işaretlidir', () => {
    const r = searchTranscript(index, 'Victor Nelson')
    // 50:00 "Victor" ve 50:40 "Nelson" 40 sn arayla: pencere (10 sn) dışında
    expect(r.every((x) => Math.abs(x.start - 50 * 60) > 5 || x.missingTerms === undefined)).toBe(true)
    const strict = r.filter((x) => !x.missingTerms)
    expect(strict.length).toBeGreaterThanOrEqual(3)
  })

  it('pencere genişletilince uzaktaki kelimeler birleşir', () => {
    const narrow = searchTranscript(index, 'Victor Nelson', { windowSec: 5, allowPartial: false })
    const wide = searchTranscript(index, 'Victor Nelson', { windowSec: 60, allowPartial: false })
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length)
    expect(wide.some((x) => Math.abs(x.start - 50 * 60) < 3)).toBe(true)
  })

  it('aynı konuşma bölümündeki tekrarlar tek sonuçta birleşir', () => {
    const lines = [
      { at: 10, text: 'Ahmet geldi. Ahmet gitti. Ahmet yine geldi çok garip.' },
      { at: 300, text: 'Başka bir bölümde Ahmet tekrar çıktı.' }
    ]
    const { index: idx } = indexFromLines(lines)
    const r = searchTranscript(idx, 'Ahmet')
    expect(r).toHaveLength(2)
    expect(r[0].matchCount).toBe(3)
    expect(r[1].matchCount).toBe(1)
  })

  it('bağlam: önceki/sonraki cümleler ve cümle metni döner', () => {
    const r = searchTranscript(index, 'Victor Nelson')[0]
    expect(r.sentence).toContain('Victor Nelson')
    expect(r.before.length).toBeGreaterThan(0)
    expect(r.after[0]).toContain('Adam gerçekten')
    expect(r.score).toBeGreaterThan(0.8)
    expect(r.matchedWords.map((m) => m.text.toLowerCase()).join(' ')).toContain('victor')
  })

  it('eşik ayarı: sıkı eşik yazım hatalarını eler', () => {
    const loose = searchTranscript(index, 'Viktor Nelsen', { fuzzyThreshold: 0.8, allowPartial: false })
    const strict = searchTranscript(index, 'Viktor Nelsen', { fuzzyThreshold: 0.99, fuzzy: true, allowPartial: false })
    expect(loose.length).toBeGreaterThan(0)
    expect(strict.length).toBeLessThan(loose.length)
    const off = searchTranscript(index, 'Viktor Nelsen', { fuzzy: false, allowPartial: false })
    expect(off.length).toBeLessThanOrEqual(strict.length)
  })

  it('olmayan bir sözcük boş döner, boş sorgu boş döner', () => {
    expect(searchTranscript(index, 'zzyzxqwerty')).toEqual([])
    expect(searchTranscript(index, '   ')).toEqual([])
  })

  it('kısa sözcüklerde bulanık eşleşme yapılmaz', () => {
    const words = wordsFromLines([{ at: 0, text: 'Bu araba kırmızı.' }])
    const idx = new TranscriptIndex(words, buildSegments(words))
    expect(searchTranscript(idx, 'ara', { allowPartial: false })).toEqual([])
  })
})
