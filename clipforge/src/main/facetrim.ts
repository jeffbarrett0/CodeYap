import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { FACE_TRIM_DEFAULT, faceTrimFilter, faceTrimGeometry, type FaceTrimGeometry, type FaceTrimOptions } from '../shared/facetrim'
import { ffprobeJson, limitThreads, runTool } from './ffmpeg'
import type { MediaTools } from './media/import'

const MEDIA_RE = /\.(mp4|mov|mkv|m4v|webm)$/i

export interface FaceTrimProbe {
  width: number
  height: number
  durationSec: number
  hasAudio: boolean
}

async function probe(tools: MediaTools, file: string, signal?: AbortSignal): Promise<FaceTrimProbe> {
  if (!MEDIA_RE.test(file)) throw new Error('Desteklenen bir video seçin (MP4, MOV, MKV, M4V, WEBM).')
  try {
    await access(file)
  } catch {
    throw new Error(`Dosya bulunamadı: ${file}`)
  }
  const p = await ffprobeJson(tools.ffprobe, file, signal)
  const v = p.streams?.find((s) => s.codec_type === 'video')
  if (!v?.width || !v.height) throw new Error('Videoda görüntü akışı bulunamadı.')
  return { width: v.width, height: v.height, durationSec: Number(p.format?.duration) || Number(v.duration) || 0, hasAudio: !!p.streams?.some((s) => s.codec_type === 'audio') }
}

const norm = (o: Partial<FaceTrimOptions>): FaceTrimOptions => ({ ...FACE_TRIM_DEFAULT, ...o })

/** Çıkış dosyası: videonun yanına `<ad> - sadece yüz.mp4` (varsa (2), (3)…) */
async function outPathFor(video: string): Promise<string> {
  const base = join(dirname(video), `${basename(video, extname(video))} - sadece yüz`)
  let p = `${base}.mp4`
  for (let i = 2; await access(p).then(() => true, () => false); i++) p = `${base} (${i}).mp4`
  return p
}

/**
 * Önizleme: orijinal kare (kesim çizgisi kırmızı) + çıkacak görüntü (JPEG, data URL). Dosyaya dokunmaz.
 */
export async function previewFaceTrim(videoPath: string, options: Partial<FaceTrimOptions>, tools: MediaTools, atSec?: number): Promise<{ original: string; result: string; probe: FaceTrimProbe; geometry: FaceTrimGeometry }> {
  const o = norm(options)
  const pr = await probe(tools, videoPath)
  const g = faceTrimGeometry(pr.width, pr.height, o)
  const at = atSec !== undefined ? Math.max(0, Math.min(atSec, Math.max(0, pr.durationSec - 0.1))) : Math.max(0, Math.min(pr.durationSec / 2, 2))
  const work = await mkdtemp(join(tmpdir(), 'clipforge-facetrim-'))
  try {
    const orig = join(work, 'o.jpg')
    const res = join(work, 'r.jpg')
    const line = `drawbox=x=0:y=${g.cropY + g.faceH}:w=iw:h=${Math.max(3, Math.round(pr.height / 400))}:color=red@0.95:t=fill,scale=420:-2`
    await runTool(tools.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-ss', at.toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', line, '-q:v', '4', orig])
    await runTool(tools.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-ss', at.toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', `${faceTrimFilter(g)},scale=420:-2`, '-q:v', '3', res])
    const url = async (f: string) => `data:image/jpeg;base64,${(await readFile(f)).toString('base64')}`
    return { original: await url(orig), result: await url(res), probe: pr, geometry: g }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Yalnızca yüzü MP4 olarak kaydeder: üst yüz alanı kesilir, ortadaki şerit ve alttaki ekran atılır. Ses AYNEN kalır (yeniden kodlanmaz;
 * MP4'e uymazsa AAC'ye çevrilir). Görüntü yeniden kodlanır (yüksek kalite). Kaynağa dokunulmaz.
 */
export async function runFaceTrim(videoPath: string, options: Partial<FaceTrimOptions> & { /** videoyu kes (sn): başlangıç/bitiş; boşsa tamamı */ start?: number; end?: number }, tools: MediaTools, hooks: { signal?: AbortSignal; progress?: (f: number) => void } = {}): Promise<{ outputPath: string; width: number; height: number; durationSec: number }> {
  const o = norm(options)
  const pr = await probe(tools, videoPath, hooks.signal)
  const g = faceTrimGeometry(pr.width, pr.height, o)
  if (g.faceH < 64) throw new Error('Yüz alanı çok küçük kaldı: yüz alanı yüksekliğini artırın.')
  // kesme: başlangıç/bitiş (sn). Tamamı seçiliyse kesme yok (ses copy); kesiliyorsa ses AAC'ye çevrilir (kare/ses kaymasın)
  const start = Math.max(0, options.start ?? 0)
  const end = Math.min(pr.durationSec || Infinity, options.end ?? Infinity)
  const trimmed = start > 0.05 || (Number.isFinite(end) && pr.durationSec > 0 && end < pr.durationSec - 0.05)
  if (trimmed && !(end - start >= 0.5)) throw new Error('Bitiş, başlangıçtan en az yarım saniye sonra olmalı.')
  const clipSec = trimmed ? end - start : pr.durationSec
  const out = await outPathFor(videoPath)
  const part = `${out}.part.mp4`
  const base = ['-y', '-v', 'error', '-nostdin', ...(trimmed ? ['-ss', start.toFixed(3), '-t', clipSec.toFixed(3)] : []), '-i', videoPath, '-map', '0:v:0', ...(pr.hasAudio ? ['-map', '0:a:0'] : []), '-vf', faceTrimFilter(g), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
  const run = (audio: string[]) => runTool(tools.ffmpeg, limitThreads([...base, ...audio, '-progress', 'pipe:1', part]), { signal: hooks.signal, durationSec: clipSec, onProgress: hooks.progress })
  try {
    try {
      await run(pr.hasAudio ? (trimmed ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy']) : ['-an'])
    } catch (e) {
      if (hooks.signal?.aborted || !pr.hasAudio) throw e
      await run(['-c:a', 'aac', '-b:a', '192k']) // ses akışı MP4'e kopyalanamadıysa
    }
    const { rename } = await import('node:fs/promises')
    await rename(part, out)
    return { outputPath: out, width: g.outW, height: g.outH, durationSec: clipSec }
  } catch (e) {
    await rm(part, { force: true }).catch(() => undefined)
    throw e
  }
}
