import { createTimelineWithGame } from './helpers'
import { describe, expect, it } from 'vitest'
import { buildExportPlan } from '@shared/export/plan'
import { buildAss, assColor } from '@shared/export/ass'
import { resolveLayout } from '@shared/export/layout'
import { EXPORT_PRESETS, exportWarnings, optionsFromPreset, resolveExportFps, COPYRIGHT_NOTICE } from '@shared/export/presets'
import { createDefaultTimeline, TRACK_IDS } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import type { Clip } from '@shared/types'

const asset = { path: '/rec/Yayın Kaydı çğış.mkv', kind: 'video' as const, audioStreams: [{ index: 0, streamIndex: 1, codec: 'aac', channels: 2, sampleRate: 48000 }, { index: 1, streamIndex: 2, codec: 'aac', channels: 2, sampleRate: 48000 }, { index: 2, streamIndex: 3, codec: 'aac', channels: 2, sampleRate: 48000 }] }
const mk = (id: string, trackId: string, start: number, srcIn: number, srcOut: number, extra: Partial<Clip> = {}): Clip => ({ id, trackId, assetId: 'a1', start, srcIn, srcOut, volume: 1, label: id, ...extra })

/** Katman konumu olmayan (eski sürüm) proje: yerleşim eski düzen şablonlarından gelir */
function legacy(tl: ReturnType<typeof createDefaultTimeline>) {
  return { ...tl, tracks: tl.tracks.filter((t) => ['V1', 'V2', 'A1', 'A2'].includes(t.id)).map(({ placement: _p, ...t }) => t) }
}

function timeline() {
  let tl = legacy(createTimelineWithGame())
  tl = ops.addClip(tl, TRACK_IDS.screen, mk('v', TRACK_IDS.screen, 0, 1394, 1424))
  tl = ops.addClip(tl, TRACK_IDS.webcam, mk('c', TRACK_IDS.webcam, 0, 1394, 1424, { crop: { x: 0.75, y: 0.7, w: 0.25, h: 0.3 } }))
  tl = ops.addClip(tl, TRACK_IDS.game, mk('ga', TRACK_IDS.game, 0, 1394, 1424, { audioStream: 1 }))
  tl = ops.addClip(tl, TRACK_IDS.voice, mk('vo', TRACK_IDS.voice, 0, 1394, 1424, { audioStream: 2 }))
  return { ...tl, captions: [{ id: 'c1', start: 1, end: 3, text: 'Merhaba dünya' }] }
}

describe('düzen', () => {
  it('9:16 oyun ekranı dikey ortada, kamera alt/üst bölgede', () => {
    const bottom = resolveLayout('9:16', 'game-center-cam-bottom', 1080, 1920, { x: 0.7, y: 0.05, w: 0.28, h: 0.2 })
    expect(bottom.screen).toEqual({ x: 0, y: 656, w: 1080, h: 608 })
    expect(bottom.cam!.y).toBeGreaterThanOrEqual(bottom.screen.y + bottom.screen.h)
    expect(bottom.cam!.y + bottom.cam!.h).toBeLessThanOrEqual(1920)
    const top = resolveLayout('9:16', 'game-center-cam-top', 1080, 1920, { x: 0.7, y: 0.05, w: 0.28, h: 0.2 })
    expect(top.cam!.y + top.cam!.h).toBeLessThanOrEqual(top.screen.y)
    expect(top.cam!.y).toBeGreaterThanOrEqual(0)
  })
  it('16:9 ekran tam, kamera köşe overlay', () => {
    const l = resolveLayout('16:9', 'game-center-cam-bottom', 1920, 1080, { x: 0.7, y: 0.05, w: 0.25, h: 0.25 })
    expect(l.screen).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(l.cam).toMatchObject({ x: 1344, y: 54 })
  })
})

describe('ASS altyazı', () => {
  it('renk BGR, zaman kaydırma, Türkçe büyük harf', () => {
    expect(assColor('#FF8800')).toBe('&H000088FF')
    const tl = timeline()
    const ass = buildAss([{ id: '1', start: 11, end: 13, text: 'şimdi ışık' }, { id: '2', start: 1, end: 2, text: 'dışarıda' }], { ...tl.captionStyle, uppercase: true }, 1080, 1920, 10, 20)
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('ŞİMDİ IŞIK')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:03.00')
    expect(ass).not.toContain('DIŞARIDA')
  })
})

describe('dışa aktarma planı', () => {
  const o = optionsFromPreset('shorts')
  const plan = buildExportPlan(timeline(), () => asset, o, '/out/klip çıktı.mp4')

  it('boşluk ve Türkçe karakterli yollar argv olarak olduğu gibi geçer', () => {
    expect(plan.args).toContain('/rec/Yayın Kaydı çğış.mkv')
    expect(plan.args.at(-1)).toBe('/out/klip çıktı.mp4')
    expect(plan.args).toContain('-filter_complex_script')
  })
  it('kırpma noktaları -ss/-t olarak girişlerde', () => {
    const i = plan.args.indexOf('-ss')
    expect(plan.args.slice(i, i + 4)).toEqual(['-ss', '1394.000', '-t', '30.000'])
    expect(plan.durationSec).toBe(30)
  })
  it('filtre grafiği: tabanda siyah, bulanık dolgu, kamera kırpma, altyazı, ses karışımı', () => {
    const f = plan.files.find((x) => x.name === 'filters.txt')!.content
    expect(f).toContain('color=c=0x000000:s=1080x1920:r=30:d=30.000')
    expect(f).toContain('boxblur')
    expect(f).toContain('crop=iw*0.25000:ih*0.30000:iw*0.75000:ih*0.70000')
    expect(f).toContain('ass=captions.ass')
    expect(f).toContain('[2:a:1]')
    expect(f).toContain('[3:a:2]')
    expect(f).toMatch(/amix=inputs=2/)
    expect(f).toContain('loudnorm')
    expect(plan.files.find((x) => x.name === 'captions.ass')).toBeTruthy()
  })
  it('oyun/konuşma iz seviyeleri ayrı uygulanır', () => {
    let tl = timeline()
    tl = ops.updateTrack(tl, TRACK_IDS.game, { volume: 0.3 })
    tl = ops.updateTrack(tl, TRACK_IDS.voice, { volume: 1.5 })
    const f = buildExportPlan(tl, () => asset, o, 'x.mp4').files[1].content
    expect(f).toContain('volume=0.300')
    expect(f).toContain('volume=1.500')
  })
  it('aralık verilince giriş kırpılır ve gecikme eklenir', () => {
    const p = buildExportPlan(timeline(), () => asset, o, 'x.mp4', { start: 10, end: 20 })
    const i = p.args.indexOf('-ss')
    expect(p.args.slice(i, i + 4)).toEqual(['-ss', '1404.000', '-t', '10.000'])
    expect(p.durationSec).toBe(10)
  })
  it('ses yoksa sessiz akış üretilir; kayıp medya uyarı verir', () => {
    const tl = ops.deleteClip(ops.deleteClip(timeline(), 'ga'), 'vo')
    const f = buildExportPlan(tl, () => asset, o, 'x.mp4').files[1].content
    expect(f).toContain('anullsrc')
    const missing = buildExportPlan(timeline(), () => undefined, o, 'x.mp4')
    expect(missing.warnings.length).toBeGreaterThan(0)
  })
  it('bitrate/crf seçenekleri', () => {
    // varsayılan: maksimum kalite (CRF 14, bitrate yalnızca üst sınır)
    expect(plan.args).toEqual(expect.arrayContaining(['-crf', '14', '-maxrate', '150000k', '-bufsize', '300000k']))
    expect(plan.args).not.toContain('-b:v')
    expect(plan.args.join(' ')).toContain('-preset slow')
    expect(plan.args.join(' ')).toContain('-b:a 320k')
    expect(plan.args.join(' ')).toContain('-colorspace bt709')
    expect(plan.files.find((x) => x.name === 'filters.txt')!.content).toContain('flags=lanczos')
    // crf=0: hedef bitrate modu
    const abr = buildExportPlan(timeline(), () => asset, { ...o, crf: 0 }, 'x.mp4')
    expect(abr.args).toEqual(expect.arrayContaining(['-b:v', '150000k']))
    const crf = buildExportPlan(timeline(), () => asset, { ...o, crf: 20, encoderPreset: 'medium' }, 'x.mp4')
    expect(crf.args).toEqual(expect.arrayContaining(['-crf', '20']))
    expect(crf.args.join(' ')).toContain('-preset medium')
  })
})

describe('şablonlar', () => {
  it('tüm şablonlar maksimum kalite: CRF ≤ 16, yavaş ön ayar, 320 kbps ses, kaynak kare hızı; 4K seçenekleri var', () => {
    for (const p of EXPORT_PRESETS) expect(p.options, p.id).toMatchObject({ crf: 14, encoderPreset: 'slow', audioBitrateKbps: 320, fps: 0 })
    expect(EXPORT_PRESETS.find((p) => p.id === 'shorts4k')!.options).toMatchObject({ width: 2160, height: 3840, aspect: '9:16' })
    expect(EXPORT_PRESETS.find((p) => p.id === 'youtube4k')!.options).toMatchObject({ width: 3840, height: 2160 })
  })
  it('kare hızı otomatik: kaynağın en yükseği (24–60 arası); kaynak yoksa 30; elle seçim korunur', () => {
    expect(resolveExportFps(0, [29.97, 59.94])).toBe(60)
    expect(resolveExportFps(0, [23.976])).toBe(24)
    expect(resolveExportFps(0, [120])).toBe(60)
    expect(resolveExportFps(0, [])).toBe(30)
    expect(resolveExportFps(25, [60])).toBe(25)
  })
  it('TikTok/Reels/Shorts 9:16 ve 60 sn sınırı; YouTube 16:9', () => {
    const s = EXPORT_PRESETS.find((p) => p.id === 'shorts')!
    expect(s.options).toMatchObject({ aspect: '9:16', width: 1080, height: 1920, maxDurationSec: 60 })
    expect(EXPORT_PRESETS.find((p) => p.id === 'youtube')!.options).toMatchObject({ aspect: '16:9', width: 1920, height: 1080 })
  })
  it('60 sn aşımı uyarısı, telif hatırlatması hukuki tavsiye değil der', () => {
    expect(exportWarnings(75, optionsFromPreset('shorts'))[0]).toContain('60')
    expect(exportWarnings(45, optionsFromPreset('shorts'))).toEqual([])
    expect(COPYRIGHT_NOTICE).toContain('hukuki tavsiye değildir')
  })
})
