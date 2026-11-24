import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Kullanıcı şikâyeti: "outro vermiştim, yayın videosunu editlemişsin ama outro'yu koymamışsın" → Auto Kick'in TAM videosuna (`… - full.mp4`) outro eklenir. */
const tmp = mkdtempSync(join(tmpdir(), 'cf-akoutro-'))
const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const dur = (f: string) => Number(JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', f]).toString()).format.duration)
const dims = (f: string) => JSON.parse(execFileSync(ffp, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', f]).toString()).streams[0] as { width: number; height: number }
const decodes = (f: string) => execFileSync(ffm, ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function setup(name: string, settings: Record<string, unknown>): string {
  const ud = join(tmp, name)
  mkdirSync(join(ud, 'models'), { recursive: true })
  writeFileSync(join(ud, 'models', 'ggml-tiny.bin'), Buffer.alloc(12_000_000))
  const fake = join(tmp, `whisper-${name}`)
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const val = (f) => a[a.indexOf(f) + 1]
const first = /chunk_0\\.wav$/.test(val('-f'))
const sents = first ? [[2, 'Selam arkadaşlar bugün çok güzel konular var.'], [13, 'Osimhen gol attı ve Galatasaray kazandı.']] : []
const tr = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
for (const [t0, text] of sents) { let t = t0 * 1000; for (const w of text.split(' ')) { tr.push({ offsets: { from: t, to: t + 350 }, text: ' ' + w }); t += 450 } }
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: tr }))
`)
  chmodSync(fake, 0o755)
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(ud, 'models'), whisperModel: 'tiny', language: 'tr', silenceAudioGuard: false, ...settings }))
  return ud
}

async function runKick(ud: string, outDir: string, extra: Record<string, unknown> = {}): Promise<any> {
  const { AutoKickManager } = await import('../../src/main/autokick/pipeline')
  let done: any
  new AutoKickManager({ userDataDir: ud }, (st) => { if (st.status === 'done' || st.status === 'failed') done = st }).start({ videoPath: join(tmp, 'yayin.mp4'), outDir, silence: { minGapSec: 0.55, keepSec: 0.2, cutFillers: true }, ...extra })
  const t0 = Date.now()
  while (!done) {
    if (Date.now() - t0 > 120_000) throw new Error('zaman aşımı')
    await new Promise((r) => setTimeout(r, 250))
  }
  if (done.status !== 'done') throw new Error(done.error)
  return done.result
}

beforeAll(() => {
  execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30', '-ac', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'yayin.mp4')])
  // kullanıcının outro'suna benzer: 1920x1080, 30 fps, SESSİZ, 4 sn
  execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'outro.mp4')])
}, 60_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('Auto Kick tam video + YouTube outro', () => {
  it('outro AÇIKKEN: tam videonun SONUNA eklenir (süre = kesimli süre + outro), ölçü korunur, ses sürer, hatasız çözülür; yeniden çalıştırınca İKİNCİ KEZ eklenmez; sonuçta/günlükte yazar', async () => {
    const ud = setup('acik', { outroPath: join(tmp, 'outro.mp4') })
    const out = join(tmp, 'out-acik')
    const r = await runKick(ud, out)
    expect(r.outroNote).toMatch(/Outro eklendi/)
    expect(dur(r.fullVideoPath)).toBeGreaterThan(r.durationAfterSec + 3.5)
    expect(dur(r.fullVideoPath)).toBeLessThan(r.durationAfterSec + 4.8)
    expect(dims(r.fullVideoPath)).toEqual({ width: 1280, height: 720 })
    expect(decodes(r.fullVideoPath).trim()).toBe('')
    const hasAudio = JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', r.fullVideoPath]).toString()).streams.some((s: any) => s.codec_type === 'audio')
    expect(hasAudio).toBe(true)
    expect(readFileSync(join(out, 'Auto Kick günlüğü.txt'), 'utf8')).toMatch(/Outro eklendi/)
    const before = dur(r.fullVideoPath)
    const again = await runKick(ud, out) // aynı klasör: kalan aşamalardan sürer
    expect(Math.abs(dur(again.fullVideoPath) - before)).toBeLessThan(0.2) // outro iki kez EKLENMEDİ
  }, 300_000)

  it('outro KAPALI (outroEnabled=false) ya da MANUEL iş: tam videoya outro eklenmez / tam video üretilmez', async () => {
    const ud = setup('kapali', { outroPath: join(tmp, 'outro.mp4'), outroEnabled: false })
    const r = await runKick(ud, join(tmp, 'out-kapali'))
    expect(r.outroNote).toBeUndefined()
    expect(Math.abs(dur(r.fullVideoPath) - r.durationAfterSec)).toBeLessThan(0.6)
    const m = await runKick(setup('manuel', { outroPath: join(tmp, 'outro.mp4') }), join(tmp, 'out-manuel'), { manual: true })
    expect(existsSync(m.fullVideoPath)).toBe(false)
  }, 300_000)

  it('olmayan outro dosyası: video outro\'suz kalır, iş BAŞARILI, neden sonuçta yazar', async () => {
    const ud = setup('yok', { outroPath: join(tmp, 'yok-outro.mp4') })
    const r = await runKick(ud, join(tmp, 'out-yok'))
    expect(r.outroNote).toMatch(/Outro videosu bulunamadı/)
    expect(Math.abs(dur(r.fullVideoPath) - r.durationAfterSec)).toBeLessThan(0.6)
  }, 300_000)
})
