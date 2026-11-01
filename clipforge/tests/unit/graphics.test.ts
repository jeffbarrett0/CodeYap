import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findPlace, key, orthographic, placesInText, slerp, toVec, fromVec, type World } from '@shared/graphics/geo'
import { buildChart, buildGlobe, buildMap, buildTitle, DEFAULT_SCENE, strokePolygon } from '@shared/graphics/scenes'

const world = JSON.parse(readFileSync(join(process.cwd(), 'resources/world.json'), 'utf8')) as World
const base = { ...DEFAULT_SCENE, width: 1080, height: 1920, durationSec: 2 }

describe('yer çözümleme', () => {
  it('Türkçe/aksan duyarsız: ülke, şehir, takma ad, koordinat', () => {
    expect(key('İSTANBUL\'a')).toBe('istanbul a')
    expect(findPlace(world, 'türkiye')).toMatchObject({ iso: 'TUR', name: 'Türkiye' })
    expect(findPlace(world, 'Turkey')?.iso).toBe('TUR')
    expect(findPlace(world, 'istanbul')).toMatchObject({ iso: 'TUR', lon: 28.98 })
    expect(findPlace(world, 'Almanya')?.iso).toBe('DEU')
    expect(findPlace(world, 'ABD')?.iso).toBe('USA')
    expect(findPlace(world, '28.9,41.0')).toMatchObject({ lon: 28.9, lat: 41 })
    expect(findPlace(world, 'Atlantis')).toBeNull()
  })
  it('cümledeki yerleri eklerle birlikte bulur', () => {
    const names = placesInText(world, "Geçen yıl Londra'dan kalkıp Türkiye'ye gittim, sonra İstanbul'da kaldım").map((p) => p.name)
    expect(names).toEqual(['Londra', 'Türkiye', 'İstanbul'])
    expect(placesInText(world, 'bugün hava çok güzel')).toEqual([])
  })
  it('veri: 170+ ülke, Türkiye çokgeni var', () => {
    expect(world.countries.length).toBeGreaterThan(170)
    expect(world.countries.find((c) => c.iso === 'TUR')!.polys.length).toBeGreaterThan(0)
  })
})

describe('izdüşüm', () => {
  it('ortografik: merkez noktası ortada ve ön yüzde; karşı yüz arkada', () => {
    const c = orthographic(30, 40, 30, 40)
    expect(c.x).toBeCloseTo(0)
    expect(c.y).toBeCloseTo(0)
    expect(c.cosc).toBeCloseTo(1)
    expect(orthographic(30 + 180, -40, 30, 40).cosc).toBeLessThan(0)
  })
  it('büyük daire: uçlar korunur, orta nokta iki ucun ortasında', () => {
    const a = toVec(0, 51.5)
    const b = toVec(29, 41)
    const m = fromVec(slerp(a, b, 0.5))
    expect(m.lon).toBeGreaterThan(5)
    expect(m.lon).toBeLessThan(25)
    const e = fromVec(slerp(a, b, 1))
    expect(e.lon).toBeCloseTo(29, 3)
  })
  it('kalın çizgi çokgeni 2×nokta üretir', () => {
    expect(strokePolygon([[0, 0], [10, 0], [20, 5]], 4)).toHaveLength(6)
  })
})

describe('sahne üretimi (ASS)', () => {
  const to = findPlace(world, 'Türkiye')!
  const from = findPlace(world, 'Londra')!
  it('3D küre: her kare için ayrı olay; hedef ülke vurgulu; etiket var', () => {
    const ass = buildGlobe({ ...base, type: 'globe', to, from }, world)
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(events.length).toBeGreaterThan(60 * 3) // 2 sn × 30 kare × çok katman
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('Türkiye') // etiket
    expect(ass).toMatch(/\\1c&H0000E6FF&/) // vurgu rengi (sarı)
    expect(buildGlobe({ ...base, type: 'globe', to, from }, world)).toBe(ass) // deterministik
  })
  it('2D harita: rota çizgisi ve işaretçi; yakınlaşma kare kare değişir', () => {
    const ass = buildMap({ ...base, type: 'map', to: findPlace(world, 'İstanbul')!, from }, world)
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length).toBeGreaterThan(200)
    expect(ass).toContain('İstanbul')
  })
  it('başlık ve grafik', () => {
    expect(buildTitle({ ...base, type: 'title', text: '3. GÜN', sub: 'Yolculuk' })).toContain('3. GÜN')
    const c = buildChart({ ...base, type: 'chart', title: 'Gol', data: [{ label: 'A', value: 5 }, { label: 'B', value: 10 }] })
    expect(c).toContain('Gol')
    expect(c.match(/\\fscx1\\t\(0,\d+,\\fscx100\)/g)).toHaveLength(2) // çubuklar büyür
  })
})
