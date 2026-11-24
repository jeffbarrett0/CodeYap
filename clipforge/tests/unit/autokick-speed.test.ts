import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Ekran kartı "var" gibi davranır ama bu makinede GERÇEKTE yok: kodlama başarısız olur → otomatik yazılım kodlamaya dönmeli
vi.mock('../../src/main/autokick/hwenc', async (orig) => ({ ...(await orig<typeof import('../../src/main/autokick/hwenc')>()), detectHwEncoder: async () => 'nvenc' }))

const tmp = mkdtempSync(join(tmpdir(), 'cf-speed-'))
const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const dur = (f: string) => Number(JSON.parse(execFileSync(ffp, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', f]).toString()).format.duration)

beforeAll(() => {
  const ud = join(tmp, 'ud')
  mkdirSync(join(ud, 'models'), { recursive: true })
  writeFileSync(join(ud, 'models', 'ggml-tiny.bin'), Buffer.alloc(12_000_000))
  const fake = join(tmp, 'whisper')
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const val = (f) => a[a.indexOf(f) + 1]
const first = /chunk_0\\.wav$/.test(val('-f'))
const sents = first ? [[2, 'Selam arkadaşlar bugün çok güzel konular var.'], [13, 'Osimhen gol attı ve Galatasaray kazandı.']] : []
const tr = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
for (const [t0, text] of sents) { let t = t0 * 1000; for (const w of text.split(' ')) { tr.push({ offsets: { from: t, to: t + 350 }, text: ' ' + w }); t += 450 } }
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: tr }))
`)
  chmodSync(fake, 0o755)
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(ud, 'models'), whisperModel: 'tiny', language: 'tr', silenceAudioGuard: false, outroEnabled: false, autoKickHwEncode: true }))
  execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30', '-ac', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'yayin.mp4')])
}, 60_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('Auto Kick hız: ekran kartı yedeği, kalite raporu arka planda, aşama süreleri', () => {
  it('ekran kartı kodlaması başarısız olursa yazılım kodlamaya DÖNER (iş durmaz); aşama süreleri kaydedilir; kalite raporu iş bittikten SONRA arka planda gelir', async () => {
    const { AutoKickManager } = await import('../../src/main/autokick/pipeline')
    let done: any
    new AutoKickManager({ userDataDir: join(tmp, 'ud') }, (st) => { if (st.status === 'done' || st.status === 'failed') done = st }).start({ videoPath: join(tmp, 'yayin.mp4'), outDir: join(tmp, 'out'), silence: { minGapSec: 0.55, keepSec: 0.2, cutFillers: true } })
    const t0 = Date.now()
    while (!done) {
      if (Date.now() - t0 > 120_000) throw new Error('zaman aşımı')
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(done.status, done.error).toBe('done')
    // tam video üretildi ve sağlam (yazılım kodlama yedeği çalıştı)
    expect(Math.abs(dur(done.result.fullVideoPath) - done.result.durationAfterSec)).toBeLessThan(0.6)
    const log = readFileSync(join(tmp, 'out', 'Auto Kick günlüğü.txt'), 'utf8')
    expect(log).toMatch(/ekran kartı kodlaması başarısız.*yazılım kodlamaya geçildi/)
    // aşama süreleri
    for (const id of ['import', 'transcribe', 'silence', 'full']) {
      const s = done.stages.find((x: any) => x.id === id)
      expect(s.startedAt, id).toBeGreaterThan(0)
      expect(s.endedAt, id).toBeGreaterThanOrEqual(s.startedAt)
    }
    // kalite raporu: iş bittikten sonra arka planda yazılır (iş onu BEKLEMEDİ)
    const qa = done.result.qaPath
    expect(qa).toMatch(/kalite raporu\.txt$/)
    const t1 = Date.now()
    while (!existsSync(qa)) {
      if (Date.now() - t1 > 60_000) throw new Error('kalite raporu gelmedi')
      await new Promise((r) => setTimeout(r, 300))
    }
    expect(readFileSync(qa, 'utf8').length).toBeGreaterThan(0)
  }, 300_000)
})
