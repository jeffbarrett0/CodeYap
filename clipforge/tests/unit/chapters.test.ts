import { describe, expect, it } from 'vitest'
import { DENSITY, TOPIC_OPTIONS, chapterTimestamp, chapterWarnings, findChapters, formatChapters, mapChapterList, parseChapterList } from '../../src/shared/chapters'
import type { TranscriptWord } from '../../src/shared/types'

/** Konu blokları: her blok kendi kelime dağarcığı; isimli bloklarda büyük harfli özel ad cümle ortasında geçer */
function stream(blocks: { mins: number; vocab: string[]; name?: string }[]): { words: TranscriptWord[]; bounds: number[] } {
  let seed = 3
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'oldukça', 'durum', 'mesele', 'taraf']
  const words: TranscriptWord[] = []
  const bounds: number[] = []
  let t = 0
  for (const b of blocks) {
    const end = t + b.mins * 60
    while (t < end) {
      for (let i = 0; i < 9; i++) {
        let w = rnd() < 0.45 ? b.vocab[Math.floor(rnd() * b.vocab.length)] : common[Math.floor(rnd() * common.length)]
        if (b.name && i === 4 && rnd() < 0.5) w = b.name
        words.push({ text: i === 8 ? `${w}.` : i === 0 ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w, start: t, end: t + 0.4, confidence: 1 } as TranscriptWord)
        t += 0.45
      }
      t += 0.5
    }
    bounds.push(t)
  }
  return { words, bounds }
}

const GAME = ['oyun', 'bölüm', 'boss', 'seviye', 'karakter', 'silah', 'görev', 'harita']
const AI = ['yapay', 'zeka', 'model', 'veri', 'eğitim', 'algoritma', 'öğrenme', 'chatbot']
const FOOT = ['transfer', 'forvet', 'taraftar', 'penaltı', 'kadro', 'sezon', 'lig', 'teknik']
const FOOD = ['yemek', 'tarif', 'lezzet', 'restoran', 'mutfak', 'tavuk', 'pilav', 'çorba']

describe('YouTube bölüm zamanları', () => {
  const { words, bounds } = stream([
    { mins: 1.5, vocab: GAME },
    { mins: 3, vocab: FOOT, name: 'Rafael' },
    { mins: 4, vocab: FOOT, name: 'Camavinga' },
    { mins: 4, vocab: FOOT, name: 'Ederson' },
    { mins: 4, vocab: FOOD }
  ])
  const chapters = findChapters(words)
  it('ardışık, boşluksuz bölümler; ilki 0; sınırlar konu/isim değişimine ±1,5 dk yakın', () => {
    expect(chapters.length).toBeGreaterThanOrEqual(4)
    expect(chapters[0].start).toBe(0)
    for (let i = 1; i < chapters.length; i++) expect(chapters[i].start).toBeGreaterThan(chapters[i - 1].start)
    for (const b of bounds.slice(0, 3)) expect(chapters.some((c) => Math.abs(c.start - b) < 90), `sınır ${Math.round(b)} bulunamadı: ${chapters.map((c) => Math.round(c.start)).join(',')}`).toBe(true)
  })
  it('başlıklar konuşulan kişi adlarıdır; ilk bölüm "Giriş"', () => {
    expect(chapters[0].title).toBe('Giriş')
    const titles = chapters.map((c) => c.title)
    for (const n of ['Rafael', 'Camavinga', 'Ederson']) expect(titles.some((t) => t.includes(n)), `${n} yok: ${titles.join(' | ')}`).toBe(true)
  })
  it('biçim: "00:00 Giriş" (1 saatin altı MM:SS, üstü HH:MM:SS); başlık/boş satır/tire yok', () => {
    expect(chapterTimestamp(0)).toBe('00:00:00')
    expect(chapterTimestamp(754)).toBe('00:12:34')
    expect(chapterTimestamp(3735)).toBe('01:02:15')
    const lines = formatChapters(chapters).split('\n')
    expect(lines[0]).toBe('00:00 Giriş')
    expect(lines).toHaveLength(chapters.length)
    for (const l of lines) expect(l).toMatch(/^\d\d:\d\d \S/)
    const long = formatChapters([{ start: 0, title: 'Giriş' }, { start: 3735, title: 'Son' }], 7200).split('\n')
    expect(long).toEqual(['00:00:00 Giriş', '01:02:15 Son'])
    expect(chapterWarnings(chapters)).toEqual([])
    expect(chapterWarnings([{ start: 0, end: 60 }])).toEqual(expect.arrayContaining([expect.stringMatching(/en az 3/)]))
    expect(chapterWarnings([{ start: 5, end: 8 }, { start: 8, end: 100 }, { start: 100, end: 200 }]).length).toBe(2)
  })
  it('sıklık: çok > orta > az bölüm; çok kısa/boş videoda bölüm yok', () => {
    const n = (d: 'low' | 'medium' | 'high') => findChapters(words, DENSITY[d]).length
    expect(n('high')).toBeGreaterThanOrEqual(n('medium'))
    expect(n('medium')).toBeGreaterThanOrEqual(n('low'))
    expect(findChapters([])).toEqual([])
    expect(findChapters(words.slice(0, 20))).toEqual([])
  })

  it('konuya göre kip: sıklık/süre sabit değil — 3 dk de 12 dk da bölüm olur; açılış her zaman Giriş; takım düzeyi başlık', () => {
    const names = ['Osimhen', 'Icardi', 'Torreira', 'Sara', 'Mertens', 'Barış']
    const pl = (i: number) => names[i % names.length]
    // 1,5 dk giriş (isimsiz) + 12 dk "Galatasaray" (6 farklı oyuncu, takım adı sık) + 3 dk tek oyuncu (Lemina) + 8 dk Beşiktaş
    const gs = stream([{ mins: 1.5, vocab: GAME }, { mins: 12, vocab: [...FOOT, 'Galatasaray', 'Galatasaray'], name: 'Osimhen' }, { mins: 3, vocab: FOOT, name: 'Lemina' }, { mins: 8, vocab: [...FOOT, 'Beşiktaş', 'Beşiktaş'], name: 'Rashica' }])
    void pl
    const ch = findChapters(gs.words, TOPIC_OPTIONS)
    expect(ch[0].title).toBe('Giriş')
    expect(ch[0].start).toBe(0)
    const lens = ch.map((c) => c.end - c.start)
    expect(Math.max(...lens)).toBeGreaterThan(8 * 60) // uzun konu bölünmedi
    expect(ch.some((c) => c.title.includes('Lemina'))).toBe(true)
    expect(chapterWarnings(ch)).toEqual([])
    // başlıklar tekrar etmez; metin YouTube sınırı içinde
    expect(formatChapters(ch).length).toBeLessThan(4800)
  })

  it('konuya göre kip: birçok farklı oyuncu + takım adı → "Galatasaray gündemi"; tek oyuncu → onun adı', () => {
    const gs = stream([
      { mins: 1.5, vocab: GAME },
      { mins: 9, vocab: ['Osimhen', 'Icardi', 'Torreira', 'Sara', 'Mertens', 'Galatasaray', 'Galatasaray', 'Galatasaray', 'transfer', 'forvet'] },
      { mins: 6, vocab: [...FOOT, 'Lemina', 'Lemina', 'Lemina'] }
    ])
    const ch = findChapters(gs.words, TOPIC_OPTIONS)
    const titles = ch.map((c) => c.title)
    expect(titles[0]).toBe('Giriş')
    expect(titles, titles.join(' | ')).toContain('Galatasaray gündemi')
    expect(titles.some((t) => t.includes('Lemina'))).toBe(true)
  })

  it('hazır liste (orijinal kayıt zamanı): ayrıştırılır ve kesimli videonun zamanına çevrilir', () => {
    const list = parseChapterList('Saniyeler:\n\n00:00:00 - Giriş\n00:20:00 - Lemina\n01:10:06 - Osimhen\n1:30:00 – Veda')
    expect(list).toEqual([{ start: 0, title: 'Giriş' }, { start: 1200, title: 'Lemina' }, { start: 4206, title: 'Osimhen' }, { start: 5400, title: 'Veda' }])
    expect(parseChapterList('06:41 Fenerbahçe uygunluk puanı')).toEqual([{ start: 401, title: 'Fenerbahçe uygunluk puanı' }])
    // kayıt: ilk 164 sn (yayın başı) kesildi; 1000–1100 arası sessizlik kesildi; 4000–4300 arası kesildi
    const kept = [
      { srcIn: 164, srcOut: 1000, start: 0 },
      { srcIn: 1100, srcOut: 4000, start: 836 },
      { srcIn: 4300, srcOut: 5000, start: 3736 }
    ]
    const r = mapChapterList(list, kept, 4436)
    expect(r.chapters[0]).toEqual({ start: 0, title: 'Giriş' })
    expect(r.chapters[1]).toEqual({ start: 836 + (1200 - 1100), title: 'Lemina' }) // 936
    expect(r.chapters[2].start).toBe(3736) // 4206 kesilen aralıkta: sonraki ilk korunan ana taşınır
    expect(r.warnings.some((w) => w.includes('Osimhen'))).toBe(true)
    expect(r.chapters.some((c) => c.title === 'Veda')).toBe(false) // 5400 > süre: atılır
    expect(r.warnings.some((w) => w.includes('Veda'))).toBe(true)
    expect(formatChapters(r.chapters, 4436).split('\n')[0]).toBe('00:00:00 Giriş') // 1 saati aşan video: SS:DD:ss
  })

  it('bitişli liste ("03:00 - 09:00 Noah Lang"): bitiş de çevrilir; ilk konu 0\'da değilse başa Giriş eklenir; klip aralıkları bitişe uyar', async () => {
    const { chapterClipRanges } = await import('../../src/shared/chapters')
    const list = parseChapterList('00:03:00 - 00:09:00 Noah Lang\n00:34:00 - 00:41:00 Leo\n00:41:00 - 00:45:00 Deniz Gül')
    expect(list[0]).toEqual({ start: 180, end: 540, title: 'Noah Lang' })
    // kesim: ilk 100 sn yok; 200–230 arası sessizlik kesildi (30 sn); 3000–3100 arası kesildi
    const kept = [
      { srcIn: 100, srcOut: 200, start: 0 },
      { srcIn: 230, srcOut: 3000, start: 100 },
      { srcIn: 3100, srcOut: 6000, start: 2870 }
    ]
    const r = mapChapterList(list, kept, 5770)
    expect(r.chapters[0]).toEqual({ start: 0, title: 'Giriş' })
    expect(r.chapters[1].title).toBe('Noah Lang')
    expect(r.chapters[1].start).toBe(80) // 180. sn: ilk 100 sn kesildi → 80
    expect(r.chapters[1].end).toBe(410) // 540. sn: 100 sn başlangıç + 30 sn sessizlik kesilmiş → 410
    const clips = chapterClipRanges(r.chapters, 5770)
    expect(clips.map((c) => c.title)).toEqual(['Noah Lang', 'Leo', 'Deniz Gül'])
    expect(clips[0].end - clips[0].start).toBeLessThan(360) // 6 dk'dan kısa: sessizlik kesimi
    expect(clips[1].end - clips[1].start).toBeGreaterThan(380) // ~7 dk (34:00–41:00; kesim yok)
  })

  it('başlık önce, zaman sonda yazımı da okunur (kullanıcının gerçek listesi); iki yazım karışık olabilir', () => {
    const real = [
      'Saniyeler:',
      '',
      'Giriş - 00:00:00',
      'Olmadığım Dönemde Neler Yaptım - 00:06:00',
      "Deniz Ertaş Trabzonspor yolunda! Jankat Yılmaz Galatasaray'dan Ayrılıyor mu? - 00:27:00",
      "Abdülkerim Bardakçı'nın devri bitti mi?  - 00:34:20",
      'Lesley Galatasaray’dan ayrılıyor! Peki o zaman neden transfer edildi?  - 00:41:00',
      'Noah Lang - 01:03:00 - 01:09:30',
      '00:50:00 - Karışık yazım',
      '1:10:06 Tek haneli saat'
    ].join('\n')
    const l = parseChapterList(real)
    expect(l.map((x) => x.title)).toEqual([
      'Giriş', 'Olmadığım Dönemde Neler Yaptım', "Deniz Ertaş Trabzonspor yolunda! Jankat Yılmaz Galatasaray'dan Ayrılıyor mu?", "Abdülkerim Bardakçı'nın devri bitti mi?",
      'Lesley Galatasaray’dan ayrılıyor! Peki o zaman neden transfer edildi?', 'Karışık yazım', 'Noah Lang', 'Tek haneli saat'
    ])
    expect(l.map((x) => x.start)).toEqual([0, 360, 1620, 2060, 2460, 3000, 3780, 4206])
    expect(l.find((x) => x.title === 'Noah Lang')!.end).toBe(4170)
    expect(parseChapterList('Saniyeler:\n\nSadece başlık satırı').length).toBe(0)
  })
})
