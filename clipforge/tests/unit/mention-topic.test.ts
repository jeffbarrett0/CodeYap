import { describe, expect, it } from 'vitest'
import { findMentionClips } from '../../src/shared/clipsearch'

/** cümleler: [metin, başlangıç sn]; her cümle 5 sn, kelimeler eşit aralıklı */
function words(sents: [string, number][]) {
  const out: { text: string; start: number; end: number; confidence: number }[] = []
  for (const [t, at] of sents) {
    const ws = t.split(' ')
    ws.forEach((w, i) => out.push({ text: w, start: at + (i * 4.5) / ws.length, end: at + ((i + 1) * 4.5) / ws.length - 0.05, confidence: 0.9 }))
  }
  return out
}

describe('isimle klip: konunun gerçek başı', () => {
  it('isim konuşmanın ortasında geçse de klip konunun başlangıcındaki duraktan başlar (30. saniyeden değil)', () => {
    const s: [string, number][] = []
    // 0–60: başka konu, sonra 1,6 sn duraklama; 64'te yeni konu başlar, isim 92'de geçer; 125'te konu biter, 128'de duraklama sonrası başka konu
    for (let t = 0; t < 60; t += 5.2) s.push([`Başka bir konudan bahsediyorum şimdi ${t.toFixed(0)}.`, t])
    for (let t = 64; t < 88; t += 5.2) s.push([`Maçta bir pozisyon vardı hatırlıyor musunuz bunu ${t.toFixed(0)}.`, t])
    s.push(['Deniz Gül gerçekten çok iyi oynadı bence.', 90])
    for (let t = 95.2; t < 123; t += 5.2) s.push([`Deniz Gül hakkında devam edeyim bakın ${t.toFixed(0)}.`, t])
    for (let t = 130; t < 160; t += 5.2) s.push([`Tamamen farklı bir konuya geçtik artık ${t.toFixed(0)}.`, t])
    const c = findMentionClips(words(s), 'Deniz Gül', { minSec: 20 })
    expect(c.length).toBeGreaterThanOrEqual(1)
    expect(c[0].start).toBeGreaterThan(55)
    expect(c[0].start).toBeLessThan(70) // konunun başı (≈62), ismin geçtiği 92'den değil
    expect(c[0].end).toBeGreaterThan(118)
    expect(c[0].end).toBeLessThan(135) // sonraki konuya taşmaz
  })
})

describe('isimle klip: az ve uzun', () => {
  it('birbirine yakın (≤60 sn) anışlar 2 dk 58 sn\'ye sığdığı sürece TEK klip olur', () => {
    const s: [string, number][] = []
    for (let t = 0; t < 200; t += 5.2) s.push([t > 20 && t < 30 || t > 70 && t < 80 || t > 120 && t < 130 ? `Deniz Gül şunu yaptı bakın ${t.toFixed(0)}.` : `Başka konu anlatıyorum şimdi ${t.toFixed(0)}.`, t])
    const c = findMentionClips(words(s), 'Deniz Gül', { minSec: 20 })
    expect(c.length).toBe(1)
    expect(c[0].durationSec).toBeGreaterThan(100)
    expect(c[0].durationSec).toBeLessThanOrEqual(178.01)
  })
})
