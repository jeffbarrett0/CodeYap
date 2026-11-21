import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { cmd } from '../../shared/timeline/commands'
import { clipForTrack } from '../../shared/timeline/create'
import { MAX_CLIP_SEC, DEFAULT_AUTOCLIP_LAYOUT, FACE_ONLY_SHAPES, autoClipTemplate, faceCrop, faceOnlyCrop, faceOnlyTemplate, type FaceOnlyShape, findAutoClips, overlayRect, screenCrop, type AutoClipCandidate, type AutoClipLayout, type AutoClipOptions } from '../../shared/autoclips'
import { newId, timelineDuration } from '../../shared/timeline/model'
import { cutRange, setCaptions } from '../../shared/timeline/ops'
import { captionsForTimeline } from '../../shared/timeline/captions'
import { presetById } from '../../shared/timeline/captionStyles'
import { applyTemplate } from '../../shared/timeline/templates'
import { timelineWords } from '../../shared/timeline/transcript'
import type { Clip } from '../../shared/types'
import { resolveProjectPath } from '../autokick/clips'
import { findMentionClips, mentionSuggestions, transcriptLines, type MentionSuggestion, type TranscriptLine } from '../../shared/clipsearch'

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

/** Auto Kick projesinin transkripti (cümleler, ÇİZELGE zamanı) + konuşmada anılan adlar (öneriler). Projeyi değiştirmez. */
export async function autoClipTranscript(projectPath: string, env: Env = {}): Promise<{ lines: TranscriptLine[]; suggestions: MentionSuggestion[]; totalSec: number; projectPath: string }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw new Error('Projede transkript yok: önce Auto Kick (ya da transkripsiyon) tamamlanmalı.')
  return { lines: transcriptLines(words), suggestions: mentionSuggestions(words), totalSec: timelineDuration(s.timeline), projectPath: path }
}

/** Kullanıcının yazdığı isim(ler)in geçtiği yerlerden DİKEY klip adayları (konu tahmini yok). */
export async function autoClipSearch(projectPath: string, query: string, opts: { minSec?: number; maxSec?: number } = {}, env: Env = {}): Promise<{ candidates: AutoClipCandidate[]; projectPath: string }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw new Error('Projede transkript yok: önce Auto Kick (ya da transkripsiyon) tamamlanmalı.')
  if (!query.trim()) throw new Error('Aranacak bir isim yazın (ör. Osimhen).')
  return { candidates: findMentionClips(words, query, opts), projectPath: path }
}

/**
 * Kullanıcının hazır bölüm listesi için DİKEY klip adayları: her listelenen aralığın İÇİNDE en güçlü (konusu bütün) en çok 2 dk 58 sn'lik parça seçilir;
 * aday adı = listedeki başlık. Aralık 20 sn'den kısaysa ya da konu bulunamazsa aralığın başından başlayan parça alınır. Zamanlar ÇİZELGE zamanıdır.
 */
export async function autoClipCandidatesForRanges(projectPath: string, ranges: { start: number; end: number; title: string }[], opts: Partial<AutoClipOptions> = {}, env: Env = {}): Promise<{ candidates: AutoClipCandidate[]; projectPath: string }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  const total = timelineDuration(s.timeline)
  const maxSec = Math.min(MAX_CLIP_SEC, opts.maxSec ?? MAX_CLIP_SEC)
  const out: AutoClipCandidate[] = []
  for (const [i, r] of ranges.entries()) {
    const end = Math.min(r.end, total)
    const inside = words.filter((w) => w.start >= r.start - 0.01 && w.end <= end + 0.01)
    let pick = inside.length >= 20 ? findAutoClips(inside, { ...opts, max: 8, maxSec })
      .filter((c) => c.start >= r.start - 0.5 && c.end <= end + 0.5)
      .sort((a, b) => b.score - a.score)[0] : undefined
    if (!pick) {
      const len = Math.min(maxSec, end - r.start)
      if (len < 3) continue
      pick = { id: `r${i + 1}`, start: r.start, end: r.start + len, durationSec: len, subject: r.title, headline: r.title, summary: '', score: 1 }
    }
    out.push({ ...pick, id: `r${i + 1}`, subject: r.title, headline: r.title })
  }
  return { candidates: out, projectPath: path }
}

/**
 * Seçilen aralıktan BAĞIMSIZ klip projesi (9:16): kaynaktaki yüz bölgesi ÜSTTE (kırpılıp büyütülür), konuşulan görüntü ALTTA. Ortaya yazı konmaz.
 * Auto Kick projesi değişmez. Düzen yerleşimi sonradan arayüzde elle de ayarlanabilir.
 */
export async function makeAutoClip(projectPath: string, cand: Pick<AutoClipCandidate, 'start' | 'end' | 'subject'>, layout: Partial<AutoClipLayout> & { /** false: şerit yok; yol: o görüntü; yoksa ayardaki */ overlay?: false | string; /** yatay (16:9) klip: yüz/şerit yok, kare olduğu gibi */ horizontal?: boolean; /** otomatik altyazı: 2–4 kelime, iri beyaz, yüzün hemen altında (dikey) */ captions?: boolean; /** yalnızca yüz klibi (ekran yok, şerit yok): yüz tüm kareyi doldurur */ faceOnly?: FaceOnlyShape } = {}, env: Env = {}): Promise<{ projectPath: string; durationSec: number; name: string }> {
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
  if (layout.faceOnly) {
    // YALNIZCA YÜZ (Sport diyor Plus kesitleri): ekran/şerit yok; kamera kutusundaki yüz tüm kareyi doldurur
    const shape = layout.faceOnly
    const srcAsp = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9
    const crop = faceOnlyCrop({ face, faceZoom: layout.faceZoom ?? 1.05, faceFocus: layout.faceFocus ?? DEFAULT_AUTOCLIP_LAYOUT.faceFocus }, srcAsp, shape)
    const v1c = (tl.tracks.find((t) => t.id === 'V1')?.clips ?? []).filter((c) => c.assetId === asset.id)
    const fclips: Clip[] = v1c.map((c) => ({ ...c, id: newId('clip'), trackId: 'V2', crop, label: 'Yüz', groupId: c.groupId }))
    tl = {
      ...tl,
      tracks: (tl.tracks.some((t) => t.id === 'V2') ? tl.tracks : [...tl.tracks, { id: 'V2', name: 'Video 2', kind: 'video' as const, role: 'webcam' as const, clips: [], muted: false, locked: false, volume: 1 }]).map((t) => (t.id === 'V2' ? { ...t, clips: fclips } : t.id === 'V1' ? { ...t, clips: [] } : t))
    }
    tl = { ...applyTemplate(tl, faceOnlyTemplate(shape)), aspect: FACE_ONLY_SHAPES[shape].aspect, aspectAuto: false }
    if (layout.captions) {
      const style = { ...tl.captionStyle, ...presetById('shorts').style, enabled: true, positionY: shape === 'horizontal' ? 0.9 : 0.8 }
      const words = Object.fromEntries(Object.entries(s.transcripts).map(([k, t]) => [k, t.words]))
      tl = setCaptions({ ...tl, captionStyle: style }, captionsForTimeline({ ...tl, captionStyle: style }, words))
    }
    const fdur = timelineDuration(tl)
    const fname = `${cand.subject.trim() || 'Klip'} · ${Math.round(fdur)} sn (yüz)`
    const fcreated = await s.service.createClipProject(s.project, asset.id, fname)
    const fc = await Session.open(fcreated.path, await makeService(env))
    fc.project = { ...fc.project, timeline: tl }
    await fc.save()
    return { projectPath: fcreated.path, durationSec: fdur, name: fname }
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
  if (layout.captions) {
    // otomatik altyazı: iri beyaz, satırda 2–4 kelime; yüz ile görüntünün birleştiği çizginin (şerit) hemen ÜSTÜNDE
    const share = layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare
    const seam = facePos === 'top' ? share : 1 - share
    const cy = Math.max(0.08, seam - 0.06)
    const style = { ...tl.captionStyle, ...presetById('shorts').style, enabled: true, positionY: Math.min(1, Math.max(0, (0.88 - cy) / 0.76)) }
    const words = Object.fromEntries(Object.entries(s.transcripts).map(([k, t]) => [k, t.words]))
    tl = setCaptions({ ...tl, captionStyle: style }, captionsForTimeline({ ...tl, captionStyle: style }, words))
  }
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
