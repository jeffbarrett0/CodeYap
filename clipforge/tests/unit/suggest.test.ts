import { describe, expect, it } from 'vitest'
import { scoreCandidates, snapCandidate, keywordStrength, DEFAULT_KEYWORDS } from '@shared/suggest/score'
import { parseMarkerFile, markersFromChapters } from '@shared/media/markers'
import { buildSegments } from '@shared/transcript/sentences'
import { wordsFromLines } from './helpers'
import type { ChatMessage } from '@shared/types'

function chatWithBurst(at: number, dur = 600): ChatMessage[] {
  const m: ChatMessage[] = []
  for (let t = 0; t < dur; t += 8) m.push({ t, user: 'u', text: 'x' })
  for (let i = 0; i < 70; i++) m.push({ t: at + i * 0.2, user: 'v', text: 'LUL' })
  return m
}
function audioWithSpike(at: number, dur = 600): number[] {
  return Array.from({ length: dur }, (_, i) => (i >= at && i < at + 4 ? -12 : -32 + Math.sin(i) * 1.2))
}

describe('otomatik öneri', () => {
  it('sohbet + ses sinyalleri çakışınca en üst aday olur ve gerekçeleri söyler', () => {
    const c = scoreCandidates('a1', { durationSec: 600, chat: chatWithBurst(300), audioDb: audioWithSpike(302) })
    expect(c.length).toBeGreaterThan(0)
    const top = [...c].sort((a, b) => b.score - a.score)[0]
    expect(top.peak).toBeGreaterThan(295)
    expect(top.peak).toBeLessThan(325)
    expect(top.reasons.map((r) => r.signal)).toEqual(expect.arrayContaining(['chat', 'audio']))
    expect(top.reasons.every((r) => r.label.length > 5)).toBe(true)
    expect(top.start).toBeLessThan(top.peak)
    expect(top.end).toBeGreaterThan(top.peak)
    expect(top.status).toBe('pending')
  })

  it('sohbet olmadan da yalnızca sesle aday üretir (skor tavanı düşmez)', () => {
    const c = scoreCandidates('a1', { durationSec: 600, audioDb: audioWithSpike(100) })
    expect(c[0]?.score).toBeGreaterThan(0.5)
    expect(c[0]?.reasons[0].signal).toBe('audio')
  })

  it('hiç sinyal yoksa boş döner', () => {
    expect(scoreCandidates('a1', { durationSec: 100 })).toEqual([])
    expect(scoreCandidates('a1', { durationSec: 600, audioDb: new Array(600).fill(-30) })).toEqual([])
  })

  it('yayıncı işareti güçlü bir sinyaldir', () => {
    const c = scoreCandidates('a1', { durationSec: 600, markers: [{ time: 200, label: 'komik', source: 'chapter' }] })
    expect(c).toHaveLength(1)
    expect(c[0].reasons[0].signal).toBe('marker')
    expect(c[0].reasons[0].label).toContain('komik')
  })

  it('anahtar kelime/kahkaha yoğunluğu', () => {
    const words = wordsFromLines([{ at: 50, text: 'ahahaha oha lan haha yok artık bu ne' }, { at: 400, text: 'sakin sakin devam ediyoruz' }])
    const k = keywordStrength(words, 600, DEFAULT_KEYWORDS)
    expect(Math.max(...k.strength.slice(45, 60))).toBeGreaterThan(0.8)
    expect(Math.max(...k.strength.slice(395, 410))).toBe(0)
  })

  it('aday sınırları cümleye yapıştırılır', () => {
    const words = wordsFromLines([{ at: 10, text: 'Birinci cümle burada bitiyor.' }, { at: 20, text: 'İkinci cümle ortada geçiyor.' }, { at: 30, text: 'Üçüncü cümle sonda.' }])
    const segs = buildSegments(words)
    const s = snapCandidate(segs, { id: 'c', assetId: 'a', start: 21, end: 31, peak: 25, score: 1, reasons: [], status: 'pending' }, 100)
    expect(s.start).toBeGreaterThan(19.5)
    expect(s.start).toBeLessThanOrEqual(20)
    expect(s.end).toBeGreaterThan(31)
  })
})

describe('işaretçiler', () => {
  it('JSON, CSV/TXT ve bölümleri okur', () => {
    expect(parseMarkerFile('[{"time": 12.5, "label": "güzel an"}, {"t": "01:00", "name": "x"}]')).toEqual([
      { time: 12.5, label: 'güzel an', source: 'sidecar' },
      { time: 60, label: 'x', source: 'sidecar' }
    ])
    expect(parseMarkerFile('00:01:05 komik\n[00:02:00] kavga\n')).toHaveLength(2)
    expect(markersFromChapters([{ start: 5, end: 9, title: 'Marker 1' }])[0]).toEqual({ time: 5, label: 'Marker 1', source: 'chapter' })
  })
  it('boş ya da bozuk dosya sessizce boş liste döner', () => {
    expect(parseMarkerFile('')).toEqual([])
    expect(parseMarkerFile('{bozuk json')).toEqual([])
    expect(parseMarkerFile('hiçbir şey anlaşılmıyor\nburada da yok')).toEqual([])
  })
})
