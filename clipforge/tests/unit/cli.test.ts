import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('auto-kick: içe aktar → transkript → sessizleri kırp → tam video; yeniden çalıştırınca biten aşamalar atlanır', () => {
    const video = join(tmp, 'video örnek.mp4')
    const r = cli('auto-kick', video, '--out', join(tmp, 'Çıkış Klasörü', 'yayın'))
    expect(r.ok).toBe(true)
    expect(r.cuts).toBeGreaterThan(0)
    expect(r.durationAfterSec).toBeLessThan(r.durationBeforeSec)
    expect(existsSync(r.fullVideoPath)).toBe(true)
    expect(r.fullVideoPath).toMatch(/ - full\.mp4$/)
    expect(existsSync(r.projectPath)).toBe(true)
    const proj = JSON.parse(readFileSync(r.projectPath, 'utf8'))
    expect(proj.assets).toHaveLength(1)
    // orijinal video değişmedi, tam video kısa
    const ffprobe = require('@ffprobe-installer/ffprobe').path as string
    const dur = Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', r.fullVideoPath]).toString())
    expect(Math.abs(dur - r.durationAfterSec)).toBeLessThan(1.5)
    const before = md5(r.fullVideoPath)
    const again = cli('auto-kick', video, '--out', join(tmp, 'Çıkış Klasörü', 'yayın'))
    expect(again.ok).toBe(true)
    expect(md5(again.fullVideoPath)).toBe(before) // yeniden kodlanmadı
    expect(cli('auto-kick', join(tmp, 'yok.mp4')).error).toMatch(/bulunamadı/)
    expect(cli('auto-kick', join(tmp, 'x.txt')).error).toMatch(/video/i)
  }, 300_000)

  it('topic-clips: konuyu Auto Kick transkriptinde bul, aday öner, seçileni bağımsız projeye çıkar (Auto Kick projesi değişmez)', () => {
    const dir = join(tmp, 'Çıkış Klasörü', 'yayın')
    const projFile = cli('auto-kick', join(tmp, 'video örnek.mp4'), '--out', dir).projectPath
    const before = md5(projFile)
    // öneri: hiçbir şey yazmaz
    const r = cli('topic-clips', dir, '--topic', "Viktor Nelsen'le ilgili")
    expect(r.candidates.length).toBeGreaterThan(0)
    expect(r.candidates[0].mentions.join(' ')).toMatch(/Nelsen|Viktor/)
    expect(r.created).toEqual([])
    expect(md5(projFile)).toBe(before)
    // seç: bağımsız klip projesi
    const p = cli('topic-clips', projFile, '--topic', 'Viktor Nelson', '--pick', '1')
    expect(p.created).toHaveLength(1)
    expect(md5(projFile)).toBe(before)
    const clip = cli('show', p.created[0].projectPath)
    expect(clip.durationSec).toBeGreaterThan(1)
    expect(clip.durationSec).toBeLessThan(15)
    expect(clip.tracks.find((t: any) => t.id === 'V1').clips.length).toBeGreaterThan(0)
    expect(clip.tracks.find((t: any) => t.id === 'A1').clips.length).toBeGreaterThan(0)
    expect(cli('topic-clips', dir, '--topic', 'Neymar').candidates).toEqual([])
    expect(cli('topic-clips', dir, '--topic', 'Viktor', '--pick', '9').error).toMatch(/Seçilen aday yok/)
  }, 300_000)

  it('auto-kick: whisper yoksa İÇE AKTARMADAN ÖNCE anlaşılır hata; çok track\'li kayıtta konuşma track\'i otomatik bulunur', () => {
    const ud2 = join(tmp, 'ud2')
    mkdirSync(join(ud2, 'models'), { recursive: true })
    writeFileSync(join(ud2, 'models', 'ggml-tiny.bin'), Buffer.alloc(12_000_000))
    const run2 = (...args: string[]) => {
      try {
        return JSON.parse(execFileSync(process.execPath, [join(root, 'out/main/cli.js'), ...args], { env: { ...process.env, CLIPFORGE_USER_DATA: ud2 }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 }).toString())
      } catch (e) {
        return JSON.parse((e as { stdout: Buffer }).stdout.toString())
      }
    }
    // 1) whisper yolu yanlış
    writeFileSync(join(ud2, 'settings.json'), JSON.stringify({ whisperCppPath: join(tmp, 'yok', 'whisper-cli.exe'), whisperModelDir: join(ud2, 'models'), whisperModel: 'tiny', language: 'tr' }))
    const bad = run2('auto-kick', join(tmp, 'video örnek.mp4'), '--out', join(tmp, 'ak-bad'))
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/Transkripsiyon başlatılamaz.*whisper\.cpp bulunamadı.*yolunu gösterin/)
    expect(existsSync(join(tmp, 'ak-bad', 'video örnek.clipforge'))).toBe(false) // içe aktarmaya bile geçilmedi

    // 2) iki ses track'li kayıt: konuşma 2. track'te (sahte whisper yalnızca p_1.wav örneğinde ve tam parçalarda kelime verir)
    const fake = join(tmp, 'whisper-t2')
    writeFileSync(
      fake,
      `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const val = (f) => a[a.indexOf(f) + 1]
const base = val('-f').split(/[\\/\\\\]/).pop()
const speak = !/^p_/.test(base) || base === 'p_1.wav'
const tr = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
if (speak) { let t = 3000; for (const w of ['Bu', 'bir', 'deneme', 'cümlesi', 'tamam', 'mı']) { tr.push({ offsets: { from: t, to: t + 350 }, text: ' ' + w }); t += 450 } }
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: tr }))
`
    )
    chmodSync(fake, 0o755)
    writeFileSync(join(ud2, 'settings.json'), JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(ud2, 'models'), whisperModel: 'tiny', language: 'tr' }))
    const ffmpeg = require('ffmpeg-static') as string
    const two = join(tmp, 'iki track.mkv')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=40', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=40', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=40', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', two])
    const r = run2('auto-kick', two, '--out', join(tmp, 'ak-two'))
    expect(r.ok).toBe(true)
    const transcriptFile = readdirSync(join(tmp, 'ak-two', 'iki track.clipforge-data', 'transcripts')).find((f) => f.endsWith('.json'))!
    expect(JSON.parse(readFileSync(join(tmp, 'ak-two', 'iki track.clipforge-data', 'transcripts', transcriptFile), 'utf8')).audioTrack).toBe(1) // Track 2
  }, 300_000)

  it('ideas: uzun transkriptten ayrı video olabilecek konu bölümleri (öneri, projeyi değiştirmez); transkript yoksa anlaşılır hata', () => {
    const proj2 = join(tmp, 'oneri.clipforge')
    cli('new', proj2)
    const imp = cli('import', proj2, join(tmp, 'video örnek.mp4'))
    const id = imp.added[0].id as string
    expect(cli('ideas', proj2).error).toMatch(/transkripsiyonunu yapın/)
    // 3 konulu, 36 dakikalık yapay transkript (her konunun kendi kelime dağarcığı)
    const vocab = [['oyun', 'bölüm', 'boss', 'seviye', 'karakter', 'silah', 'görev', 'harita'], ['yapay', 'zeka', 'model', 'veri', 'eğitim', 'algoritma', 'öğrenme', 'chatbot'], ['transfer', 'forvet', 'taraftar', 'penaltı', 'kadro', 'sezon', 'lig', 'teknik']]
    const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'oldukça', 'durum', 'mesele', 'taraf']
    let seed = 11
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const words: unknown[] = []
    let t = 0
    for (const v of vocab) {
      const end = t + 12 * 60
      while (t < end) {
        const n = 9
        for (let i = 0; i < n; i++) {
          const w = rnd() < 0.45 ? v[Math.floor(rnd() * v.length)] : common[Math.floor(rnd() * common.length)]
          words.push({ text: i === n - 1 ? `${w}.` : w, start: t, end: t + 0.4, confidence: 1 })
          t += 0.45
        }
        t += 0.5
      }
    }
    const dir = join(`${proj2}-data`, 'transcripts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id: 'tr', assetId: id, language: 'tr', model: 'small', provider: 'whisper-cpp', audioTrack: 0, createdAt: '', durationSec: t, words, segments: [] }))
    const before = md5(proj2)
    const r = cli('ideas', proj2)
    expect(r.ideas.length).toBeGreaterThanOrEqual(2)
    const ai = r.ideas.find((i: any) => /yapay|zeka|model|veri/.test(i.keywords.join(' ')))
    expect(ai).toBeTruthy()
    expect(ai.durationSec).toBeGreaterThan(9 * 60)
    expect(ai.titles[0]).toMatch(/hakkında|üzerine|dakika|sohbet|anlattıklarım/)
    expect(ai.titleSource).toBe('draft')
    expect(r.ai.requested).toBe(false)
    expect(md5(proj2)).toBe(before) // yalnızca öneri
    expect(cli('ideas', proj2, '--ai').ai.error).toMatch(/kapalı/) // anahtar yokken nedeni söyler
  }, 120_000)

  it('katman silme ve anlaşılır hata', () => {
    expect(cli('delete-lane', proj, 'CC').deleted).toBeGreaterThan(0)
    const bad = cli('bogus', proj)
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/Bilinmeyen komut/)
  }, 60_000)
})
