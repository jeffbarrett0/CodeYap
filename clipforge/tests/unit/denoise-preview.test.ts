import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { makeService, waitTask } from '../../src/cli/session'
import { ffmpegAvailable } from './ffmpeg-fixtures'

const d = ffmpegAvailable() ? describe : describe.skip
const root = mkdtempSync(join(tmpdir(), 'cf-dn-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

d('önizleme için arka plan sesi azaltma', () => {
  it('temizlenmiş ses kopyası üretilir, önbelleğe alınır ve cf-media yoluyla çözülür; hazır değilken yol yok', async () => {
    const ffm = require('ffmpeg-static') as string
    const video = join(root, 'v.mp4')
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=6', '-f', 'lavfi', '-i', 'anoisesrc=d=6:c=pink:a=0.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
    const svc = await makeService({ userDataDir: join(root, 'ud'), resourcesDir: join(__dirname, '..', '..', 'resources') })
    const ids = svc.importMedia([video])
    for (const id of ids) await waitTask(svc, id, 'içe aktarma')
    const asset = [...svc.assets.values()][0]
    expect(svc.resolveMediaPath(asset.id, 'audio', 0, 'medium')).toBeNull() // henüz hazır değil
    const level = await svc.denoisePreview({ assetId: asset.id, audioStream: 0, level: 'medium' })
    expect(level).toBe('medium')
    const f = svc.resolveMediaPath(asset.id, 'audio', 0, 'medium')
    expect(f).toBeTruthy()
    expect(existsSync(f as string)).toBe(true)
    expect(statSync(f as string).size).toBeGreaterThan(1000)
    const t0 = Date.now()
    await svc.denoisePreview({ assetId: asset.id, audioStream: 0, level: 'medium' }) // önbellekten
    expect(Date.now() - t0).toBeLessThan(500)
    expect(svc.resolveMediaPath(asset.id, 'audio', 0, 'garip')).not.toBe(f) // geçersiz değişken yok sayılır
  }, 120_000)
})
