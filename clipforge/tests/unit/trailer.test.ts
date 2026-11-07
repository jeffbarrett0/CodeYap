import { describe, expect, it } from 'vitest'
import { TRAILER_MAX_SEG, TRAILER_MIN_SEG, planShots, scoreSentence, validateSegments, type TrailerSegment } from '@shared/trailer'
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
