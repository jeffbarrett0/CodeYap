import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ctaRect, ctaSequence, defaultCtaSize, parseCtaManifest } from '@shared/cta'
import { chromaFilter } from '@shared/export/plan'

const dir = join(__dirname, '..', '..', 'resources', 'cta')

describe('çağrı butonları: manifest ve yerleşim', () => {
  const m = parseCtaManifest(JSON.parse(readFileSync(join(dir, 'cta.json'), 'utf8')))!
  it('gerçek manifest geçerli: 4 buton, dosyaları var, yeşil perde rengi tanımlı', () => {
    expect(m).toBeTruthy()
    expect(m.buttons.map((b) => b.id).sort()).toEqual(['instagram', 'tiktok', 'twitter', 'youtube'])
    for (const b of m.buttons) expect(existsSync(join(dir, b.file)), b.file).toBe(true)
    expect(m.chroma).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
  it('sıra: YouTube iki kere sırada bir; döngü başa döner', () => {
    const seq = ctaSequence(m, 8).map((b) => b.id)
    expect(seq).toEqual(['youtube', 'tiktok', 'youtube', 'twitter', 'youtube', 'instagram', 'youtube', 'tiktok'])
  })
  it('yatayda alt-solda alt kenara yapışır (alttan yükselme), kare içinde; dikeyde genişlik neredeyse tam', () => {
    const e = m.buttons[0]
    const r = ctaRect(e, 3840, 2160, '16:9', {})
    expect(r.x).toBeCloseTo(0.03, 5)
    expect(r.y + r.h).toBeCloseTo(1, 5) // alt kenara yapışık
    expect(r.w).toBeCloseTo(defaultCtaSize('16:9'), 5)
    expect(r.h).toBeGreaterThan(0.2)
    expect(r.h).toBeLessThan(0.4)
    const v = ctaRect(e, 3840, 2160, '9:16', {})
    expect(v.w).toBeGreaterThan(0.85)
    expect(v.x + v.w).toBeLessThanOrEqual(1)
    expect(v.y + v.h).toBeLessThanOrEqual(1 + 1e-9)
    expect(ctaRect(e, 3840, 2160, '16:9', { pos: 'bottom-right' }).x).toBeGreaterThan(0.5)
  })
  it('bozuk/boş manifest reddedilir', () => {
    expect(parseCtaManifest(null)).toBeNull()
    expect(parseCtaManifest({ buttons: [] })).toBeNull()
    expect(parseCtaManifest({ buttons: [{ id: 'a' }] })).toBeNull()
  })
  it('yeşil perde filtresi: renk şeffaflaşır, yeşil yansıma giderilir', () => {
    const f = chromaFilter({ color: '#00fd00' })
    expect(f).toContain('chromakey=color=0x00FD00')
    expect(f).toContain('despill=type=green')
    expect(f.endsWith(',')).toBe(true)
  })
})
