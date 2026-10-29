import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildExportPlan } from '../shared/export/plan'
import { resolveExportFps } from '../shared/export/presets'
import type { ExportRequest } from '../shared/ipc'
import { runFfmpeg, ToolError } from './ffmpeg'
import type { MediaTools } from './media/import'

/**
 * Zaman çizelgesini ffmpeg ile dışa aktarır. Çıktı önce `.part` dosyasına yazılır, başarıyla bitince
 * yeniden adlandırılır; iptal/hata durumunda yarım dosya bırakılmaz.
 */
export async function runExport(
  req: ExportRequest,
  tools: MediaTools,
  opts: { signal?: AbortSignal; progress?: (f: number, msg?: string) => void } = {}
): Promise<{ outputPath: string; warnings: string[] }> {
  try {
    return await runExportOnce(req, tools, opts)
  } catch (e) {
    // Bazı FFmpeg derlemelerinde libass (ass filtresi) yoktur: altyazısız bir kopya üretip kullanıcıyı uyar.
    const hasCaptions = req.timeline.captionStyle.enabled && req.timeline.captions.length > 0
    if (hasCaptions && e instanceof ToolError && /No such filter: 'ass'|Filter ass|libass/i.test(e.detail)) {
      const r = await runExportOnce({ ...req, timeline: { ...req.timeline, captionStyle: { ...req.timeline.captionStyle, enabled: false } } }, tools, opts)
      return { ...r, warnings: [...r.warnings, 'Bu FFmpeg derlemesi altyazı filtresini (libass) içermiyor; klip altyazısız dışa aktarıldı. Ayarlar → FFmpeg yolu ile tam bir derleme seçin.'] }
    }
    throw e
  }
}

async function runExportOnce(
  req: ExportRequest,
  tools: MediaTools,
  opts: { signal?: AbortSignal; progress?: (f: number, msg?: string) => void }
): Promise<{ outputPath: string; warnings: string[] }> {
  const byId = new Map(req.assets.map((a) => [a.id, a]))
  const missing = req.assets.filter((a) => a.missing)
  if (missing.length) throw new ToolError(`Kaynak medya bulunamadı: ${missing.map((m) => m.name).join(', ')}. Dosyaları yeniden bağlayın.`)

  const partPath = `${req.outputPath}.part`
  // fps=0: kaynağın kare hızı (kullanılan videoların en yükseği, ≤60)
  const usedFps = req.timeline.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips.map((c) => byId.get(c.assetId)?.fps ?? 0))
  const options = { ...req.options, fps: resolveExportFps(req.options.fps, usedFps) }
  const plan = buildExportPlan(req.timeline, (id) => byId.get(id), options, partPath, req.range)
  if (plan.durationSec <= 0.1) throw new ToolError('Dışa aktarılacak içerik yok: zaman çizelgesi boş.')

  await mkdir(dirname(req.outputPath), { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'clipforge-export-'))
  try {
    for (const f of plan.files) await writeFile(join(work, f.name), f.content, 'utf8')
    // ffmpeg uzantıdan biçimi çıkarır: `.part` uzantısı bunu bozacağından biçimi açıkça belirt
    const args = [...plan.args.slice(0, -1), '-f', 'mp4', plan.args.at(-1) as string]
    opts.progress?.(0, 'Kodlanıyor')
    await runFfmpeg(tools.ffmpeg, args, {
      cwd: work,
      signal: opts.signal,
      durationSec: plan.durationSec,
      onProgress: (f) => opts.progress?.(f, `Kodlanıyor %${Math.round(f * 100)}`)
    })
    await rename(partPath, req.outputPath)
  } catch (e) {
    await rm(partPath, { force: true }).catch(() => undefined)
    throw e
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
  return { outputPath: req.outputPath, warnings: plan.warnings }
}
