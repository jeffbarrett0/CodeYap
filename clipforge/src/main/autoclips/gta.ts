import { access, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { cmd } from '../../shared/timeline/commands'
import { clipsForVideoWithAudio } from '../../shared/timeline/create'
import { nearestAspect } from '../../shared/timeline/model'

export { parseGtaRanges } from '../../shared/gtaRanges'
type Env = { userDataDir?: string; resourcesDir?: string }

/**
 * GTA 6 klibi için temel proje: yayın içe aktarılır, çizelgeye TAMAMI konur (kesim yok: çizelge zamanı = yayın zamanı).
 * Transkript, sessizlik kesimi vb. YAPILMAZ (kullanıcı aralıkları kendisi verir). Aynı video için proje varsa yeniden kullanılır.
 * Klipler `<yayın klasörü>/GTA 6 Klipleri/<ad>/` altına yazılır.
 */
export async function prepareGtaProject(videoPath: string, env: Env = {}, onStatus?: (msg: string) => void): Promise<{ projectPath: string; durationSec: number }> {
  const base = basename(videoPath, extname(videoPath))
  const dir = join(dirname(videoPath), 'GTA 6 Klipleri', base)
  await mkdir(dir, { recursive: true })
  const projectPath = join(dir, `${base}.clipforge`)
  const service = await makeService(env)
  let exists = true
  try {
    await access(projectPath)
  } catch {
    exists = false
  }
  const s = exists ? await Session.open(projectPath, service) : await Session.create(projectPath, base, service)
  let asset = s.project.assets.find((a) => a.path === videoPath)
  if (!asset) {
    onStatus?.('Yayın içe aktarılıyor…')
    for (const id of service.importMedia([videoPath])) await waitTask(service, id, 'İçe aktarma')
    asset = [...service.assets.values()].find((a) => a.path === videoPath)
    if (!asset || asset.kind !== 'video') throw new Error('Bu bir video değil ya da içe aktarılamadı.')
    s.project = { ...s.project, assets: [...s.project.assets, asset] }
    const track = s.timeline.tracks.find((t) => t.id === 'V1')!
    const r = clipsForVideoWithAudio(asset, track, s.timeline.tracks, { at: 0 })
    if ('error' in r) throw new Error(r.error)
    s.apply(cmd.aspectAuto(true, nearestAspect(asset.width, asset.height)), cmd.addClips(r.items, 'Yayın ekle'))
    await s.save()
  }
  return { projectPath, durationSec: asset.durationSec }
}
