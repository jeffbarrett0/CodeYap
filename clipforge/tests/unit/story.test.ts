import { describe, expect, it } from 'vitest'
import { normalizeScenes, planStory, sanitizeContent } from '@shared/story/plan'
import { buildBackdropAss, buildStoryAss, roundedRectPath } from '@shared/story/scenes'
import { DEFAULT_STORY_THEME, type StoryContent, type StoryScene } from '@shared/story/types'
import { parseScenes } from '../../src/main/story/ai'
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
