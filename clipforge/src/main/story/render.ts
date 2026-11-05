import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
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

const VIDEO_RE = /\.(mp4|mov|mkv|webm|m4v)$/i

/** Medya sahnesi için ffmpeg bağımsız değişkenleri: tam kare (cover, isteğe bağlı yavaş yakınlaşma) ya da zeminin üstünde şeffaf karakter (contain) */
export function mediaArgs(c: Extract<StoryContent, { type: 'media' }>, file: string, size: StoryRenderSize, dur: number, theme: StoryTheme, backdrop?: string): { input: string[]; vf: string; complex?: string } {
  const { width: W, height: H, fps } = size
  const video = VIDEO_RE.test(file)
  const frames = Math.max(1, Math.round(dur * fps))
  if (c.fit === 'contain') {
    const x = c.align === 'left' ? '(W*0.04)' : c.align === 'right' ? '(W-w-W*0.04)' : '((W-w)/2)'
    const base = backdrop ? ['-loop', '1', '-framerate', String(fps), '-t', dur.toFixed(2), '-i', backdrop] : ['-f', 'lavfi', '-i', `color=c=${theme.bg.replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${dur.toFixed(2)}`]
    const fg = video ? ['-stream_loop', '-1', '-t', dur.toFixed(2), '-i', file] : ['-loop', '1', '-framerate', String(fps), '-t', dur.toFixed(2), '-i', file]
    return { input: [...base, ...fg], vf: '', complex: `[1:v]scale=-2:${Math.round(H * 0.92)}:force_original_aspect_ratio=decrease,format=rgba[fg];[0:v][fg]overlay=x=${x}:y=(H-h)/2:shortest=1,ass=scene.ass,format=yuv420p` }
  }
  const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
  if (video) return { input: ['-stream_loop', '-1', '-t', dur.toFixed(2), '-i', file], vf: `${fill},fps=${fps},ass=scene.ass,format=yuv420p` }
  const z = c.zoom ?? 'in'
  const zexpr = z === 'none' ? '1' : z === 'in' ? `min(1+0.12*on/${frames},1.12)` : `max(1.12-0.12*on/${frames},1)`
  return { input: ['-i', file], vf: `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${zexpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},ass=scene.ass,format=yuv420p` }
}

/** Sahneyi tam kare, sesiz H.264 MP4 olarak üretir (`backdrop`: renderBackdrop çıktısı; yoksa düz renk) */
export async function renderStoryScene(content: StoryContent, theme: StoryTheme, size: StoryRenderSize, dur: number, ffmpeg: string, outPath: string, opts: { world?: World; backdrop?: string; baseDir?: string; signal?: AbortSignal } = {}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cf-story-'))
  try {
    await writeFile(join(dir, 'scene.ass'), storyAss(content, theme, size, dur, opts.world), 'utf8')
    await mkdir(dirname(outPath), { recursive: true })
    const tail = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(size.fps), '-an', '-t', dur.toFixed(2), '-movflags', '+faststart', outPath]
    if (content.type === 'media') {
      // göreli yol: önce çalışma klasörüne, sonra planın klasörüne göre aranır
      const cands = [resolvePath(content.file), ...(opts.baseDir ? [resolvePath(opts.baseDir, content.file)] : [])]
      let file = ''
      for (const f of cands) {
        try {
          await access(f)
          file = f
          break
        } catch {
          /* sıradaki */
        }
      }
      if (!file) throw new Error(`Medya dosyası bulunamadı: ${cands[0]}`)
      const m = mediaArgs(content, file, size, dur, theme, opts.backdrop)
      await runTool(ffmpeg, ['-y', '-v', 'error', ...m.input, ...(m.complex ? ['-filter_complex', m.complex] : ['-vf', m.vf]), ...tail], { cwd: dir, signal: opts.signal })
      return
    }
    const src = opts.backdrop && content.type !== 'place' ? ['-loop', '1', '-framerate', String(size.fps), '-t', dur.toFixed(2), '-i', opts.backdrop] : ['-f', 'lavfi', '-i', `color=c=${theme.bg.replace('#', '0x')}:s=${size.width}x${size.height}:r=${size.fps}:d=${dur.toFixed(2)}`]
    await runTool(ffmpeg, ['-y', '-v', 'error', ...src, '-vf', 'ass=scene.ass,format=yuv420p', ...tail], { cwd: dir, signal: opts.signal })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
