import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * YAYIN SENARYOSU (kullanıcı yayından önce "çalışıyor mu bir dene" dedi): gerçek ffmpeg + sahte whisper ile
 * 1) Auto Kick: "ııı/eee" dolgu sesleri ve konuşulmayan yerler kesilir; 2) hazır zaman damgası listesiyle YATAY videolar (Auto yatay);
 * 3) dikey klipler (Auto Clips zinciri, MP4). Sahte transkript: 60 sn kayıt, konuşmalar arasında uzun sessizlik + dolgu sesleri.
 */
const tmp = mkdtempSync(join(tmpdir(), 'cf-rehearsal-'))
const ud = join(tmp, 'ud')
const ffprobe = () => require('@ffprobe-installer/ffprobe').path as string
const dur = (f: string) => Number(JSON.parse(execFileSync(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', f]).toString()).format.duration)
const dims = (f: string) => JSON.parse(execFileSync(ffprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', f]).toString()).streams[0] as { width: number; height: number }

beforeAll(() => {
  mkdirSync(join(ud, 'models'), { recursive: true })
  writeFileSync(join(ud, 'models', 'ggml-tiny.bin'), Buffer.alloc(12_000_000))
  const fake = join(tmp, 'whisper')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const val = (f) => a[a.indexOf(f) + 1]
const first = /chunk_0\\.wav$/.test(val('-f'))
// [başlangıç sn, cümle]; dolgu sesleri ("ııı", "eee") ve aralarında uzun sessizlikler
const sents = first ? [
  [2, 'Selam arkadaşlar bugün Osimhen konuşacağız.'], [5.4, 'ııı'], [6.0, 'eee'],
  [13, 'Osimhen gol attı ve Galatasaray kazandı.'], [20, 'eee'], [21, 'ııı'],
  [30, 'Lemina orta sahada çok iyi oynadı.'], [34, 'Lemina bence takımın en önemlisi.'],
  [42, 'Zaha kanatta fark yarattı ama bitiricilik eksik.']
] : []
const tr = [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }]
for (const [t0, text] of sents) { let t = t0 * 1000; for (const w of text.split(' ')) { tr.push({ offsets: { from: t, to: t + 350 }, text: ' ' + w }); t += 450 } }
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: tr }))
`
  )
  chmodSync(fake, 0o755)
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ whisperCppPath: fake, whisperModelDir: join(ud, 'models'), whisperModel: 'tiny', language: 'tr', outroEnabled: false, silenceAudioGuard: false }))
  const ffmpeg = require('ffmpeg-static') as string
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'yayin.mp4')])
}, 120_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('yayın senaryosu: Auto Kick → yatay videolar → dikey klipler', () => {
  it('ııı/eee ve sessizlikler kesilir; liste yatay videolara çevrilir; dikey MP4 klipler çıkar', async () => {
    const { AutoKickManager } = await import('../../src/main/autokick/pipeline')
    const { AutoClipsManager, chainAutoClips } = await import('../../src/main/autoclips/run')
    const { chainAutoHorizontal } = await import('../../src/main/autokick/horizontal')
    const { runYtCut } = await import('../../src/main/ytcut')
    const { Session, makeService } = await import('../../src/cli/session')
    const { timelineWords } = await import('../../src/shared/timeline/transcript')
    const env = { userDataDir: ud }
    const ac = new AutoClipsManager(env, () => undefined)
    const handled = new Set<string>()
    const logs: string[] = []
    let done: any
    const kick = new AutoKickManager(env, (st) => {
      chainAutoClips(st as any, handled, { autoClipsAfterKick: true, autoClipsMax: 0, autoClipsExport: true, autoClipsCaptions: false }, ac, (m) => logs.push(m))
      if (st.status === 'done' || st.status === 'failed') done = st
    })
    const dir = join(tmp, 'AutoKick Çıktı')
    // liste ORİJİNAL kayıt zamanıyla (kesimden önce); Auto Kick bunu kesimli videonun zamanına çevirir
    const list = '00:00:00 - Giriş\n00:00:13 - Osimhen\n00:00:30 - Lemina\n00:00:42 - Zaha'
    kick.start({ videoPath: join(tmp, 'yayin.mp4'), outDir: dir, silence: { minGapSec: 0.55, keepSec: 0.2, cutFillers: true }, chapterList: list, chapterMinSec: 2 })
    const until = async (f: () => boolean, ms = 280_000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('zaman aşımı'); await new Promise((r) => setTimeout(r, 250)) } }
    await until(() => !!done)
    expect(done.status, done.error).toBe('done')
    const r = done.result

    // 1) KESİM: konuşulmayan yerler + dolgu sesleri çıkmış; video belirgin kısalmış; tam video sağlam
    expect(r.durationAfterSec).toBeLessThan(r.durationBeforeSec * 0.75)
    expect(r.fillers).toBeGreaterThanOrEqual(2) // ııı / eee kesildi
    expect(r.verified).toBe(true)
    expect(existsSync(r.fullVideoPath)).toBe(true)
    expect(Math.abs(dur(r.fullVideoPath) - r.durationAfterSec)).toBeLessThan(0.6)
    const sess = await Session.open(r.projectPath, await makeService(env))
    const words = timelineWords(sess.timeline, sess.transcripts).map((w) => w.text.toLowerCase().replace(/[^\p{L}]/gu, ''))
    expect(words).toContain('osimhen')
    expect(words.filter((w) => /^(i+|e{2,})$/.test(w))).toEqual([]) // kesimli videoda ııı/eee kalmadı

    // 2) ZAMAN DAMGALARI: liste kesimli videonun zamanına çevrildi; her konu başlığı var
    expect(r.timestampsText).toMatch(/Osimhen/)
    expect(r.timestampsText).toMatch(/Lemina/)
    expect(r.timestampsText).toMatch(/Zaha/)
    expect(r.chapterRanges.map((x: any) => x.title)).toEqual(['Osimhen', 'Lemina', 'Zaha'])

    // 3) YATAY VİDEOLAR (Auto yatay): her satır ayrı yatay MP4 + konuşma metni
    let ytReq: any
    expect(await chainAutoHorizontal(done, new Set(), { autoHorizontalAfterKick: true, autoHorizontalCta: false }, (q) => ((ytReq = q), 'y1'), (m) => logs.push(m), env)).toBe('y1')
    const yt = await runYtCut(ytReq, (await makeService(env)).tools, {})
    expect(yt.items.map((i) => i.title)).toEqual(['Osimhen', 'Lemina', 'Zaha'])
    // ZAMAN DOĞRULUĞU: kesit süresi, çevrilen aralığın TAM süresi (saniyeye yuvarlanıp konuşma kırpılmaz)
    yt.items.forEach((it, i) => {
      const rg = r.chapterRanges[i]
      expect(Math.abs(it.start - rg.start)).toBeLessThan(0.001)
      expect(Math.abs(it.end - rg.end)).toBeLessThan(0.001)
      expect(Math.abs(dur(it.path!) - (rg.end - rg.start))).toBeLessThan(0.3)
    })
    for (const it of yt.items) {
      expect(it.error).toBeUndefined()
      expect(existsSync(it.path!)).toBe(true)
      expect(dims(it.path!)).toEqual({ width: 1920, height: 1080 })
      expect(existsSync(it.path!.replace(/\.mp4$/i, '') + ' - transkript.txt')).toBe(true)
    }
    expect(readFileSync(yt.items[0].path!.replace(/\.mp4$/i, '') + ' - transkript.txt', 'utf8')).toMatch(/Osimhen/)

    // 4) DİKEY KLİPLER (Auto Clips zinciri, MP4)
    await until(() => ac.list().length >= 1 && ac.list().every((j) => j.status === 'done' || j.status === 'failed'))
    const job = ac.list()[0]
    expect(job.status, job.error).toBe('done')
    expect(ac.list().every((j) => !j.request.horizontal)).toBe(true) // yalnızca dikey
    expect(job.result!.clips.length).toBe(3)
    for (const c of job.result!.clips) {
      expect(c.error).toBeUndefined()
      expect(statSync(c.videoPath!).size).toBeGreaterThan(5_000)
      expect(dims(c.videoPath!)).toEqual({ width: 1080, height: 1920 })
    }
    expect(job.result!.clips.map((c) => c.subject)).toEqual(['Osimhen', 'Lemina', 'Zaha'])
    // dikey klip de VERİLEN zamanlarda başlar/biter (aralık klip süresine sığıyorsa içinden "en güçlü parça" seçilmez)
    job.result!.clips.forEach((c, i) => {
      expect(Math.abs(c.start - r.chapterRanges[i].start)).toBeLessThan(0.01)
      expect(Math.abs(c.end - r.chapterRanges[i].end)).toBeLessThan(0.01)
    })
    // 5) KLİP ÇIKAR: açıklamayla an bul → ince ayar (başı/sonu elle) → TEK klip, dikey + yatay
    const { clipFindSearch } = await import('../../src/main/autoclips/pipeline')
    const found = await clipFindSearch(r.projectPath, 'Lemina orta sahada oynadı', env)
    expect(found.candidates.length).toBeGreaterThanOrEqual(1)
    const best = found.candidates[0]
    expect(best.matched.join(' ')).toMatch(/Lemina/i)
    await expect(clipFindSearch(r.projectPath, 'Mourinho kırmızı kart', env)).resolves.toMatchObject({ candidates: [] }) // konuşulmayan: bulunmaz
    const a = Math.max(0, Math.round((best.start - 0.5) * 10) / 10) // kullanıcı ince ayar: başı 0,5 sn öne
    const b = Math.min(found.totalSec, Math.round((best.end + 0.5) * 10) / 10)
    const ac2 = new AutoClipsManager(env, () => undefined)
    ac2.start({ projectPath: r.projectPath, ranges: [{ start: a, end: b, title: 'Lemina anı' }], exact: true, exportVideos: true })
    ac2.start({ projectPath: r.projectPath, ranges: [{ start: a, end: b, title: 'Lemina anı' }], exact: true, exportVideos: true, horizontal: true })
    await until(() => ac2.list().length === 2 && ac2.list().every((j) => j.status === 'done' || j.status === 'failed'))
    const [vj, hj] = ac2.list()
    expect(vj.status, vj.error).toBe('done')
    expect(hj.status, hj.error).toBe('done')
    for (const j of [vj, hj]) {
      expect(j.result!.clips.length).toBe(1) // TEK klip
      expect(j.result!.clips[0].error).toBeUndefined()
      expect(j.result!.clips[0].start).toBe(a)
      expect(j.result!.clips[0].end).toBe(b)
      expect(Math.abs(dur(j.result!.clips[0].videoPath!) - (b - a))).toBeLessThan(0.4)
    }
    expect(dims(vj.result!.clips[0].videoPath!)).toEqual({ width: 1080, height: 1920 })
    expect(dims(hj.result!.clips[0].videoPath!)).toEqual({ width: 1920, height: 1080 }) // yatay: normal video
    expect(readFileSync(join(dir, 'Auto Kick günlüğü.txt'), 'utf8')).toMatch(/Auto Kick TAMAMLANDI/)
  }, 300_000)
})
