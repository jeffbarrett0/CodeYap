import { createTimelineWithGame } from './helpers'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importMedia } from '../../src/main/media/import'
import { runExport } from '../../src/main/export'
import { saveProject, openProject, dataDirFor } from '../../src/main/project/io'
import { CancelledError } from '../../src/main/tasks'
import { createDefaultTimeline, newId, TRACK_IDS } from '@shared/timeline/model'
import { applyTemplate, BUILTIN_TEMPLATES } from '@shared/timeline/templates'
import { clipsForVideoWithAudio } from '@shared/timeline/create'
import * as ops from '@shared/timeline/ops'
import { optionsFromPreset } from '@shared/export/presets'

/** Testlerde hızlı kodlama (üretimde varsayılan: slow + CRF 14). Kalite testi ayrıca gerçek varsayılanı dener. */
const quick = (id: string, o: Partial<import('@shared/types').ExportOptions> = {}) => optionsFromPreset(id, { encoderPreset: 'ultrafast', crf: 23, ...o })
import { PROJECT_VERSION, type Clip, type MediaAsset, type Project } from '@shared/types'
import { ffmpegAvailable, FFMPEG, makeObsLikeMkv, probeVideo, tools } from './ffmpeg-fixtures'

const ok = ffmpegAvailable()
const d = ok ? describe : describe.skip
let root = ''
let asset: MediaAsset

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cf-exp-'))
  if (ok) asset = await importMedia(makeObsLikeMkv(root, 20), tools, join(root, 'data'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const mk = (trackId: string, start: number, srcIn: number, srcOut: number, extra: Partial<Clip> = {}): Clip => ({
  id: newId('clip'), trackId, assetId: asset.id, start, srcIn, srcOut, volume: 1, label: 'klip', ...extra
})

function timeline() {
  // 9:16 "oyun ortada, kamera altta" şablonu (katman konumlarıyla)
  let tl = applyTemplate(createTimelineWithGame(), BUILTIN_TEMPLATES[1])
  tl = ops.addClip(tl, TRACK_IDS.screen, mk(TRACK_IDS.screen, 0, 4, 12))
  tl = ops.addClip(tl, TRACK_IDS.webcam, mk(TRACK_IDS.webcam, 0, 4, 12, { crop: { x: 0.7, y: 0.6, w: 0.3, h: 0.4 } }))
  tl = ops.addClip(tl, TRACK_IDS.game, mk(TRACK_IDS.game, 0, 4, 12, { audioStream: 1 }))
  tl = ops.addClip(tl, TRACK_IDS.voice, mk(TRACK_IDS.voice, 0, 4, 12, { audioStream: 2 }))
  return { ...tl, captions: [{ id: 'c', start: 1, end: 4, text: 'Merhaba şişman çocuk ğüşöç' }] }
}

d('dışa aktarma (gerçek ffmpeg)', () => {
  it('9:16 (1080×1920), kamera kırpması, altyazı ve ayrı ses seviyeleriyle klip üretir', async () => {
    const out = join(root, 'Çıktı Klasörü', 'klip çıktı.mp4')
    const progress: number[] = []
    const r = await runExport(
      { name: 'k', timeline: timeline(), assets: [asset], options: quick('shorts', { fps: 30 }), range: { start: 0, end: 8 }, outputPath: out },
      tools,
      { progress: (f) => progress.push(f) }
    )
    expect(r.outputPath).toBe(out)
    expect(existsSync(out)).toBe(true)
    expect(existsSync(`${out}.part`)).toBe(false)
    const info = probeVideo(out)
    expect(info).toMatchObject({ width: 1080, height: 1920, audio: 1 })
    expect(info.duration).toBeGreaterThan(7.8)
    expect(info.duration).toBeLessThan(8.4)
    expect(Math.max(...progress)).toBeGreaterThan(0.9)
  })

  it('9:16: oyun ekranı ortada, kamera altta — kare içeriği doğrulanır', async () => {
    const out = join(root, 'frame-check.mp4')
    await runExport({ name: 'k', timeline: { ...timeline(), captions: [] }, assets: [asset], options: quick('shorts'), range: { start: 0, end: 3 }, outputPath: out }, tools)
    // Üst şerit (y<200) yalnızca bulanık arka plan, orta (y≈960) oyun, alt (y≈1500) kamera: üç bölge de siyah olmamalı
    const luma = (y: number) => {
      const buf = execFileSync(FFMPEG, ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-vf', `crop=200:40:440:${y},format=gray`, '-f', 'rawvideo', '-'])
      return buf.reduce((s, b) => s + b, 0) / buf.length
    }
    expect(luma(960)).toBeGreaterThan(20) // oyun
    expect(luma(1500)).toBeGreaterThan(20) // kamera bölgesi
    expect(luma(40)).toBeLessThan(30) // üst bölge boş: arka plan rengi
  })

  it('16:9 ve 1:1 şablonları doğru çözünürlükte çıkar', async () => {
    for (const [preset, w, h] of [['youtube', 1920, 1080], ['square', 1080, 1080]] as const) {
      const tl = { ...timeline(), aspect: preset === 'youtube' ? ('16:9' as const) : ('1:1' as const), captions: [] }
      const out = join(root, `${preset}.mp4`)
      await runExport({ name: 'k', timeline: tl, assets: [asset], options: quick(preset), range: { start: 0, end: 2 }, outputPath: out }, tools)
      expect(probeVideo(out)).toMatchObject({ width: w, height: h })
    }
  })

  it('iptal edilince yarım dosya bırakılmaz', async () => {
    const out = join(root, 'iptal.mp4')
    const ctrl = new AbortController()
    const p = runExport({ name: 'k', timeline: timeline(), assets: [asset], options: quick('shorts'), range: { start: 0, end: 8 }, outputPath: out }, tools, { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 150)
    await expect(p).rejects.toBeInstanceOf(CancelledError)
    expect(existsSync(out)).toBe(false)
    expect(existsSync(`${out}.part`)).toBe(false)
  })

  it('kayıp kaynak ve boş zaman çizelgesi anlaşılır hata verir', async () => {
    await expect(runExport({ name: 'k', timeline: timeline(), assets: [{ ...asset, missing: true }], options: quick('shorts'), range: { start: 0, end: 8 }, outputPath: join(root, 'x.mp4') }, tools)).rejects.toThrow(/bulunamadı/)
    await expect(runExport({ name: 'k', timeline: createTimelineWithGame(), assets: [asset], options: quick('shorts'), range: { start: 0, end: 0 }, outputPath: join(root, 'y.mp4') }, tools)).rejects.toThrow(/boş/)
  })
})

d('3 bölgeli varsayılan şablon (yüz / orta görsel yeri / alt görsel) — gerçek ffmpeg', () => {
  it('üstte yüz, ortada kullanıcının koyduğu görsel, altta görsel olarak çıkar; boş orta yer ve kapalı oyun katmanı görünmez', async () => {
    const png = join(root, 'konu görseli.png')
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=800x600:d=1', '-frames:v', '1', png])
    const imgAsset: MediaAsset = { ...asset, id: 'img1', name: 'konu görseli.png', path: png, kind: 'image', durationSec: 0, width: 800, height: 600, audioStreams: [], container: 'png' }
    let tl = createTimelineWithGame()
    tl = ops.addClip(tl, 'V2', mk('V2', 0, 4, 10))
    tl = ops.addClip(tl, 'V1', mk('V1', 0, 4, 10)) // oyun katmanı kapalı → görünmemeli
    tl = ops.addClip(tl, 'I1', { ...mk('I1', 0, 0, 6), assetId: 'img1' })
    tl = ops.addClip(tl, 'A2', mk('A2', 0, 4, 10, { audioStream: 2 }))
    // orta alan: mavi bir görsel (kullanıcının koyacağı davet görseli yerine)
    const blue = join(root, 'orta mavi.png')
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1000x200:d=1', '-frames:v', '1', blue])
    const blueAsset: MediaAsset = { ...imgAsset, id: 'img2', name: 'orta mavi.png', path: blue, width: 1000, height: 200 }
    tl = ops.addClip(tl, 'I2', { ...mk('I2', 0, 0, 6), assetId: 'img2' })
    const out = join(root, 'uc-bolge.mp4')
    await runExport({ name: 'k', timeline: tl, assets: [asset, imgAsset, blueAsset], options: quick('shorts'), range: { start: 0, end: 6 }, outputPath: out }, tools)
    expect(probeVideo(out)).toMatchObject({ width: 1080, height: 1920, audio: 1 })
    const rgb = (y: number, h = 40, w = 300) => {
      const buf = execFileSync(FFMPEG, ['-v', 'error', '-ss', '2', '-i', out, '-frames:v', '1', '-vf', `crop=${w}:${h}:390:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      const px = buf.length / 3
      let r = 0, g = 0, b = 0, max = 0
      for (let i = 0; i < buf.length; i += 3) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; max = Math.max(max, buf[i], buf[i + 1], buf[i + 2]) }
      return { r: r / px, g: g / px, b: b / px, max }
    }
    const top = rgb(200)
    expect(top.r + top.g + top.b).toBeGreaterThan(60) // yüz videosu (siyah değil)
    const bottom = rgb(1500)
    expect(bottom.r).toBeGreaterThan(200) // kırmızı görsel
    expect(bottom.g).toBeLessThan(40)
    expect(bottom.b).toBeLessThan(40)
    const mid = rgb(740, 100, 300) // y ≈ %34–48: orta alan
    expect(mid.b).toBeGreaterThan(200) // mavi orta görsel
    expect(mid.r).toBeLessThan(60)
  })
})

d('ses (gerçek ffmpeg)', () => {
  const meanVolume = (file: string): number => {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' })
    const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr)
    return m ? Number(m[1]) : -Infinity
  }

  it('video katmanına eklenen videonun sesi dışa aktarılan dosyada DUYULUR; sesi eklenmezse sessizdir', async () => {
    const tracks = createTimelineWithGame().tracks
    const withSound = clipsForVideoWithAudio(asset, tracks.find((t) => t.id === 'V2')!, tracks, { at: 0, srcIn: 2, duration: 6 })
    if ('error' in withSound) throw new Error(withSound.error)
    let tl = createTimelineWithGame()
    for (const it of withSound.items) tl = ops.addClip(tl, it.trackId, it.clip)
    const out = join(root, 'sesli.mp4')
    await runExport({ name: 'k', timeline: tl, assets: [asset], options: quick('shorts', { normalizeAudio: false }), range: { start: 0, end: 6 }, outputPath: out }, tools)
    expect(meanVolume(out)).toBeGreaterThan(-40) // sinüs sesi var

    // yalnızca görüntü: ses izi yok → çıktı sessiz
    let silent = createTimelineWithGame()
    silent = ops.addClip(silent, 'V2', mk('V2', 0, 2, 8))
    const out2 = join(root, 'sessiz.mp4')
    await runExport({ name: 'k', timeline: silent, assets: [asset], options: quick('shorts', { normalizeAudio: false }), range: { start: 0, end: 6 }, outputPath: out2 }, tools)
    expect(meanVolume(out2)).toBeLessThan(-70)
  })
})

d('MP4 kalitesi (gerçek ffmpeg): varsayılan en yüksek kalite ayarları', () => {
  const ssim = (a: string, b: string): number => {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-'], { encoding: 'utf8' })
    const m = /All:([\d.]+)/.exec(r.stderr)
    return m ? Number(m[1]) : 0
  }
  const probeAll = (f: string) => JSON.parse(execFileSync(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString())

  it('varsayılan şablon: yüksek profil, 320 kbps ses, bt709, kaynak kare hızı; düşük kaliteli ayardan belirgin biçimde daha yüksek benzerlik (SSIM)', async () => {
    let tl = createTimelineWithGame()
    tl = { ...tl, aspect: '16:9' }
    // tek video katmanı tam kare (kaynağa en yakın karşılaştırma için)
    tl = ops.setPlacement(tl, 'V2', { rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' })
    tl = ops.addClip(tl, 'V2', mk('V2', 0, 3, 8))
    tl = ops.addClip(tl, 'A1', mk('A1', 0, 3, 8, { audioStream: 0 }))
    const dflt = optionsFromPreset('youtube') // GERÇEK varsayılan: crf 14, slow, fps kaynak
    expect(dflt).toMatchObject({ crf: 14, encoderPreset: 'slow', audioBitrateKbps: 320, fps: 0 })
    const hi = join(root, 'kalite-yuksek.mp4')
    const lo = join(root, 'kalite-dusuk.mp4')
    await runExport({ name: 'k', timeline: tl, assets: [asset], options: dflt, range: { start: 0, end: 5 }, outputPath: hi }, tools)
    await runExport({ name: 'k', timeline: tl, assets: [asset], options: { ...dflt, crf: 38, encoderPreset: 'veryfast' }, range: { start: 0, end: 5 }, outputPath: lo }, tools)

    const j = probeAll(hi)
    const v = j.streams.find((x: { codec_type: string }) => x.codec_type === 'video')
    const a = j.streams.find((x: { codec_type: string }) => x.codec_type === 'audio')
    expect(v).toMatchObject({ codec_name: 'h264', profile: 'High', width: 1920, height: 1080, pix_fmt: 'yuv420p', color_space: 'bt709' })
    expect(v.avg_frame_rate).toBe('30/1') // kaynak 30 fps → 30 fps (otomatik)
    expect(Number(a.bit_rate)).toBeGreaterThan(150_000) // 320 kbps AAC hedefi (sinüs sinyali bunun altında kalabilir; plan testi bayrağı doğrular)
    // referans: AYNI boru hattının neredeyse kayıpsız (CRF 1) çıktısı — yalnızca kodlama kaybı ölçülür (kare hizası aynı kalır)
    const ref = join(root, 'kalite-referans.mp4')
    await runExport({ name: 'k', timeline: tl, assets: [asset], options: { ...dflt, crf: 1, encoderPreset: 'ultrafast' }, range: { start: 0, end: 5 }, outputPath: ref }, tools)
    const qHi = ssim(hi, ref)
    const qLo = ssim(lo, ref)
    expect(qHi).toBeGreaterThan(0.99)
    expect(qHi).toBeGreaterThan(qLo + 0.02)
  })
})

describe('proje kaydet / aç', () => {
  const baseProject = (a: MediaAsset): Project => ({
    version: PROJECT_VERSION, id: 'p1', name: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01',
    assets: [a], timeline: createTimelineWithGame(), chatLogs: [], candidates: [], markers: {}, searchHistory: ['Victor Nelson'], transcriptRefs: {}, exportJobs: []
  })
  const fake: MediaAsset = {
    id: 'a1', name: 'k.mkv', path: '', kind: 'video', container: 'mkv', durationSec: 10, width: 1920, height: 1080, fps: 60, sizeBytes: 1,
    audioStreams: [], obs: { isObs: false, encoder: 'unknown', evidence: [] }, chapters: [], transcriptionTrack: 0, audioMap: { mix: 0 }, importedAt: ''
  }

  it('medya yolları göreli saklanır; proje klasörü taşınınca bulunur; yoksa missing', async () => {
    const a = join(root, 'projeA')
    mkdirSync(join(a, 'Kayıtlar'), { recursive: true })
    writeFileSync(join(a, 'Kayıtlar', 'yayın 1.mkv'), 'x')
    const projPath = join(a, 'Benim Projem.clipforge')
    await saveProject(baseProject({ ...fake, path: join(a, 'Kayıtlar', 'yayın 1.mkv') }), projPath, ['a1'])
    const saved = JSON.parse(readFileSync(projPath, 'utf8')) as Project
    expect(saved.assets[0].relativePath).toBe('Kayıtlar/yayın 1.mkv')
    expect(saved.transcriptRefs).toEqual({ a1: 'transcripts/a1.json' })
    expect(dataDirFor(projPath)).toBe(`${projPath}-data`)

    // klasörü taşı: mutlak yol artık geçersiz, göreli yol çalışır
    const b = join(root, 'projeB')
    execFileSync('cp', ['-r', a, b])
    rmSync(a, { recursive: true })
    const reopened = await openProject(join(b, 'Benim Projem.clipforge'))
    expect(reopened.assets[0].path).toBe(join(b, 'Kayıtlar', 'yayın 1.mkv'))
    expect(reopened.assets[0].missing).toBeUndefined()
    expect(reopened.searchHistory).toEqual(['Victor Nelson'])

    rmSync(join(b, 'Kayıtlar'), { recursive: true })
    expect((await openProject(join(b, 'Benim Projem.clipforge'))).assets[0].missing).toBe(true)
  })

  it('v1 proje (katman konumu yok) açılınca varsayılan şablona geçirilir; klipler ve iz kimlikleri korunur', async () => {
    const dir = join(root, 'v1proje')
    mkdirSync(dir, { recursive: true })
    const old = createTimelineWithGame()
    const legacyTl = { ...old, tracks: old.tracks.filter((t) => ['V1', 'V2', 'A1', 'A2'].includes(t.id)).map(({ placement: _p, textDefault: _t, ...t }) => t) }
    legacyTl.tracks[1].clips = [{ id: 'c1', trackId: 'V1', assetId: 'a1', start: 0, srcIn: 5, srcOut: 9, volume: 1, label: 'eski klip' }]
    const projPath = join(dir, 'eski.clipforge')
    writeFileSync(projPath, JSON.stringify({ ...baseProject(fake), version: 1, timeline: legacyTl }))
    const p = await openProject(projPath)
    expect(p.timeline.tracks.every((t) => t.kind === 'audio' || t.placement)).toBe(true)
    expect(p.timeline.tracks.map((t) => t.id)).toEqual(expect.arrayContaining(['I2', 'V2', 'I1', 'V1', 'A1', 'A2']))
    expect(p.timeline.tracks.find((t) => t.id === 'V1')!.clips[0]).toMatchObject({ id: 'c1', srcIn: 5, label: 'eski klip' })
  })

  it('bozuk / yabancı dosyada anlaşılır hata', async () => {
    const bad = join(root, 'bozuk.clipforge')
    writeFileSync(bad, '{bozuk')
    await expect(openProject(bad)).rejects.toThrow(/bozuk/)
    writeFileSync(bad, '{"foo": 1}')
    await expect(openProject(bad)).rejects.toThrow(/ClipForge projesi değil/)
    await expect(openProject(join(root, 'yok.clipforge'))).rejects.toThrow(/okunamadı/)
  })
})
