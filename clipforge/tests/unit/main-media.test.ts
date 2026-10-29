import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importMedia, loadMarkers } from '../../src/main/media/import'
import { makeProxy } from '../../src/main/media/proxy'
import { audioLevelSeries, detectScenes } from '../../src/main/media/audio'
import { friendlyFfmpegMessage, ToolError } from '../../src/main/ffmpeg'
import { transcribeAsset, loadTranscript } from '../../src/main/transcribe/pipeline'
import { MockProvider, parseWhisperCppJson } from '../../src/main/transcribe/providers'
import { CancelledError } from '../../src/main/tasks'
import { ffmpegAvailable, makeBurstWav, makeObsLikeMkv, tools } from './ffmpeg-fixtures'
import { indexFromLines, longTranscriptLines, wordsFromLines } from './helpers'
import { searchTranscript } from '@shared/search/engine'
import type { MediaAsset } from '@shared/types'

const ok = ffmpegAvailable()
const d = ok ? describe : describe.skip

let root = ''
let mkv = ''
let asset: MediaAsset
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cf-test-'))
  if (ok) mkv = makeObsLikeMkv(root, 20)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('whisper.cpp çıktısı', () => {
  it('kelimeleri birleştirir, özel belirteçleri atar, noktalamayı yapıştırır, ofset ekler', () => {
    const words = parseWhisperCppJson(
      {
        transcription: [
          { offsets: { from: 0, to: 100 }, text: '[_BEG_]' },
          { offsets: { from: 200, to: 500 }, text: ' Victor' },
          { offsets: { from: 500, to: 800 }, text: " Nelson'dan" },
          { offsets: { from: 800, to: 900 }, text: '.' },
          { offsets: { from: 1000, to: 1300 }, text: ' bahsetmiştim' },
          { offsets: { from: 1300, to: 1400 }, text: '(müzik)' }
        ]
      },
      600
    )
    expect(words.map((w) => w.text)).toEqual(['Victor', "Nelson'dan.", 'bahsetmiştim'])
    expect(words[0].start).toBeCloseTo(600.2)
    expect(words[1].end).toBeCloseTo(600.9)
  })
})

d('medya içe aktarma (gerçek ffmpeg)', () => {
  it('OBS tarzı çok track\'li MKV: süre, çözünürlük, 3 ses track, OBS algısı; Türkçe/boşluklu yol', async () => {
    asset = await importMedia(mkv, tools, join(root, 'data'))
    expect(asset).toMatchObject({ container: 'mkv', width: 1280, height: 720, kind: 'video', videoCodec: 'h264' })
    expect(asset.durationSec).toBeGreaterThan(19.5)
    expect(asset.audioStreams).toHaveLength(3)
    expect(asset.audioMap).toEqual({ mix: 0, game: 1, voice: 2 })
    expect(asset.obs.isObs).toBe(true)
    expect(asset.obs.encoder).toBe('x264') // libx264 SEI imzası dosya başında bulunur
    expect(asset.transcriptionTrack).toBe(0)
    expect(existsSync(join(root, 'data', asset.thumbnailPath as string))).toBe(true)
  })

  it('desteklenmeyen / bozuk / yok dosyalar anlaşılır hata verir', async () => {
    await expect(importMedia(join(root, 'x.avi'), tools, root)).rejects.toThrow(/Desteklenmeyen/)
    await expect(importMedia(join(root, 'yok.mkv'), tools, root)).rejects.toThrow(/bulunamadı/)
    const bad = join(root, 'bozuk.mp4')
    writeFileSync(bad, Buffer.from('bu bir video degil '.repeat(100)))
    const err = await importMedia(bad, tools, root).catch((e) => e)
    expect(err).toBeInstanceOf(ToolError)
    expect(err.userMessage.length).toBeGreaterThan(10)
  })

  it('proxy: düşük çözünürlüklü görüntü + her ses track\'i için ayrı kopya', async () => {
    const withProxy = await makeProxy(asset, tools, join(root, 'data'), 360)
    expect(existsSync(join(root, 'data', withProxy.proxyPath as string))).toBe(true)
    expect(withProxy.audioStreams.every((a) => a.proxyPath && existsSync(join(root, 'data', a.proxyPath)))).toBe(true)
    const j = await import('./ffmpeg-fixtures').then((m) => m.probeVideo(join(root, 'data', withProxy.proxyPath as string)))
    expect(j.height).toBe(360)
    expect(j.audio).toBe(0)
  })

  it('iptal sinyali ffmpeg\'i durdurur', async () => {
    const ctrl = new AbortController()
    const p = makeProxy(asset, tools, join(root, 'data2'), 360, { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(CancelledError)
  })

  it('OBS bölüm işaretçisi / yan dosya yoksa sessizce boş liste', async () => {
    expect(await loadMarkers(asset)).toEqual([])
    writeFileSync(join(root, 'Yayın Kayıtları çğış', '2024-05-12 21-30-45.markers.txt'), '00:00:07 komik an\n00:00:15 kavga\n')
    const m = await loadMarkers(asset)
    expect(m.map((x) => [x.time, x.label])).toEqual([[7, 'komik an'], [15, 'kavga']])
  })

  it('ses seviyesi serisi ani artışı yakalar; sahne tespiti çalışır', async () => {
    const wav = makeBurstWav(root)
    const db = await audioLevelSeries({ path: wav, durationSec: 20 }, 0, tools)
    expect(db.length).toBe(20)
    const loud = db.slice(10, 12)
    const quiet = db.slice(2, 8)
    expect(Math.min(...loud)).toBeGreaterThan(Math.max(...quiet) + 15)
    const cuts = await detectScenes(mkv, 20, tools, { threshold: 0.2 })
    expect(Array.isArray(cuts)).toBe(true)
  })
})

describe('ffmpeg hata mesajları', () => {
  it('teknik çıktıyı anlaşılır Türkçe mesaja çevirir', () => {
    expect(friendlyFfmpegMessage('x.mp4: Invalid data found when processing input')).toMatch(/bozuk/)
    expect(friendlyFfmpegMessage('moov atom not found')).toMatch(/Remux/)
    expect(friendlyFfmpegMessage('No space left on device')).toMatch(/disk/i)
    expect(friendlyFfmpegMessage('Decoder (codec av1) not found for input stream')).toMatch(/çözücü/)
    expect(friendlyFfmpegMessage('Permission denied')).toMatch(/izin/)
    expect(friendlyFfmpegMessage('beklenmedik\nbaşka bir şey')).toMatch(/^FFmpeg hatası/)
  })
})

d('transkripsiyon hattı (sahte sağlayıcı + gerçek ffmpeg parçalama)', () => {
  // 20 sn'lik kayıt, 8 sn parça / 2 sn örtüşme → 3+ parça
  const lines = [
    { at: 1, text: 'Merhaba arkadaşlar yayına hoş geldiniz.' },
    { at: 6.5, text: 'Bugün Victor Nelson hakkında konuşacağım.' }, // 8. sn parça sınırının yakınında
    { at: 12, text: 'Sonra oyuna geçiyoruz çok eğlenceli olacak.' },
    { at: 16, text: 'Hadi başlayalım.' }
  ]
  const truth = wordsFromLines(lines, 0.3)

  it('parça sınırlarında kelime kaybı olmaz; sonuç aranabilir; ikinci çağrı yeniden kullanır', async () => {
    const provider = new MockProvider(truth, 8)
    const dataDir = join(root, 'data-tr')
    const r1 = await transcribeAsset(asset, { track: 0, language: 'tr', model: 'tiny' }, { tools, provider, dataDir, chunkSec: 8, overlapSec: 2 })
    expect(r1.reused).toBe(false)
    expect(provider.calls).toBeGreaterThanOrEqual(3)
    expect(r1.transcript.words.map((w) => w.text)).toEqual(truth.map((w) => w.text))
    expect(r1.transcript.segments.length).toBeGreaterThanOrEqual(3)

    const idx = indexFromLines(lines).index
    expect(searchTranscript(idx, 'Victor Nelson')).toHaveLength(1)

    const before = provider.calls
    const r2 = await transcribeAsset(asset, { track: 0, language: 'tr', model: 'tiny' }, { tools, provider, dataDir, chunkSec: 8, overlapSec: 2 })
    expect(r2.reused).toBe(true)
    expect(provider.calls).toBe(before)
    expect((await loadTranscript(dataDir, asset.id))?.words.length).toBe(truth.length)

    // farklı dil → yeniden hesaplanır
    const r3 = await transcribeAsset(asset, { track: 0, language: 'en', model: 'tiny' }, { tools, provider, dataDir, chunkSec: 8, overlapSec: 2 })
    expect(r3.reused).toBe(false)
  })

  it('geçersiz track ve iptal', async () => {
    const provider = new MockProvider(truth, 8)
    await expect(transcribeAsset(asset, { track: 9, language: 'tr', model: 'tiny' }, { tools, provider, dataDir: join(root, 'd3') })).rejects.toThrow(/Ses track/)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(transcribeAsset(asset, { track: 0, language: 'tr', model: 'tiny' }, { tools, provider, dataDir: join(root, 'd4'), signal: ctrl.signal, chunkSec: 8, overlapSec: 2 })).rejects.toBeInstanceOf(CancelledError)
  })

  it('iptal sonrası devam: tamamlanan parçalar önbellekten gelir', async () => {
    const provider = new MockProvider(truth, 8)
    const dataDir = join(root, 'd5')
    const ctrl = new AbortController()
    let n = 0
    const flaky = {
      kind: 'mock' as const,
      async transcribeChunk(req: Parameters<MockProvider['transcribeChunk']>[0]) {
        if (++n === 2) {
          ctrl.abort()
          throw new CancelledError()
        }
        return provider.transcribeChunk(req)
      }
    }
    await expect(transcribeAsset(asset, { track: 0, language: 'tr', model: 'tiny' }, { tools, provider: flaky, dataDir, signal: ctrl.signal, chunkSec: 8, overlapSec: 2 })).rejects.toBeInstanceOf(CancelledError)
    const resumed = new MockProvider(truth, 8)
    const r = await transcribeAsset(asset, { track: 0, language: 'tr', model: 'tiny' }, { tools, provider: resumed, dataDir, chunkSec: 8, overlapSec: 2 })
    expect(r.transcript.words).toHaveLength(truth.length)
    expect(resumed.calls).toBeLessThan(4) // ilk parça önbellekten
  })
})

void longTranscriptLines
