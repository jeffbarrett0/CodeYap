import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '../../shared/types'
import { runFfmpeg } from '../ffmpeg'
import type { MediaTools } from './import'

/**
 * Önizleme için düşük çözünürlüklü kopya üretir (büyük kayıtlarda bellek/CPU sınırı):
 *  - proxy.mp4: yalnızca görüntü, kısa GOP (hızlı arama), `proxyHeight` yüksekliğinde
 *  - audio_<n>.m4a: her ses track'i ayrı mono AAC → önizlemede track bazında seviye kontrolü
 * Tek ffmpeg geçişinde birden çok çıkış yazılır: kaynak yalnızca bir kez çözülür.
 */
export async function makeProxy(
  asset: MediaAsset,
  tools: MediaTools,
  dataDir: string,
  proxyHeight: number,
  opts: { signal?: AbortSignal; progress?: (f: number) => void } = {}
): Promise<MediaAsset> {
  const dir = join('proxy', asset.id)
  await mkdir(join(dataDir, dir), { recursive: true })
  const args: string[] = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', asset.path]
  const outs: string[] = []

  if (asset.kind === 'video') {
    const h = Math.min(proxyHeight, asset.height || proxyHeight)
    args.push(
      '-map', '0:v:0', '-an',
      '-vf', `scale=-2:${h % 2 === 0 ? h : h - 1}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      '-movflags', '+faststart',
      join(dataDir, dir, 'proxy.mp4')
    )
    outs.push('video')
  }
  asset.audioStreams.forEach((a) => {
    args.push('-map', `0:a:${a.index}`, '-vn', '-ac', '1', '-ar', '32000', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', join(dataDir, dir, `audio_${a.index}.m4a`))
  })
  if (args.length === 8) return asset // üretilecek bir şey yok

  await runFfmpeg(tools.ffmpeg, args, { signal: opts.signal, durationSec: asset.durationSec, onProgress: opts.progress })

  const next: MediaAsset = {
    ...asset,
    proxyHeight,
    audioStreams: asset.audioStreams.map((a) => ({ ...a, proxyPath: join(dir, `audio_${a.index}.m4a`) }))
  }
  if (asset.kind === 'video') next.proxyPath = join(dir, 'proxy.mp4')
  return next
}
