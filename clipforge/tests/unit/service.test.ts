import { describe, expect, it } from 'vitest'
import { SearchService } from '@shared/search/service'
import { cosine, buildSemanticWindows } from '@shared/search/semantic'
import { estimateOffsetSec } from '@shared/media/sync'
import { normalizeSettings, DEFAULT_SETTINGS } from '@shared/settings'
import { indexFromLines, longTranscriptLines, makeTranscript } from './helpers'

/** Deterministik sahte gömme: sözcük torbası (hash) */
const fake = {
  id: 'fake',
  async embed(texts: string[]) {
    return texts.map((t) => {
      const v = new Array(64).fill(0)
      for (const w of t.toLowerCase().match(/\p{L}+/gu) ?? []) {
        let h = 0
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 64
        v[h] += 1
      }
      return v
    })
  }
}

describe('SearchService', () => {
  const lines = longTranscriptLines(900, [
    { at: 300, text: 'Dün gece arkadaşımla çok kavga ettik ve ona çok kızdım.' },
    { at: 306, text: 'Sinirden ellerim titriyordu gerçekten.' }
  ])
  const { words } = indexFromLines(lines)
  const t = makeTranscript(words)

  it('sözcük araması ve yoksa anlamlı hata', async () => {
    const s = new SearchService()
    expect(() => s.lexical('x', 'a')).toThrow(/transkript/)
    s.load('a1', t)
    expect((await s.search('a1', 'kavga')).length).toBe(1)
  })

  it('anlamsal arama kapalıysa sağlayıcı istenmez; açıksa ve yoksa açık hata verir', async () => {
    const s = new SearchService()
    s.load('a1', t)
    await expect(s.search('a1', 'kızdım', {}, true)).rejects.toThrow(/sağlayıcı/)
  })

  it('anlamsal sonuçlar sözcük sonuçlarıyla birleşir', async () => {
    const s = new SearchService(() => fake)
    s.load('a1', t)
    const r = await s.search('a1', 'çok kızdım ona', {}, true)
    expect(r.some((x) => Math.abs(x.start - 300) < 12)).toBe(true)
    const times = r.map((x) => x.start)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('yardımcılar', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(buildSemanticWindows(t.segments).length).toBeGreaterThan(10)
  })
})

describe('kamera/ekran senkronu', () => {
  it('ses zarflarındaki ofseti bulur', () => {
    const rate = 100
    const env = (n: number, shift: number) =>
      Float32Array.from({ length: n }, (_, i) => {
        const t = i - shift
        // seyrek "alkış" darbeleri
        return [200, 530, 910, 1500, 2100].some((p) => Math.abs(t - p) < 6) ? 1 : 0.05 * Math.sin(i)
      })
    const a = env(3000, 0)
    const b = env(3000, 137) // b, 1.37 sn geriden
    const r = estimateOffsetSec(a, b, rate, 5)
    expect(r.offsetSec).toBeCloseTo(1.37, 1)
    expect(r.confidence).toBeGreaterThan(0.3)
    expect(estimateOffsetSec(b, a, rate, 5).offsetSec).toBeCloseTo(-1.37, 1)
  })
})

describe('ayarlar', () => {
  it('eksik/yanlış tipli alanlar varsayılana döner, değerler sınırlanır', () => {
    const s = normalizeSettings({ language: 'en', fuzzyThreshold: 5, preRollSec: 'x', bilinmeyen: 1 })
    expect(s.language).toBe('en')
    expect(s.fuzzyThreshold).toBe(1)
    expect(s.preRollSec).toBe(DEFAULT_SETTINGS.preRollSec)
    expect('bilinmeyen' in s).toBe(false)
    expect(DEFAULT_SETTINGS.language).toBe('tr')
  })
})
