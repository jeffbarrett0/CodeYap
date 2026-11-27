import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitForButtons, ctaRect, ctaSequence, ctaTimes, ctaTimesEvery, defaultCtaSize, parseCtaManifest, youtubeCtaSize, verticalCtaRect } from '@shared/cta'
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

  it('İLK BUTON 2. SANİYEDE, sonra HER 20 SN\'DE (kullanıcının kalıcı kararı); sona taşmaz; üst üste binmez', () => {
    expect(ctaTimesEvery(7)).toEqual([]) // buton (5,2 sn) sığmaz
    expect(ctaTimesEvery(8)).toEqual([2])
    expect(ctaTimesEvery(30)).toEqual([2]) // 30 sn'de tek buton (2. sn; ikincisi sığmaz)
    expect(ctaTimesEvery(62)).toEqual([2, 32])
    expect(ctaTimesEvery(600).length).toBe(20)
    for (const D of [8, 12, 20, 45, 60, 99, 178, 300, 1500, 3600]) {
      const t = ctaTimesEvery(D)
      expect(t[0]).toBe(2)
      for (let i = 0; i < t.length; i++) {
        expect(t[i] + 5.2).toBeLessThanOrEqual(D - 0.5 + 1e-6)
        if (i) expect(t[i] - t[i - 1]).toBeCloseTo(30, 5)
      }
    }
    // dikey: kullanıcının kırmızı ile işaretlediği yer (yatayda ortada, alt kenar %80'de)
    const vr = verticalCtaRect({ crop: { x: 0.17, y: 0.44, w: 0.66, h: 0.56 } }, 3840, 2160)
    expect(vr.x + vr.w / 2).toBeCloseTo(0.5, 5)
    expect(vr.y + vr.h).toBeCloseTo(0.8, 5)
    expect(vr.w).toBeCloseTo(0.72, 5)
    // yer: altta ortada (tam ortaya değil), küçük; dikeyde de alt orta
    for (const asp of ['16:9', '9:16']) {
      const r = ctaRect({ crop: { x: 0, y: 0, w: 1, h: 1 }, flushBottom: true }, 1280, 720, asp, { pos: 'bottom-center', size: youtubeCtaSize(asp) })
      expect(r.x + r.w / 2).toBeCloseTo(0.5, 5)
      expect(r.y + r.h).toBeCloseTo(1, 5) // alt kenara yapışık (alttan yükselir)
      expect(r.y).toBeGreaterThan(0.6) // ekranın alt kısmında, ortada değil
    }
    expect(youtubeCtaSize('16:9')).toBeLessThan(0.34)
  })

  it('(ESKİ kural, artık yalnızca vlog cta komutunda) YouTube yatay kesit: buton yerleri (kullanıcının örnekleri: 3 dk → 1. ve 2. dk; 8 dk → 2-4-6-7. dk; çok olmasın)', () => {
    expect(ctaTimes(15)).toEqual([]) // buton sığmaz
    expect(ctaTimes(60)).toEqual([30]) // 90 sn'den kısa: yine ortada 1
    expect(ctaTimes(90)).toEqual([45])
    expect(ctaTimes(120)).toEqual([60]) // ortada tek
    expect(ctaTimes(180)).toEqual([60, 120]) // 3 dk
    expect(ctaTimes(480)).toEqual([120, 240, 360, 420]) // 8 dk
    expect(ctaTimes(300)).toEqual([120, 240]) // 5 dk: 2., 4. (son 1 dk'ya taşmaz; 240 = 300-60)
    const long = ctaTimes(3600)
    expect(long.length).toBeLessThanOrEqual(9) // 1 saatlik kesit bile en çok ~8-9
    for (const D of [20, 60, 95, 150, 200, 241, 480, 900, 3600]) {
      const t = ctaTimes(D)
      for (let i = 0; i < t.length; i++) {
        expect(t[i] + 5).toBeLessThanOrEqual(D - 5) // buton kesitin sonuna taşmaz
        if (i) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(45) // butonlar üst üste binmez
      }
    }
  })

  it('uzun video: butonlar parçalara bölünür (parça başına ≤4), hiçbir buton iki parçaya düşmez, parçalar videoyu eksiksiz kaplar', () => {
    const D = 3 * 3600
    const times = ctaTimesEvery(D, 120) // GTA 6 yayın edit: 2. sn + her 2 dk
    expect(times[0]).toBe(2)
    const parts = splitForButtons(times, D)
    expect(parts.length).toBeGreaterThan(10)
    expect(parts[0].a).toBe(0)
    expect(parts[parts.length - 1].b).toBe(D)
    parts.forEach((p, i) => {
      expect(p.times.length).toBeLessThanOrEqual(4)
      if (i) expect(p.a).toBe(parts[i - 1].b)
      p.times.forEach((t) => expect(t + 5.2).toBeLessThanOrEqual(p.b - p.a + 1e-6)) // buton parça içinde biter
    })
    expect(parts.reduce((n, p) => n + p.times.length, 0)).toBe(times.length)
    expect(splitForButtons([2, 32], 60)).toEqual([{ a: 0, b: 60, times: [2, 32] }]) // kısa video tek parça
  })
})
