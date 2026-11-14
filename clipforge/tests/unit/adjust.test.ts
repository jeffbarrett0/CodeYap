import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ADJUST_DEFS, adjustFilter, adjustIsDefault, cleanAdjust, previewFilter } from '../../src/shared/adjust'
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
})
