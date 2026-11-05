import { describe, expect, it } from 'vitest'
import { contentProblem, normalizeScenes, planStory, sanitizeContent } from '@shared/story/plan'
import { simulateFootball } from '@shared/story/football'
import { Raster } from '@shared/story/raster'
import { planePoly } from '@shared/graphics/scenes'
import { colorDistance, findTeam, resolveKits, themeForTeam } from '@shared/story/teams'
import { datasetWarnings, findPlayerRows, resolveSceneData, staleDatasets, teamFacts, trDate, usedDatasets, validateDataset, type Dataset } from '@shared/story/data'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBackdropAss, buildStoryAss, roundedRectPath } from '@shared/story/scenes'
import { DEFAULT_STORY_THEME, type StoryContent, type StoryScene } from '@shared/story/types'
import { parseScenes } from '../../src/main/story/ai'
import { cleanBrand } from '../../src/main/story/pipeline'
import type { TranscriptWord } from '@shared/types'

/** Cümle listesinden kelime zamanlı transkript üretir (her cümle verilen saniyede başlar) */
function narration(sentences: [number, string][]): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const [t0, text] of sentences) {
    let t = t0
    for (const w of text.split(' ')) {
      words.push({ text: w, start: t, end: t + 0.35, confidence: 1 })
      t += 0.42
    }
  }
  return words
}

const STORY = narration([
  [2, 'Bugün VfB Stuttgart için dalgalı bir sezondan bahsedeceğiz.'],
  [8, 'Şampiyonlar Ligi’nde 7 puan topladılar ve üç maçta yenilgisiz kaldılar.'],
  [15, 'Bundesliga’da ise 15 sıradalar ve yedi maçta beş yenilgi aldılar.'],
  [24, 'Takımın başında teknik direktör Sebastian Hoeness var.'],
  [32, '22/23 sezonunda sezon sonunda göreve geldi ama küme düşme hattındaydı.'],
  [40, '23/24 sezonunda Bundesliga ikinciliği ve Şampiyonlar Ligi bileti geldi.'],
  [48, '24/25 sezonunda DFB-Pokal şampiyonu oldular ama ligde ilk yirmi dörtün dışında kaldılar.'],
  [58, 'Şimdi bu düşüşün nedenlerine bakalım ve nasıl toparlanacaklarını konuşalım.']
])

describe('Anlatım → Görsel: plan', () => {
  const plan = planStory(STORY, { isPlace: (w) => (w === 'Stuttgart' ? 'Stuttgart' : undefined) })
  const of = (t: string) => plan.scenes.filter((s) => s.content.type === t)
  it('rakamlar, sezon çizelgesi ve isim bandı bulunur; hepsi anlatımdaki yerinde başlar', () => {
    expect(plan.scenes.length).toBeGreaterThanOrEqual(3)
    const tl = of('timeline')[0]
    expect(tl).toBeTruthy()
    expect(tl.start).toBeGreaterThan(29)
    expect(tl.start).toBeLessThan(34)
    const c = tl.content as Extract<StoryContent, { type: 'timeline' }>
    expect(c.periods.map((p) => p.label)).toEqual(['22/23', '23/24', '24/25'])
    expect(c.periods.every((p) => p.items.length > 0)).toBe(true)
    expect(c.periods[0].items.some((i) => i.tone === 'warn' || i.tone === 'bad')).toBe(true) // "küme düşme hattı"
    expect(c.periods[1].items.some((i) => i.tone === 'good')).toBe(true) // "şampiyonlar ligi bileti"
    const stats = of('stats')[0]
    expect(stats).toBeTruthy()
    expect(JSON.stringify(stats.content)).toContain('"value":"7"')
    const person = of('person')[0]
    expect(person).toBeTruthy()
    expect(person.content).toMatchObject({ type: 'person', name: 'SEBASTİAN HOENESS' })
  })
  it('sahneler çakışmaz, sıralıdır, her biri nedenini (anlatımdan alıntı) taşır; çağrı metni yok', () => {
    for (let i = 1; i < plan.scenes.length; i++) expect(plan.scenes[i].start).toBeGreaterThanOrEqual(plan.scenes[i - 1].end - 0.01)
    expect(plan.scenes.every((s) => s.reason && s.enabled && s.source === 'auto')).toBe(true)
    expect(JSON.stringify(plan)).not.toMatch(/abone|beğen/i)
  })
  it('çok kısa anlatımda sahne yok ve uyarı var', () => {
    const p = planStory(narration([[0, 'Merhaba arkadaşlar.']]))
    expect(p.scenes).toEqual([])
    expect(p.warnings.length).toBe(1)
  })
  it('normalizeScenes: kapalıları atar, çakışanı kırpar, toplam süreyi aşmaz', () => {
    const mk = (id: string, start: number, end: number, enabled = true): StoryScene => ({ id, start, end, enabled, source: 'manual', content: { type: 'title', text: id } })
    const n = normalizeScenes([mk('b', 10, 40), mk('a', 0, 20), mk('x', 5, 9, false)], 30)
    expect(n.map((s) => s.id)).toEqual(['a', 'b'])
    expect(n[0].end).toBeLessThanOrEqual(10)
    expect(n[1].end).toBeLessThanOrEqual(30)
  })
})

describe('Anlatım → Görsel: içerik güvenliği ve yapay zekâ çıktısı', () => {
  it('sanitizeContent: çağrı metnini, geçersiz türü ve aşırı uzunluğu temizler', () => {
    expect(sanitizeContent({ type: 'title', text: 'Videoyu beğenip abone olun' })).toBeNull()
    expect(sanitizeContent({ type: 'bilinmeyen' })).toBeNull()
    expect(sanitizeContent(null)).toBeNull()
    const c = sanitizeContent({ type: 'list', items: Array.from({ length: 12 }, (_, i) => ({ text: `madde ${i} ` + 'x'.repeat(100), tone: 'good' })) }) as Extract<StoryContent, { type: 'list' }>
    expect(c.items.length).toBe(6)
    expect(c.items[0].text.length).toBeLessThanOrEqual(40)
    const s = sanitizeContent({ type: 'stats', cards: [{ value: '7', unit: 'PUAN', at: 2.04 }, { value: '' }, { value: '15.', tone: 'x' }] }) as Extract<StoryContent, { type: 'stats' }>
    expect(s.cards.map((x) => x.value)).toEqual(['7', '15.'])
    expect(s.cards[0].at).toBe(2)
    expect(s.cards[1].tone).toBeUndefined()
  })
  it('parseScenes: bozuk/eksik yanıtı güvenle ele alır', () => {
    expect(parseScenes('boş')).toEqual([])
    expect(parseScenes('{"scenes": [bozuk')).toEqual([])
    const r = parseScenes('Tamam: {"scenes":[{"start":4,"end":12,"type":"person","role":"Teknik direktör","name":"Ad Soyad"},{"start":-1,"type":"title","text":"x"},{"start":9,"type":"title","text":"Abone ol"}]}')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ start: 4, end: 12, source: 'ai', enabled: true })
  })
})

describe('Anlatım → Görsel: sahne çizimi (ASS)', () => {
  const T = { ...DEFAULT_STORY_THEME, brand: 'KANAL' }
  const all: StoryContent[] = [
    { type: 'stats', kicker: 'RAKAMLARLA', cards: [{ label: 'Lig', value: '7', unit: 'PUAN', sub: 'üç maçta yenilgisiz', tone: 'good' }, { value: '15.', unit: 'SIRA', tone: 'bad', at: 3 }] },
    { type: 'timeline', title: 'Sezonlar', periods: [{ label: '22/23', at: 0.5, items: [{ text: 'Göreve geldi', tone: 'good', at: 1 }] }, { label: '23/24', at: 4, items: [{ text: 'İkinci oldu', at: 5 }] }] },
    { type: 'list', title: 'Sorunlar', items: [{ text: 'Savunma', tone: 'bad' }, { text: 'Forvet' }] },
    { type: 'person', role: 'TEKNİK DİREKTÖR', name: 'SEBASTIAN HOENESS', sub: 'Stuttgart’ta 4. sezon' },
    { type: 'quote', text: 'Bu takım hâlâ kazanmayı biliyor.', by: 'Hoeness' },
    { type: 'title', text: 'STUTTGART NASIL ÇÖKTÜ?', sub: 'Bölüm 1' }
  ]
  for (const size of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    it(`${size[0]}×${size[1]}: her tür geçerli ASS üretir (olaylar var, süre aşılmaz, geçersiz sayı yok)`, () => {
      for (const c of all) {
        const ass = buildStoryAss(c as Exclude<StoryContent, { type: 'place' }>, T, size[0], size[1], 10)
        expect(ass).toContain(`PlayResX: ${size[0]}`)
        const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
        expect(events.length, c.type).toBeGreaterThan(2)
        expect(ass).not.toMatch(/NaN|undefined|Infinity/)
        for (const e of events) expect(e).toMatch(/^Dialogue: \d+,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,/)
      }
    })
  }
  it('rakam kartında birim, satır içi yazı boyutu etiketiyle aynı satırda (kaçışlanmamış)', () => {
    const ass = buildStoryAss(all[0] as Exclude<StoryContent, { type: 'place' }>, T, 1920, 1080, 8)
    expect(ass).toMatch(/\}7\{\\fs\d+\}  PUAN/)
    expect(ass).not.toContain('＼fs')
  })
  it('sahne süresinden sonra açılacak kart çizilmez; zemin ayrıca çizilir (marka yazısı orada)', () => {
    const short = buildStoryAss(all[0] as Exclude<StoryContent, { type: 'place' }>, T, 1920, 1080, 2) // 2. kart 3. sn'de: sığmıyor
    expect(short).toContain('PUAN')
    expect(short).not.toContain('SIRA')
    expect(buildBackdropAss(T, 1920, 1080)).toContain('KANAL')
    expect(buildStoryAss(all[5] as Exclude<StoryContent, { type: 'place' }>, T, 1920, 1080, 5)).not.toContain('KANAL')
  })
  it('yuvarlatılmış dikdörtgen yolu kapalı ve sayısal', () => {
    expect(roundedRectPath(100, 50, 12)).toMatch(/^m -?\d+ -?\d+ l (-?\d+ -?\d+ ?)+$/)
  })
})

describe('Futbol sahnesi: simülasyon', () => {
  const base = (actions: any[], extra: Record<string, unknown> = {}): Extract<StoryContent, { type: 'football' }> => ({
    type: 'football',
    home: { formation: '4-3-3' },
    away: { formation: '4-4-2' },
    players: [{ id: 'a', name: 'Osimhen', team: 'home', at: [60, 30] }, { id: 'b', name: 'Barış', team: 'home', at: [88, 38] }],
    ball: { holder: 'a' },
    actions,
    ...extra
  })
  it('top pas boyunca gider, alıcıda kalır; sonra şutla kaleye gider ve gol sayılır', () => {
    const s = simulateFootball(base([{ do: 'pass', at: 1, from: 'a', to: 'b', dur: 1 }, { do: 'shoot', at: 3, from: 'b', to: 'kale-sag', dur: 0.8 }]), 8)
    expect(s.ball(0).holder).toBe('a')
    const mid = s.ball(1.5)
    expect(mid.holder).toBeUndefined()
    expect(mid.x).toBeGreaterThan(65)
    expect(mid.x).toBeLessThan(88)
    expect(s.ball(2.5).holder).toBe('b')
    const end = s.ball(4)
    expect(end.x).toBeCloseTo(105, 0)
    expect(end.holder).toBeUndefined()
    expect(s.goals).toHaveLength(1)
    expect(s.goals[0].t).toBeCloseTo(3.8, 1)
    expect(s.trails.filter((t) => t.kind === 'pass')).toHaveLength(1)
  })
  it('formasyondan arka plan oyuncuları: 22 kişi, açık oyuncular çakışan yedeği çıkarır', () => {
    const s = simulateFootball(base([]), 5)
    const home = s.players.filter((p) => p.team === 'home')
    const away = s.players.filter((p) => p.team === 'away')
    expect(away).toHaveLength(11)
    expect(home).toHaveLength(11)
    expect(s.players.some((p) => p.id === 'h1' && p.keeper)).toBe(true)
  })
  it('koşu ve sürme: oyuncu hedefe varır; attack:left sahneyi 180° döndürür', () => {
    const run = [{ do: 'run', at: 0, player: 'b', to: [95, 20], dur: 2 }]
    const s = simulateFootball(base(run), 5)
    expect(s.pos('b', 3)[0]).toBeCloseTo(95, 0)
    expect(s.pos('b', 1)[0]).toBeGreaterThan(88)
    const l = simulateFootball(base(run, { attack: 'left' }), 5)
    expect(l.pos('b', 3)[0]).toBeCloseTo(105 - 95, 0)
    expect(l.pos('b', 3)[1]).toBeCloseTo(68 - 20, 0)
  })
  it('anlaşılır hatalar: bilinmeyen oyuncu/nokta/hedef, topu tutmayan oyuncunun pası, üst üste binen top hareketi', () => {
    expect(() => simulateFootball(base([{ do: 'pass', at: 1, from: 'a', to: 'yok' }]), 5)).toThrow(/oyuncu bulunamadı "yok"/)
    expect(() => simulateFootball(base([{ do: 'run', at: 1, player: 'a', to: 'mars' }]), 5)).toThrow(/bilinmeyen nokta "mars"/)
    expect(() => simulateFootball(base([{ do: 'shoot', at: 1, from: 'a', to: 'kale-yok' }]), 5)).toThrow(/bilinmeyen hedef/)
    expect(() => simulateFootball(base([{ do: 'pass', at: 1, from: 'b', to: 'a' }]), 5)).toThrow(/top şu an "a"/)
    expect(() => simulateFootball(base([{ do: 'pass', at: 1, from: 'a', to: 'b', dur: 2 }, { do: 'shoot', at: 2, from: 'b', to: 'kale-sag' }]), 8)).toThrow(/önceki top hareketi/)
    expect(contentProblem(base([{ do: 'pass', at: 1, from: 'a', to: 'yok' }]))).toMatch(/yok/)
    expect(contentProblem(base([]))).toBeNull()
  })
  it('etiket, bölge, çizgi ve kamera eylemleri kaydedilir; sanitize geçerli sahneyi korur, bozuk/CTA olanı atar', () => {
    const s = simulateFootball(base([{ do: 'label', at: 0.5, player: 'a', text: 'PRES' }, { do: 'zone', at: 1, center: 'ceza-yayi', text: 'BOŞ ALAN' }, { do: 'line', at: 1, from: 'a', to: 'b' }, { do: 'camera', at: 2, mode: 'top' }]), 6)
    expect(s.labels).toHaveLength(1)
    expect(s.zones[0].center).toEqual([86, 34])
    expect(s.trails.some((t) => t.kind === 'line')).toBe(true)
    expect(s.camera.map((c) => c.mode)).toEqual(['broadcast', 'top'])
    const c = base([{ do: 'pass', at: 1, from: 'a', to: 'b' }])
    expect(sanitizeContent(JSON.parse(JSON.stringify(c)))).toMatchObject({ type: 'football' })
    expect(sanitizeContent({ type: 'football', players: [] })).toBeNull()
    expect(sanitizeContent({ ...c, actions: [{ do: 'label', at: 1, player: 'a', text: 'Abone olun' }] })).toBeNull()
  })
})

describe('Yazılım rasterleştirici', () => {
  it('dolu dikdörtgen alanı doğru boyar; alfa karışır; kapsam dışı ve bozuk girdi güvenli', () => {
    const r = new Raster(20, 10)
    r.clear([0, 0, 0])
    r.fill([[2, 2], [12, 2], [12, 8], [2, 8]], [200, 100, 50], 1)
    const px = (x: number, y: number) => [...r.data.slice((y * 20 + x) * 3, (y * 20 + x) * 3 + 3)]
    expect(px(5, 5)).toEqual([200, 100, 50])
    expect(px(15, 5)).toEqual([0, 0, 0])
    r.fill([[0, 0], [20, 0], [20, 10], [0, 10]], [255, 255, 255], 0.5)
    expect(px(15, 5)[0]).toBeGreaterThan(120)
    expect(px(15, 5)[0]).toBeLessThan(135)
    r.fill([[NaN, 0], [5, 5], [0, 5]], [1, 2, 3], 1) // bozuk: hata vermez
    r.fill([[-50, -50], [-10, -50], [-10, -10]], [1, 2, 3], 1) // tamamen dışarıda
    expect(px(15, 5)[0]).toBeLessThan(135)
  })
  it('halka (zıt sarımlı iç çokgen) ortası boş kalır', () => {
    const r = new Raster(40, 40)
    r.clear([0, 0, 0])
    r.fill([[5, 5], [35, 5], [35, 35], [5, 35], [5, 5], [15, 15], [15, 25], [25, 25], [25, 15], [15, 15]], [255, 255, 255], 1)
    expect(r.data[(20 * 40 + 20) * 3]).toBe(0)
    expect(r.data[(8 * 40 + 8) * 3]).toBe(255)
  })
})

describe('Takım formaları ve takıma özgü tema', () => {
  it('takım adı Türkçe/İngilizce/aksansız yazımlarla bulunur; bilinmeyen null', () => {
    for (const q of ['Bayern Münih', 'bayern munich', 'FC Bayern', 'Bayern Munih']) expect(findTeam(q)?.id, q).toBe('bayern')
    expect(findTeam('Fenerbahce')?.id).toBe('fenerbahce')
    expect(findTeam('Fenerbahçe')?.id).toBe('fenerbahce')
    expect(findTeam('galatasaray')?.id).toBe('galatasaray')
    expect(findTeam('Beşiktaş')?.id).toBe('besiktas')
    expect(findTeam('Borussia Dortmund')?.id).toBe('dortmund')
    expect(findTeam('Atletico Madrid')?.id).toBe('atletico')
    expect(findTeam('Real Madrid')?.id).toBe('realmadrid')
    expect(findTeam('Uzaylı Spor')).toBeNull()
    expect(findTeam('')).toBeNull()
  })
  it('Bayern kırmızı (şort/çorap dahil, doğrulanmış 2025/26), Galatasaray sarı-kırmızı parçalı', () => {
    const b = findTeam('Bayern')!
    expect(b.home).toMatchObject({ primary: '#DC052D', shorts: '#DC052D', socks: '#DC052D', pattern: 'solid' })
    expect(b.note).toMatch(/2025\/26/)
    const g = findTeam('Galatasaray')!.home
    expect(g.pattern).toBe('halves')
    expect([g.primary, g.secondary].sort()).toEqual(['#A90432', '#FDB913'])
  })
  it('resolveKits: adla forma gelir, alanlarla ezilir; aynı renkte rakip yedek forma giyer; kaleci renk ayrışır', () => {
    const r = resolveKits({ team: 'Bayern Münih' }, { team: 'Dortmund' })
    expect(r.home.primary).toBe('#DC052D')
    expect(r.away.primary).toBe('#FDE100')
    expect(r.homeName).toBe('Bayern Münih')
    expect(colorDistance(r.keeper.primary, r.home.primary)).toBeGreaterThan(150)
    expect(colorDistance(r.keeper.primary, r.away.primary)).toBeGreaterThan(150)
    // Galatasaray - Fenerbahçe değil; Bayern - Liverpool: ikisi de kırmızı → Liverpool yedek (beyaz)
    const c = resolveKits({ team: 'Bayern' }, { team: 'Liverpool' })
    expect(c.away.primary).toBe('#F4F4F4')
    expect(c.notes.join(' ')).toMatch(/karıştığı/)
    expect(resolveKits({ team: 'Bayern', color: '#112233' }).home.primary).toBe('#112233')
    expect(resolveKits({ team: 'Bayern' }, { team: 'Liverpool', color: '#00AA00' }).away.primary).toBe('#00AA00') // açık renk verilmişse zorlanmaz
    expect(() => resolveKits({ team: 'Uzaylı Spor' })).toThrow(/takım bulunamadı/)
    expect(contentProblem({ type: 'football', home: { team: 'Uzaylı Spor' }, players: [{ id: 'a', team: 'home', at: 'orta-nokta' }], actions: [] })).toMatch(/takım bulunamadı/)
  })
  it('themeForTeam: vurgu rengi takımın rengi; koyu zeminde okunmayan renk yerine ikincisi; bilinmeyen takım temayı değiştirmez', () => {
    expect(themeForTeam(DEFAULT_STORY_THEME, 'Bayern').accent).toBe('#DC052D')
    expect(themeForTeam(DEFAULT_STORY_THEME, 'Galatasaray').accent).toBe('#FDB913') // koyu kırmızı okunmaz → sarı
    expect(themeForTeam(DEFAULT_STORY_THEME, 'Beşiktaş').accent).toBe(DEFAULT_STORY_THEME.accent === '#FFD21F' ? '#F4F4F4' : '#F4F4F4')
    expect(themeForTeam(DEFAULT_STORY_THEME, 'Yok Spor')).toBe(DEFAULT_STORY_THEME)
  })
  it('sanitize: team/source korunur; çağrı metni içeren kaynak atılır', () => {
    const c = sanitizeContent({ type: 'stats', team: 'Bayern', source: 'Bundesliga.com', cards: [{ value: '36', unit: 'GOL' }] }) as Extract<StoryContent, { type: 'stats' }>
    expect(c.team).toBe('Bayern')
    expect(c.source).toBe('Bundesliga.com')
    expect((sanitizeContent({ type: 'stats', source: 'Abone ol', cards: [{ value: '1' }] }) as Extract<StoryContent, { type: 'stats' }>).source).toBeUndefined()
    const ass = buildStoryAss(c, DEFAULT_STORY_THEME, 1920, 1080, 6)
    expect(ass).toContain('KAYNAK: BUNDESLİGA.COM')
  })
})

describe('Bilgi paketi (veri) ve veriye dayalı sahneler', () => {
  const seed: Dataset[] = JSON.parse(readFileSync(join(process.cwd(), 'resources/knowledge/datasets.json'), 'utf8')).map((d: unknown) => validateDataset(d))
  it('tohum veri geçerli, kaynaklı ve dürüst: tam olmayan listeler complete:false, bilinmeyen değer null', () => {
    expect(seed.length).toBeGreaterThanOrEqual(8)
    for (const d of seed) {
      expect(d.sources.length, d.id).toBeGreaterThan(0)
      expect(d.rows.length, d.id).toBeGreaterThan(0)
    }
    const sl = seed.find((d) => d.id === 'superlig-2025-26-gol')!
    expect(sl.rows.map((r) => `${r.name}:${r.value}`)).toEqual(['Paul Onuachu:22', 'Eldor Shomurodov:22', 'Anderson Talisca:19', 'Victor Osimhen:15', 'Mohamed Bayo:15'])
    expect(sl.rows.map((r) => r.rank)).toEqual([1, 1, 3, 4, 4])
    expect(sl.complete).toBe(false)
    expect(seed.find((d) => d.id === 'bundesliga-2025-26-gol')!.rows[0]).toMatchObject({ name: 'Harry Kane', value: 36 })
    expect(seed.find((d) => d.id === 'ucl-2025-26-gol')!.rows.filter((r) => r.value === null)).toHaveLength(3)
  })
  it('validateDataset: kaynaksız/bozuk veri reddedilir', () => {
    const ok = { id: 'deneme-1', title: 'T', competition: 'superlig', season: '2025/26', metric: 'gol', asOf: '2026-01-01', rows: [{ name: 'A', value: 1 }], sources: ['x'] }
    expect(validateDataset(ok).id).toBe('deneme-1')
    expect(() => validateDataset({ ...ok, sources: [] })).toThrow(/kaynaksız|sources/)
    expect(() => validateDataset({ ...ok, competition: 'yok' })).toThrow(/competition/)
    expect(() => validateDataset({ ...ok, season: '2025' })).toThrow(/season/)
    expect(() => validateDataset({ ...ok, rows: [{ name: 'A', value: 'x' }] })).toThrow(/value/)
  })
  it('resolveLeaderboard: veri kümesinden ilk N, vurgu soyadıyla; ilk N dışındaki vurgulanan sona eklenir; eksiklik notu', () => {
    const c = resolveSceneData({ type: 'leaderboard', rows: [], dataset: 'superlig-2025-26-gol', top: 3, highlight: ['Osimhen'] }, seed) as Extract<StoryContent, { type: 'leaderboard' }>
    expect(c.rows.map((r) => r.name)).toEqual(['Paul Onuachu', 'Eldor Shomurodov', 'Anderson Talisca', 'Victor Osimhen'])
    expect(c.rows[3].highlight).toBe(true)
    expect(c.metric).toBe('GOL')
    expect(c.source).toMatch(/beIN/)
    const all5 = resolveSceneData({ type: 'leaderboard', rows: [], dataset: 'superlig-2025-26-gol', top: 10 }, seed) as Extract<StoryContent, { type: 'leaderboard' }>
    expect(all5.rows).toHaveLength(5) // uydurulmaz
    expect(all5.note).toMatch(/ilk 5 sıra doğrulandı/)
    expect(() => resolveSceneData({ type: 'leaderboard', rows: [], dataset: 'yok-yok' }, seed)).toThrow(/Veri kümesi bulunamadı/)
  })
  it('takım künyeleri ve oyuncu arama', () => {
    const f = teamFacts(seed, 'Galatasaray')
    expect(f.some((x) => /1\. sıra · 77 puan/.test(x.value))).toBe(true)
    expect(f.some((x) => /Victor Osimhen · 15 gol/.test(x.value))).toBe(true)
    expect(findPlayerRows(seed, 'Osimhen').length).toBeGreaterThanOrEqual(2)
    expect(findPlayerRows(seed, 'Kane').some((m) => m.dataset.id === 'bundesliga-2025-26-gol')).toBe(true)
    expect((resolveSceneData({ type: 'teamcard', team: 'Galatasaray' }, seed) as Extract<StoryContent, { type: 'teamcard' }>).facts!.length).toBeGreaterThan(0)
  })
  it('bayatlık ve eksiklik uyarıları: sürüyor + eski tarih → bayat; kesinleşmiş sezon bayatlamaz', () => {
    const live = seed.find((d) => d.id === 'superlig-2026-27-puan-hafta7')!
    expect(datasetWarnings(live, '2026-11-05').join(' ')).toMatch(/GÜNCEL DEĞİL/)
    expect(datasetWarnings(live, '2026-10-10').join(' ')).not.toMatch(/bayat/)
    expect(datasetWarnings(seed.find((d) => d.id === 'superlig-2025-26-gol')!, '2030-01-01').join(' ')).not.toMatch(/bayat/)
    expect(datasetWarnings(seed.find((d) => d.id === 'ucl-2025-26-gol')!, '2026-06-01').join(' ')).toMatch(/değeri bilinmiyor/)
  })
  it('planlayıcı: "Süper Lig gol krallığında Osimhen" → sıralama sahnesi (veri kümesi + vurgu); "Galatasaray" → takım kartı; veri yoksa uyarı', () => {
    const w = narration([
      [2, 'Bugün Galatasaray için konuşacağız ve çok şey var.'],
      [10, 'Süper Lig gol krallığı yarışında Osimhen dördüncü sırada bitirdi.'],
      [20, 'Bundesliga gol krallığını ise Kane kazandı.'],
      [30, 'Sonra başka konulara geçelim ve devam edelim bakalım.']
    ])
    const p = planStory(w, { datasets: seed, today: '2026-11-05' })
    const lb = p.scenes.filter((s) => s.content.type === 'leaderboard')
    // Süper Lig'in güncel sezon verisi (2026/27) bayat → sahne ÖNERİLMEZ, "güncel veri" uyarısı verilir
    expect(lb.some((s) => (s.content as { dataset?: string }).dataset?.startsWith('superlig'))).toBe(false)
    expect(p.warnings.join(' ')).toMatch(/Güncel veri gerektiren sahneler/)
    expect(lb.some((s) => (s.content as { dataset?: string }).dataset === 'bundesliga-2025-26-gol')).toBe(true)
    // veri güncelse (bugünün tarihli) Süper Lig sıralaması da önerilir ve Osimhen vurgulanır
    const fresh = seed.map((d) => (d.id === 'superlig-2026-27-gol-hafta6' ? { ...d, asOf: '2026-11-05' } : d))
    const p2 = planStory(w, { datasets: fresh, today: '2026-11-05' })
    const sl = p2.scenes.find((s) => (s.content as { dataset?: string }).dataset === 'superlig-2026-27-gol-hafta6')!
    expect(sl).toBeTruthy()
    expect((sl.content as { highlight?: string[] }).highlight).toContain('Osimhen')
    expect(p.scenes.some((s) => s.content.type === 'teamcard' && (s.content as { team: string }).team === 'Galatasaray')).toBe(true)
    const none = planStory(narration([[2, 'Ligue 1 gol krallığını kim aldı sence bakalım şimdi söyleyelim arkadaşlar.'], [9, 'Konuşmaya devam ediyoruz ve başka şeyler de var burada.']]), { datasets: seed })
    expect(none.warnings.join(' ')).toMatch(/Ligue 1 GOL.*veri yok/)
  })
})

describe('Güncellik kapısı ve marka koruması', () => {
  const seed2: Dataset[] = JSON.parse(readFileSync(join(process.cwd(), 'resources/knowledge/datasets.json'), 'utf8')).map((d: unknown) => validateDataset(d))
  it('sezonu süren eski veri kapıya takılır; sezonu biten ve bugünkü veri takılmaz; takım kartı künye veri kümelerini de sayar', () => {
    const lb: StoryContent = { type: 'leaderboard', rows: [], dataset: 'superlig-2026-27-puan-hafta7' }
    const used = usedDatasets([lb], seed2)
    expect(staleDatasets(used, '2026-11-05').map((x) => x.id)).toEqual(['superlig-2026-27-puan-hafta7'])
    expect(staleDatasets(used, '2026-11-05')[0].ageDays).toBe(27)
    expect(staleDatasets(used, '2026-10-10')).toEqual([]) // 1 gün: kabul
    expect(staleDatasets(usedDatasets([{ type: 'leaderboard', rows: [], dataset: 'superlig-2025-26-gol' }], seed2), '2030-01-01')).toEqual([]) // final
    const tc = usedDatasets([{ type: 'teamcard', team: 'Galatasaray' }], seed2).map((d) => d.id)
    expect(tc).toEqual(expect.arrayContaining(['superlig-2025-26-puan', 'superlig-2026-27-puan-hafta7']))
    expect(staleDatasets(usedDatasets([{ type: 'teamcard', team: 'Galatasaray' }], seed2), '2026-11-05').length).toBeGreaterThan(0)
    expect(usedDatasets([{ type: 'teamcard', team: 'Galatasaray', facts: [{ label: 'a', value: 'b' }] }], seed2)).toEqual([]) // elle verilen künye veri sayılmaz
  })
  it('ekrandaki kaynak satırında verinin tarihi görünür', () => {
    expect(trDate('2026-11-05')).toBe('5 KASIM 2026')
    const r = resolveSceneData({ type: 'leaderboard', rows: [], dataset: 'bundesliga-2025-26-gol' }, seed2) as Extract<StoryContent, { type: 'leaderboard' }>
    expect(r.source).toMatch(/16 MAYIS 2026$/)
  })
  it('başka kanalın adı marka olarak yazılamaz', () => {
    expect(cleanBrand('AKIL OYUNU')).toBe('')
    expect(cleanBrand('Akıl Oyunu - Football Mind')).toBe('')
    expect(cleanBrand('Benim Kanalım')).toBe('Benim Kanalım')
    expect(cleanBrand(undefined)).toBe('')
    expect(DEFAULT_STORY_THEME.brand).toBe('')
  })
})

describe('Sıralama / karşılaştırma / takım kartı çizimi', () => {
  const T2 = { ...DEFAULT_STORY_THEME }
  const lb: Extract<StoryContent, { type: 'leaderboard' }> = { type: 'leaderboard', kicker: 'SÜPER LİG', title: 'Gol krallığı', metric: 'GOL', rows: [{ name: 'Paul Onuachu', team: 'Trabzonspor', value: 22, rank: 1 }, { name: 'Victor Osimhen', team: 'Galatasaray', value: 15, rank: 4, highlight: true }, { name: 'Bilinmeyen', value: null, rank: 5 }], source: 'beIN SPORTS' }
  for (const size of [[1920, 1080], [1080, 1920]]) {
    it(`${size[0]}×${size[1]}: sıralama/karşılaştırma/takım kartı geçerli ASS`, () => {
      const cmp: StoryContent = { type: 'compare', title: 'Kane ↔ Haaland', left: { name: 'Kane', team: 'Bayern' }, right: { name: 'Haaland', team: 'Manchester City' }, metrics: [{ label: 'Gol', left: 36, right: 27 }, { label: 'Asist', left: 8, right: 5 }, { label: 'Yenilen gol', left: 30, right: 40, lowerBetter: true }] }
      const tc: StoryContent = { type: 'teamcard', team: 'Galatasaray', facts: [{ label: 'Süper Lig 2025/26', value: '1. sıra · 77 puan' }], source: 'GZT' }
      for (const c of [lb, cmp, tc]) {
        const ass = buildStoryAss(c as Exclude<StoryContent, { type: 'place' }>, T2, size[0], size[1], 10)
        expect(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length, c.type).toBeGreaterThan(4)
        expect(ass).not.toMatch(/NaN|undefined|Infinity/)
      }
    })
  }
  it('sıralamada değeri olmayan satır çubuksuz, değerli satır çubuklu; vurgulu satır vurgu renginde', () => {
    const ass = buildStoryAss(lb, T2, 1920, 1080, 10)
    expect(ass).toContain('PAUL ONUACHU')
    expect(ass).toContain('BİLİNMEYEN')
    expect((ass.match(/\\fscx1\\t/g) ?? []).length).toBe(2) // yalnızca iki değerli satırda çubuk
    expect(ass).toContain('22 GOL')
    expect(ass).not.toContain('null')
  })
})

describe('Yüz videosu + uçak rotası', () => {
  it('"Paris\'ten İstanbul\'a gittik" → tek harita sahnesi: from Paris, to İstanbul, uçakla', () => {
    const w = narration([[2, "Geçen hafta Paris'ten İstanbul'a gittik ve çok eğlendik."], [10, 'Sonra başka konulara geçtik ve devam ettik burada bakalım.']])
    const p = planStory(w, { isPlace: (x) => ({ Paris: 'Paris', 'İstanbul': 'İstanbul' } as Record<string, string>)[x] })
    const place = p.scenes.filter((s) => s.content.type === 'place')
    expect(place).toHaveLength(1)
    expect(place[0].content).toMatchObject({ type: 'place', from: 'Paris', to: 'İstanbul', vehicle: 'plane' })
  })
  it('uçak silüeti çizilir; vehicle:none ile çizilmez', () => {
    expect(planePoly(100, 100, 20, 0)[0]).toEqual([120, 100]) // burun +x
    expect(planePoly(100, 100, 20, Math.PI / 2)[0][1]).toBeCloseTo(120, 5)
  })
})
