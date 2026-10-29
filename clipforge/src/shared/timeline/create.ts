import type { Clip, ClipOrigin, ID, MediaAsset, Timeline, Track } from '../types'
import { formatTime } from '../text'
import { newId, timelineDuration, TRACK_IDS } from './model'

export interface NewClipItem {
  trackId: ID
  clip: Clip
}

type Lookup = (id: ID) => MediaAsset | undefined

/**
 * Bir kaynak aralığından zaman çizelgesi klipleri üretir:
 *  - ekran görüntüsü (V1) ve kamera (V2; ayrı dosya, senkron ofsetiyle ya da tek dosyadaki bölgenin kırpması)
 *  - oyun sesi (A1) ve konuşma (A2): aynı dosyada ayrı track'lerdeyse bölünür, ayrı dosyalarsa o dosyalardan alınır
 * `asset.sources` ile bağlanan ayrı dosyalar AYNI zaman aralığında, kendi `syncOffsetSec` ofsetleriyle eklenir.
 * Hepsi aynı `groupId`'yi paylaşır; kaynak zaman damgası `origin` içinde saklanır.
 * Beşinci parametre: bağlı dosyaları bulmak için arama işlevi (ya da eski kullanım: doğrudan kamera dosyası).
 */
export function clipItemsForSource(
  asset: MediaAsset,
  range: { start: number; end: number },
  at: number,
  origin: Pick<ClipOrigin, 'query' | 'resultId' | 'matchTime' | 'candidateId'> = {},
  camOrLookup?: MediaAsset | Lookup
): NewClipItem[] {
  const lookup: Lookup | undefined = typeof camOrLookup === 'function' ? camOrLookup : undefined
  const src = asset.sources ?? {}
  const find = (id?: ID) => (id && lookup ? lookup(id) : undefined)
  const camAsset = (typeof camOrLookup === 'object' ? camOrLookup : undefined) ?? find(src.cam ?? asset.webcamAssetId)
  const screenAsset = find(src.screen)
  const gameAsset = find(src.game)
  const voiceAsset = find(src.voice)

  const group = newId('grp')
  const start = Math.max(0, range.start)
  const end = Math.min(asset.durationSec, range.end)
  const label = `${formatTime(start)} · ${origin.query ?? asset.name}`
  const base = { volume: 1, label, groupId: group, origin: { assetId: asset.id, sourceStart: start, sourceEnd: end, ...origin } }
  const items: NewClipItem[] = []

  /** Birincil dosya zamanındaki [start, end] aralığını, `a` dosyasının zamanına (ofsetle) çevirir; sığmazsa null */
  const place = (a: MediaAsset): { start: number; srcIn: number; srcOut: number } | null => {
    const off = a.id === asset.id ? 0 : (a.syncOffsetSec ?? 0)
    let s = start + off
    const e = Math.min(a.durationSec || Infinity, end + off)
    let lead = 0
    if (s < 0) (lead = -s, (s = 0))
    return e - s > 0.1 ? { start: at + lead, srcIn: s, srcOut: e } : null
  }
  const push = (trackId: ID, a: MediaAsset, extra: Partial<Clip> = {}, lbl?: string) => {
    const p = place(a)
    if (p) items.push({ trackId, clip: { ...base, id: newId('clip'), trackId, assetId: a.id, ...p, ...extra, label: lbl ?? label } })
  }

  // ── görüntü
  const screenSrc = screenAsset ?? (asset.kind === 'video' && asset.role !== 'cam' ? asset : undefined)
  if (screenSrc?.kind === 'video') push(TRACK_IDS.screen, screenSrc)
  if (asset.kind === 'video' && asset.role === 'cam' && !camAsset) push(TRACK_IDS.webcam, asset, {}, `Kamera · ${label}`)
  if (camAsset?.kind === 'video') push(TRACK_IDS.webcam, camAsset, {}, `Kamera · ${label}`)
  else if (!camAsset && asset.webcamRegion && asset.kind === 'video' && asset.role !== 'cam') push(TRACK_IDS.webcam, asset, { crop: asset.webcamRegion }, `Kamera · ${label}`)

  // ── ses
  const audioOf = (a: MediaAsset, stream: number) => (a.audioStreams.length > 0 ? Math.min(stream, a.audioStreams.length - 1) : -1)
  const m = asset.audioMap
  const n = asset.audioStreams.length
  if (gameAsset) {
    const st = audioOf(gameAsset, gameAsset.audioMap.mix)
    if (st >= 0) push(TRACK_IDS.game, gameAsset, { audioStream: st })
  }
  if (voiceAsset) {
    const st = audioOf(voiceAsset, voiceAsset.audioMap.mix)
    if (st >= 0) push(TRACK_IDS.voice, voiceAsset, { audioStream: st })
  }
  if (n > 0 && asset.role !== 'cam') {
    const split = m.game !== undefined && m.voice !== undefined && m.game !== m.voice && m.game < n && m.voice < n
    if (split) {
      if (!gameAsset) push(TRACK_IDS.game, asset, { audioStream: m.game })
      if (!voiceAsset) push(TRACK_IDS.voice, asset, { audioStream: m.voice })
    } else {
      // tek karışım: dosyanın rolü ses izini belirler (konuşma kaydı → A2; aksi halde A1)
      // rol belirtilmemiş SADECE-SES dosyası başka kaynaklara (ekran/oyun sesi) bağlıysa konuşma kaydı sayılır
      const looksVoice = asset.role === 'voice' || (!asset.role && asset.kind === 'audio' && !!(src.screen || src.game || src.cam))
      const track = looksVoice ? TRACK_IDS.voice : TRACK_IDS.game
      const overridden = track === TRACK_IDS.voice ? !!voiceAsset : !!gameAsset
      if (!overridden) push(track, asset, { audioStream: Math.min(m.mix, n - 1) })
    }
  }
  return items
}

/**
 * Bir kaynak dosyadan, belirli bir ize konacak tek klip. Uyumsuzsa neden döner.
 *  - video izi: video; görsel izi: görsel (süre `duration`); ses izi: ses akışı olan her dosya.
 */
export function clipForTrack(
  asset: MediaAsset,
  track: Pick<Track, 'id' | 'kind' | 'role'>,
  opts: { at: number; srcIn?: number; duration?: number; audioStream?: number }
): { clip: Clip } | { error: string } {
  const srcIn = Math.max(0, opts.srcIn ?? 0)
  const common = { id: newId('clip'), trackId: track.id, assetId: asset.id, start: Math.max(0, opts.at), volume: 1, label: asset.name }
  if (track.kind === 'image') {
    if (asset.kind !== 'image') return { error: 'Görsel katmanına yalnızca görsel dosyası (PNG, JPG, WEBP) eklenebilir.' }
    return { clip: { ...common, srcIn: 0, srcOut: Math.max(0.5, opts.duration ?? 8) } }
  }
  if (track.kind === 'video') {
    if (asset.kind !== 'video') return { error: 'Video katmanına yalnızca video dosyası eklenebilir.' }
    const out = Math.min(asset.durationSec, srcIn + (opts.duration ?? asset.durationSec - srcIn))
    if (out - srcIn < 0.1) return { error: 'Seçilen başlangıç dosyanın süresini aşıyor.' }
    return { clip: { ...common, srcIn, srcOut: out } }
  }
  if (track.kind === 'audio') {
    if (asset.audioStreams.length === 0) return { error: 'Bu dosyada ses akışı yok.' }
    const st = Math.min(opts.audioStream ?? (track.role === 'game' && asset.audioMap.game !== undefined ? asset.audioMap.game : track.role === 'voice' && asset.audioMap.voice !== undefined ? asset.audioMap.voice : asset.audioMap.mix), asset.audioStreams.length - 1)
    const out = Math.min(asset.durationSec, srcIn + (opts.duration ?? asset.durationSec - srcIn))
    if (out - srcIn < 0.1) return { error: 'Seçilen başlangıç dosyanın süresini aşıyor.' }
    return { clip: { ...common, srcIn, srcOut: out, audioStream: st } }
  }
  return { error: 'Bu ize dosya eklenemez.' }
}

/** Yeni klibin varsayılan yerleşimi: mevcut içeriğin sonu */
export function appendPosition(tl: Timeline): number {
  return timelineDuration(tl)
}

/**
 * Bir videoyu video katmanına eklerken SESİNİ de ekler (aksi halde video katmanı sessiz kalır):
 * görüntü + ses aynı grupta; ses, dosyanın rolüne göre konuşma (A2) ya da oyun sesi (A1) izine gider.
 * Videoda ses akışı yoksa yalnızca görüntü döner.
 */
export function clipsForVideoWithAudio(
  asset: MediaAsset,
  videoTrack: Pick<Track, 'id' | 'kind' | 'role'>,
  audioTracks: Pick<Track, 'id' | 'kind' | 'role'>[],
  opts: { at: number; srcIn?: number; duration?: number; withAudio?: boolean }
): { items: NewClipItem[] } | { error: string } {
  if (videoTrack.kind !== 'video') return { error: 'Bu işlev yalnızca video katmanı içindir.' }
  const v = clipForTrack(asset, videoTrack, opts)
  if ('error' in v) return v
  const group = newId('grp')
  const items: NewClipItem[] = [{ trackId: videoTrack.id, clip: { ...v.clip, groupId: group } }]
  if (opts.withAudio !== false && asset.audioStreams.length > 0) {
    const want = asset.role === 'voice' ? 'voice' : 'game'
    const target = audioTracks.find((t) => t.kind === 'audio' && t.role === want) ?? audioTracks.find((t) => t.kind === 'audio')
    if (target) {
      const a = clipForTrack(asset, target, { at: opts.at, srcIn: opts.srcIn, duration: opts.duration, audioStream: asset.audioMap.mix })
      if (!('error' in a)) items.push({ trackId: target.id, clip: { ...a.clip, groupId: group } })
    }
  }
  return { items }
}
