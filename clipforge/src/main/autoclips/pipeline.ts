import { GTA_GAME_ZOOM } from '../../shared/cta'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { cmd } from '../../shared/timeline/commands'
import { clipForTrack } from '../../shared/timeline/create'
import { MAX_CLIP_SEC, DEFAULT_AUTOCLIP_LAYOUT, FACE_ONLY_SHAPES, autoClipTemplate, faceCrop, faceOnlyCrop, faceOnlyTemplate, type FaceOnlyShape, findAutoClips, overlayRect, screenCrop, type AutoClipCandidate, type AutoClipLayout, type AutoClipOptions } from '../../shared/autoclips'
import { newId, timelineDuration } from '../../shared/timeline/model'
import { foldTr } from '../../shared/text'
import { cutRange, setCaptions } from '../../shared/timeline/ops'
import { captionsForTimeline } from '../../shared/timeline/captions'
import { presetById } from '../../shared/timeline/captionStyles'
import { applyTemplate } from '../../shared/timeline/templates'
import { timelineWords } from '../../shared/timeline/transcript'
import type { Clip } from '../../shared/types'
import { resolveProjectPath } from '../autokick/clips'
import { addYoutubeCta } from './cta'
import { findMentionClips, findSceneClips, mentionSuggestions, transcriptLines, type MentionSuggestion, type SceneCandidate, type TranscriptLine } from '../../shared/clipsearch'

type Env = { userDataDir?: string; resourcesDir?: string }

/**
 * Auto Clips: Auto Kick'ten çıkan (sessizleri kesilmiş) projenin transkriptinden klip adayları bulur. Projeyi değiştirmez.
 * Zamanlar ÇİZELGE zamanıdır (= dışa aktarılan tam video).
 */
export async function autoClipCandidates(projectPath: string, opts: Partial<AutoClipOptions> = {}, env: Env = {}): Promise<{ candidates: AutoClipCandidate[]; totalSec: number; projectPath: string; faceRegion?: { x: number; y: number; w: number; h: number } }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw await noTranscriptError(s)
  return { candidates: findAutoClips(words, opts), totalSec: timelineDuration(s.timeline), projectPath: path, faceRegion: s.project.assets[0]?.webcamRegion }
}

/** Transkript yoksa NEDENİ görünür olsun: hangi medya, transkript hangi klasörde aranmış, o klasör var mı */
async function noTranscriptError(s: Session): Promise<Error> {
  let dataExists = false
  try {
    await access(s.service.dataDir)
    dataExists = true
  } catch {
    /* yok */
  }
  const media = s.project.assets[0]?.name ?? '(medya yok)'
  return new Error(`Projede transkript yok (medya: ${media}; transkript klasörü ${dataExists ? 'var ama içinde bu medyanın transkripti yok' : 'BULUNAMADI'}: ${s.service.dataDir}). Altta “Transkripti şimdi çıkar” ile kaydı yeniden yazıya dökebilirsiniz.`)
}

/**
 * Projenin medyası için transkript yoksa Whisper ile çıkarır (Auto Kick transkripti kaybolmuşsa/projeye bağlanmamışsa). Kesim haritası aynı kalır:
 * transkript KAYNAK kayıt zamanıyla yazılır, çizelgeye kesim haritasıyla yansır. Projeyi (kesimleri) değiştirmez; yalnızca transkript yan dosyası + proje kaydı.
 */
export async function autoClipEnsureTranscript(projectPath: string, env: Env = {}): Promise<{ words: number; sentences: number; already: boolean }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const asset = s.project.assets[0]
  if (!asset) throw new Error('Projede medya yok.')
  const have = s.transcripts[asset.id]
  if (have && have.words.length > 0) return { words: have.words.length, sentences: have.segments.length, already: true }
  const lang = s.service.settings.value.language
  let track = asset.transcriptionTrack
  if (track === undefined && asset.audioStreams.length > 1) track = (await s.service.detectSpeechTrack(asset.id, lang)).track
  const id = await s.service.transcriptStart({ assetId: asset.id, track: track ?? 0, language: lang, force: true })
  await waitTask(s.service, id, 'Transkripsiyon')
  const t = await s.service.transcriptGet(asset.id)
  if (!t || t.words.length === 0) throw new Error('Transkripsiyon bitti ama konuşma bulunamadı (dil/ses track ayarlarını kontrol edin).')
  s.transcripts[asset.id] = t
  await s.save()
  return { words: t.words.length, sentences: t.segments.length, already: false }
}

/** Auto Kick projesinin transkripti (cümleler, ÇİZELGE zamanı) + konuşmada anılan adlar (öneriler). Projeyi değiştirmez. */
export async function autoClipTranscript(projectPath: string, env: Env = {}): Promise<{ lines: TranscriptLine[]; suggestions: MentionSuggestion[]; totalSec: number; projectPath: string }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw await noTranscriptError(s)
  return { lines: transcriptLines(words), suggestions: mentionSuggestions(words), totalSec: timelineDuration(s.timeline), projectPath: path }
}

/**
 * Transkriptte yanlış yazılmış bir ismi (ör. "Osman") doğrusuyla ("Osimhen") TÜM geçtiği yerlerde düzeltir (çekim eki korunur, ünlü uyumuyla);
 * düzeltilmiş transkript projeye kaydedilir. Yeniden transkripsiyon gerekmez.
 */
export async function autoClipFixWord(projectPath: string, from: string, to: string, env: Env = {}): Promise<{ replaced: number }> {
  if (!from.trim() || !to.trim()) throw new Error('Yanlış yazımı ve doğrusunu doldurun (ör. Osman → Osimhen).')
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const asset = s.project.assets[0]
  const t = asset ? s.transcripts[asset.id] : undefined
  if (!asset || !t) throw await noTranscriptError(s)
  const key = (x: string) => (foldTr(x.split(/['’]/)[0]).match(/[\p{L}\p{N}]+/gu) ?? []).join('')
  const f = key(from)
  const index = t.words.findIndex((w) => key(w.text) === f)
  if (index < 0) throw new Error(`“${from.trim()}” transkriptte bulunamadı (yazımı farklı olabilir; transkriptte arayıp tam yazımı girin).`)
  const r = await s.service.transcriptFix({ assetId: asset.id, index, text: to.trim(), all: true, remember: false })
  return { replaced: r.replaced }
}

/** "Klip çıkar": düz Türkçe açıklamadan (ör. "Okan Buruk'un kırmızı kart gördüğü yer") an adayları; konuşma yoksa bulunamaz. Projeyi değiştirmez. */
export async function clipFindSearch(projectPath: string, query: string, env: Env = {}): Promise<{ candidates: SceneCandidate[]; projectPath: string; totalSec: number }> {
  if (!query.trim()) throw new Error('Ne aradığınızı yazın (ör. Okan Buruk kırmızı kart gördüğü yer).')
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw await noTranscriptError(s)
  return { candidates: findSceneClips(words, query), projectPath: path, totalSec: timelineDuration(s.timeline) }
}

/** Kullanıcının yazdığı isim(ler)in geçtiği yerlerden DİKEY klip adayları (konu tahmini yok). */
export async function autoClipSearch(projectPath: string, query: string, opts: { minSec?: number; maxSec?: number } = {}, env: Env = {}): Promise<{ candidates: AutoClipCandidate[]; projectPath: string }> {
  const path = await resolveProjectPath(projectPath)
  const s = await Session.open(path, await makeService(env))
  const words = timelineWords(s.timeline, s.transcripts)
  if (words.length === 0) throw await noTranscriptError(s)
  if (!query.trim()) throw new Error('Aranacak bir isim yazın (ör. Osimhen).')
  return { candidates: findMentionClips(words, query, opts), projectPath: path }
}

/**
 * Kullanıcının hazır bölüm listesi için DİKEY klip adayları: her listelenen aralığın İÇİNDE en güçlü (konusu bütün) en çok 2 dk 58 sn'lik parça seçilir;
 * aday adı = listedeki başlık. Aralık klip süresine (178 sn) sığıyorsa KULLANICININ zamanları aynen alınır; uzunsa içinden en güçlü parça seçilir; konu bulunamazsa aralığın başından başlayan parça alınır. Zamanlar ÇİZELGE zamanıdır.
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
    const whole = end - r.start <= maxSec + 0.5 && end - r.start >= 3
    // aralık klip süresine sığıyorsa KULLANICININ verdiği zamanlar aynen alınır (klip listedeki başlangıçtan başlar, bitişte biter); uzunsa içinden en güçlü parça
    let pick = whole ? { id: `r${i + 1}`, start: r.start, end, durationSec: end - r.start, subject: r.title, headline: r.title, summary: '', score: 1 } as AutoClipCandidate : inside.length >= 20 ? findAutoClips(inside, { ...opts, max: 8, maxSec })
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
export async function makeAutoClip(projectPath: string, cand: Pick<AutoClipCandidate, 'start' | 'end' | 'subject'>, layout: Partial<AutoClipLayout> & { /** false: şerit yok; yol: o görüntü; yoksa ayardaki */ overlay?: false | string; /** yatay (16:9) klip: yüz/şerit yok, kare olduğu gibi */ horizontal?: boolean; /** otomatik altyazı: 2–4 kelime, iri beyaz, yüzün hemen altında (dikey) */ captions?: boolean; /** yalnızca yüz klibi (ekran yok, şerit yok): yüz tüm kareyi doldurur */ faceOnly?: FaceOnlyShape; /** GTA 6: oyun YAKINLAŞTIRILMAZ (tüm kare sığar), altındaki boş yere YouTube butonu */ fullGame?: boolean } = {}, env: Env = {}): Promise<{ projectPath: string; durationSec: number; name: string }> {
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
    await addYoutubeCta(hc, hdur)
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
    await addYoutubeCta(fc, fdur)
    await fc.save()
    return { projectPath: fcreated.path, durationSec: fdur, name: fname }
  }
  // düzen: 9:16, yüz üstte/altta; konuşulan görüntü (tüm kare) ortada-altta. Yüz klipleri aynı kaynağın yüz bölgesi kırpmasıdır.
  let gameZone: { y: number; h: number } | null = null
  let tpl = autoClipTemplate({ facePos, faceShare: layout.faceShare })
  if (layout.fullGame) {
    // oyun ekranı tam kare sığar (yakınlaştırma yok): genişlik = kare genişliği, yükseklik = kaynak oranına göre; yüz/şerit düzeni aynı, altta boş kalan yere buton konur
    const share = layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare
    const srcAsp = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9
    // oyun BİRAZ büyütülür (kullanıcı: "çok değil, birazcık"): yanlardan %1/1,12 kırpılır, yükseklik 1,12 kat; tüm HUD'u tutan ortalı kırpma
    const gz = GTA_GAME_ZOOM
    const gameH = Math.min(1 - share, ((1080 / srcAsp) / 1920) * gz)
    const gy = facePos === 'top' ? share : 1 - share - gameH
    tpl = { ...tpl, layers: tpl.layers.map((l) => (l.id === 'V1' ? { ...l, placement: { rect: { x: 0, y: gy, w: 1, h: gameH }, fit: 'cover' as const, visible: true, opacity: 1 } } : l)) }
    gameZone = { y: gy, h: gameH }
  }
  const v1 = tl.tracks.find((t) => t.id === 'V1')
  const screenClips = (v1?.clips ?? []).filter((c) => c.assetId === asset.id)
  // alttaki konuşulan görüntü: biraz yakınlaştırılmış, ortalı kırpma (yüz kutusu altta görünmesin)
  const crop = screenCrop({ face, faceShare: layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare, screenZoom: layout.screenZoom ?? DEFAULT_AUTOCLIP_LAYOUT.screenZoom }, asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9)
  const gameCrop = { x: (1 - 1 / GTA_GAME_ZOOM) / 2, y: 0, w: 1 / GTA_GAME_ZOOM, h: 1 }
  tl = { ...tl, tracks: tl.tracks.map((t) => (t.id === 'V1' ? { ...t, clips: t.clips.map((c) => (c.assetId === asset.id ? { ...c, crop: layout.fullGame ? gameCrop : crop } : c)) } : t)) }
  const srcAspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9
  const faceRect = faceCrop({ face, faceShare: layout.faceShare ?? DEFAULT_AUTOCLIP_LAYOUT.faceShare, faceZoom: layout.faceZoom ?? DEFAULT_AUTOCLIP_LAYOUT.faceZoom, faceFocus: layout.faceFocus ?? DEFAULT_AUTOCLIP_LAYOUT.faceFocus }, srcAspect)
  const faceClips: Clip[] = screenClips.map((c) => ({ ...c, id: newId('clip'), trackId: 'V2', crop: faceRect, label: 'Yüz', groupId: undefined }))
  tl = {
    ...tl,
    tracks: tl.tracks.some((t) => t.id === 'V2') ? tl.tracks.map((t) => (t.id === 'V2' ? { ...t, clips: faceClips } : t)) : [...tl.tracks, { id: 'V2', name: 'Video 2', kind: 'video' as const, role: 'webcam' as const, clips: faceClips, muted: false, locked: false, volume: 1 }]
  }
  tl = { ...applyTemplate(tl, tpl), aspect: '9:16', aspectAuto: false }
  if (gameZone) {
    // oyunun ALTINDAKİ boş yer: aynı oyun ekranının KOPYASI, bulanık + karartılmış (net oyun çizilmez); üstüne YouTube butonu gelir
    const yb = gameZone.y + gameZone.h
    const blurClips: Clip[] = screenClips.map((c) => ({ ...c, id: newId('clip'), trackId: 'VB', crop: undefined, label: 'Alt: bulanık kopya', groupId: undefined, fx: { ...c.fx, blurFill: true, blurOnly: true } }))
    tl = { ...tl, tracks: [...tl.tracks, { id: 'VB', name: 'Alt bulanık kopya', kind: 'video' as const, role: 'screen' as const, clips: blurClips, muted: false, locked: false, volume: 1, placement: { rect: { x: 0, y: yb, w: 1, h: 1 - yb }, fit: 'contain' as const, visible: true, opacity: 1 } }] }
  }
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
  await addYoutubeCta(c, dur, { gtaBottom: !!layout.fullGame })
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
