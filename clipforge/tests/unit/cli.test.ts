import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
    expect(r.results[0].sentence).toMatch(/Nelse/) // yerleşik sözlük adı "Victor Nelsson"a yaklaştırsa da arama bulur
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

  it('chapters: düzenlenmiş çizelgenin YouTube zaman damgaları (0:00, ≥3 bölüm, başlıklar), dosyaya yazılır, proje değişmez', () => {
    const proj3 = join(tmp, 'bolum.clipforge')
    cli('new', proj3)
    const imp = cli('import', proj3, join(tmp, 'video örnek.mp4'), '--add')
    const id = imp.added[0].id as string
    const vocab = [['oyun', 'bölüm', 'boss', 'seviye', 'karakter', 'silah', 'görev', 'harita'], ['yapay', 'zeka', 'model', 'veri', 'eğitim', 'algoritma', 'öğrenme', 'chatbot'], ['transfer', 'forvet', 'taraftar', 'penaltı', 'kadro', 'sezon', 'lig', 'teknik']]
    const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'oldukça', 'durum', 'mesele', 'taraf']
    let seed = 13
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const words: unknown[] = []
    let t = 0
    for (const v of vocab) {
      const end = t + 10 * 60
      while (t < end) {
        for (let i = 0; i < 9; i++) {
          const w = rnd() < 0.45 ? v[Math.floor(rnd() * v.length)] : common[Math.floor(rnd() * common.length)]
          words.push({ text: i === 8 ? `${w}.` : w, start: t, end: t + 0.4, confidence: 1 })
          t += 0.45
        }
        t += 0.5
      }
    }
    const dir = join(`${proj3}-data`, 'transcripts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id: 'tr', assetId: id, language: 'tr', model: 'small', provider: 'whisper-cpp', audioTrack: 0, createdAt: '', durationSec: t, words, segments: [] }))
    // çizelgedeki klipleri kaynağın tamamına uzat (düzenlenmiş 30 dk'lık video gibi)
    const pj = JSON.parse(readFileSync(proj3, 'utf8'))
    for (const tr of pj.timeline.tracks) for (const c of tr.clips) c.srcOut = t
    writeFileSync(proj3, JSON.stringify(pj))
    const before = md5(proj3)
    const out = join(tmp, 'zd', 'zaman damgalari.txt')
    const r = cli('chapters', proj3, '--out', out)
    expect(r.chapters.length).toBeGreaterThanOrEqual(3)
    expect(r.chapters[0].time).toBe('00:00:00')
    expect(r.text.split('\n').slice(0, 3)).toEqual(['Saniyeler:', '', expect.stringMatching(/^00:00:00 - \S/)])
    expect(r.warnings).toEqual([])
    expect(readFileSync(out, 'utf8').trim()).toBe(r.text)
    expect(md5(proj3)).toBe(before)
    expect(cli('chapters', proj3, '--ai').ai.error).toMatch(/kapalı/) // anahtar yokken nedeni söyler
  }, 120_000)

  it('story: anlatım sesi → plan (düzenlenebilir JSON) → sahneler çizilir; ses Ses katmanında, sahneler Video 1\'de, çizelge süresi anlatımla aynı', () => {
    const ffmpeg = require('ffmpeg-static') as string
    const wav = join(tmp, 'anlatim ses.wav')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=30', wav])
    const dir = join(tmp, 'anlatim cikti')
    const p = cli('story', 'plan', wav, '--out', dir)
    expect(p.ok).toBe(true)
    expect(p.planner).toBe('auto')
    const planPath = join(dir, 'story-plan.json')
    expect(existsSync(planPath)).toBe(true)
    const plan = JSON.parse(readFileSync(planPath, 'utf8'))
    expect(plan.totalSec).toBeGreaterThan(10)
    plan.scenes = [
      { id: 'a', start: 2, end: 12, enabled: true, source: 'manual', content: { type: 'stats', kicker: 'RAKAMLARLA', cards: [{ label: 'Lig', value: '7', unit: 'PUAN', tone: 'good' }, { value: '15.', unit: 'SIRA', tone: 'bad', at: 3 }] } },
      { id: 'b', start: 12, end: 20, enabled: true, source: 'manual', content: { type: 'person', role: 'TEKNİK DİREKTÖR', name: 'AD SOYAD' } },
      { id: 'c', start: 20, end: 24, enabled: true, source: 'manual', content: { type: 'football', home: { formation: '4-3-3' }, away: { formation: '4-4-2' }, players: [{ id: 'a', name: 'Osimhen', team: 'home', at: 'orta-saha-sag' }, { id: 'b', name: 'Barış', team: 'home', at: 'ceza-yayi' }], ball: { holder: 'a' }, actions: [{ do: 'pass', at: 0.5, from: 'a', to: 'b' }, { do: 'shoot', at: 2.8, from: 'b', to: 'kale-sol' }] } },
      { id: 'd', start: 24, end: 28, enabled: false, source: 'manual', content: { type: 'title', text: 'KAPALI' } }
    ]
    writeFileSync(planPath, JSON.stringify(plan))
    const b = cli('story', 'build', wav, '--out', dir, '--plan', planPath, '--aspect', '16:9')
    expect(b.ok, JSON.stringify(b)).toBe(true)
    expect(b.rendered.scenes).toBe(3)
    const show = cli('show', b.project)
    const v1 = show.tracks.find((t: any) => t.id === 'V1')
    expect(v1.clips).toHaveLength(3)
    expect(v1.clips[0].start).toBeCloseTo(2, 1)
    expect(v1.clips[1].start).toBeCloseTo(12, 1)
    const audio = show.tracks.filter((t: any) => t.id !== 'V1').flatMap((t: any) => t.clips).filter((c: any) => c.start === 0)
    expect(audio.length).toBeGreaterThan(0) // anlatım sesi 0. sn'den
    expect(show.aspect).toBe('16:9')
    // aynı build tekrar: eski sahneler temizlenir, çoğalmaz
    const again = cli('story', 'build', wav, '--out', dir, '--plan', planPath)
    expect(cli('show', again.project).tracks.find((t: any) => t.id === 'V1').clips).toHaveLength(3)
    // güncellik kapısı: sezonu süren eski veriyle çizim reddedilir; --allow-stale ile (bilinçli) çizilir
    const stalePlan = { ...plan, scenes: [{ id: 'z', start: 2, end: 10, enabled: true, source: 'manual', content: { type: 'leaderboard', dataset: 'superlig-2026-27-puan-hafta7', top: 5 } }] }
    writeFileSync(planPath, JSON.stringify(stalePlan))
    const refused = cli('story', 'build', wav, '--out', dir, '--plan', planPath)
    expect(refused.ok).toBe(false)
    expect(JSON.stringify(refused)).toMatch(/Veri güncel değil/)
    const forced = cli('story', 'build', wav, '--out', dir, '--plan', planPath, '--allow-stale')
    expect(forced.ok, JSON.stringify(forced)).toBe(true)
    writeFileSync(planPath, JSON.stringify(plan)) // sonraki adımlar için eski plan
    cli('story', 'build', wav, '--out', dir, '--plan', planPath)
    // kare: sahne gerçekten çizilmiş (düz zeminden farklı)
    const fr = join(tmp, 'sahne-kare.jpg')
    expect(cli('frame', b.project, '--at', '8', '--out', fr).ok).toBe(true)
    expect(statSync(fr).size).toBeGreaterThan(8000)
    // bozuk istek: anlaşılır hata
    expect(cli('story', 'build', join(tmp, 'yok.wav')).ok).toBe(false)
    expect(cli('story', 'cizim', wav).ok).toBe(false)
  }, 240_000)

  it('story schema + preview + medya sahnesi (tam kare görsel, şeffaf karakter, video) — Claude Code akışı', () => {
    const ffmpeg = require('ffmpeg-static') as string
    const sch = cli('story', 'schema')
    expect(Object.keys(sch.types)).toEqual(expect.arrayContaining(['stats', 'timeline', 'person', 'media']))
    expect(sch.plan.theme.accent).toBe('#FFD21F') // sarı-siyah varsayılan
    const dir = join(tmp, 'medya')
    mkdirSync(dir, { recursive: true })
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1600x900:rate=1:duration=1', '-frames:v', '1', join(dir, 'sahne.png')])
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=600x900,format=rgba,geq=r=255:g=120:b=20:a=\'if(lt(hypot(X-300,Y-450),260),255,0)\'', '-frames:v', '1', join(dir, 'karakter.png')])
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2', '-pix_fmt', 'yuv420p', join(dir, 'klip.mp4')])
    const plan = {
      totalSec: 40, planner: 'ai', warnings: [], theme: sch.plan.theme,
      scenes: [
        { id: 'm1', start: 0, end: 8, enabled: true, source: 'manual', content: { type: 'media', file: 'sahne.png', fit: 'cover', zoom: 'in', title: 'Stuttgart', caption: 'Hikâyenin başladığı yer' } },
        { id: 'm2', start: 8, end: 16, enabled: true, source: 'manual', content: { type: 'media', file: 'karakter.png', fit: 'contain', align: 'right', caption: 'Teknik direktör' } },
        { id: 'm3', start: 16, end: 24, enabled: true, source: 'manual', content: { type: 'media', file: 'klip.mp4', caption: 'Antrenman' } },
        { id: 'p1', start: 24, end: 32, enabled: true, source: 'manual', content: { type: 'person', role: 'TEKNİK DİREKTÖR', name: 'AD SOYAD' } },
        { id: 'f1', start: 32, end: 40, enabled: true, source: 'manual', content: { type: 'football', home: { formation: '4-3-3' }, away: { formation: '4-4-2' }, players: [{ id: 'a', name: 'Osimhen', team: 'home', at: 'orta-saha-sag' }, { id: 'b', name: 'Barış', team: 'home', at: 'ceza-yayi' }], ball: { holder: 'a' }, actions: [{ do: 'pass', at: 1, from: 'a', to: 'b' }, { do: 'shoot', at: 3, from: 'b', to: 'kale-sag' }] } }
      ]
    }
    const pf = join(dir, 'plan.json')
    writeFileSync(pf, JSON.stringify(plan))
    const r = cli('story', 'preview', pf, '--out', join(dir, 'onizleme'))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.frames.map((f: any) => f.id)).toEqual(['m1', 'm2', 'm3', 'p1', 'f1'])
    for (const f of r.frames) expect(statSync(f.file).size, f.id).toBeGreaterThan(5000)
    // futbol sahnesinde hatalı eylem: sahne kimliğiyle anlaşılır hata
    writeFileSync(pf, JSON.stringify({ ...plan, scenes: [{ id: 'fx', start: 0, end: 6, enabled: true, source: 'manual', content: { type: 'football', players: [{ id: 'a', team: 'home', at: 'orta-nokta' }], actions: [{ do: 'pass', at: 1, from: 'a', to: 'yok' }] } }] }))
    const fbad = cli('story', 'preview', pf, '--out', join(dir, 'onizleme3'))
    expect(fbad.ok).toBe(false)
    expect(JSON.stringify(fbad)).toMatch(/Sahne fx.*oyuncu bulunamadı/)
    // eksik dosya: anlaşılır hata
    writeFileSync(pf, JSON.stringify({ ...plan, scenes: [{ id: 'x', start: 0, end: 5, enabled: true, source: 'manual', content: { type: 'media', file: 'yok.png' } }] }))
    const bad = cli('story', 'preview', pf, '--out', join(dir, 'onizleme2'))
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).toContain('Medya dosyası bulunamadı')
  }, 240_000)

  it('story data: bilgi paketi listele/ara/ekle; kaynaksız veri reddedilir; sıralama sahnesi veriden çizilir; yok olan veri anlaşılır hata', () => {
    const list = cli('story', 'data', 'list')
    expect(list.datasets.map((d: any) => d.id)).toEqual(expect.arrayContaining(['superlig-2025-26-gol', 'bundesliga-2025-26-gol']))
    const sd = list.datasets.find((d: any) => d.id === 'superlig-2026-27-puan-hafta7')
    expect(sd.warnings.join(' ')).toMatch(/bayat|doğrulanmadı/)
    const found = cli('story', 'data', 'search', 'Osimhen')
    expect(found.found).toBe(true)
    expect(found.matches.some((m: any) => m.dataset === 'superlig-2025-26-gol' && m.value === 15)).toBe(true)
    expect(cli('story', 'data', 'search', 'Hiçkimse Yok').found).toBe(false)
    const dir = join(tmp, 'veri')
    mkdirSync(dir, { recursive: true })
    const ds = { id: 'seriea-2025-26-gol', title: 'Serie A 2025/26 gol krallığı', competition: 'seriea', season: '2025/26', metric: 'gol', asOf: '2026-05-25', final: true, complete: false, rows: [{ rank: 1, name: 'Deneme Oyuncu', team: 'Napoli', value: 20, status: 'final' }, { rank: 2, name: 'Başka Oyuncu', team: 'Inter', value: 18, status: 'final' }], sources: ['test kaynağı'], verified: 'press' }
    writeFileSync(join(dir, 'ds.json'), JSON.stringify(ds))
    expect(cli('story', 'data', 'add', join(dir, 'ds.json')).saved).toEqual(['seriea-2025-26-gol'])
    expect(cli('story', 'data', 'show', 'seriea-2025-26-gol').rows).toHaveLength(2)
    writeFileSync(join(dir, 'kotu.json'), JSON.stringify({ ...ds, id: 'kotu-veri', sources: [] }))
    const bad = cli('story', 'data', 'add', join(dir, 'kotu.json'))
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).toMatch(/sources|kaynak/)
    const theme = cli('story', 'schema').plan.theme
    const plan = { totalSec: 20, planner: 'ai', warnings: [], theme, scenes: [{ id: 'l', start: 0, end: 8, enabled: true, source: 'manual', content: { type: 'leaderboard', dataset: 'seriea-2025-26-gol', top: 5, highlight: ['Başka'] } }, { id: 't', start: 8, end: 14, enabled: true, source: 'manual', content: { type: 'teamcard', team: 'Galatasaray' } }, { id: 'c', start: 14, end: 20, enabled: true, source: 'manual', content: { type: 'compare', left: { name: 'A', team: 'Bayern' }, right: { name: 'B', team: 'Liverpool' }, metrics: [{ label: 'Gol', left: 3, right: 2 }] } }] }
    const pf = join(dir, 'plan2.json')
    writeFileSync(pf, JSON.stringify(plan))
    const r = cli('story', 'preview', pf, '--out', join(dir, 'o2'))
    expect(r.ok, JSON.stringify(r)).toBe(true)
    for (const f of r.frames) expect(statSync(f.file).size, f.id).toBeGreaterThan(5000)
    writeFileSync(pf, JSON.stringify({ ...plan, scenes: [{ ...plan.scenes[0], content: { type: 'leaderboard', dataset: 'yok-yok-yok' } }] }))
    const miss = cli('story', 'preview', pf, '--out', join(dir, 'o3'))
    expect(miss.ok).toBe(false)
    expect(JSON.stringify(miss)).toMatch(/Veri kümesi bulunamadı/)
  }, 240_000)

  it('auto-clips: transkriptte konuşulan kişiye göre aday (zaman + ne konuşulmuş); --pick ile 9:16 klip projesi: yüz üstte (kırpma), görüntü altta; ana proje değişmez', () => {
    const proj4 = join(tmp, 'autoclips.clipforge')
    const ffm = require('ffmpeg-static') as string
    execFileSync(ffm, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=5:duration=330', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=330', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'uzun.mp4')])
    cli('new', proj4)
    const id = cli('import', proj4, join(tmp, 'uzun.mp4'), '--add').added[0].id as string
    const FOOT = ['transfer', 'forvet', 'taraftar', 'penaltı', 'kadro', 'sezon', 'lig', 'teknik']
    const FOOD = ['yemek', 'tarif', 'lezzet', 'restoran', 'mutfak', 'tavuk', 'pilav', 'çorba']
    const common = ['gerçekten', 'şimdi', 'arkadaşlar', 'konuşuyoruz', 'oldukça', 'durum', 'mesele', 'taraf']
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const words: unknown[] = []
    let t = 0
    for (const b of [{ secs: 60, v: FOOD }, { secs: 70, v: FOOT, name: 'Lemina' }, { secs: 60, v: FOOD }, { secs: 60, v: FOOT, name: 'Zaha' }, { secs: 60, v: FOOD }] as { secs: number; v: string[]; name?: string }[]) {
      const end = t + b.secs
      while (t < end) {
        for (let i = 0; i < 9; i++) {
          let w = rnd() < 0.45 ? b.v[Math.floor(rnd() * b.v.length)] : common[Math.floor(rnd() * common.length)]
          if (b.name && i === 4 && rnd() < 0.6) w = b.name
          words.push({ text: i === 8 ? `${w}.` : i === 0 ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w, start: t, end: t + 0.4, confidence: 1 })
          t += 0.45
        }
        t += 0.5
      }
    }
    const dir4 = join(`${proj4}-data`, 'transcripts')
    mkdirSync(dir4, { recursive: true })
    writeFileSync(join(dir4, `${id}.json`), JSON.stringify({ id: 'tr', assetId: id, language: 'tr', model: 'small', provider: 'whisper-cpp', audioTrack: 0, createdAt: '', durationSec: t, words, segments: [] }))
    const before = md5(proj4)
    const r = cli('auto-clips', proj4)
    expect(r.ok === false ? JSON.stringify(r) : 'ok').toBe('ok')
    expect(r.candidates.every((c: any) => c.headline.includes('konuşmuşsun') && c.summary.length > 5)).toBe(true)
    const lem = r.candidates.find((c: any) => c.subject.includes('Lemina'))
    expect(lem, JSON.stringify(r.candidates)).toBeTruthy()
    expect(lem.start, JSON.stringify(r.candidates)).toBeGreaterThan(40)
    expect(md5(proj4)).toBe(before)
    // klip projesi: 9:16, yüz (kırpma) üstte, konuşulan görüntü altta
    const mk = cli('auto-clips', proj4, '--pick', String(lem.pick), '--face', '0.7,0.64,0.29,0.34')
    expect(mk.created, JSON.stringify(mk)).toHaveLength(1)
    const cp = cli('show', mk.created[0].projectPath)
    expect(cp.aspect).toBe('9:16')
    const v1c = cp.tracks.find((x: any) => x.id === 'V1').clips
    const v2c = cp.tracks.find((x: any) => x.id === 'V2').clips
    expect(v1c.length).toBeGreaterThan(0)
    expect(v2c.length).toBe(v1c.length)
    expect(cp.durationSec).toBeCloseTo(lem.durationSec, 0)
    expect(md5(proj4)).toBe(before)
    // gözetimsiz zincir: konular → klip projeleri → MP4 (tek klip, süre için)
    const chain = cli('auto-clips', proj4, '--export', '--max', '1')
    expect(chain.ok, JSON.stringify(chain)).toBe(true)
    expect(chain.count).toBe(1)
    expect(chain.clips[0].error).toBeUndefined()
    expect(existsSync(chain.clips[0].video)).toBe(true)
    expect(statSync(chain.clips[0].video).size).toBeGreaterThan(20_000)
    expect(chain.clips[0].project).toMatch(/\.clipforge$/)
    expect(md5(proj4)).toBe(before)
    const bad = cli('auto-clips', join(tmp, 'yok.clipforge'))
    expect(bad.ok).toBe(false)
    expect(cli('auto-clips', proj4, '--face', '0.9,0.9,0.5,0.5').ok).toBe(false)
  }, 180_000)

  it('ideas --write: Claude Code\'un yazdığı klip önerileri kaydedilir, uygulamadaki Öneriler bunları gösterir; --auto kurallı bulucu; --clear siler; geçersiz öneri reddedilir', () => {
    const f = join(tmp, 'oneriler.json')
    writeFileSync(f, JSON.stringify([{ start: 3, end: 22, headline: 'Viktor Nelsen hakkında konuşmuşsun', summary: 'Geçen sene Nelsen\'dan bahsetmiştim.', title: 'Nelsen Neden Önemli?' }]))
    expect(cli('ideas', proj, '--write', f).saved).toBe(1)
    const r = cli('ideas', proj)
    expect(r.source).toBe('claude')
    expect(r.ideas[0]).toMatchObject({ headline: 'Viktor Nelsen hakkında konuşmuşsun' })
    expect(r.ideas[0].start).toBe(3)
    expect(cli('ideas', proj, '--auto').source).toBe('auto')
    writeFileSync(f, JSON.stringify([{ start: 10, end: 5, headline: 'x' }]))
    expect(cli('ideas', proj, '--write', f).ok).toBe(false)
    expect(cli('ideas', proj, '--clear').cleared).toBe(true)
    expect(cli('ideas', proj).source).toBe('auto')
  }, 120_000)

  it('katman silme ve anlaşılır hata', () => {
    expect(cli('delete-lane', proj, 'CC').deleted).toBeGreaterThan(0)
    const bad = cli('bogus', proj)
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/Bilinmeyen komut/)
  }, 60_000)
})
