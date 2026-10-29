import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importMedia } from '../../src/main/media/import'
import { makeProxy } from '../../src/main/media/proxy'
import { audioLevelSeries } from '../../src/main/media/audio'
import { transcribeAsset } from '../../src/main/transcribe/pipeline'
import { MockProvider } from '../../src/main/transcribe/providers'
import { SearchService } from '@shared/search/service'
import { suggestClip } from '@shared/clip/boundaries'
import { tools, FFMPEG } from '../unit/ffmpeg-fixtures'
import { longTranscriptLines, wordsFromLines } from '../unit/helpers'

/**
 * Kabul kriteri: 60 dakikalık, çok ses track'li OBS MKV sorunsuz içe aktarılır; Track 1 transkript için kullanılır;
 * "Victor Nelson" araması birkaç saniye içinde tüm geçişleri listeler; yazım hatalı sorgu da bulur;
 * 30 sn'lik klip cümle sınırında başlar.
 */
const MIN = 60
const DURATION = 60 * MIN
let root = ''
let mkv = ''
const t: Record<string, number> = {}
const lap = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
  const s = performance.now()
  const r = await f()
  t[name] = Math.round(performance.now() - s)
  return r
}

// Üretilen 60 dk'lık kayıt önbelleğe alınır (CF_PERF_CLEAN=1 ile silinir)
const CACHE = join(tmpdir(), 'clipforge-perf')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cf-hour-'))
  mkdirSync(join(CACHE, 'Yayın Kayıtları'), { recursive: true })
  mkv = join(CACHE, 'Yayın Kayıtları', '2024-05-12 21-30-45.mkv')
  if (existsSync(mkv) && statSync(mkv).size > 1e6) return
  const s = performance.now()
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=30:duration=${DURATION}`, '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${DURATION}`, '-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=48000:duration=${DURATION}`, '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${DURATION}`, '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '120', '-c:a', 'aac', '-b:a', '64k', mkv], { maxBuffer: 1 << 28 })
  t['fixture-üretimi'] = Math.round(performance.now() - s)
})
afterAll(() => {
  const report = { ...t, 'kayıt boyutu (MB)': Math.round(statSync(mkv).size / 1e6) }
  writeFileSync(join(CACHE, 'sonuc.json'), JSON.stringify(report, null, 2))
  process.stderr.write(`\n[perf] ${JSON.stringify(report)}\n`)
  rmSync(root, { recursive: true, force: true })
  if (process.env.CF_PERF_CLEAN) rmSync(CACHE, { recursive: true, force: true })
})

describe('60 dakikalık kayıt', () => {
  it('içe aktarma → proxy → transkripsiyon (parçalı) → arama → klip', async () => {
    const dataDir = join(root, 'data')
    const asset = await lap('içe aktarma', () => importMedia(mkv, tools, dataDir))
    expect(asset.durationSec).toBeGreaterThan(3590)
    expect(asset.audioStreams).toHaveLength(3)
    expect(asset.transcriptionTrack).toBe(0) // Track 1 varsayılan
    expect(t['içe aktarma']).toBeLessThan(5000)

    const withProxy = await lap('proxy (540p + 3 ses)', () => makeProxy(asset, tools, dataDir, 540))
    expect(statSync(join(dataDir, withProxy.proxyPath as string)).size).toBeGreaterThan(0)

    const lines = longTranscriptLines(DURATION, [
      { at: 23 * 60 + 14, text: "Geçen sene Victor Nelson'dan bahsetmiştim hatırlıyor musunuz." },
      { at: 41 * 60 + 2, text: 'Viktor Nelsen diye bir yayıncı vardı ya.' },
      { at: 55 * 60 + 40, text: 'Victor Nelson yine geldi.' }
    ])
    const truth = wordsFromLines(lines, 0.35)
    const provider = new MockProvider(truth, 600)
    const { transcript } = await lap('transkripsiyon hattı (7 parça, sahte model)', () => transcribeAsset(asset, { track: 0, language: 'tr', model: 'small' }, { tools, provider, dataDir }))
    // Parça sınırlarında kelime kaybı/tekrarı yok. (Kaydın ilk/son saniyesi hariç: sahte model orada kelime kesiyor.)
    const key = (w: { start: number; text: string }) => `${w.start.toFixed(3)}|${w.text}`
    const have = new Set(transcript.words.map(key))
    expect(have.size).toBe(transcript.words.length)
    expect(truth.filter((w) => w.start > 1 && w.end < DURATION - 1).filter((w) => !have.has(key(w)))).toEqual([])

    const svc = new SearchService()
    svc.load(asset.id, transcript)
    const s0 = performance.now()
    const r = await svc.search(asset.id, 'Victor Nelson')
    t['arama (Victor Nelson)'] = Math.round(performance.now() - s0)
    expect(t['arama (Victor Nelson)']).toBeLessThan(2000)
    expect(r.map((x) => Math.round(x.start / 60))).toEqual([23, 41, 56])
    const typo = await svc.search(asset.id, 'Viktor Nelsen')
    expect(typo.map((x) => x.start)).toEqual(r.map((x) => x.start))

    const sug = suggestClip(transcript.segments, r[0], { targetDurationSec: 30, assetDurationSec: asset.durationSec })
    expect(sug.duration).toBeLessThanOrEqual(30)
    const startSeg = transcript.segments.find((s) => Math.abs(s.start - sug.start) < 0.2)
    expect(startSeg).toBeTruthy() // başlangıç bir cümle başında

    const db = await lap('ses analizi (öneri, 60 dk)', () => audioLevelSeries(asset, 0, tools))
    expect(db.length).toBeGreaterThanOrEqual(3598)
  })
})
