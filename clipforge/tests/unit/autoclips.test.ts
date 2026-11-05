import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTOCLIP_LAYOUT, autoClipTemplate, findAutoClips, parseRect, screenCrop } from '@shared/autoclips'
import type { TranscriptWord } from '@shared/types'
import { chainAutoClips } from '../../src/main/autoclips/run'

/** Her blok: dakika, kelime dağarcığı, isteğe bağlı büyük harfli ad (cümle ortasında) */
function stream(blocks: { secs: number; vocab: string[]; name?: string }[]): TranscriptWord[] {
  let seed = 5
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'oldukça', 'durum', 'mesele', 'taraf']
  const words: TranscriptWord[] = []
  let t = 0
  for (const b of blocks) {
    const end = t + b.secs
    while (t < end) {
      for (let i = 0; i < 9; i++) {
        let w = rnd() < 0.45 ? b.vocab[Math.floor(rnd() * b.vocab.length)] : common[Math.floor(rnd() * common.length)]
        if (b.name && i === 4 && rnd() < 0.6) w = b.name
        words.push({ text: i === 8 ? `${w}.` : i === 0 ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w, start: t, end: t + 0.4, confidence: 1 })
        t += 0.45
      }
      t += 0.5
    }
  }
  return words
}
const FOOT = ['transfer', 'forvet', 'taraftar', 'penaltı', 'kadro', 'sezon', 'lig', 'teknik']
const FOOD = ['yemek', 'tarif', 'lezzet', 'restoran', 'mutfak', 'tavuk', 'pilav', 'çorba']

describe('Auto Clips: konu bölümleri', () => {
  const words = stream([
    { secs: 60, vocab: FOOD },
    { secs: 75, vocab: FOOT, name: 'Lemina' },
    { secs: 70, vocab: FOOD },
    { secs: 70, vocab: FOOT, name: 'Zaha' },
    { secs: 70, vocab: FOOD }
  ])
  const clips = findAutoClips(words)
  it('adı geçen kişiler için klip adayı bulur: net başlık, süre sınırı içinde, zamanlar sıralı ve çakışmasız', () => {
    expect(clips.length).toBeGreaterThanOrEqual(2)
    for (const c of clips) {
      expect(c.durationSec).toBeGreaterThanOrEqual(20)
      expect(c.durationSec).toBeLessThanOrEqual(105)
      expect(c.headline).toMatch(/konuşmuşsun/)
      expect(c.summary.length).toBeGreaterThan(10)
    }
    for (let i = 1; i < clips.length; i++) expect(clips[i].start).toBeGreaterThanOrEqual(clips[i - 1].end - 0.01)
    expect(clips.some((c) => c.subject.includes('Lemina'))).toBe(true)
    expect(clips.some((c) => c.subject.includes('Zaha'))).toBe(true)
  })
  it('Lemina klibi, Lemina konuşulan aralıkta (60-135 sn civarı) ve o aralığın içinde başlar/biter', () => {
    const c = clips.find((x) => x.subject.includes('Lemina'))!
    expect(c.start).toBeGreaterThan(40)
    expect(c.end).toBeLessThan(160)
  })
  it('en çok N aday; çok kısa/boş transkriptte aday yok; seçenekler uygulanır', () => {
    expect(findAutoClips(words, { max: 1 })).toHaveLength(1)
    expect(findAutoClips([])).toEqual([])
    expect(findAutoClips(words, { minSec: 400 })).toEqual([])
  })
  it('yüz bölgesi ayrıştırma: geçerli x,y,w,h; bozuk/taşan reddedilir; varsayılan sağ alt', () => {
    expect(parseRect('0.7,0.64,0.29,0.34')).toEqual({ x: 0.7, y: 0.64, w: 0.29, h: 0.34 })
    expect(parseRect('0.9,0.9,0.5,0.5')).toBeNull()
    expect(parseRect('a,b,c,d')).toBeNull()
    expect(parseRect('1,2,3')).toBeNull()
    expect(DEFAULT_AUTOCLIP_LAYOUT.face.x + DEFAULT_AUTOCLIP_LAYOUT.face.w).toBeLessThanOrEqual(1)
  })
})

describe('Auto Clips: seçenekler', () => {
  it('tanımsız (undefined) seçenek varsayılanı ezmez (CLI bayrakları verilmediğinde)', () => {
    const w = stream([{ secs: 60, vocab: FOOD }, { secs: 140, vocab: FOOT, name: 'Lemina' }, { secs: 60, vocab: FOOD }])
    const a = findAutoClips(w, { minSec: undefined, maxSec: undefined, max: undefined })
    const b = findAutoClips(w)
    expect(a).toEqual(b)
    expect(a.every((c) => c.durationSec <= 105)).toBe(true) // uzun konu parçalanır
  })
})

describe('Auto Clips: klip düzeni (kullanıcının örnek ekran görüntüsü)', () => {
  it('9:16: yüz üstte kare genişliğinde ~%41,5, görüntü altta kalan alan; ikisi de cover; yüz altta seçilince yer değiştirir', () => {
    const t = autoClipTemplate()
    expect(t.aspect).toBe('9:16')
    const face = t.layers.find((l) => l.id === 'V2')!.placement
    const screen = t.layers.find((l) => l.id === 'V1')!.placement
    expect(face.rect).toEqual({ x: 0, y: 0, w: 1, h: 0.415 })
    expect(screen.rect.y).toBeCloseTo(0.415, 5)
    expect(screen.rect.y + screen.rect.h).toBeCloseTo(1, 5)
    expect(face.fit).toBe('cover')
    expect(screen.fit).toBe('cover')
    const b = autoClipTemplate({ facePos: 'bottom', faceShare: 0.3 })
    expect(b.layers.find((l) => l.id === 'V2')!.placement.rect).toEqual({ x: 0, y: 0.7, w: 1, h: 0.3 })
    expect(autoClipTemplate({ faceShare: 5 }).layers[0].placement.rect.h).toBe(0.7) // sınırlanır
  })
  it('varsayılan yüz bölgesi sağ alt köşe ve üst alanın en-boy oranıyla uyumlu (bozulmadan)', () => {
    const f = DEFAULT_AUTOCLIP_LAYOUT.face
    expect(f.x + f.w).toBeCloseTo(1, 5)
    expect(f.y + f.h).toBeGreaterThan(0.97) // kaynak karenin sağ altındaki kamera kutusu (örnek ekran görüntüsünden ölçüldü)
    expect(f.y + f.h).toBeLessThanOrEqual(1)
    const srcRatio = (f.w * 1920) / (f.h * 1080) // 16:9 kaynakta kırpılan alanın piksel oranı
    const slotRatio = 1080 / (1920 * 0.415)
    expect(Math.abs(srcRatio - slotRatio)).toBeLessThan(0.06)
  })
})

describe('Auto Clips: alt görüntü kırpması (biraz büyük, ortalı)', () => {
  const L = DEFAULT_AUTOCLIP_LAYOUT
  const slot = 1080 / (1920 * (1 - L.faceShare))
  it('alt alanın en-boy oranına uyar (bozulma yok), ortalıdır ve yüz kutusuna taşmaz', () => {
    const c = screenCrop(L, 16 / 9)
    expect((c.w * 16) / (c.h * 9)).toBeCloseTo(slot, 3)
    expect(c.h).toBeCloseTo(1 / 1.15, 3)
    expect(Math.abs(c.x + c.w / 2 - 0.5)).toBeLessThan(0.06) // neredeyse tam ortada
    expect(Math.abs(c.y + c.h / 2 - 0.5)).toBeLessThan(1e-9)
    // kamera kutusunun içine girmez (yüz altta tekrar görünmesin)
    expect(c.x + c.w).toBeLessThanOrEqual(L.face.x)
    expect(c.x).toBeGreaterThanOrEqual(0)
  })
  it('yakınlık: 1 = tam yükseklik, daha büyük sayı daha dar kırpma; sınırlar korunur; yüz kutusu yoksa tam ortalı', () => {
    expect(screenCrop({ ...L, screenZoom: 1 }, 16 / 9).h).toBeCloseTo(1, 5)
    expect(screenCrop({ ...L, screenZoom: 2 }, 16 / 9).w).toBeLessThan(screenCrop({ ...L, screenZoom: 1.2 }, 16 / 9).w)
    expect(screenCrop({ ...L, screenZoom: 0.2 }, 16 / 9).h).toBeCloseTo(1, 5) // 1'in altına inmez
    const far = screenCrop({ ...L, face: { x: 0.95, y: 0.95, w: 0.05, h: 0.05 }, screenZoom: 2 }, 16 / 9)
    expect(far.x + far.w / 2).toBeCloseTo(0.5, 5)
    const sq = screenCrop({ ...L, screenZoom: 1 }, 1) // kare kaynak: genişlik 1'e sığar
    expect(sq.w).toBeLessThanOrEqual(1)
    expect(sq.h).toBeLessThanOrEqual(1)
  })
})

describe('Zincir: Auto Kick → Auto Clips (gözetimsiz)', () => {
  const settings = { autoClipsAfterKick: true, autoClipsMax: 8, autoClipsExport: true }
  const mk = () => {
    const started: unknown[] = []
    return { started, manager: { start: (r: unknown) => (started.push(r), `job${started.length}`) } }
  }
  it('Auto Kick bitince Auto Clips başlar: doğru proje, klip sayısı ve MP4 ayarıyla; aynı iş için yalnızca bir kez', () => {
    const { started, manager } = mk()
    const handled = new Set<string>()
    const done = { id: 'autokick-1', status: 'done', result: { projectPath: '/yayin/AutoKick/kayit/kayit.clipforge' } }
    expect(chainAutoClips(done, handled, settings, manager)).toBe('job1')
    expect(started[0]).toEqual({ projectPath: '/yayin/AutoKick/kayit/kayit.clipforge', max: 8, exportVideos: true })
    expect(chainAutoClips(done, handled, settings, manager)).toBeNull() // her güncellemede çağrılır: tekrar başlatılmaz
    expect(started).toHaveLength(1)
  })
  it('çalışırken/başarısızken/iptalde ya da ayar kapalıyken başlamaz; MP4 kapalıysa exportVideos:false', () => {
    const { started, manager } = mk()
    for (const status of ['running', 'failed', 'cancelled']) expect(chainAutoClips({ id: `a-${status}`, status, result: { projectPath: '/p' } }, new Set(), settings, manager)).toBeNull()
    expect(chainAutoClips({ id: 'x', status: 'done' }, new Set(), settings, manager)).toBeNull() // sonuç yok
    expect(chainAutoClips({ id: 'b', status: 'done', result: { projectPath: '/p' } }, new Set(), { ...settings, autoClipsAfterKick: false }, manager)).toBeNull()
    expect(started).toHaveLength(0)
    chainAutoClips({ id: 'c', status: 'done', result: { projectPath: '/p' } }, new Set(), { ...settings, autoClipsExport: false }, manager)
    expect(started[0]).toMatchObject({ exportVideos: false })
  })
})
