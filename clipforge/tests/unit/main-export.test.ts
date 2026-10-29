import { execFileSync } from 'node:child_process'
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
import * as ops from '@shared/timeline/ops'
import { optionsFromPreset } from '@shared/export/presets'
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
  let tl = applyTemplate(createDefaultTimeline(), BUILTIN_TEMPLATES[1])
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
      { name: 'k', timeline: timeline(), assets: [asset], options: optionsFromPreset('shorts', { fps: 30 }), range: { start: 0, end: 8 }, outputPath: out },
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
    await runExport({ name: 'k', timeline: { ...timeline(), captions: [] }, assets: [asset], options: optionsFromPreset('shorts'), range: { start: 0, end: 3 }, outputPath: out }, tools)
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
      await runExport({ name: 'k', timeline: tl, assets: [asset], options: optionsFromPreset(preset), range: { start: 0, end: 2 }, outputPath: out }, tools)
      expect(probeVideo(out)).toMatchObject({ width: w, height: h })
    }
  })

  it('iptal edilince yarım dosya bırakılmaz', async () => {
    const out = join(root, 'iptal.mp4')
    const ctrl = new AbortController()
    const p = runExport({ name: 'k', timeline: timeline(), assets: [asset], options: optionsFromPreset('shorts'), range: { start: 0, end: 8 }, outputPath: out }, tools, { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 150)
    await expect(p).rejects.toBeInstanceOf(CancelledError)
    expect(existsSync(out)).toBe(false)
    expect(existsSync(`${out}.part`)).toBe(false)
  })

  it('kayıp kaynak ve boş zaman çizelgesi anlaşılır hata verir', async () => {
    await expect(runExport({ name: 'k', timeline: timeline(), assets: [{ ...asset, missing: true }], options: optionsFromPreset('shorts'), range: { start: 0, end: 8 }, outputPath: join(root, 'x.mp4') }, tools)).rejects.toThrow(/bulunamadı/)
    await expect(runExport({ name: 'k', timeline: createDefaultTimeline(), assets: [asset], options: optionsFromPreset('shorts'), range: { start: 0, end: 0 }, outputPath: join(root, 'y.mp4') }, tools)).rejects.toThrow(/boş/)
  })
})

d('3 bölgeli varsayılan şablon (yüz / davet metni / görsel) — gerçek ffmpeg', () => {
  it('üstte yüz, ortada beyaz davet metni, altta görsel olarak çıkar; oyun ekranı katmanı kapalıyken görünmez', async () => {
    const png = join(root, 'konu görseli.png')
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=800x600:d=1', '-frames:v', '1', png])
    const imgAsset: MediaAsset = { ...asset, id: 'img1', name: 'konu görseli.png', path: png, kind: 'image', durationSec: 0, width: 800, height: 600, audioStreams: [], container: 'png' }
    let tl = createDefaultTimeline()
    tl = ops.addClip(tl, 'V2', mk('V2', 0, 4, 10))
    tl = ops.addClip(tl, 'V1', mk('V1', 0, 4, 10)) // oyun katmanı kapalı → görünmemeli
    tl = ops.addClip(tl, 'I1', { ...mk('I1', 0, 0, 6), assetId: 'img1' })
    tl = ops.addClip(tl, 'A2', mk('A2', 0, 4, 10, { audioStream: 2 }))
    tl = ops.fillTextTracks(tl)
    const out = join(root, 'uc-bolge.mp4')
    await runExport({ name: 'k', timeline: tl, assets: [asset, imgAsset], options: optionsFromPreset('shorts'), range: { start: 0, end: 6 }, outputPath: out }, tools)
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
    const text = rgb(760, 130, 300)
    expect(text.max).toBeGreaterThan(240) // beyaz davet metni pikselleri
  })
})

describe('proje kaydet / aç', () => {
  const baseProject = (a: MediaAsset): Project => ({
    version: PROJECT_VERSION, id: 'p1', name: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01',
    assets: [a], timeline: createDefaultTimeline(), chatLogs: [], candidates: [], markers: {}, searchHistory: ['Victor Nelson'], transcriptRefs: {}, exportJobs: []
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

  it('bozuk / yabancı dosyada anlaşılır hata', async () => {
    const bad = join(root, 'bozuk.clipforge')
    writeFileSync(bad, '{bozuk')
    await expect(openProject(bad)).rejects.toThrow(/bozuk/)
    writeFileSync(bad, '{"foo": 1}')
    await expect(openProject(bad)).rejects.toThrow(/ClipForge projesi değil/)
    await expect(openProject(join(root, 'yok.clipforge'))).rejects.toThrow(/okunamadı/)
  })
})
