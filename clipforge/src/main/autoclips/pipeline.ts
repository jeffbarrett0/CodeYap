import { Session, makeService } from '../../cli/session'
import { DEFAULT_AUTOCLIP_LAYOUT, autoClipTemplate, findAutoClips, type AutoClipCandidate, type AutoClipLayout, type AutoClipOptions } from '../../shared/autoclips'
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
export async function makeAutoClip(projectPath: string, cand: Pick<AutoClipCandidate, 'start' | 'end' | 'subject'>, layout: Partial<AutoClipLayout> = {}, env: Env = {}): Promise<{ projectPath: string; durationSec: number; name: string }> {
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
  // düzen: 9:16, yüz üstte/altta; konuşulan görüntü (tüm kare) ortada-altta. Yüz klipleri aynı kaynağın yüz bölgesi kırpmasıdır.
  const tpl = autoClipTemplate({ facePos, faceShare: layout.faceShare })
  const v1 = tl.tracks.find((t) => t.id === 'V1')
  const screenClips = (v1?.clips ?? []).filter((c) => c.assetId === asset.id)
  const faceClips: Clip[] = screenClips.map((c) => ({ ...c, id: newId('clip'), trackId: 'V2', crop: { ...face }, label: 'Yüz', groupId: undefined }))
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
  await c.save()
  return { projectPath: created.path, durationSec: dur, name }
}
