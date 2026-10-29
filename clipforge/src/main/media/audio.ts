import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '../../shared/types'
import { runFfmpeg } from '../ffmpeg'
import type { MediaTools } from './import'

/** Transkripsiyon için bir aralığı 16 kHz mono PCM WAV olarak çıkarır (parça başına ≈ 19 MB / 10 dk). */
export async function extractWavChunk(
  asset: Pick<MediaAsset, 'path'>,
  track: number,
  start: number,
  duration: number,
  out: string,
  tools: MediaTools,
  signal?: AbortSignal
): Promise<void> {
  await mkdir(join(out, '..'), { recursive: true })
  await runFfmpeg(
    tools.ffmpeg,
    ['-y', '-v', 'error', '-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', asset.path, '-map', `0:a:${track}`, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out],
    { signal }
  )
}

/**
 * Ses track'ini akış olarak çözüp `binPerSec` çözünürlükte RMS zarfı (dBFS) üretir.
 * Bellekte yalnızca bir kutu tutulur; 3 saatlik kayıt bile birkaç MB'lık dizi üretir.
 */
export async function audioLevelSeries(
  asset: Pick<MediaAsset, 'path' | 'durationSec'>,
  track: number,
  tools: MediaTools,
  opts: { binPerSec?: number; signal?: AbortSignal; progress?: (f: number) => void; startSec?: number; durationSec?: number } = {}
): Promise<number[]> {
  const rate = 8000
  const bin = opts.binPerSec ?? 1
  const samplesPerBin = Math.floor(rate / bin)
  const out: number[] = []
  let sumSq = 0
  let count = 0
  let carry: Buffer = Buffer.alloc(0)

  const flushSample = (s: number) => {
    sumSq += s * s
    count++
    if (count >= samplesPerBin) {
      const rms = Math.sqrt(sumSq / count) / 32768
      out.push(rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90)
      sumSq = 0
      count = 0
    }
  }

  const args = ['-v', 'error', '-nostats', '-progress', 'pipe:2']
  if (opts.startSec) args.push('-ss', String(opts.startSec))
  if (opts.durationSec) args.push('-t', String(opts.durationSec))
  args.push('-i', asset.path, '-map', `0:a:${track}`, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-')
  const total = opts.durationSec ?? asset.durationSec
  await runFfmpeg(tools.ffmpeg, args, {
    signal: opts.signal,
    onStdout: (chunk) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const n = buf.length - (buf.length % 2)
      for (let i = 0; i < n; i += 2) flushSample(buf.readInt16LE(i))
      carry = buf.subarray(n)
    },
    onStderrLine: (line) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
      if (m && opts.progress && total > 0) opts.progress(Math.min(1, Number(m[1]) / 1e6 / total))
    }
  })
  if (count > 0) {
    const rms = Math.sqrt(sumSq / count) / 32768
    out.push(rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90)
  }
  return out
}

/** Sahne değişimi zaman damgaları (ffmpeg scene skoru). Hız için düşük fps ve (varsa) proxy kullanılır. */
export async function detectScenes(
  file: string,
  durationSec: number,
  tools: MediaTools,
  opts: { threshold?: number; signal?: AbortSignal; progress?: (f: number) => void } = {}
): Promise<number[]> {
  const cuts: number[] = []
  const thr = opts.threshold ?? 0.35
  await runFfmpeg(
    tools.ffmpeg,
    ['-v', 'info', '-nostats', '-i', file, '-an', '-vf', `fps=4,scale=320:-2,select='gt(scene,${thr})',showinfo`, '-f', 'null', '-'],
    {
      signal: opts.signal,
      onStderrLine: (line) => {
        const m = /pts_time:([\d.]+)/.exec(line)
        if (m && line.includes('Parsed_showinfo')) {
          const t = Number(m[1])
          cuts.push(t)
          opts.progress?.(Math.min(1, t / durationSec))
        }
      }
    }
  )
  return cuts
}
