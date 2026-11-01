import { describe, expect, it } from 'vitest'
import { autoKickPaths, fullVideoOptions } from '../../src/main/autokick/pipeline'
import { initialStages } from '../../src/shared/autokick'
import type { MediaAsset } from '../../src/shared/types'

const asset = (w: number, h: number) => ({ width: w, height: h }) as MediaAsset

describe('Auto Kick yardımcıları', () => {
  it('çıkış yolları: kaydın yanında AutoKick/<ad>/, boşluk ve Türkçe karakter korunur', () => {
    const p = autoKickPaths('/yayınlar/Şubat Yayını çğ.mkv')
    expect(p.dir).toBe('/yayınlar/AutoKick/Şubat Yayını çğ')
    expect(p.full).toBe('/yayınlar/AutoKick/Şubat Yayını çğ/Şubat Yayını çğ - full.mp4')
    expect(p.project.endsWith('Şubat Yayını çğ.clipforge')).toBe(true)
    expect(autoKickPaths('/a/b.mp4', '/çıkış').dir).toBe('/çıkış')
  })
  it('tam video ayarı: hızlı = veryfast/CRF 20; yüksek = şablonun maksimum kalitesi; oran ve çözünürlüğe göre şablon', () => {
    const f = fullVideoOptions(asset(1920, 1080), 'fast')
    expect(f).toMatchObject({ aspect: '16:9', width: 1920, encoderPreset: 'veryfast', crf: 20 })
    expect(f.maxDurationSec).toBeUndefined()
    expect(fullVideoOptions(asset(1920, 1080), 'high')).toMatchObject({ crf: 14, encoderPreset: 'slow' })
    expect(fullVideoOptions(asset(3840, 2160), 'fast').width).toBe(3840)
    expect(fullVideoOptions(asset(1080, 1920), 'fast').aspect).toBe('9:16')
  })
  it('aşamalar sırası', () => expect(initialStages().map((s) => s.id)).toEqual(['import', 'transcribe', 'silence', 'full', 'clips']))
})
