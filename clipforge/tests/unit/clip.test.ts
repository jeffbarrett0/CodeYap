import { describe, expect, it } from 'vitest'
import { suggestClip, nearestBoundary } from '@shared/clip/boundaries'
import { searchTranscript } from '@shared/search/engine'
import { buildSegments, segmentIndexAt } from '@shared/transcript/sentences'
import { indexFromLines, longTranscriptLines, wordsFromLines } from './helpers'

const INJECT = [{ at: 23 * 60 + 14, text: "Geçen sene Victor Nelson'dan bahsetmiştim hatırlıyor musunuz." }]
const { index, segments } = indexFromLines(longTranscriptLines(3600, INJECT))
const hit = searchTranscript(index, 'Victor Nelson')[0]

function startsOnSentenceBoundary(start: number) {
  // başlangıç hiçbir cümlenin içine (kenarlardan 0.2 sn ötede) düşmemeli
  const i = segmentIndexAt(segments, start)
  const seg = segments[i]
  if (!seg) return true
  const inside = start > seg.start + 0.2 && start < seg.end - 0.05
  return !inside
}
function endsOnSentenceBoundary(end: number) {
  const i = segmentIndexAt(segments, end - 0.01)
  const seg = segments[i]
  return !(end < seg.end - 0.05 && end > seg.start + 0.05)
}

describe('klip sınırı önerisi', () => {
  it('varsayılan 5 sn önce / 10 sn sonra, cümle sınırlarına yapışır', () => {
    const s = suggestClip(segments, hit, { assetDurationSec: 3600 })
    expect(s.start).toBeLessThanOrEqual(hit.start)
    expect(s.end).toBeGreaterThanOrEqual(hit.end)
    expect(hit.start - s.start).toBeGreaterThanOrEqual(0)
    expect(hit.start - s.start).toBeLessThan(5 + 6 + 1)
    expect(startsOnSentenceBoundary(s.start)).toBe(true)
    expect(endsOnSentenceBoundary(s.end)).toBe(true)
    expect(s.warnings.filter((w) => w.code === 'no_sentence_info')).toHaveLength(0)
  })

  it('hedef 30 sn: süre hedefi aşmaz, hedefe yakındır ve sınırlar cümlededir', () => {
    const s = suggestClip(segments, hit, { assetDurationSec: 3600, targetDurationSec: 30 })
    expect(s.duration).toBeLessThanOrEqual(30 + 1e-6)
    expect(s.duration).toBeGreaterThan(30 * 0.6)
    expect(s.start).toBeLessThanOrEqual(hit.start)
    expect(s.end).toBeGreaterThanOrEqual(hit.end)
    expect(startsOnSentenceBoundary(s.start)).toBe(true)
    expect(endsOnSentenceBoundary(s.end)).toBe(true)
  })

  it('hedefler 15/30/60 için uyarı yok ve süreler monoton artar', () => {
    const d = [15, 30, 60].map((t) => suggestClip(segments, hit, { assetDurationSec: 3600, targetDurationSec: t }))
    d.forEach((x, i) => expect(x.duration).toBeLessThanOrEqual([15, 30, 60][i] + 1e-6))
    expect(d[0].duration).toBeLessThanOrEqual(d[1].duration)
    expect(d[1].duration).toBeLessThanOrEqual(d[2].duration)
  })

  it('platform sınırı aşılırsa uyarır', () => {
    const s = suggestClip(segments, hit, { assetDurationSec: 3600, preRollSec: 40, postRollSec: 60, maxDurationSec: 60 })
    expect(s.warnings.map((w) => w.code)).toContain('exceeds_max')
  })

  it('eşleşme hedeften uzunsa uyarır', () => {
    const w = wordsFromLines([{ at: 10, text: Array(80).fill('kelime').join(' ') + '.' }], 0.4)
    const segs = buildSegments(w, { maxSentenceSec: 1000, maxWords: 1000 })
    const s = suggestClip(segs, { start: 10, end: 40, firstWord: 0, lastWord: 79 }, { assetDurationSec: 100, targetDurationSec: 15 })
    expect(s.warnings.map((x) => x.code)).toContain('hit_longer_than_target')
  })

  it('kaydın başında ve sonunda sınırlar taşmaz', () => {
    const w = wordsFromLines([{ at: 0.5, text: 'Merhaba Victor geldi.' }, { at: 4, text: 'Hoşça kalın arkadaşlar.' }])
    const segs = buildSegments(w)
    const s = suggestClip(segs, { start: 0.85, end: 1.2, firstWord: 1, lastWord: 1 }, { assetDurationSec: 6 })
    expect(s.start).toBeGreaterThanOrEqual(0)
    expect(s.end).toBeLessThanOrEqual(6)
  })

  it('cümle yoksa uyarı ile ham pre/post-roll kullanır', () => {
    const s = suggestClip([], { start: 100, end: 102, firstWord: 0, lastWord: 1 }, { assetDurationSec: 500 })
    expect(s.start).toBe(95)
    expect(s.end).toBe(112)
    expect(s.warnings[0].code).toBe('no_sentence_info')
  })

  it('nearestBoundary en yakın cümle başına/sonuna çeker', () => {
    const seg = segments[100]
    expect(Math.abs(nearestBoundary(segments, seg.start + 0.3, 'start') - seg.start)).toBeLessThan(0.2)
    expect(nearestBoundary(segments, seg.end - 0.1, 'end')).toBeGreaterThanOrEqual(seg.end)
  })
})
