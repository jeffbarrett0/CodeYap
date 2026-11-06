import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { cmd } from '../../shared/timeline/commands'
import { clipForTrack } from '../../shared/timeline/create'
import { DEFAULT_AUTOCLIP_LAYOUT, autoClipTemplate, faceCrop, findAutoClips, overlayRect, screenCrop, type AutoClipCandidate, type AutoClipLayout, type AutoClipOptions } from '../../shared/autoclips'
import { newId, timelineDuration } from '../../shared/timeline/model'
import { cutRange } from '../../shared/timeline/ops'
import { applyTemplate } from '../../shared/timeline/templates'
import { timelineWords } from '../../shared/timeline/transcript'
import type { Clip } from '../../shared/types'
import { resolveProjectPath } from '../autokick/clips'

type Env = { userDataDir?: string; resourcesDir?: string }

/**
 * Auto Clips: Auto Kick'ten çıkan (sessizleri kesilmiş) projenin transkriptinden klip adayları bulur. Projeyi değiştirmez.
 * Zamanlar ÇİZELGE zamanıdır (= dışa aktarılan tam video).
 */
export async function autoClipCandidates(projectPath: string, opts: Partial<AutoClipOptions> = {}, env: Env = {}): Promise<{ candidates: AutoClipCandidate[]; totalSec: number; projectPath: string; faceRegion?: { x: number; y: number; w: number; h: number } }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw new Error('Projede transkript yok: önce Auto Kick (ya da transkripsiyon) tamamlanmalı.')
  return { candidates: findAutoClips(words, opts), totalSec: timelineDuration(s.timeline), projectPath: path, faceRegion: s.project.assets[0]?.webcamRegion }
}

/**
 * Seçilen aralıktan BAĞIMSIZ klip projesi (9:16): kaynaktaki yüz bölgesi ÜSTTE (kırpılıp büyütülür), konuşulan görüntü ALTTA. Ortaya yazı konmaz.
 * Auto Kick projesi değişmez. Düzen yerleşimi sonradan arayüzde elle de ayarlanabilir.
 */
export async function makeAutoClip(projectPath: string, cand: Pick<AutoClipCandidate, 'start' | 'end' | 'subject'>, layout: Partial<AutoClipLayout> & { /** false: şerit yok; yol: o görüntü; yoksa ayardaki */ overlay?: false | string; /** yatay (16:9) klip: yüz/şerit yok, kare olduğu gibi */ horizontal?: boolean } = {}, env: Env = {}): Promise<{ projectPath: string; durationSec: number; name: string }> {
  const s = await Session.open(await resolveProjectPath(projectPath), await makeService(env))
  const total = timelineDuration(s.timeline)
  if (!(cand.end > cand.start) || cand.start < 0 || cand.end > total + 0.5) throw new Error(`Geçersiz aralık: ${cand.start.toFixed(1)}–${cand.end.toFixed(1)} (çizelge ${total.toFixed(1)} sn).`)
  const asset = s.project.assets[0]
  if (!asset) throw new Error('Projede medya yok.')
  const face = layout.face ?? asset.webcamRegion ?? DEFAULT_AUTOCLIP_LAYOUT.face
  const facePos = layout.facePos ?? DEFAULT_AUTOCLIP_LAYOUT.facePos
  let tl = s.timeline
  if (cand.end < total - 1e-3) tl = cutRange(tl, cand.end, total, true)
  if (cand.start > 1e-3) tl = cutRange(tl, 0, cand.start, true)
  tl = { ...tl, captions: [] }
  if (layout.horizontal) {
    // YATAY klip (YouTube): kare olduğu gibi kalır (kaynak kalitesi), yüz/şerit eklenmez; yalnızca konuşulan aralık
    tl = { ...tl, aspect: '16:9', aspectAuto: false }
    const hdur = timelineDuration(tl)
    const hname = `${cand.subject.trim() || 'Klip'} · ${Math.round(hdur)} sn (yatay)`
    const hcreated = await s.service.createClipProject(s.project, asset.id, hname)
    const hc = await Session.open(hcreated.path, await makeService(env))
    hc.project = { ...hc.project, timeline: tl }
    await hc.save()
    return { projectPath: hcreated.path, durationSec: hdur, name: hname }
  }
  // düzen: 9:16, yüz üstte/altta; konuşulan görüntü (tüm kare) ortada-altta. Yüz klipleri aynı kaynağın yüz bölgesi kırpmasıdır.
  const tpl = autoClipTemplate({ facePos, faceShare: layout.faceShare })
  const v1 = tl.tracks.find((t) => t.id === 'V1')
  const screenClips = (v1?.clips ?? []).filter((c) => c.assetId === asset.id)
  // alttaki konuşulan görüntü: biraz yakınlaştırılmış, ortalı kırpma (yüz kutusu altta görünmesin)
  const crop = screenCrop({ face, faceShare: layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare, screenZoom: layout.screenZoom ?? DEFAULT_AUTOCLIP_LAYOUT.screenZoom }, asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9)
  tl = { ...tl, tracks: tl.tracks.map((t) => (t.id === 'V1' ? { ...t, clips: t.clips.map((c) => (c.assetId === asset.id ? { ...c, crop } : c)) } : t)) }
  const srcAspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9
  const faceRect = faceCrop({ face, faceShare: layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare, faceZoom: layout.faceZoom ?? DEFAULT_AUTOCLIP_LAYOUT.faceZoom, faceFocus: layout.faceFocus ?? DEFAULT_AUTOCLIP_LAYOUT.faceFocus }, srcAspect)
  const faceClips: Clip[] = screenClips.map((c) => ({ ...c, id: newId('clip'), trackId: 'V2', crop: faceRect, label: 'Yüz', groupId: undefined }))
  tl = {
    ...tl,
    tracks: tl.tracks.some((t) => t.id === 'V2') ? tl.tracks.map((t) => (t.id === 'V2' ? { ...t, clips: faceClips } : t)) : [...tl.tracks, { id: 'V2', name: 'Video 2', kind: 'video' as const, role: 'webcam' as const, clips: faceClips, muted: false, locked: false, volume: 1 }]
  }
  tl = { ...applyTemplate(tl, tpl), aspect: '9:16', aspectAuto: false }
  const dur = timelineDuration(tl)
  const name = `${cand.subject.trim() || 'Klip'} · ${Math.round(dur)} sn`
  const created = await s.service.createClipProject(s.project, asset.id, name)
  const c = await Session.open(created.path, await makeService(env))
  c.project = { ...c.project, timeline: tl }
  await addOverlay(c, layout, dur)
  await c.save()
  return { projectPath: created.path, durationSec: dur, name }
}

/** Sosyal medya şeridi: yüz ile görüntünün kesiştiği çizgiye, klip boyunca; en üst katmanda (Fotoğraf 1) */
async function addOverlay(c: Session, layout: { faceShare?: number; facePos?: 'top' | 'bottom'; overlay?: false | string }, dur: number): Promise<void> {
  if (layout.overlay === false) return
  const st = c.service.settings.value
  if (layout.overlay === undefined && !st.autoClipsOverlay) return
  const path = typeof layout.overlay === 'string' ? layout.overlay : st.autoClipsOverlayPath.trim() || join(c.service.deps.resourcesDir, 'overlays', 'sosyal-medya.png')
  try {
    await access(path)
  } catch {
    return // şerit dosyası yoksa klip şeritsiz üretilir
  }
  const known = new Set(c.project.assets.map((a) => a.id))
  for (const id of c.service.importMedia([path])) await waitTask(c.service, id, 'Şerit içe aktarma')
  const asset = [...c.service.assets.values()].find((a) => !known.has(a.id) && a.path === path)
  if (!asset || asset.kind !== 'image') return
  c.project = { ...c.project, assets: [...c.project.assets, asset] }
  const track = c.timeline.tracks.find((t) => t.id === 'I1')
  if (!track) return
  const clip = clipForTrack(asset, track, { at: 0, duration: dur })
  if ('error' in clip) return
  c.apply(cmd.addClip('I1', { ...clip.clip, label: 'Sosyal medya şeridi' }))
  const rect = overlayRect(layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare, asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 11, 0.86, layout.facePos ?? 'top')
  c.apply(cmd.placement('I1', { rect, fit: 'contain', visible: true, opacity: 1 }, false))
  // şerit en önde çizilsin (listede ilk)
  const tl = c.timeline
  c.project = { ...c.project, timeline: { ...tl, tracks: [...tl.tracks.filter((t) => t.id === 'I1'), ...tl.tracks.filter((t) => t.id !== 'I1')] } }
}
