import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
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
  opts: { signal?: AbortSignal; progress?: (f: number) => void; /** yalnızca bu kaynak aralığı (sn): kopyanın 0. sn'si = kaynağın `start`'ı (`proxyStartSec`) */ range?: { start: number; end: number } } = {}
): Promise<MediaAsset> {
  const dir = join('proxy', asset.id)
  await mkdir(join(dataDir, dir), { recursive: true })
  const rs = opts.range ? Math.max(0, opts.range.start) : 0
  const rd = opts.range ? Math.max(1, Math.min(asset.durationSec || Infinity, opts.range.end) - rs) : 0
  const args: string[] = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', ...(opts.range ? ['-ss', String(rs), '-t', String(rd)] : []), '-i', asset.path]
  const outs: string[] = []

  if (asset.kind === 'video') {
    const h = Math.min(proxyHeight, asset.height || proxyHeight)
    args.push(
      '-map', '0:v:0', '-an',
      // önizleme kopyası: 60 fps kaynak 30 fps'e düşürülür (kodlama yükü yarıya iner), en hızlı hazır ayar
      '-vf', `${asset.fps > 32 ? 'fps=30,' : ''}scale=-2:${h % 2 === 0 ? h : h - 1}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      '-movflags', '+faststart',
      join(dataDir, dir, 'proxy.mp4')
    )
    outs.push('video')
  }
  asset.audioStreams.forEach((a) => {
    args.push('-map', `0:a:${a.index}`, '-vn', '-ac', '1', '-ar', '32000', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', join(dataDir, dir, `audio_${a.index}.m4a`))
  })
  if (args.length === (opts.range ? 12 : 8)) return asset // üretilecek bir şey yok

  await runFfmpeg(tools.ffmpeg, args, { signal: opts.signal, durationSec: opts.range ? rd : asset.durationSec, onProgress: opts.progress })

  const next: MediaAsset = {
    ...asset,
    proxyHeight,
    ...(opts.range ? { proxyStartSec: rs } : { proxyStartSec: undefined }),
    audioStreams: asset.audioStreams.map((a) => ({ ...a, proxyPath: join(dir, `audio_${a.index}.m4a`) }))
  }
  if (asset.kind === 'video') next.proxyPath = join(dir, 'proxy.mp4')
  // yan dosya: proje kaydedilmeden kapanırsa kopya yeniden üretilmeden bulunabilsin (aralık bilgisi dahil)
  await writeFile(join(dataDir, dir, 'info.json'), JSON.stringify({ proxyHeight, proxyStartSec: opts.range ? rs : 0 }), 'utf8').catch(() => undefined)
  return next
}

/** Daha önce üretilmiş (proje dosyasına yazılmamış) önizleme kopyası varsa ona bağlar; yoksa null */
export async function findExistingProxy(asset: MediaAsset, dataDir: string): Promise<MediaAsset | null> {
  const dir = join('proxy', asset.id)
  try {
    await access(join(dataDir, dir, 'proxy.mp4'))
    const info = JSON.parse(await readFile(join(dataDir, dir, 'info.json'), 'utf8')) as { proxyHeight?: number; proxyStartSec?: number }
    const audioStreams = await Promise.all(asset.audioStreams.map(async (a) => {
      const rel = join(dir, `audio_${a.index}.m4a`)
      return (await access(join(dataDir, rel)).then(() => true, () => false)) ? { ...a, proxyPath: rel } : a
    }))
    return { ...asset, proxyPath: join(dir, 'proxy.mp4'), proxyHeight: info.proxyHeight, proxyStartSec: info.proxyStartSec || undefined, audioStreams }
  } catch {
    return null
  }
}
