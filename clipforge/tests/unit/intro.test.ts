import { describe, expect, it } from 'vitest'
import { findIntro, frameCorrelation, INTRO_H, INTRO_W } from '@shared/intro'

const N = INTRO_W * INTRO_H
/** Referans: sol yarı koyu, sağda parlak "geri sayım" dairesi benzeri desen */
const ref = Uint8Array.from({ length: N }, (_, i) => {
  const x = i % INTRO_W
  const y = Math.floor(i / INTRO_W)
  return Math.hypot(x - 46, y - 18) < 12 ? 200 : x < 30 && y > 10 && y < 26 ? 230 : 20
})
/** Referansın geri sayım rakamı değişmiş hâli: dairenin ortasında küçük bölge farklı */
const variant = (k: number) => Uint8Array.from(ref, (v, i) => (Math.hypot((i % INTRO_W) - 46, Math.floor(i / INTRO_W) - 18) < 4 ? (v + 60 * k) % 256 : v))
/** Yayın içeriği: rastgele benzeri ama referanstan bağımsız */
const content = (s: number) => Uint8Array.from({ length: N }, (_, i) => ((i * 2654435761 + s * 97) >>> 7) % 256)

describe('yayın başı videosu tespiti', () => {
  it('korelasyon: aynı kare 1, rakamı değişen ~1, alakasız kare düşük, düz renk 0', () => {
    expect(frameCorrelation(ref, ref)).toBeCloseTo(1, 5)
    expect(frameCorrelation(ref, variant(1))).toBeGreaterThan(0.9)
    expect(frameCorrelation(ref, content(3))).toBeLessThan(0.3)
    expect(frameCorrelation(ref, new Uint8Array(N).fill(7))).toBe(0)
  })
  it('video başında 164 sn intro (geri sayım rakamı değişen) → ilk 164 sn kesilir', () => {
    const frames: Uint8Array[] = []
    for (let t = 0; t < 224; t++) frames.push(t < 164 ? variant(t % 5) : content(t))
    const d = findIntro(frames, ref, { durationSec: 164 })
    expect(d.found).toBe(true)
    expect(d.endSec).toBe(164)
    expect(d.firstMatch).toBe(0)
    expect(d.lastMatch).toBe(163)
  })
  it('intro ilk 36 sn farklı animasyon, sonra geri sayım ekranı: yine [0,164] kesilir (eşleşmeler yeterli ve başta)', () => {
    const frames: Uint8Array[] = []
    for (let t = 0; t < 224; t++) frames.push(t < 36 ? content(t) : t < 164 ? variant(t % 4) : content(t + 500))
    const d = findIntro(frames, ref, { durationSec: 164 })
    expect(d.found).toBe(true)
    expect(d.endSec).toBe(164)
  })
  it('intro süre ayarından uzunsa sonuna kadar kesilir', () => {
    const frames: Uint8Array[] = []
    for (let t = 0; t < 224; t++) frames.push(t < 190 ? variant(t % 3) : content(t))
    expect(findIntro(frames, ref, { durationSec: 164 }).endSec).toBe(190)
  })
  it('KESMEZ: intro yok, çok az eşleşme ya da eşleşme videonun ortasında', () => {
    const plain = Array.from({ length: 224 }, (_, t) => content(t))
    expect(findIntro(plain, ref).found).toBe(false)
    const few = plain.map((f, t) => (t < 3 ? ref : f))
    expect(findIntro(few, ref).found).toBe(false)
    const mid = plain.map((f, t) => (t > 200 && t < 215 ? ref : f))
    const dm = findIntro(mid, ref, { durationSec: 164 })
    expect(dm.found).toBe(false)
    expect(dm.reason).toMatch(/yayın başında değil/)
    expect(findIntro([], ref).found).toBe(false)
  })
  it('tanımsız seçenekler varsayılanı ezmez', () => {
    const frames = Array.from({ length: 200 }, (_, t) => (t < 164 ? variant(t % 5) : content(t)))
    expect(findIntro(frames, ref, { durationSec: undefined, threshold: undefined }).found).toBe(true)
  })
})
