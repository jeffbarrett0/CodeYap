import { beforeEach, describe, expect, it } from 'vitest'
import { detectHwEncoder, hwCandidates, resetHwEncoderCache, videoEncoderArgs } from '../../src/main/autokick/hwenc'
import { planFastCut } from '../../src/main/autokick/fastcut'

const LIST = ` V....D h264_amf             AMD AMF H.264 Encoder (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D h264_qsv             H.264 / AVC / MPEG-4 AVC (Intel Quick Sync Video acceleration) (codec h264)
 V....D libx264              libx264 H.264`

describe('donanım kodlayıcı (ekran kartı) — Auto Kick tam video hızlandırma', () => {
  beforeEach(() => resetHwEncoderCache())

  it('kodlayıcı listesinden adaylar (sıra: NVENC, QSV, AMF); olmayan yok', () => {
    expect(hwCandidates(LIST)).toEqual(['nvenc', 'qsv', 'amf'])
    expect(hwCandidates(' V....D libx264 libx264 H.264')).toEqual([])
  })

  it('algılama: listede olsa bile GERÇEK deneme başarısızsa atlanır, sıradaki çalışan seçilir; hiçbiri çalışmazsa null; sonuç önbelleklenir', async () => {
    const calls: string[] = []
    const run = (async (_bin: string, args: string[]) => {
      if (args.includes('-encoders')) return { stdout: LIST, stderr: '' }
      const codec = args[args.indexOf('-c:v') + 1]
      calls.push(codec)
      if (codec === 'h264_nvenc') throw new Error('Cannot load nvcuda.dll') // kart/sürücü yok
      return { stdout: '', stderr: '' }
    }) as never
    expect(await detectHwEncoder('ffmpeg', run)).toBe('qsv')
    expect(calls).toEqual(['h264_nvenc', 'h264_qsv'])
    await detectHwEncoder('ffmpeg', run) // önbellek: yeniden denenmez
    expect(calls.length).toBe(2)
    resetHwEncoderCache()
    expect(await detectHwEncoder('ffmpeg', (async (_b: string, args: string[]) => { if (args.includes('-encoders')) return { stdout: LIST, stderr: '' }; throw new Error('yok') }) as never)).toBeNull()
  })

  it('kodlayıcı argümanları: yazılım = eskisiyle aynı; donanım kodlayıcılar kaliteyi karşılık gelen sabit-kalite değerine çevirir, üst bit hızı sınırı ve YouTube uyumlu çıktı aynı', () => {
    const o = { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000 }
    expect(videoEncoderArgs(o)).toEqual(['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '20', '-maxrate', '40000k', '-bufsize', '80000k'])
    const nv = videoEncoderArgs(o, 'nvenc')
    expect(nv).toEqual(expect.arrayContaining(['h264_nvenc', '-cq', '21', '-maxrate', '40000k', 'yuv420p', 'high']))
    expect(nv).not.toContain('libx264')
    expect(videoEncoderArgs(o, 'qsv')).toEqual(expect.arrayContaining(['h264_qsv', '-global_quality', '21']))
    expect(videoEncoderArgs(o, 'amf')).toEqual(expect.arrayContaining(['h264_amf', '-qp_i', '21']))
  })

  it('planFastCut: hw verilmezse eski libx264 komutu; verilirse donanım kodlayıcı', () => {
    const asset = { path: '/v/a.mkv', fps: 30, audioStreams: [{ index: 0 }], audioMap: { mix: 0 } } as never
    const base = { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192 }
    const cpu = planFastCut(asset, [[0, 5]], base, '/o/full.mp4').args
    expect(cpu).toContain('libx264')
    expect(cpu).toContain('-crf')
    const hw = planFastCut(asset, [[0, 5]], { ...base, hw: 'nvenc' }, '/o/full.mp4').args
    expect(hw).toContain('h264_nvenc')
    expect(hw).not.toContain('libx264')
    expect(hw.at(-1)).toBe('/o/full.mp4')
  })
})
