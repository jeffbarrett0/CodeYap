import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Komut satırı (yapay zekâ ile editleme) uçtan uca: gerçek ffmpeg + sahte whisper-cli ile derlenmiş cli.js */
const root = process.cwd()
const tmp = mkdtempSync(join(tmpdir(), 'cf-cli-'))
const ud = join(tmp, 'ud')
const proj = join(tmp, 'Proje Klasörü çğ', 'ana.clipforge')
const md5 = (f: string) => createHash('md5').update(readFileSync(f)).digest('hex')

function cli(...args: string[]): any {
  try {
    return JSON.parse(execFileSync(process.execPath, [join(root, 'out/main/cli.js'), ...args], { env: { ...process.env, CLIPFORGE_USER_DATA: ud }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 }).toString())
  } catch (e) {
    // hata durumunda çıkış kodu 1 ve stdout'ta { ok: false, error } olur
    const out = (e as { stdout?: Buffer }).stdout?.toString()
    if (out) return JSON.parse(out)
    throw e
  }
}

beforeAll(() => {
  execFileSync('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'ignore' })
  mkdirSync(join(ud, 'models'), { recursive: true })
  writeFileSync(join(ud, 'models', 'ggml-tiny.bin'), Buffer.alloc(12_000_000))
  const fake = join(tmp, 'whisper')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const val = (f) => a[a.indexOf(f) + 1]
const first = /chunk_0\\.wav$/.test(val('-f'))
const sents = first ? [[3, "Geçen sene Viktor Nelsen'dan bahsetmiştim."], [12, 'Hatırlıyor musunuz bunu?'], [22, 'Sonra uzun bir sessizlik oldu ve devam ettik.']] : []
const tr = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
for (const [t0, text] of sents) { let t = t0 * 1000; for (const w of text.split(' ')) { tr.push({ offsets: { from: t, to: t + 350 }, text: ' ' + w }); t += 450 } }
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: tr }))
`
  )
  chmodSync(fake, 0o755)
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(ud, 'models'), whisperModel: 'tiny', language: 'tr' }))
  const ffmpeg = require('ffmpeg-static') as string
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=40', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=40', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'video örnek.mp4')])
}, 120_000)

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('komut satırı: sessizleri kes + altyazı + dışa aktar; arama + bağımsız klip', () => {
  it('yeni proje, içe aktar (Video 1, 0. sn, sesiyle), transkripsiyon, arama', () => {
    expect(cli('new', proj).tracks).toContain('A1:Ses')
    const imp = cli('import', proj, join(tmp, 'video örnek.mp4'), '--add')
    expect(imp.added[0]).toMatchObject({ kind: 'video', size: '1280x720' })
    const show = cli('show', proj)
    const v1 = show.tracks.find((t: any) => t.id === 'V1')
    expect(v1.clips[0]).toMatchObject({ start: 0, srcIn: 0 }) // sıfırdan başlar
    expect(show.tracks.find((t: any) => t.id === 'A1').clips).toHaveLength(1)
    expect(cli('transcribe', proj).sentences).toBe(3)
    const r = cli('search', proj, 'Victor Nelson')
    expect(r.results[0].sentence).toContain('Viktor Nelsen')
  }, 180_000)

  it('ana proje değişmeden bağımsız klip projesi (süre hedefi, ayrı dosya)', () => {
    const before = md5(proj)
    const out = join(tmp, 'klipler', 'yeni.clipforge')
    const r = cli('new-clip-project', proj, '--query', 'Victor Nelson', '--sec', '20', '--out', out)
    expect(r.ok).toBe(true)
    expect(md5(proj)).toBe(before)
    const c = cli('show', out)
    expect(c.tracks.find((t: any) => t.id === 'V1').clips).toHaveLength(1)
    expect(c.durationSec).toBeGreaterThan(3)
    expect(existsSync(out + '-data')).toBe(true)
  }, 120_000)

  it('sessizleri kes → altyazı → kare → dışa aktar', () => {
    const s = cli('silence', proj)
    expect(s.cuts).toBeGreaterThan(0)
    expect(s.newDurationSec).toBeLessThan(15)
    expect(cli('captions', proj).captions).toBeGreaterThan(1)
    const frame = join(tmp, 'kare.jpg')
    expect(cli('frame', proj, '--at', '1', '--out', frame).ok).toBe(true)
    expect(existsSync(frame)).toBe(true)
    const out = join(tmp, 'çıktı', 'son.mp4')
    const e = cli('export', proj, '--out', out, '--preset', 'youtube')
    expect(e.ok).toBe(true)
    expect(existsSync(out)).toBe(true)
    expect(existsSync(proj + '.bak')).toBe(true) // yedek alınır
  }, 240_000)

  it('vlog akışı: Video 3 ana görüntü, script, b-roll önerisi/uygulama, grafik yerleştirme', () => {
    const vlog = join(tmp, 'vlog.clipforge')
    const broll = join(tmp, 'broll')
    mkdirSync(broll, { recursive: true })
    const ffmpeg = require('ffmpeg-static') as string
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(broll, 'viktor_nelsen.mp4')])
    cli('new', vlog)
    cli('import', vlog, join(tmp, 'video örnek.mp4'), '--add', '--layer', 'V3')
    cli('transcribe', vlog)
    expect(cli('silence', vlog).cuts).toBeGreaterThan(0)
    const script = cli('script', vlog)
    expect(script.sentences.length).toBe(3)
    // öneri: yazmaz
    const before = md5(vlog)
    const plan = cli('broll-plan', vlog, '--folder', broll)
    expect(plan.plan[0]).toMatchObject({ file: 'viktor_nelsen.mp4' })
    expect(plan.plan[0].at).not.toBeNull()
    expect(md5(vlog)).toBe(before)
    expect(cli('broll-plan', vlog, '--folder', broll, '--apply').placed).toEqual(['viktor_nelsen.mp4'])
    // grafik: harita/küre üretilip V1'e konur; çakışmada hata verir
    const g = cli('graphic', vlog, '--type', 'globe', '--to', 'Türkiye', '--from', 'Londra', '--at', '1', '--dur', '2', '--layer', 'V1')
    expect(g.ok).toBe(true)
    expect(existsSync(g.file)).toBe(true)
    expect(cli('graphic', vlog, '--type', 'title', '--text', 'X', '--at', '1.5', '--dur', '2', '--layer', 'V1').error).toMatch(/dolu/)
    expect(cli('graphic', vlog, '--type', 'map', '--to', 'Atlantis').error).toMatch(/bulunamadı/)
    const show = cli('show', vlog)
    const lane = (id: string) => show.tracks.find((t: any) => t.id === id).clips
    expect(lane('V3').length).toBeGreaterThan(0) // ana görüntü
    expect(lane('V2')).toHaveLength(1) // b-roll
    expect(lane('V1')).toHaveLength(1) // grafik
    expect(cli('captions', vlog, '--style', 'boxed-highlight').style).toBe('boxed-highlight')
  }, 300_000)

  it('katman silme ve anlaşılır hata', () => {
    expect(cli('delete-lane', proj, 'CC').deleted).toBeGreaterThan(0)
    const bad = cli('bogus', proj)
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/Bilinmeyen komut/)
  }, 60_000)
})
