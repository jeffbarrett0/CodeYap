import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planChunks, mergeChunkResults, type ChunkResult } from '../../shared/transcript/chunking'
import { buildSegments } from '../../shared/transcript/sentences'
import { applyVocabulary } from '../../shared/transcript/vocabulary'
import type { MediaAsset, Transcript, TranscriptWord, WhisperModelSize } from '../../shared/types'
import { ToolError } from '../ffmpeg'
import type { MediaTools } from '../media/import'
import { extractWavChunk } from '../media/audio'
import { CancelledError } from '../tasks'
import type { TranscriptionProvider } from './providers'

export const CHUNK_SEC = 600
export const OVERLAP_SEC = 15

export interface TranscribeParams {
  track: number
  language: string
  model: WhisperModelSize
  force?: boolean
  /** Whisper başlangıç ipucu (özel sözlük + dolgu) */
  prompt?: string
  /** Üretim sonrası bulanık düzeltme için özel sözlük terimleri */
  vocabulary?: string[]
  /** Yerleşik (futbol) sözlüğü: temkinli düzeltme */
  softVocabulary?: string[]
}

export interface PipelineDeps {
  tools: MediaTools
  provider: TranscriptionProvider
  /** proje veri klasörü */
  dataDir: string
  signal?: AbortSignal
  progress?: (fraction: number, message?: string) => void
  /** aynı anda işlenen parça sayısı (varsayılan 1) */
  concurrency?: number
  chunkSec?: number
  overlapSec?: number
}

const transcriptPath = (dataDir: string, assetId: string) => join(dataDir, 'transcripts', `${assetId}.json`)

/**
 * Geçici çalışma klasörü (ses parçaları + whisper çıktısı). Windows bir programı 260 karakterden uzun çalışma klasöründe BAŞLATAMAZ
 * (ENOENT → "whisper.cpp bulunamadı" gibi yanıltıcı hata): uzun video adları + uzun anahtar yolu aşabilir. Yol uzunsa kısa, ASCII
 * bir geçici klasör kullanılır (sonuçlar yine `transcripts/chunks` önbelleğine yazılır).
 */
export function shortWorkDir(dataDir: string, key: string, tmp: string = tmpdir()): string {
  const normal = join(dataDir, 'tmp', key)
  // eslint-disable-next-line no-control-regex
  if (normal.length <= 120 && /^[\x00-\x7f]*$/.test(normal)) return normal
  return join(tmp, 'clipforge-tr', `${key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16)}_${hash(key)}`)
}

export async function loadTranscript(dataDir: string, assetId: string): Promise<Transcript | null> {
  try {
    return JSON.parse(await readFile(transcriptPath(dataDir, assetId), 'utf8')) as Transcript
  } catch {
    return null
  }
}

export async function saveTranscript(dataDir: string, t: Transcript): Promise<void> {
  await writeJsonAtomic(transcriptPath(dataDir, t.assetId), t)
}

async function writeJsonAtomic(path: string, data: unknown) {
  await mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data))
  await rename(tmp, path)
}

/**
 * Bir kaydın seçili ses track'ini transkribe eder.
 *  - Aynı (track, dil, model, sağlayıcı) için kayıtlı transkript varsa yeniden kullanılır.
 *  - Kayıt örtüşen parçalara bölünür (varsayılan 10 dk + 15 sn); her parça ayrı WAV'a çıkarılıp işlenir ve
 *    sonucu önbelleğe yazılır: iptal/çökme sonrası kaldığı yerden devam eder.
 *  - Parçalar kelime kaybı/tekrarı olmadan birleştirilir.
 */
export async function transcribeAsset(asset: MediaAsset, p: TranscribeParams, d: PipelineDeps): Promise<{ transcript: Transcript; reused: boolean }> {
  if (asset.audioStreams.length === 0) throw new ToolError('Bu kayıtta ses akışı yok; transkripsiyon yapılamaz.')
  if (p.track < 0 || p.track >= asset.audioStreams.length) {
    throw new ToolError(`Ses track'i ${p.track + 1} bu kayıtta yok (toplam ${asset.audioStreams.length} track).`)
  }

  if (!p.force) {
    const existing = await loadTranscript(d.dataDir, asset.id)
    if (existing && existing.audioTrack === p.track && existing.language === p.language && existing.model === p.model && existing.provider === d.provider.kind && (existing.prompt ?? '') === (p.prompt ?? '')) {
      d.progress?.(1, 'Kayıtlı transkript kullanıldı')
      return { transcript: existing, reused: true }
    }
  }

  const chunkSec = d.chunkSec ?? CHUNK_SEC
  const overlap = d.overlapSec ?? OVERLAP_SEC
  const chunks = planChunks(asset.durationSec, chunkSec, overlap)
  const key = `${asset.id}_t${p.track}_${p.language}_${p.model}_${d.provider.kind}_${chunkSec}_${overlap}_${hash(p.prompt ?? '')}`
  const cacheDir = join(d.dataDir, 'transcripts', 'chunks', key)
  const workDir = shortWorkDir(d.dataDir, key)
  await mkdir(cacheDir, { recursive: true })
  await mkdir(workDir, { recursive: true })

  // parçalar en fazla `concurrency` işle birlikte (sıra korunur): çok çekirdekli bilgisayarda tek whisper süreci tüm işlemciyi kullanamaz
  const conc = Math.max(1, Math.min(d.concurrency ?? 1, chunks.length))
  const results: ChunkResult[] = new Array(chunks.length)
  let next = 0
  let done = 0
  let stop = false
  const worker = async () => {
    for (;;) {
      if (stop || d.signal?.aborted) throw new CancelledError()
      const i = next++
      if (i >= chunks.length) return
      const c = chunks[i]
      d.progress?.(done / chunks.length, `Parça ${Math.min(done + 1, chunks.length)}/${chunks.length} işleniyor`)
      const cachePath = join(cacheDir, `${c.index}.json`)
      let words: TranscriptWord[] | null = null
      if (!p.force) {
        try {
          words = JSON.parse(await readFile(cachePath, 'utf8')) as TranscriptWord[]
        } catch {
          words = null
        }
      }
      if (!words) {
        const wav = join(workDir, `chunk_${c.index}.wav`)
        await extractWavChunk(asset, p.track, c.start, c.end - c.start, wav, d.tools, d.signal)
        try {
          words = await d.provider.transcribeChunk({ wavPath: wav, offsetSec: c.start, language: p.language, model: p.model, signal: d.signal, workDir, prompt: p.prompt })
        } finally {
          await rm(wav, { force: true })
        }
        await writeJsonAtomic(cachePath, words)
      }
      results[i] = { start: c.start, end: c.end, words }
      done++
    }
  }
  try {
    await Promise.all(Array.from({ length: conc }, () => worker().catch((e) => { stop = true; throw e })))
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }

  // Özel sözlükle bulanık düzeltme (ör. kabukçu → Kavukçu); düzeltilen kelimelerde özgün yazım saklanır
  const words = applyVocabulary(mergeChunkResults(results), p.vocabulary ?? [], p.softVocabulary ?? []).words
  const transcript: Transcript = {
    id: `tr_${asset.id}_${Date.now().toString(36)}`,
    assetId: asset.id,
    language: p.language,
    model: p.model,
    provider: d.provider.kind,
    audioTrack: p.track,
    prompt: p.prompt || undefined,
    createdAt: new Date().toISOString(),
    durationSec: asset.durationSec,
    words,
    segments: buildSegments(words)
  }
  await writeJsonAtomic(transcriptPath(d.dataDir, asset.id), transcript)
  await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined)
  d.progress?.(1, 'Tamamlandı')
  return { transcript, reused: false }
}

/** Kısa, kararlı karma (önbellek anahtarı için) */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
