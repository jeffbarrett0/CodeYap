import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
}

export interface PipelineDeps {
  tools: MediaTools
  provider: TranscriptionProvider
  /** proje veri klasörü */
  dataDir: string
  signal?: AbortSignal
  progress?: (fraction: number, message?: string) => void
  chunkSec?: number
  overlapSec?: number
}

const transcriptPath = (dataDir: string, assetId: string) => join(dataDir, 'transcripts', `${assetId}.json`)

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
  const workDir = join(d.dataDir, 'tmp', key)
  await mkdir(cacheDir, { recursive: true })
  await mkdir(workDir, { recursive: true })

  const results: ChunkResult[] = []
  try {
    for (const c of chunks) {
      if (d.signal?.aborted) throw new CancelledError()
      d.progress?.(c.index / chunks.length, `Parça ${c.index + 1}/${chunks.length} işleniyor`)
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
      results.push({ start: c.start, end: c.end, words })
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }

  // Özel sözlükle bulanık düzeltme (ör. kabukçu → Kavukçu); düzeltilen kelimelerde özgün yazım saklanır
  const words = applyVocabulary(mergeChunkResults(results), p.vocabulary ?? []).words
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
