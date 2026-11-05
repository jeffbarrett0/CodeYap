import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildMap } from '../../shared/graphics/scenes'
import { findPlace, type World } from '../../shared/graphics/geo'
import { buildBackdropAss, buildStoryAss } from '../../shared/story/scenes'
import type { StoryContent, StoryTheme } from '../../shared/story/types'
import { runTool } from '../ffmpeg'

export interface StoryRenderSize {
  width: number
  height: number
  fps: number
}

/** Sahnenin ASS metni (harita için world gerekir) */
export function storyAss(content: StoryContent, theme: StoryTheme, size: StoryRenderSize, dur: number, world?: World): string {
  if (content.type !== 'place') return buildStoryAss(content, theme, size.width, size.height, dur)
  if (!world) throw new Error('Harita sahnesi için dünya verisi yüklenemedi.')
  const to = findPlace(world, content.to)
  if (!to) throw new Error(`Yer bulunamadı: "${content.to}". Ülke/ana şehir adı ya da "boylam,enlem" kullanın.`)
  const from = content.from ? (findPlace(world, content.from) ?? undefined) : undefined
  return buildMap({ type: 'map', ...size, durationSec: dur, bg: theme.bg, accent: theme.accent, fontFamily: theme.fontHead, to, from, label: content.label ?? content.to, sub: content.sub }, world)
}

/** Ortak zemin görüntüsü (PNG): bir kez üretilir, sahneler arka plan olarak kullanır */
export async function renderBackdrop(theme: StoryTheme, size: StoryRenderSize, ffmpeg: string, outPng: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cf-story-bg-'))
  try {
    await writeFile(join(dir, 'bg.ass'), buildBackdropAss(theme, size.width, size.height), 'utf8')
    await mkdir(dirname(outPng), { recursive: true })
    await runTool(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${theme.bg.replace('#', '0x')}:s=${size.width}x${size.height}:r=1:d=4`, '-vf', 'ass=bg.ass', '-ss', '2.5', '-frames:v', '1', '-update', '1', outPng], { cwd: dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Sahneyi tam kare, sesiz H.264 MP4 olarak üretir (`backdrop`: renderBackdrop çıktısı; yoksa düz renk) */
export async function renderStoryScene(content: StoryContent, theme: StoryTheme, size: StoryRenderSize, dur: number, ffmpeg: string, outPath: string, opts: { world?: World; backdrop?: string; signal?: AbortSignal } = {}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cf-story-'))
  try {
    await writeFile(join(dir, 'scene.ass'), storyAss(content, theme, size, dur, opts.world), 'utf8')
    await mkdir(dirname(outPath), { recursive: true })
    const src = opts.backdrop && content.type !== 'place' ? ['-loop', '1', '-framerate', String(size.fps), '-t', dur.toFixed(2), '-i', opts.backdrop] : ['-f', 'lavfi', '-i', `color=c=${theme.bg.replace('#', '0x')}:s=${size.width}x${size.height}:r=${size.fps}:d=${dur.toFixed(2)}`]
    await runTool(
      ffmpeg,
      ['-y', '-v', 'error', ...src, '-vf', 'ass=scene.ass,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(size.fps), '-an', '-movflags', '+faststart', outPath],
      { cwd: dir, signal: opts.signal }
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
