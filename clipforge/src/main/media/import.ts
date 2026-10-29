import { open, readFile, stat, mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { defaultAudioMap, isSupportedMedia, parseProbe } from '../../shared/media/probe'
import { markersFromChapters, parseMarkerFile } from '../../shared/media/markers'
import { newId } from '../../shared/timeline/model'
import type { MediaAsset, Marker } from '../../shared/types'
import { ffprobeJson, runFfmpeg, ToolError } from '../ffmpeg'

export interface MediaTools {
  ffmpeg: string
  ffprobe: string
}

async function readHead(file: string, bytes = 1 << 20): Promise<Uint8Array> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/**
 * Kayıt dosyasını çözümler: süre, çözünürlük, codec, ses track'leri, OBS algılama.
 * Ayrıca küçük bir test çözümü yapar; bozuk dosya / çözücü eksikliği içe aktarmada anlaşılır mesajla yakalanır.
 */
export async function importMedia(
  file: string,
  tools: MediaTools,
  dataDir: string,
  opts: { signal?: AbortSignal; progress?: (f: number, msg?: string) => void } = {}
): Promise<MediaAsset> {
  const name = basename(file)
  if (!isSupportedMedia(name)) {
    throw new ToolError(`Desteklenmeyen dosya türü "${extname(name) || name}". Desteklenenler: MP4, MOV, MKV, FLV (OBS kayıtları için MKV önerilir).`)
  }
  let st
  try {
    st = await stat(file)
  } catch {
    throw new ToolError('Dosya bulunamadı ya da erişilemiyor.')
  }
  if (!st.isFile() || st.size === 0) throw new ToolError('Dosya boş ya da geçerli bir dosya değil.')

  opts.progress?.(0.05, 'Dosya çözümleniyor')
  const probe = await ffprobeJson(tools.ffprobe, file, opts.signal)
  const head = await readHead(file).catch(() => undefined)
  const info = parseProbe(probe, name, head)
  if (info.durationSec <= 0) throw new ToolError('Dosyanın süresi okunamadı; kayıt tamamlanmamış olabilir.')
  if (info.audioStreams.length === 0 && info.kind === 'video') {
    // ses olmayan kayıt geçerli ama transkripsiyon yapılamaz — uyarı UI'da gösterilir
  }

  // Test çözümü: ilk iki saniye (codec çözülemiyorsa burada anlaşılır)
  opts.progress?.(0.3, 'Codec denetleniyor')
  await runFfmpeg(tools.ffmpeg, ['-v', 'error', '-t', '2', '-i', file, '-f', 'null', '-'], { signal: opts.signal }).catch((e) => {
    // Bazı kayıtlarda kısa test sonunda uyarı olabilir; yalnızca codec/dosya hatalarını yükselt
    if (e instanceof ToolError && /çözücü|bozuk|erişim|bulunamad/i.test(e.userMessage)) throw e
  })

  const id = newId('asset')
  const asset: MediaAsset = {
    id,
    name,
    path: file,
    ...info,
    transcriptionTrack: 0,
    audioMap: defaultAudioMap(info.audioStreams),
    importedAt: new Date().toISOString()
  }

  if (info.kind === 'video') {
    opts.progress?.(0.6, 'Küçük resim hazırlanıyor')
    await makeThumbnail(asset, tools, dataDir, opts.signal).catch(() => undefined)
  }
  opts.progress?.(1)
  return asset
}

export async function makeThumbnail(asset: MediaAsset, tools: MediaTools, dataDir: string, signal?: AbortSignal): Promise<void> {
  const rel = join('thumbs', `${asset.id}.jpg`)
  await mkdir(join(dataDir, 'thumbs'), { recursive: true })
  const at = Math.min(Math.max(1, asset.durationSec * 0.1), Math.max(0, asset.durationSec - 1))
  await runFfmpeg(
    tools.ffmpeg,
    ['-y', '-v', 'error', '-ss', at.toFixed(2), '-i', asset.path, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', join(dataDir, rel)],
    { signal }
  )
  asset.thumbnailPath = rel
}

/** Kaydın yanındaki işaret dosyası adayları: <ad>.markers.json|csv|txt, <ad>.chapters.txt */
export async function findSidecarMarkers(file: string): Promise<Marker[]> {
  const dir = dirname(file)
  const stem = basename(file, extname(file))
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const want = new Set(['.markers.json', '.markers.csv', '.markers.txt', '.chapters.txt', '.chapters.json', '.json', '.csv', '.txt'].map((s) => `${stem}${s}`.toLowerCase()))
  const out: Marker[] = []
  for (const n of names) {
    if (!want.has(n.toLowerCase())) continue
    try {
      const text = await readFile(join(dir, n), 'utf8')
      // Sohbet günlüğü gibi alakasız yan dosyalar zaten işaret olarak tanınmaz → boş döner
      out.push(...parseMarkerFile(text, n))
    } catch {
      /* sessizce atla */
    }
  }
  return out
}

/** Bölümler (OBS Chapter Marker) + yan dosya işaretçileri. Hiçbiri yoksa boş liste: özellik sessizce kapalı kalır. */
export async function loadMarkers(asset: MediaAsset): Promise<Marker[]> {
  const chapters = markersFromChapters(asset.chapters ?? [])
  const side = await findSidecarMarkers(asset.path).catch(() => [])
  const all = [...chapters, ...side].sort((a, b) => a.time - b.time)
  return all.filter((m, i) => i === 0 || Math.abs(m.time - all[i - 1].time) > 0.5)
}
