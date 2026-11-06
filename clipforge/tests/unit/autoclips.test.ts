import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTOCLIP_LAYOUT, MAX_CLIP_SEC, MIN_CLIP_SEC, autoClipTemplate, faceCrop, findAutoClips, overlayRect, parseRect, screenCrop } from '@shared/autoclips'
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
      expect(c.durationSec).toBeLessThanOrEqual(MAX_CLIP_SEC)
      expect(c.headline).toMatch(/konuşmuşsun/)
      expect(c.summary.length).toBeGreaterThan(10)
    }
    for (let i = 1; i < clips.length; i++) expect(clips[i].start).toBeGreaterThanOrEqual(clips[i - 1].end - 0.01)
    expect(clips.some((c) => c.subject.includes('Lemina'))).toBe(true)
    expect(clips.some((c) => c.subject.includes('Zaha'))).toBe(true)
  })
  it('konu 75 sn konuşulduysa klip yarıda kesilmez: konuşulan sürenin büyük kısmını kapsar', () => {
    const c = clips.find((x) => x.subject.includes('Lemina'))!
    expect(c.durationSec).toBeGreaterThanOrEqual(60)
  })
  it('Lemina klibi, Lemina konuşulan aralıkta (60-135 sn civarı) ve o aralığın içinde başlar/biter', () => {
    const c = clips.find((x) => x.subject.includes('Lemina'))!
    expect(c.start).toBeGreaterThan(40)
    expect(c.end).toBeLessThan(160)
  })
  it('en çok N aday; çok kısa/boş transkriptte aday yok; seçenekler uygulanır', () => {
    expect(findAutoClips(words, { max: 1 })).toHaveLength(1)
    expect(findAutoClips([])).toEqual([])
    // alt sınır en çok 168 sn'ye kadar yükselir (üst sınır 178): daha uzun istek buna sıkıştırılır
    for (const c of findAutoClips(words, { minSec: 400 })) expect(c.durationSec).toBeGreaterThanOrEqual(168)
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
    expect(a.every((c) => c.durationSec <= MAX_CLIP_SEC)).toBe(true) // klipler 2:58'i aşmaz
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

describe('Auto Clips: yüze odaklı üst kırpma', () => {
  const L = DEFAULT_AUTOCLIP_LAYOUT
  const slot = 1080 / (1920 * L.faceShare)
  it('kamera kutusunun İÇİNDE kalır (üstündeki sayfa şeridi görünmez), alan oranına uyar, kafa üstte küçük payla durur', () => {
    const c = faceCrop(L, 16 / 9)
    expect(c.x).toBeGreaterThanOrEqual(L.face.x - 1e-9)
    expect(c.y).toBeGreaterThanOrEqual(L.face.y - 1e-9)
    expect(c.x + c.w).toBeLessThanOrEqual(L.face.x + L.face.w + 1e-9)
    expect(c.y + c.h).toBeLessThanOrEqual(L.face.y + L.face.h + 1e-9)
    expect((c.w * 16) / (c.h * 9)).toBeCloseTo(slot, 3)
    expect(c.h).toBeLessThan(L.face.h) // yakınlaştırıldı
    // kafa merkezi kırpmanın üst ~%42'sinde: üstte büyük boşluk kalmaz
    const headY = L.face.y + L.faceFocus.y * L.face.h
    expect((headY - c.y) / c.h).toBeGreaterThan(0.3)
    expect((headY - c.y) / c.h).toBeLessThanOrEqual(0.6)
  })
  it('yakınlık arttıkça kırpma küçülür; 1 = kutunun tamamına yakın; odak değişince kırpma kayar; sınırlar korunur', () => {
    expect(faceCrop({ ...L, faceZoom: 2 }, 16 / 9).h).toBeLessThan(faceCrop({ ...L, faceZoom: 1.3 }, 16 / 9).h)
    expect(faceCrop({ ...L, faceZoom: 1 }, 16 / 9).h).toBeGreaterThan(L.face.h * 0.9)
    const left = faceCrop({ ...L, faceFocus: { x: 0.2, y: 0.5 } }, 16 / 9)
    const right = faceCrop({ ...L, faceFocus: { x: 0.8, y: 0.5 } }, 16 / 9)
    expect(left.x).toBeLessThan(right.x)
    expect(left.x).toBeGreaterThanOrEqual(L.face.x - 1e-9)
    expect(faceCrop({ ...L, faceZoom: 0.1, faceFocus: { x: -3, y: 9 } }, 16 / 9).h).toBeLessThanOrEqual(L.face.h + 1e-9) // saçma değerler sınırlanır
  })
})

describe('Auto Clips: klip süresi 20 sn – 2:58 (178 sn)', () => {
  it('178 sn\'ye sığan konu BÖLÜNMEZ (70 sn\'de kesilmez): ~150 sn\'lik konu tek klip', () => {
    const w = stream([{ secs: 60, vocab: FOOD }, { secs: 150, vocab: FOOT, name: 'Lemina' }, { secs: 60, vocab: FOOD }])
    const clips = findAutoClips(w)
    const lem = clips.filter((c) => c.subject.includes('Lemina'))
    expect(lem).toHaveLength(1)
    expect(lem[0].durationSec).toBeGreaterThan(100)
    expect(lem[0].durationSec).toBeLessThanOrEqual(MAX_CLIP_SEC)
  })
  it('178 sn\'yi aşan konu eşit parçalara bölünür; hiçbir klip 178 sn\'yi aşmaz, 20 sn\'nin altına düşmez', () => {
    const w = stream([{ secs: 40, vocab: FOOD }, { secs: 400, vocab: FOOT, name: 'Zaha' }, { secs: 40, vocab: FOOD }])
    const clips = findAutoClips(w, { max: 30 })
    expect(clips.length).toBeGreaterThanOrEqual(2)
    for (const c of clips) {
      expect(c.durationSec).toBeLessThanOrEqual(MAX_CLIP_SEC)
      expect(c.durationSec).toBeGreaterThanOrEqual(MIN_CLIP_SEC)
    }
  })
  it('kullanıcı seçenekleri sınırlanır: 300 sn istense de 178, 5 sn istense de 20', () => {
    const w = stream([{ secs: 40, vocab: FOOD }, { secs: 400, vocab: FOOT, name: 'Zaha' }, { secs: 40, vocab: FOOD }])
    for (const c of findAutoClips(w, { maxSec: 300, minSec: 5, max: 30 })) {
      expect(c.durationSec).toBeLessThanOrEqual(MAX_CLIP_SEC)
      expect(c.durationSec).toBeGreaterThanOrEqual(MIN_CLIP_SEC)
    }
  })
})

describe('Auto Clips: sosyal medya şeridi yerleşimi', () => {
  it('yüz ile görüntünün kesiştiği çizgiye ortalı, yatayda ortalı, kare içinde; oran bozulmaz', () => {
    const r = overlayRect(0.415, 11.26)
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 5)
    expect(r.y + r.h / 2).toBeCloseTo(0.415, 3) // kesişim çizgisi
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
    expect((r.w * 1080) / (r.h * 1920)).toBeCloseTo(11.26, 1) // piksel oranı korunur
    expect(r.h).toBeLessThan(0.08) // ince şerit
  })
  it('yüz altta ise çizgi aşağı iner; sınırlar korunur', () => {
    const r = overlayRect(0.3, 11, 0.94, 'bottom')
    expect(r.y + r.h / 2).toBeCloseTo(0.7, 2)
    const e = overlayRect(0.7, 1, 1, 'top') // kare şerit: sınırdan taşmaz
    expect(e.y).toBeGreaterThanOrEqual(0)
    expect(e.y + e.h).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe('geçen süre biçimi', () => {
  it('saat/dakika/saniye', async () => {
    const { fmtElapsed } = await import('@shared/autokick')
    expect(fmtElapsed(45_000)).toBe('45 sn')
    expect(fmtElapsed(200_000)).toBe('3 dk 20 sn')
    expect(fmtElapsed(4_325_000)).toBe('1 sa 12 dk')
  })
})

describe('Auto Clips: başlangıç/bitiş rastgele olmasın', () => {
  const W = (text: string, start: number): TranscriptWord => ({ text, start, end: start + 0.4, confidence: 1 })
  /** cümleler: [metin, başlangıç sn]; her cümle ~3 sn, araları 1 sn sessizlik */
  const build = (sents: string[]) => {
    const words: TranscriptWord[] = []
    let t = 0
    for (const s of sents) {
      for (const w of s.split(' ')) { words.push(W(w, t)); t += 0.45 }
      t += 1
    }
    return words
  }
  it('bağlaçla başlayan kısa baş cümle ve yarım biten son cümle atılır; söz payı verilir', async () => {
    const { refineClipBounds } = await import('@shared/autoclips')
    const { buildSegments } = await import('../../src/shared/transcript/sentences')
    const lines = ['Ve işte.', 'Lemina bu sezon çok iyi oynuyor.', 'Orta sahada topu çok iyi taşıyor.', 'Bence takımın en önemli oyuncusu oldu.', 'Ama bir de şey']
    const words = build(lines)
    const segs = buildSegments(words)
    const r = refineClipBounds(segs, segs, words, 5, 100)
    expect(r.piece[0].text).toMatch(/^Lemina/)
    expect(r.piece[r.piece.length - 1].text).toMatch(/oldu\.$/)
    // pay: baştaki söz bitmeden kesilmez, sonda 0,5 sn pay
    expect(r.start).toBeLessThanOrEqual(r.piece[0].start)
    expect(r.end).toBeGreaterThan(r.piece[r.piece.length - 1].end)
  })
  it('süre alt sınırı bozulacaksa baş/son cümleye dokunulmaz', async () => {
    const { refineClipBounds } = await import('@shared/autoclips')
    const { buildSegments } = await import('../../src/shared/transcript/sentences')
    const words = build(['Ve işte.', 'Lemina iyi oynadı bugün.'])
    const segs = buildSegments(words)
    const r = refineClipBounds(segs, segs, words, 30, 100)
    expect(r.piece).toHaveLength(2)
  })
})

describe('Auto Clips: yatay (YouTube) klipler', () => {
  it('yatayda 2 dk 58 sn sınırı yok: uzun konu tek klip kalır; dikeyde bölünür/sığmaz', () => {
    const words = stream([{ secs: 60, vocab: FOOD }, { secs: 330, vocab: FOOT, name: 'Lemina' }, { secs: 60, vocab: FOOD }])
    const h = findAutoClips(words, { horizontal: true, maxSec: 900 })
    expect(h.some((c) => c.durationSec > MAX_CLIP_SEC)).toBe(true)
    const v = findAutoClips(words)
    expect(v.every((c) => c.durationSec <= MAX_CLIP_SEC)).toBe(true)
  })
  it('yatay: en az 3 dk, en çok 25 dk; aynı konu tek klipte toplanır, farklı konular birleşmez', () => {
    const words = stream([{ secs: 60, vocab: FOOD }, { secs: 360, vocab: FOOT, name: 'Lemina' }, { secs: 120, vocab: FOOD }, { secs: 300, vocab: FOOT, name: 'Zaha' }, { secs: 60, vocab: FOOD }])
    const h = findAutoClips(words, { horizontal: true })
    for (const c of h) {
      expect(c.durationSec).toBeGreaterThanOrEqual(180)
      expect(c.durationSec).toBeLessThanOrEqual(1500)
    }
    const lem = h.filter((c) => c.subject.includes('Lemina'))
    const zaha = h.filter((c) => c.subject.includes('Zaha'))
    expect(lem).toHaveLength(1) // 6 dk'lık konuşma parçalanmaz
    expect(lem[0].durationSec).toBeGreaterThan(240)
    expect(zaha.length).toBeGreaterThanOrEqual(1)
    expect(h.some((c) => c.subject.includes('Lemina') && c.subject.includes('Zaha'))).toBe(false) // iki konu tek klibe karışmaz
  })
})

describe('zincir: yatay klipler', () => {
  it('ayar açıksa dikeyden sonra yatay iş de başlatılır; kapalıysa yalnızca dikey', () => {
    const started: { horizontal?: boolean }[] = []
    const mgr = { start: (r: { horizontal?: boolean }) => (started.push(r), `j${started.length}`) }
    const st = (id: string) => ({ id, status: 'done', result: { projectPath: '/x/p.clipforge' } })
    chainAutoClips(st('a1'), new Set(), { autoClipsAfterKick: true, autoClipsMax: 5, autoClipsExport: true, autoClipsHorizontal: true }, mgr)
    expect(started.map((r) => !!r.horizontal)).toEqual([false, true])
    started.length = 0
    chainAutoClips(st('a2'), new Set(), { autoClipsAfterKick: true, autoClipsMax: 5, autoClipsExport: true, autoClipsHorizontal: false }, mgr)
    expect(started.map((r) => !!r.horizontal)).toEqual([false])
  })
})

describe('kısa video altyazısı (2–4 kelime)', () => {
  it('"shorts" stili: iri beyaz, kutusuz; satırlarda 2–4 kelime, tek kelimelik satır kalmaz', async () => {
    const { presetById } = await import('@shared/timeline/captionStyles')
    const { captionsFromWords } = await import('@shared/timeline/captions')
    const st = presetById('shorts')
    expect(st.id).toBe('shorts')
    expect(st.style.color).toBe('#FFFFFF')
    expect(st.style.box).toBeUndefined()
    expect(st.style.maxWords).toBe(4)
    expect(st.style.minWords).toBe(2)
    const txt = 'Beşiktaş kazanırsa ilk sekize girer mi bence kesinlikle konuşabiliriz çünkü puan durumu güzel'.split(' ')
    const words = txt.map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35, confidence: 1 }))
    const caps = captionsFromWords(words, 0, Infinity, { maxWords: 4, minWords: 2, maxLines: 1, maxDurationSec: 2.4 })
    for (const c of caps) {
      const n = c.text.split(' ').length
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(5) // tek kelime komşuya katılınca en fazla 5
    }
    expect(caps.map((c) => c.text).join(' ')).toBe(txt.join(' '))
  })
})

describe('Claude ile edit yap (vlog komutu)', () => {
  it('proje yolunu, sessiz kesme, boşluk kapatma ve rota grafiğini içerir; çağrı metni yok', async () => {
    const { claudeVlogPrompt } = await import('../../src/renderer/claudePrompt')
    const t = claudeVlogPrompt('C:\\Videolar\\paris.clipforge')
    expect(t).toContain('C:\\Videolar\\paris.clipforge')
    expect(t).toMatch(/silence/)
    expect(t).toMatch(/graphic --type globe/)
    expect(t).toMatch(/Belçika/)
    expect(t.toLowerCase()).not.toMatch(/abone|takip et/)
  })
})
