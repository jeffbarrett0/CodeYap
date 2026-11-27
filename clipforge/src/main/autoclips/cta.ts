import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Session, waitTask } from '../../cli/session'
import { CTA_AUDIO_VOLUME } from '../../shared/voicelevel'
import { ctaRect, ctaTimesEvery, GTA_CTA, GTA_EVERY_SEC, verticalCtaRect, CTA_CLIP_SEC, parseCtaManifest, youtubeCtaSize } from '../../shared/cta'
import { cmd } from '../../shared/timeline/commands'
import { clipForTrack } from '../../shared/timeline/create'

/**
 * Klip projesine kullanıcının YouTube abone butonunu ekler (KULLANICININ KARARI: her videoda, 2. saniyede ilk, sonra her 20 sn'de bir; yatayda alt orta, dikeyde kullanıcının kırmızı ile işaretlediği yer (verticalCtaRect)).
 * Yeşil perde dışa aktarmada şeffaflaşır (`fx.chroma`), butonun sesi karışır. Buton dosyası yoksa/eklenemezse klip butonsuz kalır (iş durmaz).
 * Dönen: butonların yerleri (sn). Çizelge süresi `dur` (kesim/şerit eklendikten SONRA).
 */
export async function addYoutubeCta(c: Session, dur: number, opts: { gtaBottom?: boolean } = {}): Promise<number[]> {
  const st = c.service.settings.value
  if (st.autoClipsCta === false) return []
  // KULLANICININ KARARI: YouTube butonu YALNIZCA yatay (16:9) videolarda; dikey/kare videolara konmaz
  // GTA 6 klibi (dikey): kullanıcı özellikle istedi → oyun altındaki boş bölgeye konur; diğer dikey/kare videolarda yine yok
  if (c.timeline.aspect !== '16:9' && !opts.gtaBottom) return []
  const times = ctaTimesEvery(dur, opts.gtaBottom ? GTA_EVERY_SEC : undefined)
  if (times.length === 0) return []
  try {
    const dir = join(c.service.deps.resourcesDir, 'cta')
    const manifest = parseCtaManifest(JSON.parse(await readFile(join(dir, 'cta.json'), 'utf8')))
    const entry = manifest?.buttons.find((b) => b.id === 'youtube')
    if (!manifest || !entry) return []
    const file = join(dir, entry.file)
    await access(file)
    const known = new Set(c.project.assets.map((a) => a.id))
    for (const id of c.service.importMedia([file])) await waitTask(c.service, id, 'Buton içe aktarma')
    const asset = [...c.service.assets.values()].find((a) => !known.has(a.id) && a.path === file)
    if (!asset || asset.kind !== 'video') return []
    c.project = { ...c.project, assets: [...c.project.assets, asset] }
    const aspect = c.timeline.aspect
    const rect = opts.gtaBottom ? verticalCtaRect(entry, asset.width, asset.height, GTA_CTA) : ctaRect(entry, asset.width, asset.height, aspect, { pos: 'bottom-center', size: youtubeCtaSize(aspect) })
    c.apply(cmd.addTrack({ id: 'CTAV', name: 'Çağrı butonları', kind: 'video', role: 'screen', placement: { rect, fit: 'contain', visible: true, opacity: 1 } }))
    if (asset.audioStreams.length > 0) c.apply(cmd.addTrack({ id: 'CTAS', name: 'Çağrı butonu sesi', kind: 'audio', role: 'mix' }))
    const vtr = c.timeline.tracks.find((t) => t.id === 'CTAV')!
    const atr = c.timeline.tracks.find((t) => t.id === 'CTAS')
    const len = Math.min(CTA_CLIP_SEC, asset.durationSec)
    times.forEach((at, i) => {
      const r = clipForTrack(asset, vtr, { at, duration: len })
      if ('error' in r) return
      const grp = `cta${i}`
      c.apply(cmd.addClip('CTAV', { ...r.clip, label: `Buton: ${entry.label}`, crop: entry.crop, groupId: grp, fx: { chroma: { color: manifest.chroma } } }))
      if (atr) {
        const ar = clipForTrack(asset, atr, { at, duration: len })
        if (!('error' in ar)) c.apply(cmd.addClip('CTAS', { ...ar.clip, label: `Buton sesi: ${entry.label}`, groupId: grp, volume: CTA_AUDIO_VOLUME }))
      }
    })
    // buton en önde çizilsin (listede ilk)
    const tl = c.timeline
    c.project = { ...c.project, timeline: { ...tl, tracks: [...tl.tracks.filter((t) => t.id === 'CTAV'), ...tl.tracks.filter((t) => t.id !== 'CTAV')] } }
    return times
  } catch {
    return []
  }
}
