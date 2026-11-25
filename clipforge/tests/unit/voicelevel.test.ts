import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { planFastCut } from '../../src/main/autokick/fastcut'
import { ctaGraph } from '../../src/main/ytcut'
import { CTA_AUDIO_VOLUME, VOICE_LEVEL_FILTER } from '../../src/shared/voicelevel'

const ffm = require('ffmpeg-static') as string
const tmp = mkdtempSync(join(tmpdir(), 'cf-vl-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** ffmpeg ile tepe/ortalama ölçer (dB) */
function maxDb(file: string, af = ''): number {
  const out = execFileSync(ffm, ['-v', 'info', '-nostats', '-i', file, ...(af ? ['-af', af + ',volumedetect'] : ['-af', 'volumedetect']), '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] })
  void out
  return 0
}
function volumeOf(file: string, af: string): number {
  const r = require('node:child_process').spawnSync(ffm, ['-v', 'info', '-nostats', '-i', file, '-af', `${af}volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /max_volume: (-?[\d.]+) dB/.exec(r.stderr)
  return Number(m?.[1])
}
void maxDb

describe('ses seviyesi: yalnızca yukarı', () => {
  it('sessiz konuşma yükselir; zaten yüksek olana dokunulmaz; buton sesi konuşmadan kısık', () => {
    const quiet = join(tmp, 'sessiz.wav')
    const loud = join(tmp, 'yuksek.wav')
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=20', '-af', 'volume=-12dB', quiet])
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=20', '-af', 'volume=14dB', loud])
    const q0 = volumeOf(quiet, '')
    const q1 = volumeOf(quiet, VOICE_LEVEL_FILTER + ',')
    expect(q1).toBeGreaterThan(q0 + 8) // en az +8 dB yükselir
    const l0 = volumeOf(loud, '')
    const l1 = volumeOf(loud, VOICE_LEVEL_FILTER + ',')
    expect(l1).toBeGreaterThanOrEqual(l0 - 0.5) // yüksek olan DÜŞÜRÜLMEZ
    expect(l1).toBeLessThanOrEqual(-0.5) // taşma/kırpılma yok
  }, 60_000)
  it('Auto Kick tam video ve yt-cut filtresi: açıkken seviyeleme var, kapalıyken yok; buton ses katsayısı sabit kısık', () => {
    const asset = { path: '/x.mp4', fps: 30, audioStreams: [{}], audioMap: { mix: 0 } } as never
    expect(planFastCut(asset, [[0, 5]], { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192, voiceLift: true }, '/o.mp4').filters).toContain('dynaudnorm')
    expect(planFastCut(asset, [[0, 5]], { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192 }, '/o.mp4').filters).not.toContain('dynaudnorm')
    const cta = { entry: { id: 'youtube', label: 'y', file: 'y.mp4', crop: { x: 0, y: 0, w: 1, h: 1 }, flushBottom: true }, file: '/y.mp4', chroma: '#00FF00', width: 1280, height: 720, hasAudio: true }
    const g = ctaGraph({ cta, times: [2, 22], srcW: 1920, srcH: 1080, hasAudio: true, videoPre: '', voiceLift: true })
    expect(g.filter).toContain('dynaudnorm')
    expect(g.filter).toContain(`volume=${CTA_AUDIO_VOLUME}`)
    expect(CTA_AUDIO_VOLUME).toBeLessThanOrEqual(0.35)
  })
})
