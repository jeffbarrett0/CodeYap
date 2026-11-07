import { join } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { DEFAULT_SCENE, type SceneSpec } from '../../shared/graphics/scenes'
import { cmd } from '../../shared/timeline/commands'
import { clipForTrack, clipsForVideoWithAudio } from '../../shared/timeline/create'
import { aspectSize, clipEnd, newId, timelineDuration } from '../../shared/timeline/model'
import { cutRange } from '../../shared/timeline/ops'
import { timelineWords } from '../../shared/timeline/transcript'
import { DEFAULT_TRAILER_OPTIONS, planShots, validateSegments, type TrailerRequest, type TrailerResult, type TrailerSegment, type TrailerShot } from '../../shared/trailer'
import type { Clip, MediaAsset, Timeline, TranscriptWord } from '../../shared/types'
import { loadWorld, renderScene } from '../graphics/render'
import { renderSfx } from '../sfx'

type Env = { userDataDir?: string; resourcesDir?: string }

/** Zaman çizelgesinin [a,b] aralığındaki klipler (tüm izler), 0'dan başlayacak biçimde */
function sliceClips(tl: Timeline, a: number, b: number): Clip[] {
  const total = timelineDuration(tl)
  let t = tl
  if (b < total - 1e-3) t = cutRange(t, b, total, true)
  if (a > 1e-3) t = cutRange(t, 0, a, true)
  return t.tracks.filter((x) => x.kind === 'video' || x.kind === 'audio' || x.kind === 'image').flatMap((x) => x.clips)
}

/**
 * FRAGMAN: vlogdan seçilen 10–60 sn'lik parçalardan hızlı kurgulu, kancalı, kapanış kartlı ayrı bir proje üretir (ana proje değişmez):
 * en güçlü anlar kısa planlara kesilir (en iyisi başa), her planda hafif yakınlaşma/uzaklaşma, kesimlerde "whoosh", sonda "boom" + başlık kartı,
 * açılışta/kapanışta ses+görüntü geçişi. Konuşma sesi her planda aynen kalır.
 */
export async function buildTrailer(req: TrailerRequest, env: Env = {}): Promise<TrailerResult> {
  const problem = validateSegments(req.segments)
  if (problem) throw new Error(problem)
  const service = await makeService(env)
  const src = await Session.open(req.projectPath, service)
  const tl = src.timeline
  const transcripts = src.transcripts
  const total = timelineDuration(tl)
  const allWords = timelineWords(tl, transcripts)
  for (const s of req.segments) {
    if (s.kind === 'timeline' && (s.start < 0 || s.end > total + 0.5)) throw new Error(`Parça ${s.start.toFixed(1)}–${s.end.toFixed(1)} sn zaman çizelgesinin (${total.toFixed(1)} sn) dışında.`)
    if (s.kind === 'asset' && !src.project.assets.find((a) => a.id === s.assetId)) throw new Error('Parçanın kaynak videosu projede bulunamadı.')
  }
  const wordsFor = (s: TrailerSegment): TranscriptWord[] =>
    s.kind === 'timeline'
      ? allWords.filter((w) => w.end > s.start && w.start < s.end).map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence }))
      : (transcripts[s.assetId as string]?.words ?? []).filter((w) => w.end > s.start && w.start < s.end)
  const opts = { ...DEFAULT_TRAILER_OPTIONS, targetSec: req.targetSec ?? DEFAULT_TRAILER_OPTIONS.targetSec, endCardSec: req.title?.trim() ? DEFAULT_TRAILER_OPTIONS.endCardSec : 0 }
  const shots = planShots(req.segments, wordsFor, opts)
  if (shots.length === 0) throw new Error('Seçilen parçalardan fragman planı çıkarılamadı.')

  // yeni proje (kaynak değişmez)
  const projName = `${src.project.name} · fragman`
  const created = await service.createTrailerProject(src.project, projName)
  const c = await Session.open(created.path, service)
  const base: Timeline = { ...tl, tracks: tl.tracks.map((t) => ({ ...t, clips: [] })), captions: [] }
  const mainTrack = [...tl.tracks].reverse().find((t) => t.kind === 'video') // en alttaki görüntü katmanı: ana görüntü
  const videoTrack = tl.tracks.find((t) => t.kind === 'video')
  const audioTracks = tl.tracks.filter((t) => t.kind === 'audio')
  const placed: Clip[] = []
  let cursor = 0
  const shotStarts: number[] = []
  for (const [i, sh] of shots.entries()) {
    const dur = sh.b - sh.a
    shotStarts.push(cursor)
    let clips: Clip[] = []
    if (sh.kind === 'timeline') {
      const g = `.t${i}`
      clips = sliceClips(tl, sh.a, sh.b).map((k) => ({ ...k, id: newId('clip'), start: k.start + cursor, groupId: k.groupId ? `${k.groupId}${g}` : undefined }))
    } else {
      const asset = src.project.assets.find((a) => a.id === sh.assetId) as MediaAsset
      if (!videoTrack) throw new Error('Projede video katmanı yok.')
      const r = clipsForVideoWithAudio(asset, videoTrack, audioTracks, { at: cursor, srcIn: sh.a, duration: dur })
      if ('error' in r) throw new Error(r.error)
      clips = r.items.map((it) => ({ ...it.clip, trackId: it.trackId }))
    }
    // hafif hareket: tek sayılı planlar yaklaşır, çift sayılılar uzaklaşır; ana görüntü katmanına
    for (const k of clips) {
      const isMain = !!mainTrack && k.trackId === mainTrack.id
      const tr = tl.tracks.find((t) => t.id === k.trackId)
      if (isMain && tr?.kind === 'video') k.fx = { ...k.fx, zoom: i % 2 === 0 ? { from: 1, to: 1.12, x: 0.5, y: 0.45 } : { from: 1.12, to: 1, x: 0.5, y: 0.45 } }
      if (tr?.kind === 'audio' || (tr?.kind === 'video' && k.audioStream !== undefined)) k.fx = { ...k.fx, fadeIn: i === 0 ? 0.5 : 0.04, fadeOut: 0.06 }
      if (i === 0 && isMain) k.fx = { ...k.fx, fadeIn: 0.5 }
    }
    placed.push(...clips)
    cursor += dur
  }
  let tlOut: Timeline = { ...base, tracks: base.tracks.map((t) => ({ ...t, clips: placed.filter((k) => k.trackId === t.id).sort((x, y) => x.start - y.start) })) }
  c.project = { ...c.project, timeline: tlOut }

  // kapanış kartı (başlık) + efektler
  const dataDir = join(`${created.path}-data`)
  const importOne = async (file: string): Promise<MediaAsset> => {
    const known = new Set(c.project.assets.map((a) => a.id))
    for (const id of c.service.importMedia([file])) await waitTask(c.service, id, 'Fragman medyası')
    const added = [...c.service.assets.values()].find((a) => !known.has(a.id) && a.path === file)
    if (!added) throw new Error(`İçe aktarılamadı: ${file}`)
    c.project = { ...c.project, assets: [...c.project.assets, added] }
    return added
  }
  const ff = c.service.tools.ffmpeg
  const endAt = cursor
  if (opts.endCardSec > 0 && req.title?.trim()) {
    const world = await loadWorld(c.service.deps.resourcesDir)
    const size = aspectSize(c.timeline.aspect)
    const spec: SceneSpec = { ...DEFAULT_SCENE, ...size, durationSec: opts.endCardSec, type: 'title', text: req.title.trim(), sub: req.subtitle?.trim() || undefined }
    const cardFile = join(dataDir, 'fragman', 'kapanis-karti.mp4')
    await renderScene(spec, world, ff, cardFile)
    const card = await importOne(cardFile)
    const top = c.timeline.tracks.find((t) => t.kind === 'video' && !t.clips.some((k) => k.start < endAt + opts.endCardSec && endAt < clipEnd(k)))
    if (top) {
      const r = clipForTrack(card, top, { at: endAt, duration: opts.endCardSec })
      if (!('error' in r)) c.apply(cmd.addClip(top.id, { ...r.clip, label: 'Kapanış kartı', fx: { fadeIn: 0.35, fadeOut: 0.8 } }))
    }
  }
  // ses efektleri: her kesimde whoosh (ilk plan hariç), kapanışta boom
  const sfxDir = join(dataDir, 'sfx')
  const addSfx = async (type: string, at: number, track: string, vol: number) => {
    if (!c.timeline.tracks.some((t) => t.id === track)) c.apply(cmd.addTrack({ id: track, name: 'Ses efektleri', kind: 'audio', role: 'mix' }))
    const asset = c.project.assets.find((a) => a.name === `${type}.wav`) ?? (await importOne(await renderSfx(ff, type, sfxDir)))
    const tr = c.timeline.tracks.find((t) => t.id === track)!
    const r = clipForTrack(asset, tr, { at: Math.max(0, at), duration: asset.durationSec })
    if (!('error' in r) && !tr.clips.some((k) => k.start < r.clip.start + asset.durationSec && r.clip.start < clipEnd(k))) c.apply(cmd.addClip(track, { ...r.clip, label: `Efekt: ${type}`, volume: vol }))
  }
  for (const [i, st] of shotStarts.entries()) if (i > 0) await addSfx('whoosh', st - 0.25, 'SFX', 0.5)
  if (opts.endCardSec > 0 && req.title?.trim()) await addSfx('boom', endAt - 0.05, 'SFX2', 0.7)
  await c.save()
  return { projectPath: created.path, durationSec: timelineDuration(c.timeline), shots: shots.map((s: TrailerShot) => ({ segmentId: s.segmentId, a: s.a, b: s.b, text: s.text })) }
}
