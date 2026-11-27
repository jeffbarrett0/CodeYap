import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseGtaRanges } from '../../src/shared/gtaRanges'
import { prepareGtaProject } from '../../src/main/autoclips/gta'
import { makeAutoClip } from '../../src/main/autoclips/pipeline'
import { exportClipProject } from '../../src/main/autoclips/run'
import { Session, makeService } from '../../src/cli/session'

const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const tmp = mkdtempSync(join(tmpdir(), 'cf-gta-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('GTA 6 klip çıkar', () => {
  it('aralık yazımı: 0:28 - 0:45, saniye, ad; bozuk satır uyarı', () => {
    const r = parseGtaRanges('0:28 - 0:45\n1:02:10 - 1:03:00 Heist sahnesi\n95 140\nsaçma\n10 - 11')
    expect(r.ranges).toEqual([
      { start: 28, end: 45, title: 'GTA 6 klip 1' },
      { start: 3730, end: 3780, title: 'Heist sahnesi' },
      { start: 95, end: 140, title: 'GTA 6 klip 3' }
    ])
    expect(r.warnings.length).toBe(2)
  })

  it('transkript olmadan: oyun yakınlaştırılmaz (tam kare), YouTube butonu altta, çıktı 1080×1920 ve süre = yazılan aralık', async () => {
    const src = join(tmp, 'gta-yayin.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src])
    const env = { userDataDir: join(tmp, 'ud') }
    const prep = await prepareGtaProject(src, env)
    expect(prep.durationSec).toBeGreaterThan(59)
    expect(prep.projectPath).toContain('GTA 6 Klipleri')
    const m = await makeAutoClip(prep.projectPath, { start: 10, end: 28, subject: 'Deneme' }, { fullGame: true }, env)
    expect(Math.round(m.durationSec)).toBe(18)
    const s = await Session.open(m.projectPath, await makeService(env))
    const v1 = s.timeline.tracks.find((t) => t.id === 'V1')!
    expect(v1.clips[0].crop!.w).toBeCloseTo(1 / 1.12, 3) // yalnızca birazcık yakın: yanlardan kırpılır, yükseklik tam
    expect(v1.clips[0].crop!.h).toBe(1)
    const pl = v1.placement!
    expect(pl.rect.w).toBe(1)
    expect(pl.rect.h).toBeCloseTo(0.316 * 1.12, 2)
    const v3 = s.timeline.tracks.find((t) => t.id === 'VB')!
    expect(v3.clips[0].fx?.blurOnly).toBe(true) // altta oyunun bulanık kopyası
    expect(v3.placement!.rect.y).toBeCloseTo(pl.rect.y + pl.rect.h, 3)
    expect(v3.placement!.rect.y + v3.placement!.rect.h).toBeCloseTo(1, 3)
    const ctav = s.timeline.tracks.find((t) => t.id === 'CTAV')
    expect(ctav?.placement?.rect.y! + ctav?.placement?.rect.h!).toBeCloseTo(0.95, 2) // oyunun altındaki boş bölgede
    expect(ctav!.placement!.rect.y).toBeGreaterThan(pl.rect.y + pl.rect.h - 0.02)
    expect(ctav!.clips.map((c) => Math.round(c.start))).toEqual([2]) // 18 sn'de tek buton: 2. sn
    const outro = join(tmp, 'outro-dikey.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outro])
    const out = await exportClipProject(m.projectPath, env, undefined, undefined, 'shorts', outro)
    expect(existsSync(out)).toBe(true)
    const pr = JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', out]).toString())
    expect(pr.streams.find((x: { codec_type: string }) => x.codec_type === 'video').width).toBe(1080)
    expect(pr.streams.find((x: { codec_type: string }) => x.codec_type === 'video').height).toBe(1920)
    expect(Number(pr.format.duration)).toBeGreaterThan(20.5) // 18 sn klip + 3 sn outro
    expect(Number(pr.format.duration)).toBeLessThan(22)
  }, 120_000)
})
