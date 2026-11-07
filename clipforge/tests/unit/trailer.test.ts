import { describe, expect, it } from 'vitest'
import { TRAILER_MAX_SEG, TRAILER_MIN_SEG, autoSegments, parseClock, planShots, scoreSentence, validateSegments, type TrailerSegment } from '@shared/trailer'
import type { TranscriptWord } from '@shared/types'

const seg = (id: string, start: number, end: number): TrailerSegment => ({ id, kind: 'timeline', start, end })

/** cümleler [metin, başlangıç]: kelimeler 0,4 sn aralıkla */
function words(lines: [string, number][]): TranscriptWord[] {
  const out: TranscriptWord[] = []
  for (const [text, t0] of lines) {
    text.split(' ').forEach((w, i) => out.push({ text: w, start: t0 + i * 0.42, end: t0 + i * 0.42 + 0.38, confidence: 1 }))
  }
  return out
}

describe('fragman: parça doğrulama', () => {
  it('her parça 10–60 sn olmalı; boş liste reddedilir', () => {
    expect(validateSegments([])).toMatch(/en az bir parça/)
    expect(validateSegments([seg('a', 0, 9)])).toMatch(/en az 10/)
    expect(validateSegments([seg('a', 0, 61)])).toMatch(/en çok 60/)
    expect(validateSegments([seg('a', 0, TRAILER_MIN_SEG), seg('b', 100, 100 + TRAILER_MAX_SEG)])).toBeNull()
  })
})

describe('fragman: an seçimi', () => {
  it('vurgulu/soru/sayılı cümle sıradan cümleden yüksek puan alır', () => {
    expect(scoreSentence('Vay canına, bu inanılmaz bir manzara!')).toBeGreaterThan(scoreSentence('Sonra biraz yürüdük ve oturduk bir yere'))
    expect(scoreSentence('Evet')).toBeLessThan(scoreSentence('Paris\'e 3 saatte vardık ve çok şaşırdık!'))
  })

  it('en güçlü an başa (kanca) alınır; planlar parçaların içinde; toplam süre hedefe yakın; her parçadan en az bir plan', () => {
    const a = seg('a', 0, 30)
    const b = seg('b', 100, 130)
    const w = words([
      ['Bugün sıradan bir yerde oturduk biraz', 2],
      ['Sonra kahve içip bir süre bekledik burada', 12],
      ['Vay canına bu inanılmaz bir manzara!', 105],
      ['Daha sonra yavaşça eve doğru yürüdük hep birlikte', 118]
    ])
    const shots = planShots([a, b], () => w, { targetSec: 20, endCardSec: 3 })
    expect(shots[0].text).toMatch(/inanılmaz/) // kanca
    expect(new Set(shots.map((s) => s.segmentId)).size).toBe(2)
    for (const s of shots) {
      const parent = s.segmentId === 'a' ? a : b
      expect(s.a).toBeGreaterThanOrEqual(parent.start - 1e-6)
      expect(s.b).toBeLessThanOrEqual(parent.end + 1e-6)
      expect(s.b - s.a).toBeGreaterThanOrEqual(1.5)
      expect(s.b - s.a).toBeLessThanOrEqual(10)
    }
    const total = shots.reduce((n, s) => n + (s.b - s.a), 0)
    expect(total).toBeLessThan(30)
    expect(total).toBeGreaterThan(8)
  })

  it('konuşma/transkript yoksa parçanın içinden eşit aralıklı planlar alınır', () => {
    const shots = planShots([seg('a', 50, 80), seg('b', 200, 230)], () => [], { targetSec: 30 })
    expect(shots.length).toBeGreaterThanOrEqual(2)
    expect(shots.every((s) => (s.a >= 50 && s.b <= 80) || (s.a >= 200 && s.b <= 230))).toBe(true)
  })
})

describe('fragman: klip seç (olduğu gibi), otomatik, zaman yazımı', () => {
  it('exact: 2–60 sn klipler kabul edilir (1:10–1:20 gibi 10 sn); 1 sn ya da 61 sn reddedilir; otomatik moda doğrulama yok', () => {
    expect(validateSegments([seg('a', 70, 80)], 'exact')).toBeNull()
    expect(validateSegments([seg('a', 70, 71)], 'exact')).toMatch(/en az 2/)
    expect(validateSegments([seg('a', 0, 61)], 'exact')).toMatch(/en çok 60/)
    expect(validateSegments([seg('a', 70, 75)], 'moments')).toMatch(/en az 10/) // parça modunda 10 sn şartı sürer
    expect(validateSegments([], 'auto')).toBeNull()
    expect(validateSegments([], 'exact')).toMatch(/en az bir klip/)
  })
  it('exact: planlar tam olarak seçilen aralıklardır ve verilen sıradadır (kanca yeniden sıralaması yok)', () => {
    const s = [seg('x', 300, 312), seg('y', 70, 80)]
    const shots = planShots(s, () => [], { mode: 'exact' })
    expect(shots.map((h) => [h.a, h.b])).toEqual([[300, 312], [70, 80]])
  })
  it('otomatik: vlog eşit bölgelere ayrılır, baştan/sondan pay bırakılır, bölgeler çakışmaz', () => {
    const z = autoSegments(1800, 45)
    expect(z.length).toBeGreaterThanOrEqual(5)
    expect(z[0].start).toBeGreaterThan(0)
    expect(z[z.length - 1].end).toBeLessThan(1800)
    for (let i = 1; i < z.length; i++) expect(z[i].start).toBeCloseTo(z[i - 1].end, 5)
  })
  it('parseClock: dk:sn, saat:dk:sn, saniye, virgüllü; anlaşılmayan null', () => {
    expect(parseClock('1:10')).toBe(70)
    expect(parseClock('01:10:05')).toBe(4205)
    expect(parseClock('70')).toBe(70)
    expect(parseClock('70,5')).toBe(70.5)
    expect(parseClock('abc')).toBeNull()
    expect(parseClock('')).toBeNull()
    expect(parseClock('1:2:3:4')).toBeNull()
  })
})
