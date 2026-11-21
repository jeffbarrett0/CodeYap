import { mkdir, access } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { adjustFilter } from '../shared/adjust'
import { parseChapterList } from '../shared/chapters'
import { safeFileTitle, ytCutFileName, ytCutRanges, type YtCutRequest, type YtCutResult } from '../shared/ytcut'
import { ffprobeJson, limitThreads, runTool } from './ffmpeg'
import type { MediaTools } from './media/import'

const MEDIA_RE = /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i

/** Çıkış klasörü: kaydın yanında `YouTube Yatay/<kayıt adı>/` */
export const ytCutDir = (req: Pick<YtCutRequest, 'videoPath' | 'outDir'>) => req.outDir?.trim() || join(dirname(req.videoPath), 'YouTube Yatay', safeFileTitle(basename(req.videoPath, extname(req.videoPath))))

/**
 * Her zaman damgası aralığını orijinal kayıttan ayrı bir MP4 olarak keser (yatay: kare olduğu gibi, yeniden boyutlandırma yok).
 * Tek bir bölümde hata olursa diğerleri sürer. Orijinal dosyaya dokunulmaz.
 */
export async function runYtCut(req: YtCutRequest, tools: MediaTools, hooks: { signal?: AbortSignal; progress?: (f: number, msg?: string) => void } = {}): Promise<YtCutResult> {
  if (!MEDIA_RE.test(req.videoPath)) throw new Error('Desteklenen bir video seçin (MKV, MP4, MOV, FLV, M4V, WEBM).')
  try {
    await access(req.videoPath)
  } catch {
    throw new Error(`Dosya bulunamadı: ${req.videoPath}`)
  }
  const list = parseChapterList(req.list)
  if (list.length === 0) throw new Error('Zaman damgası listesi boş ya da okunamadı. Örnek: "00:34:00 - Leo" ya da "00:03:00 - 00:09:00 Noah Lang".')
  const probe = (await ffprobeJson(tools.ffprobe, req.videoPath, hooks.signal)) as { streams?: { codec_type: string }[]; format?: { duration?: string } }
  const videoSec = Number(probe.format?.duration) || 0
  if (videoSec <= 0) throw new Error('Video süresi okunamadı.')
  const hasAudio = (probe.streams ?? []).some((s) => s.codec_type === 'audio')
  const { items, warnings } = ytCutRanges(list, videoSec)
  if (items.length === 0) throw new Error('Kesilecek bölüm yok: listedeki zamanlar video süresinin dışında.')
  const dir = ytCutDir(req)
  await mkdir(dir, { recursive: true })
  const totalSec = items.reduce((n, i) => n + i.durationSec, 0)
  let doneSec = 0
  const vf = adjustFilter(req.adjust).replace(/^,/, '')
  const crf = req.quality === 'high' ? '17' : '19'
  const preset = req.quality === 'high' ? 'slow' : 'veryfast'
  for (const it of items) {
    if (hooks.signal?.aborted) throw new Error('İptal edildi.')
    const out = join(dir, ytCutFileName(it.index, it.title, items.length))
    const args = ['-y', '-v', 'error', '-nostdin', '-ss', it.start.toFixed(3), '-t', it.durationSec.toFixed(3), '-i', req.videoPath, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []), ...(vf ? ['-vf', vf] : []), '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', '-progress', 'pipe:1', out]
    try {
      await runTool(tools.ffmpeg, limitThreads(args), {
        signal: hooks.signal,
        durationSec: it.durationSec,
        onProgress: (f) => hooks.progress?.(Math.min(1, (doneSec + f * it.durationSec) / totalSec), `${it.index}/${items.length}: ${it.title}`)
      })
      it.path = out
    } catch (e) {
      if (hooks.signal?.aborted) throw e
      it.error = e instanceof Error ? e.message : String(e)
    }
    doneSec += it.durationSec
    hooks.progress?.(Math.min(1, doneSec / totalSec), `${it.index}/${items.length}: ${it.title}`)
  }
  return { dir, items, warnings }
}
