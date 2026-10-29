import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { WhisperModelSize } from '../../shared/types'
import { ToolError } from '../ffmpeg'
import { CancelledError } from '../tasks'
import { whisperModelFile } from './providers'

export const MODEL_URL = (size: WhisperModelSize) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${size}.bin`

export async function modelInstalled(dir: string, size: WhisperModelSize): Promise<boolean> {
  try {
    return (await stat(whisperModelFile(dir, size))).size > 10_000_000
  } catch {
    return false
  }
}

/** Whisper (ggml) modelini indirir. Yarım dosya `.part` olarak yazılır, bitince yeniden adlandırılır. */
export async function downloadModel(
  dir: string,
  size: WhisperModelSize,
  opts: { signal?: AbortSignal; progress?: (f: number, msg?: string) => void } = {}
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = whisperModelFile(dir, size)
  const part = `${target}.part`
  const res = await fetch(MODEL_URL(size), { signal: opts.signal, redirect: 'follow' }).catch((e: Error) => {
    if (opts.signal?.aborted) throw new CancelledError()
    throw new ToolError(`Model indirilemedi (ağ hatası): ${e.message}`)
  })
  if (!res.ok || !res.body) throw new ToolError(`Model indirilemedi (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const src = Readable.fromWeb(res.body as never)
  src.on('data', (c: Buffer) => {
    got += c.length
    if (total) opts.progress?.(got / total, `${(got / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`)
  })
  try {
    await pipeline(src, createWriteStream(part), { signal: opts.signal })
    await rename(part, target)
  } catch (e) {
    await rm(part, { force: true }).catch(() => undefined)
    if (opts.signal?.aborted) throw new CancelledError()
    throw new ToolError(`Model indirilemedi: ${(e as Error).message}`)
  }
}

export const modelPath = (dir: string, size: WhisperModelSize) => join(dir, `ggml-${size}.bin`)
