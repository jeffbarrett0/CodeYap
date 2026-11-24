import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectVoicedRuns, mapVoicedToTimeline, voicedFromFrames } from '../../src/main/autokick/voice'

const tmp = mkdtempSync(join(tmpdir(), 'cf-guard-'))
const ffm = require('ffmpeg-static') as string
const ffp = require('@ffprobe-installer/ffprobe').path as string
const tools = { ffmpeg: ffm, ffprobe: ffp } as never

/** Gerçek konuşma aralıkları (kaynak zamanı): ses yalnızca bu aralıklarda var, arada sessizlik + hafif gürültü */
const SPEECH: [number, number][] = [[2, 5.4], [13, 20], [30, 35]]
const gate = SPEECH.map(([a, b]) => `between(t,${a},${b})`).join('+')

beforeAll(() => {
  execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=40', '-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*220*t)*(${gate})+0.0006*sin(2*PI*50*t)':s=48000:d=40`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'yayin.mp4')])
}, 60_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('ses seviyesinden "ses var" aralıkları', () => {
  it('SAF: gürültü tabanı −60 dB, konuşma −25 dB → aralıklar bulunur; sözcük içi kısa çukur birleşir; çok kısa tıkırtı atılır', () => {
    const f = 0.02
    const db = new Array(1500).fill(-60) // 30 sn
    const put = (a: number, b: number, v = -25) => { for (let i = Math.round(a / f); i < Math.round(b / f); i++) db[i] = v }
    put(2, 4)
    put(4.05, 5) // 50 ms çukurla ayrılmış: tek konuşma
    put(10, 10.03) // 30 ms tıkırtı: ses sayılmaz
    put(20, 22, -30)
    const r = voicedFromFrames(db, f)
    expect(r.continuous).toBe(false)
    expect(r.runs.length).toBe(2)
    expect(r.runs[0][0]).toBeCloseTo(2, 1)
    expect(r.runs[0][1]).toBeCloseTo(5, 1)
    expect(r.runs[1][0]).toBeCloseTo(20, 1)
  })
  it('SAF: sürekli ses (oyun/müzik aynı kanalda) → continuous işaretlenir ve hemen her yer "ses var" (kesim güvenli yönde azalır)', () => {
    const db = Array.from({ length: 1000 }, (_, i) => -30 + (i % 7))
    const r = voicedFromFrames(db)
    expect(r.continuous).toBe(true)
    expect(r.runs.length).toBeGreaterThanOrEqual(1)
  })
  it('çizelge zamanına çevirme: yalnızca korunan klip parçalarına düşenler, kayma hesaplanır', () => {
    const out = mapVoicedToTimeline([[2, 5], [13, 20]], [{ srcIn: 1, srcOut: 6, start: 0 }, { srcIn: 12, srcOut: 21, start: 5 }])
    expect(out).toEqual([[1, 4], [6, 13]])
  })
  it('GERÇEK ses dosyası: ffmpeg ile çözülüp ölçülen aralıklar gerçek konuşmayla ±0,15 sn örtüşür', async () => {
    const va = await detectVoicedRuns(join(tmp, 'yayin.mp4'), 0, tools)
    expect(va.runs.length).toBe(SPEECH.length)
    SPEECH.forEach(([a, b], i) => {
      expect(Math.abs(va.runs[i][0] - a)).toBeLessThan(0.15)
      expect(Math.abs(va.runs[i][1] - b)).toBeLessThan(0.2)
    })
  }, 60_000)
})

/** Auto Kick'i verilen ayarla çalıştırır; Whisper konuşmaların başlangıcını GEÇ (0,4 sn) yazar. Korunan (kesilmeyen) kaynak aralıklarını döner. */
async function runKick(guard: boolean): Promise<[number, number][]> {
  const ud = join(tmp, guard ? 'ud-guard' : 'ud-noguard')
  mkdirSync(join(ud, 'models'), { recursive: true })
  writeFileSync(join(ud, 'models', 'ggml-tiny.bin'), Buffer.alloc(12_000_000))
  const fake = join(tmp, guard ? 'w1' : 'w0')
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const val = (f) => a[a.indexOf(f) + 1]
const first = /chunk_0\\.wav$/.test(val('-f'))
// gerçek konuşmalar 2.0 / 13.0 / 30.0'da başlıyor; Whisper başlangıcı 0,4 sn GEÇ yazıyor
const sents = first ? [[2.4, 'Selam arkadaşlar bugün çok güzel konular var.'], [13.4, 'Osimhen gol attı ve Galatasaray kazandı mı.'], [30.4, 'Son olarak hepinize teşekkürler.']] : []
const tr = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
for (const [t0, text] of sents) { let t = t0 * 1000; for (const w of text.split(' ')) { tr.push({ offsets: { from: t, to: t + 350 }, text: ' ' + w }); t += 450 } }
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: tr }))
`)
  chmodSync(fake, 0o755)
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(ud, 'models'), whisperModel: 'tiny', language: 'tr', silenceAudioGuard: guard, outroEnabled: false }))
  const { AutoKickManager } = await import('../../src/main/autokick/pipeline')
  const { Session, makeService } = await import('../../src/cli/session')
  let done: any
  new AutoKickManager({ userDataDir: ud }, (st) => { if (st.status === 'done' || st.status === 'failed') done = st }).start({ videoPath: join(tmp, 'yayin.mp4'), outDir: join(tmp, guard ? 'out-guard' : 'out-noguard'), silence: { minGapSec: 0.55, keepSec: 0.15, cutFillers: true }, manual: true })
  const t0 = Date.now()
  while (!done) {
    if (Date.now() - t0 > 120_000) throw new Error('zaman aşımı')
    await new Promise((r) => setTimeout(r, 250))
  }
  if (done.status !== 'done') throw new Error(done.error)
  const s = await Session.open(done.result.projectPath, await makeService({ userDataDir: ud }))
  return (s.timeline.tracks.find((t) => t.id === 'V1')?.clips ?? []).map((c) => [c.srcIn, c.srcOut] as [number, number]).sort((a, b) => a[0] - b[0])
}

const covered = (kept: [number, number][], a: number, b: number) => kept.some(([x, y]) => x <= a + 0.02 && y >= b - 0.02)

describe('Auto Kick uçtan uca: konuşmanın başı kesiliyor muydu?', () => {
  it('KORUMASIZ (eski davranışın temkinli hâli): Whisper 0,4 sn geç yazınca konuşmanın ilk saniyesinin bir kısmı kesilir; KORUMALI: hiçbir konuşma kesilmez', async () => {
    const noGuard = await runKick(false)
    const guard = await runKick(true)
    // her konuşmanın TAMAMI korunan aralıklarda (kesintisiz) olmalı
    for (const [a, b] of SPEECH) expect(covered(guard, a, b), `KORUMALI: ${a}–${b} tamamen korunmalı; korunanlar ${JSON.stringify(guard)}`).toBe(true)
    // korumasız: en az bir konuşmanın başı kesilmiş (Whisper'ın geç yazdığı 0,4 sn'nin bir kısmı)
    const lost = SPEECH.filter(([a, b]) => !covered(noGuard, a, b))
    expect(lost.length).toBeGreaterThanOrEqual(1)
    // koruma sessizliği kesmeyi bırakmadı: gerçekten sessiz yerler (6–12, 21–29) hâlâ kısaltılıyor
    const keptSec = guard.reduce((n, [a, b]) => n + (b - a), 0)
    expect(keptSec).toBeLessThan(31)
    expect(guard.some(([a, b]) => a <= 8 && b >= 8)).toBe(false) // 8. sn sessiz, kesildi
    // kesim raporu: neyin kesildiği zaman + önce/sonra sözleriyle yazılır
    const rep = readFileSync(join(tmp, 'out-guard', 'Kesim raporu.txt'), 'utf8')
    expect(rep).toMatch(/AUTO KICK KESİM RAPORU/)
    expect(rep).toMatch(/Konuşma koruması: açık/)
    expect(rep).toMatch(/sessizlik/)
    expect(rep).toMatch(/önce: “….*çok güzel konular var\.?”/)
    expect(rep).toMatch(/sonra: “Osimhen/)
  }, 300_000)
})
