import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { planFastCut, snapToFrame } from '../../src/main/autokick/fastcut'

const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const tmp = mkdtempSync(join(tmpdir(), 'cf-vfr-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** kare atlanmış (DEĞİŞKEN kare hızlı) kayıt: OBS'te sık görülür; her kesimde görüntü kısalıp sesi kaydırıyordu */
describe('Auto Kick tam video: görüntü ve ses AYNI uzunlukta kalır', () => {
  it('kare atlamış (VFR) kaynakta da çok sayıda kesimden sonra görüntü = ses süresi', () => {
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60:sample_rate=48000', '-vf', "select='not(between(mod(n,300),100,115))'", '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'vfr.mp4')])
    const fps = 30
    const ranges: [number, number][] = []
    for (let t = 0; t < 55; t += 5) ranges.push([snapToFrame(t + 0.37, fps), snapToFrame(t + 3.11, fps)])
    const plan = planFastCut({ path: join(tmp, 'vfr.mp4'), fps, audioStreams: [{}], audioMap: { mix: 0 } } as never, ranges, { crf: 23, encoderPreset: 'ultrafast', maxrateKbps: 40000, audioKbps: 128 }, join(tmp, 'o.mp4'))
    writeFileSync(join(tmp, 'filters.txt'), plan.filters)
    execFileSync(ffm, plan.args, { cwd: tmp, stdio: 'ignore' })
    const d = JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', join(tmp, 'o.mp4')]).toString()) as { streams: { codec_type: string; duration: string }[] }
    const v = Number(d.streams.find((s) => s.codec_type === 'video')!.duration)
    const a = Number(d.streams.find((s) => s.codec_type === 'audio')!.duration)
    expect(Math.abs(v - a)).toBeLessThan(0.1)
    expect(Math.abs(v - plan.durationSec)).toBeLessThan(0.1)
  }, 60_000)
})
