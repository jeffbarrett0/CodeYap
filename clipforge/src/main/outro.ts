import { access, mkdtemp, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffprobeJson, limitThreads, runTool } from './ffmpeg'
import type { MediaTools } from './media/import'

/**
 * YOUTUBE OUTRO (kullanıcının kapanış videosu): yatay videonun SONUNA eklenir. Ana video yeniden kodlanmaz: outro, ana videonun
 * ölçüsüne/kare hızına/ses ayarına UYDURULUP aynı kodlayıcı ayarlarıyla bir kez kodlanır, sonra iki parça `concat` ile kayıpsız birleşir.
 * Dosya yoksa/eklenemezse ana video OLDUĞU GİBİ kalır (iş durmaz, nedeni döner).
 */
const DEFAULT_ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p']

const rate = (s?: string): string => {
  const [n, d] = (s ?? '').split('/').map(Number)
  return n && d ? `${n}/${d}` : n ? String(n) : '30'
}

export async function appendOutro(videoPath: string, outroPath: string, tools: MediaTools, opts: { signal?: AbortSignal; enc?: string[] } = {}): Promise<{ ok: boolean; outroSec?: number; error?: string }> {
  try {
    await access(outroPath)
  } catch {
    return { ok: false, error: `Outro videosu bulunamadı: ${outroPath}` }
  }
  // uzun yayın videosu (GB'larca): birleştirme dosyanın bir kopyasını yazar → yer kontrolü
  try {
    const need = (await stat(videoPath)).size * 1.05 + 200e6
    const fs = await statfs(dirname(videoPath))
    if (fs.bavail * fs.bsize < need) return { ok: false, error: `Outro eklenemedi: diskte yeterli boş yer yok (${(need / 1e9).toFixed(1)} GB gerekli). Video outro'suz bırakıldı.` }
  } catch {
    /* yer ölçülemezse devam */
  }
  const work = await mkdtemp(join(tmpdir(), 'clipforge-outro-'))
  try {
    const main = await ffprobeJson(tools.ffprobe, videoPath, opts.signal)
    const outro = await ffprobeJson(tools.ffprobe, outroPath, opts.signal)
    const mv = main.streams?.find((s) => s.codec_type === 'video')
    const ma = main.streams?.find((s) => s.codec_type === 'audio')
    const ov = outro.streams?.find((s) => s.codec_type === 'video')
    const oa = outro.streams?.find((s) => s.codec_type === 'audio')
    if (!mv?.width || !mv.height) return { ok: false, error: 'Ana videonun görüntü akışı okunamadı.' }
    if (!ov) return { ok: false, error: 'Outro dosyasında görüntü yok.' }
    const W = mv.width
    const H = mv.height
    const fps = rate(mv.avg_frame_rate && mv.avg_frame_rate !== '0/0' ? mv.avg_frame_rate : mv.r_frame_rate)
    const sr = Number(ma?.sample_rate) || 48000
    const ch = ma?.channels && ma.channels >= 2 ? 2 : 1
    const layout = ch === 2 ? 'stereo' : 'mono'
    const oDur = Number(outro.format?.duration) || Number(ov.duration) || 0
    const norm = join(work, 'outro.mp4')
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
    const args = ['-y', '-v', 'error', '-nostdin', '-i', outroPath]
    if (ma && !oa) args.push('-f', 'lavfi', '-t', String(Math.max(0.5, oDur)), '-i', `anullsrc=r=${sr}:cl=${layout}`)
    args.push('-map', '0:v:0')
    if (ma) args.push('-map', oa ? '0:a:0' : '1:a:0')
    args.push('-vf', vf, ...(opts.enc ?? DEFAULT_ENC))
    if (ma) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', String(sr), '-ac', String(ch))
    else args.push('-an')
    args.push('-movflags', '+faststart', '-t', String(Math.max(0.5, oDur)), norm)
    await runTool(tools.ffmpeg, limitThreads(args), { signal: opts.signal })
    // kayıpsız birleştir
    const esc = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "'\\''")
    await writeFile(join(work, 'list.txt'), `file '${esc(videoPath)}'\nfile '${esc(norm)}'\n`, 'utf8')
    const tmpOut = `${videoPath}.outro.tmp.mp4`
    await runTool(tools.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', tmpOut], { signal: opts.signal })
    // doğrulama: süre = ana + outro; aksi halde ana video değişmez
    const before = Number(main.format?.duration) || 0
    const after = Number((await ffprobeJson(tools.ffprobe, tmpOut, opts.signal)).format?.duration) || 0
    const outroSec = Number((await ffprobeJson(tools.ffprobe, norm, opts.signal)).format?.duration) || oDur
    if (!(Math.abs(after - (before + outroSec)) <= 0.6)) {
      await rm(tmpOut, { force: true })
      return { ok: false, error: `Outro eklenirken süre tutmadı (beklenen ${(before + outroSec).toFixed(1)} sn, çıkan ${after.toFixed(1)} sn); video outro'suz bırakıldı.` }
    }
    // kuyruk doğrulaması: outro bölümü hatasız çözülmeli (parametre uyuşmazlığı süreyi bozmadan görüntüyü bozabilir); bozuksa ana video DEĞİŞMEZ
    const tailFrom = Math.max(0, after - outroSec - 1)
    let decodeErr = ''
    try {
      const r = await runTool(tools.ffmpeg, ['-v', 'error', '-nostdin', '-ss', tailFrom.toFixed(2), '-i', tmpOut, '-f', 'null', '-'], { signal: opts.signal })
      decodeErr = `${r.stderr ?? ''}`.trim() // ffmpeg çözme hatalarını stderr'e yazar
    } catch (e) {
      decodeErr = e instanceof Error ? e.message : String(e)
    }
    if (decodeErr) {
      await rm(tmpOut, { force: true })
      return { ok: false, error: `Outro bölümü çözülemedi (${decodeErr.split('\n')[0].slice(0, 120)}); video outro'suz bırakıldı.` }
    }
    await rename(tmpOut, videoPath)
    return { ok: true, outroSec }
  } catch (e) {
    await rm(`${videoPath}.outro.tmp.mp4`, { force: true }).catch(() => undefined)
    return { ok: false, error: `Outro eklenemedi: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 160)}` }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

const OUTRO_EXT = /\.(mp4|mov|mkv|m4v|webm)$/i

/** Kullanıcının "kapanış" klasörü (bilgisayarında, uygulama verisi altında): outro dosyasını buraya bırakması yeterli */
export const outroFolder = (userDataDir: string): string => join(userDataDir, 'kapanis')

/**
 * Kullanılacak outro: önce Ayarlar'da seçilen dosya, sonra kapanış klasöründeki ilk video (adına göre), sonra uygulamayla gelen `resources/outro`. Hiçbiri yoksa boş (outro eklenmez).
 */
export async function resolveOutro(settingPath: string | undefined, userDataDir: string, resourcesDir?: string, enabled = true): Promise<string> {
  if (!enabled) return ''
  if (settingPath?.trim()) return settingPath.trim()
  const { readdir } = await import('node:fs/promises')
  for (const dir of [outroFolder(userDataDir), ...(resourcesDir ? [join(resourcesDir, 'outro')] : [])]) {
    try {
      const f = (await readdir(dir)).filter((x) => OUTRO_EXT.test(x) && !x.startsWith('.')).sort()[0]
      if (f) return join(dir, f)
    } catch {
      /* klasör yok */
    }
  }
  return ''
}
