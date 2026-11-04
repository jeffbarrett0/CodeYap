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

describe('transkripsiyon hazırlık denetimi', () => {
  const ok = { whisperCpp: { ok: true, path: 'C:/w/whisper-cli.exe' }, models: [{ size: 'small' as const, installed: true, path: 'C:/m/ggml-small.bin' }, { size: 'tiny' as const, installed: false, path: 'C:/m/ggml-tiny.bin' }] }
  it('hazır; model eksikse kendiliğinden indirilir (ok kalır); program yoksa durur; anahtar yoksa durur', async () => {
    const { transcriptionReadiness: r } = await import('../../src/shared/autokick')
    expect(r({ provider: 'whisper-cpp', whisperModel: 'small' }, ok)).toMatchObject({ ok: true, problems: [] })
    const noModel = r({ provider: 'whisper-cpp', whisperModel: 'tiny' }, ok)
    expect(noModel).toMatchObject({ ok: true, needsModelDownload: 'tiny' })
    expect(noModel.problems[0]).toMatch(/otomatik indirilir/)
    const noBin = r({ provider: 'whisper-cpp', whisperModel: 'small' }, { ...ok, whisperCpp: { ok: false, path: 'whisper-cli' } })
    expect(noBin.ok).toBe(false)
    expect(noBin.problems[0]).toMatch(/whisper-cli\.exe.*yolunu gösterin/)
    expect(r({ provider: 'openai-api', whisperModel: 'small', openaiApiKey: '' }, ok).ok).toBe(false)
    expect(r({ provider: 'openai-api', whisperModel: 'small', openaiApiKey: 'sk-x' }, ok).ok).toBe(true)
  })
})

describe('işlemci politikası (bilgisayar kilitlenmesin)', () => {
  it('dengeli: çekirdek payı ve ffmpeg iş parçacığı sınırı; tam: dokunmaz', async () => {
    const { cpuPolicy, setCpuMode, cpuThreads, limitThreads } = await import('../../src/main/ffmpeg')
    cpuPolicy.cores = 16
    setCpuMode('balanced')
    expect(cpuThreads(0.5)).toBe(8)
    const a = limitThreads(['-y', '-i', 'in.mkv', '-c:v', 'libx264', 'out.mp4'])
    expect(a).toEqual(['-filter_threads', '8', '-filter_complex_threads', '8', '-y', '-threads', '8', '-i', 'in.mkv', '-c:v', 'libx264', '-threads', '8', 'out.mp4'])
    expect(limitThreads(['-y', '-i', 'a', '-threads', '2', 'o.mp4'])).toEqual(['-y', '-i', 'a', '-threads', '2', 'o.mp4']) // elle verilen korunur
    setCpuMode('full')
    expect(cpuThreads(0.5)).toBe(16)
    expect(limitThreads(['-i', 'a', 'o.mp4'])).toEqual(['-i', 'a', 'o.mp4'])
    setCpuMode('balanced')
  })
})
