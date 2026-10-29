import { describe, expect, it } from 'vitest'
import { parseTimecode } from '@shared/text'
import { cutBoundsForWords, timelineWords, wordIndexAt } from '@shared/timeline/transcript'
import { createDefaultTimeline } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { buildSegments } from '@shared/transcript/sentences'
import type { Clip, Transcript } from '@shared/types'
import { wordsFromLines } from './helpers'

const words = wordsFromLines([{ at: 100, text: 'Bir iki üç dört beş altı yedi sekiz.' }], 0.5)
const tr: Transcript = { id: 't', assetId: 'a1', language: 'tr', model: 'm', provider: 'mock', audioTrack: 0, createdAt: '', durationSec: 200, words, segments: buildSegments(words) }
const mk = (id: string, trackId: string, start: number, srcIn: number, srcOut: number, extra: Partial<Clip> = {}): Clip => ({ id, trackId, assetId: 'a1', start, srcIn, srcOut, volume: 1, label: id, ...extra })

function tl() {
  let t = createDefaultTimeline()
  t = ops.addClip(t, 'V1', mk('v', 'V1', 0, 100, 104, { groupId: 'g' }))
  t = ops.addClip(t, 'A2', mk('a', 'A2', 0, 100, 104, { groupId: 'g', audioStream: 0 }))
  return t
}

describe('zaman damgası ayrıştırma', () => {
  it('çeşitli biçimler', () => {
    expect(parseTimecode('23:14')).toBe(1394)
    expect(parseTimecode('1:02:03')).toBe(3723)
    expect(parseTimecode('754.5')).toBe(754.5)
    expect(parseTimecode(' 12:05,5 ')).toBe(725.5)
    expect(parseTimecode('99:99')).toBeNull()
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('')).toBeNull()
  })
})

describe('zaman çizelgesi transkripti', () => {
  it('yalnızca kullanılan aralığın kelimeleri; görüntü+ses aynı kaynaktan olsa da tekrar yok; çizelge zamanında', () => {
    const w = timelineWords(tl(), { a1: tr })
    expect(w.map((x) => x.text)).toEqual(['Bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz.'].slice(0, w.length))
    expect(w.length).toBeGreaterThanOrEqual(7) // 4 sn × 2 kelime/sn
    expect(w[0].start).toBeCloseTo(0)
    expect(w.at(-1)!.end).toBeLessThanOrEqual(4.0001)
  })

  it('kırpılmış ve kaydırılmış klip: zaman çizelgesi zamanı klibin yerine göre', () => {
    const t = ops.moveClip(tl(), 'v', 10)
    const w = timelineWords(t, { a1: tr })
    expect(w[0].start).toBeCloseTo(10)
    expect(timelineWords(tl(), {})).toEqual([])
  })

  it('kelimeden kesme: kelimeler gider, sonrası kayar, bağlı klipler birlikte kesilir', () => {
    const t0 = tl()
    const w = timelineWords(t0, { a1: tr })
    const [a, b] = cutBoundsForWords(w, 2, 3) // "üç dört"
    expect(a).toBeLessThanOrEqual(w[2].start)
    expect(b).toBeGreaterThanOrEqual(w[3].end)
    const t1 = ops.cutRange(t0, a, b)
    const after = timelineWords(t1, { a1: tr }).map((x) => x.text)
    expect(after).not.toContain('üç')
    expect(after).not.toContain('dört')
    expect(after.slice(0, 3)).toEqual(['Bir', 'iki', 'beş'])
    expect(t1.tracks.find((x) => x.id === 'V1')!.clips).toHaveLength(2)
    expect(t1.tracks.find((x) => x.id === 'A2')!.clips).toHaveLength(2)
    // sonraki kelime kayıp boşlukla değil, hemen ardından başlar
    const w1 = timelineWords(t1, { a1: tr })
    expect(w1[2].start - w1[1].end).toBeLessThan(0.6)
  })

  it('başta ve sonda kesme sınırları', () => {
    const w = timelineWords(tl(), { a1: tr })
    const [a0] = cutBoundsForWords(w, 0, 0)
    expect(a0).toBeGreaterThanOrEqual(0)
    const [, bEnd] = cutBoundsForWords(w, w.length - 1, w.length - 1)
    expect(bEnd).toBeGreaterThan(w.at(-1)!.end)
  })

  it('wordIndexAt: oynatma başlığındaki kelime', () => {
    const w = timelineWords(tl(), { a1: tr })
    expect(wordIndexAt(w, 0.1)).toBe(0)
    expect(wordIndexAt(w, 1.3)).toBe(2)
    expect(wordIndexAt(w, -1)).toBe(-1)
  })
})
