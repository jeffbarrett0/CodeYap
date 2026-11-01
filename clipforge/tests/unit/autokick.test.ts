import { describe, expect, it } from 'vitest'
import { autoKickPaths } from '../../src/main/autokick/pipeline'
import { mergeRanges, planFastCut, selectExpr, snapToFrame } from '../../src/main/autokick/fastcut'
import { initialStages } from '../../src/shared/autokick'
import { createDefaultTimeline } from '../../src/shared/timeline/model'
import * as ops from '../../src/shared/timeline/ops'
import { cmd } from '../../src/shared/timeline/commands'
import type { Clip, MediaAsset } from '../../src/shared/types'

describe('Auto Kick yardımcıları', () => {
  it('çıkış yolları: kaydın yanında AutoKick/<ad>/, boşluk ve Türkçe karakter korunur', () => {
    const p = autoKickPaths('/yayınlar/Şubat Yayını çğ.mkv')
    expect(p.dir).toBe('/yayınlar/AutoKick/Şubat Yayını çğ')
    expect(p.full).toBe('/yayınlar/AutoKick/Şubat Yayını çğ/Şubat Yayını çğ - full.mp4')
    expect(autoKickPaths('/a/b.mp4', '/çıkış').dir).toBe('/çıkış')
  })
  it('aşamalar: içe aktar → transkripsiyon → sessiz kes → boşluk kapat → tam video', () =>
    expect(initialStages().map((s) => s.id)).toEqual(['import', 'transcribe', 'silence', 'gaps', 'full']))
})

describe('hızlı kesim (tek kaynak, yüzlerce kesim)', () => {
  const asset = { path: '/yayın/kayıt çğ.mkv', fps: 60, audioStreams: [{}, {}], audioMap: { mix: 1 } } as unknown as MediaAsset
  it('kare ızgarası, birleştirme, ifade', () => {
    expect(snapToFrame(1.0083, 60)).toBeCloseTo(1.0, 6)
    expect(mergeRanges([[5, 6], [0, 2], [2, 3], [5.5, 7]])).toEqual([[0, 3], [5, 7]])
    expect(selectExpr([[1, 2]], 30)).toBe('gte(t,0.9917)*lt(t,1.9917)')
  })
  it('plan: tek giriş, görüntü + seçilen ses akışı, 1500 aralıkta da tek filtre betiği', () => {
    const ranges = Array.from({ length: 1500 }, (_, i) => [i * 5, i * 5 + 4] as [number, number])
    const plan = planFastCut(asset, ranges, { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192 }, '/o/out.mp4')
    expect(plan.args.filter((a) => a === '-i')).toHaveLength(1)
    expect(plan.filters).toContain('[0:a:1]') // karışım track'i
    expect(plan.filters).toContain('asetnsamples=n=160')
    expect(plan.filters).toContain('fps=60/1')
    expect(plan.durationSec).toBe(6000)
    expect(plan.args).toContain('filters.txt')
    expect(plan.filters.length).toBeLessThan(200_000)
  })
})

describe('boşlukları kapatma', () => {
  const mk = (id: string, trackId: string, start: number, a: number, b: number): Clip => ({ id, trackId, assetId: 'a', start, srcIn: a, srcOut: b, volume: 1, label: id })
  it('findGaps: ardışık değilse boşluk bulur; closeGaps sonrası kalmaz', () => {
    let tl = createDefaultTimeline()
    tl = ops.addClip(tl, 'V1', mk('v1', 'V1', 0, 0, 5))
    tl = ops.addClip(tl, 'A1', mk('a1', 'A1', 0, 0, 5))
    tl = ops.addClip(tl, 'V1', mk('v2', 'V1', 8, 10, 14))
    tl = ops.addClip(tl, 'A1', mk('a2', 'A1', 8, 10, 14))
    expect(ops.findGaps(tl)).toEqual([[5, 8]])
    const closed = cmd.closeGaps().do(tl)
    expect(ops.findGaps(closed)).toEqual([])
    expect(closed.tracks.find((t) => t.id === 'V1')!.clips.map((c) => c.start)).toEqual([0, 5])
  })
})

describe('kare hızı ve ses çerçevesi', () => {
  it('kesirli kare hızları tam kesirdir; ses çerçevesi kare süresine bölünür', async () => {
    const { fpsRational, audioFrameSamples } = await import('../../src/main/autokick/fastcut')
    expect(fpsRational(59.94)).toEqual([60000, 1001])
    expect(fpsRational(30)).toEqual([30, 1])
    expect(fpsRational(60)).toEqual([60, 1])
    expect([60, 50, 30, 25, 24].map(audioFrameSamples).map((n, i) => 48000 / [60, 50, 30, 25, 24][i] % n)).toEqual([0, 0, 0, 0, 0])
    expect(audioFrameSamples(59.94)).toBe(40)
  })
})
