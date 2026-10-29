import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { THUMB_DIR, VIDEO_DIR } from '../config.js'
import { prisma } from '../db.js'

const run = promisify(execFile)

export interface ProbeResult {
  durationSec: number
  fps: number
  width: number
  height: number
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run('ffprobe', ['-version'])
    await run('ffmpeg', ['-version'])
    return true
  } catch {
    return false
  }
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!n || !d) return Number.isFinite(n) ? n : 0
  return n / d
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ])
  const info = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }>
  }
  const v = info.streams?.find((s) => s.codec_type === 'video')
  if (!v) throw new Error('No video stream found in file')
  const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 25
  const durationSec = Number(info.format?.duration ?? v.duration ?? 0)
  return { durationSec, fps: Math.round(fps * 1000) / 1000, width: v.width ?? 0, height: v.height ?? 0 }
}

export async function makeThumbnail(file: string, out: string, durationSec: number): Promise<void> {
  const at = Math.min(Math.max(durationSec * 0.1, 0), 30)
  await run('ffmpeg', [
    '-y', '-v', 'error', '-ss', at.toFixed(2), '-i', file,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out,
  ])
}

export const FILMSTRIP_FRAMES = 24
export const FILMSTRIP_CELL = { w: 160, h: 90 }

/** One JPEG with FILMSTRIP_FRAMES evenly spaced frames side by side (the timeline's video track). */
export async function makeFilmstrip(file: string, out: string, durationSec: number): Promise<void> {
  const rate = (FILMSTRIP_FRAMES / Math.max(durationSec, 1)).toFixed(6)
  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', file, '-an',
    '-vf', `fps=${rate},scale=${FILMSTRIP_CELL.w}:${FILMSTRIP_CELL.h}:force_original_aspect_ratio=increase,crop=${FILMSTRIP_CELL.w}:${FILMSTRIP_CELL.h},tile=${FILMSTRIP_FRAMES}x1`,
    '-frames:v', '1', '-q:v', '6', out,
  ], { maxBuffer: 1 << 24 })
}

/**
 * Background post-upload step: probe metadata, extract a thumbnail, flip the row
 * to `ready` (or `failed` with the reason). Never throws.
 */
export async function processVideo(videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video) return
  const abs = path.join(VIDEO_DIR, path.basename(video.filePath))
  try {
    if (!(await ffmpegAvailable())) {
      // Degrade gracefully: the client reports duration/fps from the <video> element.
      await prisma.video.update({
        where: { id: videoId },
        data: { status: 'ready', error: 'ffmpeg not installed: no thumbnail or metadata probe' },
      })
      return
    }
    const meta = await probe(abs)
    const thumbRel = `thumbs/${videoId}.jpg`
    let thumbnailPath: string | null = null
    try {
      fs.mkdirSync(THUMB_DIR, { recursive: true })
      await makeThumbnail(abs, path.join(THUMB_DIR, `${videoId}.jpg`), meta.durationSec)
      thumbnailPath = thumbRel
    } catch {
      // thumbnail is best-effort
    }
    await prisma.video.update({
      where: { id: videoId },
      data: { ...meta, thumbnailPath, status: 'ready', error: null },
    })
  } catch (err) {
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : 'Processing failed' },
    })
  }
}
