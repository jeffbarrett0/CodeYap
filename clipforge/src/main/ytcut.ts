import { mkdir, access, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { adjustFilter } from '../shared/adjust'
import { parseChapterList } from '../shared/chapters'
import { ctaRect, ctaTimesEvery, parseCtaManifest, youtubeCtaSize, type CtaEntry } from '../shared/cta'
import { chromaFilter } from '../shared/export/plan'
import { clipTranscriptText, safeFileTitle, ytCutFileName, ytCutRanges, type YtCutRequest, type YtCutResult } from '../shared/ytcut'
import { ffprobeJson, limitThreads, runTool } from './ffmpeg'
import type { MediaTools } from './media/import'

const MEDIA_RE = /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i


interface CtaAsset { entry: CtaEntry; file: string; chroma: string; width: number; height: number; hasAudio: boolean }

/** Abone butonu (resources/cta, YouTube) bilgisi: yoksa ya da okunamazsa null (kesit düğmesiz kesilir) */
async function loadYoutubeCta(resourcesDir: string | undefined, tools: MediaTools): Promise<CtaAsset | null> {
  if (!resourcesDir) return null
  try {
    const dir = join(resourcesDir, 'cta')
    const m = parseCtaManifest(JSON.parse(await readFile(join(dir, 'cta.json'), 'utf8')))
    const entry = m?.buttons.find((b) => b.id === 'youtube')
    if (!m || !entry) return null
    const file = join(dir, entry.file)
    const p = (await ffprobeJson(tools.ffprobe, file)) as { streams?: { codec_type: string; width?: number; height?: number }[] }
    const v = (p.streams ?? []).find((x) => x.codec_type === 'video')
    if (!v?.width || !v.height) return null
    return { entry, file, chroma: m.chroma, width: v.width, height: v.height, hasAudio: (p.streams ?? []).some((x) => x.codec_type === 'audio') }
  } catch {
    return null
  }
}

/** Kesite abone butonları: yeşil perde şeffaflaşır, buton sol altta; butonun sesi kesit sesine karışır. Dönen: ek girişler + filter_complex + haritalar. */
export function ctaGraph(o: { cta: CtaAsset; times: number[]; srcW: number; srcH: number; hasAudio: boolean; videoPre: string }): { inputs: string[]; filter: string; maps: string[] } {
  const rect = ctaRect(o.cta.entry, o.cta.width, o.cta.height, '16:9', { pos: 'bottom-center', size: youtubeCtaSize('16:9') })
  const pw = Math.max(2, Math.round((rect.w * o.srcW) / 2) * 2)
  const ph = Math.max(2, Math.round((rect.h * o.srcH) / 2) * 2)
  const px = Math.round(rect.x * o.srcW)
  const py = Math.round(o.cta.entry.flushBottom ? o.srcH - ph : rect.y * o.srcH)
  const c = o.cta.entry.crop
  const crop = c ? `crop=iw*${c.w.toFixed(5)}:ih*${c.h.toFixed(5)}:iw*${c.x.toFixed(5)}:ih*${c.y.toFixed(5)},` : ''
  const lines: string[] = [`[0:v:0]${o.videoPre || 'null'}[b0]`]
  const inputs: string[] = []
  const audios: string[] = []
  o.times.forEach((t, i) => {
    const k = i + 1
    inputs.push('-i', o.cta.file)
    // önce kırp+küçült, sonra yeşili anahtarla (buton videosu 4K: tam çözünürlükte anahtarlamak çok yavaş)
    lines.push(`[${k}:v]${crop}scale=${pw}:${ph}:flags=lanczos,${chromaFilter({ color: o.cta.chroma })}setpts=PTS-STARTPTS+${t.toFixed(3)}/TB[c${k}]`)
    lines.push(`[b${i}][c${k}]overlay=${px}:${py}:eof_action=pass:repeatlast=0[b${k}]`)
    if (o.hasAudio && o.cta.hasAudio) {
      const ms = Math.round(t * 1000)
      lines.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=0.8[ca${k}]`)
      audios.push(`[ca${k}]`)
    }
  })
  const maps = ['-map', `[b${o.times.length}]`]
  if (o.hasAudio) {
    if (audios.length) {
      lines.push(`[0:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a0]`)
      lines.push(`[a0]${audios.join('')}amix=inputs=${audios.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`)
      maps.push('-map', '[aout]')
    } else maps.push('-map', '0:a:0')
  }
  return { inputs, filter: lines.join(';'), maps }
}

/** Çıkış klasörü: kaydın yanında `YouTube Yatay/<kayıt adı>/` */
export const ytCutDir = (req: Pick<YtCutRequest, 'videoPath' | 'outDir'>) => req.outDir?.trim() || join(dirname(req.videoPath), 'YouTube Yatay', safeFileTitle(basename(req.videoPath, extname(req.videoPath))))

/**
 * Her zaman damgası aralığını orijinal kayıttan ayrı bir MP4 olarak keser (yatay: kare olduğu gibi, yeniden boyutlandırma yok).
 * Tek bir bölümde hata olursa diğerleri sürer. Orijinal dosyaya dokunulmaz.
 */
export async function runYtCut(req: YtCutRequest, tools: MediaTools, hooks: { signal?: AbortSignal; progress?: (f: number, msg?: string) => void; resourcesDir?: string } = {}): Promise<YtCutResult> {
  if (!MEDIA_RE.test(req.videoPath)) throw new Error('Desteklenen bir video seçin (MKV, MP4, MOV, FLV, M4V, WEBM).')
  try {
    await access(req.videoPath)
  } catch {
    throw new Error(`Dosya bulunamadı: ${req.videoPath}`)
  }
  const list = req.ranges?.length ? req.ranges.map((r) => ({ start: r.start, end: r.end, title: r.title })) : parseChapterList(req.list)
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
  const vstream = (probe.streams ?? []).find((x) => x.codec_type === 'video') as { width?: number; height?: number } | undefined
  const srcW = vstream?.width ?? 1920
  const srcH = vstream?.height ?? 1080
  const cta = req.cta === false ? null : await loadYoutubeCta(hooks.resourcesDir, tools)
  if (req.cta !== false && !cta) warnings.push('Abone butonu eklenemedi: resources/cta/youtube-abone.mp4 bulunamadı; videolar butonsuz kesildi.')
  const crf = req.quality === 'high' ? '17' : '19'
  const preset = req.quality === 'high' ? 'slow' : 'veryfast'
  for (const it of items) {
    if (hooks.signal?.aborted) throw new Error('İptal edildi.')
    const out = join(dir, ytCutFileName(it.index, it.title, items.length))
    const times = cta ? ctaTimesEvery(it.durationSec) : []
    const enc = ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', '-progress', 'pipe:1', out]
    const plain = ['-y', '-v', 'error', '-nostdin', '-ss', it.start.toFixed(3), '-t', it.durationSec.toFixed(3), '-i', req.videoPath, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []), ...(vf ? ['-vf', vf] : []), ...enc]
    const run = (args: string[]) => runTool(tools.ffmpeg, limitThreads(args), { signal: hooks.signal, durationSec: it.durationSec, onProgress: (f) => hooks.progress?.(Math.min(1, (doneSec + f * it.durationSec) / totalSec), `${it.index}/${items.length}: ${it.title}`) })
    try {
      if (cta && times.length) {
        const g = ctaGraph({ cta, times, srcW, srcH, hasAudio, videoPre: vf })
        const withCta = ['-y', '-v', 'error', '-nostdin', '-ss', it.start.toFixed(3), '-t', it.durationSec.toFixed(3), '-i', req.videoPath, ...g.inputs, '-filter_complex', g.filter, ...g.maps, '-t', it.durationSec.toFixed(3), ...enc]
        try {
          await run(withCta)
          it.ctaAt = times
        } catch (e) {
          if (hooks.signal?.aborted) throw e
          // buton eklenemezse kesit butonsuz kesilir (iş durmaz)
          warnings.push(`"${it.title}": abone butonu eklenemedi (${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 120)}); butonsuz kesildi.`)
          await run(plain)
        }
      } else await run(plain)
      it.path = out
      if (req.transcriptLines?.length) {
        // kesitin yanına konuşma metni (hata olursa kesit yine başarılı)
        await writeFile(out.replace(/\.mp4$/i, '') + ' - transkript.txt', clipTranscriptText(req.transcriptLines, it.start, it.end) + '\n', 'utf8').catch(() => undefined)
      }
    } catch (e) {
      if (hooks.signal?.aborted) throw e
      it.error = e instanceof Error ? e.message : String(e)
    }
    doneSec += it.durationSec
    hooks.progress?.(Math.min(1, doneSec / totalSec), `${it.index}/${items.length}: ${it.title}`)
  }
  return { dir, items, warnings }
}
