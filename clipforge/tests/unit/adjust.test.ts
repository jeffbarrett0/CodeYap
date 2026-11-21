import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ADJUST_DEFS, adjustFilter, adjustIsDefault, autoAdjustFrom, cleanAdjust, previewFilter, withDefaultAdjust } from '../../src/shared/adjust'
import { planFastCut } from '../../src/main/autokick/fastcut'
import { buildExportPlan } from '../../src/shared/export/plan'
import { optionsFromPreset } from '../../src/shared/export/presets'
import { createDefaultTimeline } from '../../src/shared/timeline/model'
import * as ops from '../../src/shared/timeline/ops'
import type { Clip } from '../../src/shared/types'

describe('CapCut tarzı ayarlar', () => {
  it('varsayılan (hepsi 0) filtre üretmez; sıfırlar temizlenir; sınırlar kırpılır', () => {
    expect(adjustFilter(undefined)).toBe('')
    expect(adjustFilter({ sharpen: 0, temp: 0 })).toBe('')
    expect(adjustIsDefault({})).toBe(true)
    expect(cleanAdjust({ sharpen: 0, temp: 20 })).toEqual({ temp: 20 })
    expect(cleanAdjust({ sharpen: 0 })).toBeUndefined()
    expect(cleanAdjust({ temp: 500 })).toEqual({ temp: 100 })
    expect(previewFilter(undefined)).toBe('none')
    expect(previewFilter({ contrast: 50 })).toMatch(/contrast\(1\.250\)/)
  })
  it('keskinlik artınca unsharp, tanecik noise, vinyet vignette üretilir', () => {
    expect(adjustFilter({ sharpen: 60 })).toMatch(/unsharp=5:5:1\.200/)
    expect(adjustFilter({ particles: 40 })).toMatch(/noise=/)
    expect(adjustFilter({ vignette: 50 })).toMatch(/vignette=angle=/)
  })
  it('tüm ayarlar birlikte gerçek ffmpeg tarafından kabul edilir', () => {
    const ff = require('ffmpeg-static') as string
    const all = Object.fromEntries(ADJUST_DEFS.map((d) => [d.key, d.max === 100 && d.min === 0 ? 50 : -35]))
    const f = adjustFilter(all).slice(1)
    expect(() => execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=1', '-vf', f, '-frames:v', '3', '-f', 'null', '-'], { stdio: 'pipe' })).not.toThrow()
  })
  it('dışa aktarma planına girer: görüntü ayarı + ses eşitleme (loudnorm)', () => {
    const asset = { path: '/rec/a.mp4', kind: 'video' as const, width: 1280, height: 720, audioStreams: [{ index: 0, streamIndex: 1, codec: 'aac', channels: 2, sampleRate: 48000 }] }
    const mk = (id: string, trackId: string, extra: Partial<Clip> = {}): Clip => ({ id, trackId, assetId: 'a1', start: 0, srcIn: 0, srcOut: 5, volume: 0.2, label: id, ...extra })
    let tl = createDefaultTimeline()
    tl = ops.addClip(tl, 'V3', mk('v', 'V3', { groupId: 'g', fx: { adjust: { sharpen: 60, contrast: 20 } } }))
    tl = ops.addClip(tl, 'A1', mk('a', 'A1', { audioStream: 0, groupId: 'g', fx: { normalize: true } }))
    const f = buildExportPlan(tl, () => asset as never, optionsFromPreset('youtube'), 'x.mp4').files.find((x) => x.name === 'filters.txt')!.content
    expect(f).toMatch(/unsharp=5:5:1\.200/)
    expect(f).toMatch(/eq=contrast=1\.100/)
    expect(f).toMatch(/loudnorm=I=-16/)
    expect(f).toMatch(/volume=0\.2/)
  })

  it('otomatik ayar: ayarlardan +5 kontrast/+5 keskinlik; kapalıysa ya da 0 ise yok', () => {
    expect(autoAdjustFrom({ autoAdjustEnabled: true, autoAdjustContrast: 5, autoAdjustSharpen: 5 })).toEqual({ contrast: 5, sharpen: 5 })
    expect(autoAdjustFrom({ autoAdjustEnabled: false, autoAdjustContrast: 5, autoAdjustSharpen: 5 })).toBeUndefined()
    expect(autoAdjustFrom({ autoAdjustEnabled: true, autoAdjustContrast: 0, autoAdjustSharpen: 0 })).toBeUndefined()
    expect(adjustFilter({ contrast: 5, sharpen: 5 })).toMatch(/eq=contrast=1\.025/)
    expect(adjustFilter({ contrast: 5, sharpen: 5 })).toMatch(/unsharp=5:5:0\.100/)
  })
  it('varsayılan ayar yalnızca video kliplerine eklenir; kendi ayarı olana, yeşil perdeliye, görsele ve metne dokunulmaz', () => {
    const tl = {
      tracks: [
        { kind: 'video', clips: [{ assetId: 'a', id: 1 }, { assetId: 'a', id: 2, fx: { adjust: { sharpen: 40 } } }, { assetId: 'b', id: 3, fx: { chroma: { color: '#00FF00' } } }, { id: 4 }] },
        { kind: 'image', clips: [{ assetId: 'p', id: 5 }] },
        { kind: 'audio', clips: [{ assetId: 'a', id: 6 }] }
      ]
    }
    const r = withDefaultAdjust(tl, { contrast: 5, sharpen: 5 }) as typeof tl
    const v = r.tracks[0].clips as { fx?: { adjust?: unknown } }[]
    expect(v[0].fx!.adjust).toEqual({ contrast: 5, sharpen: 5 })
    expect(v[1].fx!.adjust).toEqual({ sharpen: 40 }) // kendi ayarı korunur
    expect(v[2].fx!.adjust).toBeUndefined() // çağrı butonu
    expect((v[3] as { fx?: unknown }).fx).toBeUndefined() // metin
    expect((r.tracks[1].clips[0] as { fx?: unknown }).fx).toBeUndefined() // şerit/görsel
    expect(withDefaultAdjust(tl, undefined)).toBe(tl)
    expect((tl.tracks[0].clips[0] as { fx?: unknown }).fx).toBeUndefined() // orijinal çizelge değişmez
  })
  it('Auto Kick tam video filtresi: ayar verilirse görüntü zincirine eklenir, verilmezse eklenmez', () => {
    const asset = { path: '/r/a.mkv', fps: 30, audioStreams: [{ index: 0, streamIndex: 1, codec: 'aac', channels: 2, sampleRate: 48000 }], audioMap: { mix: 0 } } as never
    const o = { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192 }
    expect(planFastCut(asset, [[0, 10]], { ...o, adjust: { contrast: 5, sharpen: 5 } }, 'o.mp4').filters).toMatch(/fps=30\/1,eq=contrast=1\.025.*unsharp=5:5:0\.100.*\[v\]/)
    expect(planFastCut(asset, [[0, 10]], o, 'o.mp4').filters).not.toMatch(/unsharp/)
  })
})
