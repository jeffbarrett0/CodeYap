import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseQaLine, qaReport, type QaMeasure } from '../shared/qa'
import { ffprobeJson, runFfmpeg } from './ffmpeg'
import type { MediaTools } from './media/import'

/** Çıkış kontrolü: bitmiş videoyu ölçer (ilk kare, siyah ekran, uzun sessizlik, ses şiddeti/tepe). Yalnızca okur; videoyu değiştirmez. */
export async function measureVideo(file: string, tools: MediaTools, opts: { signal?: AbortSignal } = {}): Promise<QaMeasure> {
  const probe = (await ffprobeJson(tools.ffprobe, file, opts.signal)) as { streams?: { codec_type: string }[]; format?: { duration?: string } }
  const durationSec = Number(probe.format?.duration) || 0
  const hasAudio = (probe.streams ?? []).some((s) => s.codec_type === 'audio')
  const acc: Pick<QaMeasure, 'black' | 'silence'> & { lufs?: number; peak?: number; silStart?: number } = { black: [], silence: [] }
  const on = (line: string) => parseQaLine(line, acc)

  // ilk kare: 64×36 gri; ortalama ve standart sapma
  let firstFrame: QaMeasure['firstFrame']
  const dir = await mkdtemp(join(tmpdir(), 'cf-qa-'))
  try {
    const raw = join(dir, 'f.raw')
    await runFfmpeg(tools.ffmpeg, ['-y', '-v', 'error', '-i', file, '-an', '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', raw], { signal: opts.signal })
    const b = await readFile(raw)
    if (b.length > 0) {
      let sum = 0
      for (const v of b) sum += v
      const mean = sum / b.length
      let sq = 0
      for (const v of b) sq += (v - mean) ** 2
      firstFrame = { mean, std: Math.sqrt(sq / b.length) }
    }
  } catch {
    /* ilk kare ölçülemedi: diğer kontroller sürer */
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // siyah ekran: saniyede 2 kare, küçük boyut (uzun videolarda hızlı)
  await runFfmpeg(tools.ffmpeg, ['-v', 'info', '-nostats', '-i', file, '-an', '-vf', 'fps=2,scale=160:90,blackdetect=d=0.5:pix_th=0.12', '-f', 'null', '-'], { signal: opts.signal, onStderrLine: on })
  if (hasAudio) {
    await runFfmpeg(tools.ffmpeg, ['-v', 'info', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=n=-45dB:d=2,ebur128=peak=true', '-f', 'null', '-'], { signal: opts.signal, onStderrLine: on })
  }
  return { durationSec, firstFrame, black: acc.black, silence: acc.silence, loudnessLufs: acc.lufs, peakDb: acc.peak, hasAudio }
}

export async function qaVideo(file: string, tools: MediaTools, opts: { signal?: AbortSignal } = {}) {
  const measure = await measureVideo(file, tools, opts)
  return { measure, ...qaReport(measure) }
}
