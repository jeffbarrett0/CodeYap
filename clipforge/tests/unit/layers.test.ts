import { createTimelineWithGame } from './helpers'
import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, findClip, nearestAspect, timelineDuration, TRACK_IDS } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { applyTemplate, BUILTIN_TEMPLATES, DEFAULT_TEMPLATE, templateFromTimeline } from '@shared/timeline/templates'
import { cmd } from '@shared/timeline/commands'
import { History } from '@shared/timeline/history'
import { buildAss, captionLayout } from '@shared/export/ass'
import { buildExportPlan } from '@shared/export/plan'
import { optionsFromPreset } from '@shared/export/presets'
import type { Caption, Clip, Timeline } from '@shared/types'

const TEXT = { text: 'Kendi yazım', fontFamily: 'Impact', fontSize: 62, color: '#FFFFFF', outlineColor: '#000000', outlineWidth: 6, bold: false, animation: 'pulse' as const }
const mk = (id: string, trackId: string, start: number, srcIn: number, srcOut: number, extra: Partial<Clip> = {}): Clip => ({ id, trackId, assetId: 'a1', start, srcIn, srcOut, volume: 1, label: id, ...extra })
const clips = (tl: Timeline, id: string) => tl.tracks.find((t) => t.id === id)!.clips

function base(): Timeline {
  let tl = createTimelineWithGame()
  tl = ops.addClip(tl, 'V2', mk('cam', 'V2', 0, 100, 130, { groupId: 'g' }))
  tl = ops.addClip(tl, 'A2', mk('voice', 'A2', 0, 100, 130, { groupId: 'g', audioStream: 0 }))
  return tl
}

describe('şablonlar', () => {
  it('varsayılan şablon: yalnızca tam kare Video; hiçbir hazır görsel/metin/oyun ekranı yok', () => {
    expect(DEFAULT_TEMPLATE.layers.map((l) => l.id)).toEqual(['V1', 'V2', 'V3', 'I1', 'I2'])
    expect(DEFAULT_TEMPLATE.layers.map((l) => l.name)).toEqual(['Video 1', 'Video 2', 'Video 3', 'Fotoğraf 1', 'Fotoğraf 2'])
    expect(DEFAULT_TEMPLATE.layers[0]).toMatchObject({ name: 'Video 1', kind: 'video' })
    expect(DEFAULT_TEMPLATE.layers[0].placement).toMatchObject({ fit: 'contain', rect: { x: 0, y: 0, w: 1, h: 1 } })
    expect(DEFAULT_TEMPLATE.layers.some((l) => l.kind === 'text' || l.textDefault)).toBe(false)
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(4)
  })

  it('şablon uygulanınca konumlar değişir, klipler korunur, kullanıcı katmanı altta kalır', () => {
    let tl = base()
    tl = ops.addTrack(tl, { name: 'Logo', kind: 'image', role: 'image' })
    const extra = tl.tracks[0].id
    const out = applyTemplate(tl, BUILTIN_TEMPLATES[1])
    expect(out.tracks.find((t) => t.id === 'V2')!.placement!.rect.y).toBeCloseTo(0.675)
    expect(clips(out, 'V2')).toHaveLength(1)
    expect(out.tracks.map((t) => t.id).indexOf(extra)).toBeGreaterThan(out.tracks.map((t) => t.id).indexOf('V1'))
  })

  it('katman düzeni şablon olarak yakalanıp tekrar uygulanabilir (konum, görünürlük, metin)', () => {
    let tl = base()
    tl = ops.setPlacement(tl, 'V2', { rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, visible: false })
    tl = ops.addTrack(tl, { id: 'TX', name: 'Yazı', kind: 'text', role: 'text', textDefault: TEXT })
    tl = ops.fillTextTracks(tl)
    tl = cmd.textSpec(clips(tl, 'TX')[0].id, { text: 'BENİ TAKİP ET' }).do(tl)
    const tpl = templateFromTimeline(tl, 'ozel', 'Özel düzen')
    const fresh = applyTemplate(createTimelineWithGame(), tpl)
    expect(fresh.tracks.find((t) => t.id === 'V2')!.placement).toMatchObject({ visible: false, rect: { x: 0.1, y: 0.2 } })
    expect(fresh.tracks.find((t) => t.id === 'TX')!.textDefault!.text).toBe('BENİ TAKİP ET')
    // JSON olarak serileştirilebilir
    expect(JSON.parse(JSON.stringify(tpl))).toEqual(tpl)
  })
})

describe('katman işlemleri', () => {
  it('konum/boyut/görünürlük güncellenir, geri alınır', () => {
    const h = new History(base())
    h.execute(cmd.placement('V2', { rect: { x: 0, y: 0, w: 0.5, h: 0.2 } }))
    expect(h.present.tracks.find((t) => t.id === 'V2')!.placement!.rect).toMatchObject({ w: 0.5, h: 0.2 })
    h.execute(cmd.placement('V2', { visible: false }))
    expect(h.present.tracks.find((t) => t.id === 'V2')!.placement!.visible).toBe(false)
    h.undo()
    expect(h.present.tracks.find((t) => t.id === 'V2')!.placement!.visible).toBe(true)
  })

  it('katman ekleme/silme/sıralama; ses katmanı sona, görsel katman öne', () => {
    let tl = ops.addTrack(base(), { name: 'Logo', kind: 'image', role: 'image' })
    expect(tl.tracks[0].name).toBe('Logo')
    const id = tl.tracks[0].id
    tl = ops.moveTrackOrder(tl, id, 'down')
    expect(tl.tracks[1].id).toBe(id)
    expect(ops.moveTrackOrder(tl, 'A1', 'up')).toBe(tl) // ses izleri sıralanmaz
    tl = ops.addTrack(tl, { name: 'Müzik', kind: 'audio', role: 'mix' })
    expect(tl.tracks.at(-1)!.name).toBe('Müzik')
    expect(ops.removeTrack(tl, id).tracks.some((t) => t.id === id)).toBe(false)
  })

  it('kullanıcının eklediği boş metin izi timeline uzunluğunca kendi varsayılan metniyle dolar; hazır metin üretilmez', () => {
    expect(ops.fillTextTracks(base()).tracks.some((t) => t.kind === 'text')).toBe(false)
    expect(base().tracks.some((t) => t.kind === 'text')).toBe(false)
    const tl = ops.fillTextTracks(ops.addTrack(base(), { id: 'TX', name: 'Yazı', kind: 'text', role: 'text', textDefault: TEXT }))
    expect(clips(tl, 'TX')).toHaveLength(1)
    expect(clips(tl, 'TX')[0].text!.text).toBe('Kendi yazım')
    expect(clips(tl, 'TX')[0].srcOut - clips(tl, 'TX')[0].srcIn).toBeCloseTo(30)
    expect(ops.fillTextTracks(createTimelineWithGame())).toEqual(createTimelineWithGame()) // boş projede klip yok
  })
})

describe('kesme, birleştirme, boşluk kapatma', () => {
  it('cutRange: tüm izlerden keser, sonrasını sola kaydırır, bağlı klipler birlikte bölünür', () => {
    const tl = ops.cutRange(base(), 10, 15)
    const cam = clips(tl, 'V2')
    expect(cam).toHaveLength(2)
    expect(cam[0]).toMatchObject({ start: 0, srcIn: 100, srcOut: 110 })
    expect(cam[1]).toMatchObject({ start: 10, srcIn: 115, srcOut: 130 })
    expect(clips(tl, 'A2').map((c) => [c.start, c.srcIn, c.srcOut])).toEqual([[0, 100, 110], [10, 115, 130]])
    expect(timelineDuration(tl)).toBeCloseTo(25)
    expect(cam[1].groupId).toBe(clips(tl, 'A2')[1].groupId)
  })

  it('cutRange: baştan/sondan kısmi kesme, ripple kapalıysa boşluk bırakır, altyazılar kayar', () => {
    let tl = base()
    tl = { ...tl, captions: [{ id: 'c1', start: 2, end: 4, text: 'a' }, { id: 'c2', start: 11, end: 13, text: 'b' }, { id: 'c3', start: 20, end: 22, text: 'c' }] }
    const head = ops.cutRange(tl, 0, 5)
    expect(clips(head, 'V2')[0]).toMatchObject({ start: 0, srcIn: 105, srcOut: 130 })
    const tail = ops.cutRange(tl, 25, 40)
    expect(clips(tail, 'V2')[0]).toMatchObject({ srcOut: 125 })
    const cut = ops.cutRange(tl, 10, 15)
    expect(cut.captions.map((c) => [c.id, c.start])).toEqual([['c1', 2], ['c3', 15]])
    const hole = ops.cutRange(tl, 10, 15, false)
    expect(clips(hole, 'V2')[1].start).toBe(15)
    expect(ops.cutRange(tl, 5, 5)).toBe(tl)
  })

  it('kilitli iz kesmeden etkilenmez', () => {
    const tl = ops.cutRange(ops.updateTrack(base(), 'A2', { locked: true }), 10, 15)
    expect(clips(tl, 'A2')).toHaveLength(1)
    expect(clips(tl, 'V2')).toHaveLength(2)
  })

  it('joinWithNext: kesintisiz bitişik parçaları (gruplarıyla) birleştirir; bitişik değilse dokunmaz', () => {
    const split = ops.splitClip(base(), 'cam', 12)
    const first = clips(split, 'V2')[0].id
    const joined = ops.joinWithNext(split, first)
    expect(clips(joined, 'V2')).toHaveLength(1)
    expect(clips(joined, 'V2')[0]).toMatchObject({ srcIn: 100, srcOut: 130 })
    expect(clips(joined, 'A2')).toHaveLength(1)
    const gapped = ops.moveClip(split, clips(split, 'V2')[1].id, 20)
    expect(ops.joinWithNext(gapped, first)).toBe(gapped)
  })

  it('closeGaps: hiçbir izde içerik olmayan boşlukları kapatır; metin izleri sayılmaz', () => {
    let tl = base()
    tl = ops.addClip(tl, 'V2', mk('cam2', 'V2', 50, 200, 210))
    tl = ops.addClip(tl, 'A2', mk('v2', 'A2', 50, 200, 210, { audioStream: 0 }))
    const out = ops.closeGaps(tl)
    expect(clips(out, 'V2')[1].start).toBeCloseTo(30)
    expect(clips(out, 'A2')[1].start).toBeCloseTo(30)
    expect(timelineDuration(out)).toBeCloseTo(40)
  })
})

describe('ASS metin katmanı', () => {
  it('konum, stil, sarma ve animasyonlar', () => {
    const spec = TEXT
    const ass = buildAss([], createTimelineWithGame().captionStyle, 1080, 1920, 0, 10, [
      { start: 1, end: 6, spec, rect: { x: 30, y: 740, w: 1020, h: 180 } },
      { start: 0, end: 3, spec: { ...spec, animation: 'slide-up' }, rect: { x: 0, y: 0, w: 1080, h: 100 } }
    ])
    expect(ass).toContain('Style: Txt0,Impact,62')
    expect(ass).toContain('\\an5\\pos(540,830)')
    expect(ass).toContain('\\t(400,700,\\fscx108\\fscy108)') // pulse
    expect(ass).toContain('\\move(540,')
    expect(ass).toContain('Kendi yazım')
  })
})

describe('katman konumlu dışa aktarma planı', () => {
  const asset = { path: '/rec/k.mkv', kind: 'video' as const, audioStreams: [{ index: 0, streamIndex: 1, codec: 'aac', channels: 2, sampleRate: 48000 }] }
  const img = { path: '/img/görsel çğ.png', kind: 'image' as const, audioStreams: [] }
  const lookup = (id: string) => (id === 'img' ? img : asset)

  function tl3() {
    let tl = createTimelineWithGame()
    tl = ops.addClip(tl, 'V2', mk('cam', 'V2', 0, 100, 110))
    tl = ops.addClip(tl, 'I1', { ...mk('img', 'I1', 0, 0, 10), assetId: 'img' })
    tl = ops.addClip(tl, 'V1', mk('game', 'V1', 0, 100, 110))
    tl = ops.addClip(tl, 'A2', mk('voice', 'A2', 0, 100, 110, { audioStream: 0 }))
    tl = ops.addTrack(tl, { id: 'TX', name: 'Yazı', kind: 'text', role: 'text', placement: { rect: { x: 0.03, y: 0.38, w: 0.94, h: 0.1 }, fit: 'contain', visible: true, opacity: 1 }, textDefault: { ...TEXT, text: 'KENDİ YAZIM' } })
    return ops.fillTextTracks(tl)
  }

  it('yüz üstte, görsel altta; oyun katmanı kapalıyken girişe alınmaz; metinler ASS olarak', () => {
    const plan = buildExportPlan(tl3(), lookup, optionsFromPreset('shorts'), 'x.mp4')
    const f = plan.files.find((x) => x.name === 'filters.txt')!.content
    expect(f).toContain('overlay=x=0+(1080-overlay_w)/2') // üst video: sığdır, alanın içinde ortalı
    expect(f).toMatch(/overlay=0:797/) // görsel: 0.415*1920
    expect(plan.args.join(' ')).toContain('-loop 1')
    expect(plan.args).toContain('/img/görsel çğ.png')
    // oyun klibi (V1) kapalı: yalnızca yüz + görsel + ses girişi
    expect(plan.args.filter((a) => a === '-i')).toHaveLength(3)
    const ass = plan.files.find((x) => x.name === 'captions.ass')!.content
    expect(ass).toContain('KENDİ YAZIM')
    expect(f).toContain('ass=captions.ass')
  })

  it('oyun katmanı açılınca girişe eklenir; katman sırası çizimi belirler', () => {
    const on = ops.setPlacement(tl3(), 'V1', { visible: true })
    const plan = buildExportPlan(on, lookup, optionsFromPreset('shorts'), 'x.mp4')
    expect(plan.args.filter((a) => a === '-i')).toHaveLength(4)
    // alttaki katman (oyun) önce, sonra görsel, en sonda yüz çizilir → giriş sırası da böyledir
    const inputs = plan.args.flatMap((a, i) => (plan.args[i - 1] === '-i' ? [a] : []))
    expect(inputs).toEqual(['/rec/k.mkv', '/img/görsel çğ.png', '/rec/k.mkv', '/rec/k.mkv'])
  })

  it('kırpma (alttan yukarı) video katmanında kırp filtresi olarak, kapak ve sığdır modunda uygulanır', () => {
    let tl = createTimelineWithGame()
    tl = ops.addClip(tl, 'V2', mk('cam', 'V2', 0, 100, 110, { crop: { x: 0, y: 0, w: 1, h: 0.6 } }))
    for (const fit of ['cover', 'contain'] as const) {
      const t = ops.setPlacement(tl, 'V2', { fit })
      const f = buildExportPlan(t, lookup, optionsFromPreset('shorts'), 'x.mp4').files.find((x) => x.name === 'filters.txt')!.content
      expect(f).toContain('crop=iw*1.00000:ih*0.60000:iw*0.00000:ih*0.00000') // alt %40 kesildi
      expect(f.indexOf('ih*0.60000')).toBeLessThan(f.indexOf('scale=')) // önce kırp, sonra yerleştir
    }
  })

  it('şeffaflık ve arka plan rengi', () => {
    let tl = ops.setPlacement(tl3(), 'V2', { opacity: 0.5 })
    tl = { ...tl, background: '#112233' }
    const f = buildExportPlan(tl, lookup, optionsFromPreset('shorts'), 'x.mp4').files.find((x) => x.name === 'filters.txt')!.content
    expect(f).toContain('color=c=0x112233')
    expect(f).toContain('colorchannelmixer=aa=0.500')
  })
})

void findClip
void TRACK_IDS

describe('altyazı konumu (sürükleyerek taşıma)', () => {
  const tl = (): Timeline => ({ ...createTimelineWithGame(), captions: [{ id: 'c1', start: 1, end: 3, text: 'Birinci satır' }, { id: 'c2', start: 4, end: 6, text: 'İkinci' }] as Caption[] })

  it('konum yalnızca seçilen altyazıyı değiştirir; sınırlar 0..1; varsayılana dönülebilir', () => {
    const t1 = ops.setCaptionPos(tl(), 'c1', { x: 0.3, y: 1.4 })
    expect(t1.captions[0].pos).toEqual({ x: 0.3, y: 1 })
    expect(t1.captions[1].pos).toBeUndefined()
    const t2 = ops.setCaptionPos(t1, 'c1', undefined)
    expect(t2.captions[0]).toEqual({ id: 'c1', start: 1, end: 3, text: 'Birinci satır' })
    const all = ops.setAllCaptionPos(tl(), { x: 0.5, y: 0.2 })
    expect(all.captions.every((c) => c.pos?.y === 0.2)).toBe(true)
  })

  it('konum komutu sürüklemede tek adımda geri alınır', () => {
    let t = 0
    const h = new History(tl(), 200, () => t)
    for (const y of [0.5, 0.52, 0.55, 0.6]) {
      t += 40
      h.execute(cmd.captionPos('c1', { x: 0.5, y }))
    }
    expect(h.present.captions[0].pos!.y).toBe(0.6)
    h.undo()
    expect(h.present.captions[0].pos).toBeUndefined()
  })

  it('önizleme/sürükleme yerleşimi ile dışa aktarma (ASS \\pos) aynı hesabı kullanır', () => {
    const t = ops.setCaptionPos(tl(), 'c2', { x: 0.25, y: 0.4 })
    const lay = captionLayout(t.captionStyle, t.captions[1], 1080, 1920)
    expect([lay.cx, lay.cy]).toEqual([270, 768])
    const ass = buildAss(t.captions, t.captionStyle, 1080, 1920)
    expect(ass).toContain('\\pos(270,768)')
    // konumsuz altyazı stildeki varsayılan konumda
    const def = captionLayout(t.captionStyle, t.captions[0], 1080, 1920)
    expect(def.cx).toBe(540)
    expect(ass).toContain(`\\pos(540,${def.cy})`)
    expect(lay.w).toBeGreaterThan(0)
    expect(lay.h).toBeGreaterThan(0)
  })
})

describe('otomatik en-boy oranı ve katman sınırları', () => {
  it('nearestAspect: gerçek boyuta göre en yakın desteklenen oran', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9')
    expect(nearestAspect(1280, 720)).toBe('16:9')
    expect(nearestAspect(1080, 1920)).toBe('9:16')
    expect(nearestAspect(1080, 1080)).toBe('1:1')
    expect(nearestAspect(1080, 1350)).toBe('1:1') // 4:5 → kareye yakın
    expect(nearestAspect(3840, 1600)).toBe('16:9') // ultra geniş → en yakın
    expect(nearestAspect(0, 0)).toBe('16:9')
  })

  it('elle oran seçimi otomatiği kapatır; otomatik komut oranı uygular', () => {
    const t0 = createDefaultTimeline()
    expect(t0.aspectAuto).toBe(true)
    const manual = cmd.aspect('1:1').do(t0)
    expect(manual).toMatchObject({ aspect: '1:1', aspectAuto: false })
    const auto = cmd.aspectAuto(true, '9:16').do(manual)
    expect(auto).toMatchObject({ aspect: '9:16', aspectAuto: true })
  })

  it('katman dikdörtgeni kare içinde tutulur (taşma yok); bozuk değerler onarılır', () => {
    const tl = createDefaultTimeline()
    const big = ops.setPlacement(tl, 'V2', { rect: { x: -0.4, y: 0.2, w: 1.96, h: 3 } })
    expect(big.tracks.find((t) => t.id === 'V2')!.placement!.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    const off = ops.clampRect({ x: 0.9, y: 0.95, w: 0.5, h: 0.5 })
    expect(off.x + off.w).toBeLessThanOrEqual(1)
    expect(off.y + off.h).toBeLessThanOrEqual(1)
    expect(ops.clampRect({ x: NaN, y: NaN, w: NaN, h: NaN })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(ops.clampRect({ x: 0, y: 0, w: 0, h: 0 }).w).toBeCloseTo(0.03)
    // kare dışına taşmış eski proje onarılır
    const broken = { ...tl, tracks: tl.tracks.map((t) => (t.id === 'V2' ? { ...t, placement: { ...t.placement!, rect: { x: -1, y: -1, w: 3, h: 3 } } } : t)) }
    expect(ops.sanitizePlacements(broken).tracks.find((t) => t.id === 'V2')!.placement!.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})
