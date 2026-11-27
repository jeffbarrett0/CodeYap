import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { makeService } from '../../src/cli/session'
import { runYtCut } from '../../src/main/ytcut'
import { autoAdjustFrom } from '../../src/shared/adjust'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const tmp = mkdtempSync(join(tmpdir(), 'cf-gtaedit-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('GTA 6 yayın edit (bütün yayın, transkript yok)', () => {
  it('2. sn + her N sn buton, sonda outro, +5/+5 görüntü ayarı; süre = yayın + outro', async () => {
    const src = join(tmp, 'yayin.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=40', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=40', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src])
    const svc = await makeService({ userDataDir: join(tmp, 'ud') })
    const res = await runYtCut({ videoPath: src, list: '', ranges: [{ start: 0, end: 40, title: 'yayin - GTA 6 edit' }], outDir: join(tmp, 'out'), cta: true, ctaEverySec: 15, adjust: autoAdjustFrom(DEFAULT_SETTINGS), voiceLift: true, outroPath: join(svc.deps.resourcesDir, 'outro', 'youtube-outro.mp4') }, svc.tools, { resourcesDir: svc.deps.resourcesDir, hw: false })
    const it0 = res.items[0]
    expect(it0.error).toBeUndefined()
    expect(it0.ctaAt).toEqual([2, 17, 32].filter((t) => t + 5.2 <= 40 - 1.5)) // 2, 17
    expect(existsSync(it0.path!)).toBe(true)
    expect(it0.outroSec).toBeGreaterThan(5)
    const pr = JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', it0.path!]).toString())
    expect(Number(pr.format.duration)).toBeGreaterThan(40 + it0.outroSec! - 1)
    expect(Number(pr.format.duration)).toBeLessThan(40 + it0.outroSec! + 1)
    expect(pr.streams.find((x: { codec_type: string }) => x.codec_type === 'video').width).toBe(1920)
  }, 180_000)
})
