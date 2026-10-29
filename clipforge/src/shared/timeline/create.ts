import type { Clip, ClipOrigin, ID, MediaAsset, Timeline } from '../types'
import { formatTime } from '../text'
import { newId, timelineDuration, TRACK_IDS } from './model'

export interface NewClipItem {
  trackId: ID
  clip: Clip
}

/**
 * Bir kaynak aralığından zaman çizelgesi klipleri üretir:
 *  - ekran görüntüsü (V1)
 *  - ses: oyun ve konuşma ayrı track'teyse A1 (oyun) + A2 (konuşma), değilse A1'de karışım
 *  - kamera (V2): ayrı dosya (senkron ofsetiyle) ya da tek dosyadaki kamera bölgesinin kırpması
 * Hepsi aynı `groupId`'yi paylaşır; taşıma/bölme/silme birlikte uygulanır. Kaynak zaman damgası `origin` içinde saklanır.
 */
export function clipItemsForSource(
  asset: MediaAsset,
  range: { start: number; end: number },
  at: number,
  origin: Pick<ClipOrigin, 'query' | 'resultId' | 'matchTime' | 'candidateId'> = {},
  camAsset?: MediaAsset
): NewClipItem[] {
  const group = newId('grp')
  const start = Math.max(0, range.start)
  const end = Math.min(asset.durationSec, range.end)
  const label = `${formatTime(start)} · ${origin.query ?? asset.name}`
  const base = { volume: 1, label, groupId: group, origin: { assetId: asset.id, sourceStart: start, sourceEnd: end, ...origin } }
  const items: NewClipItem[] = []

  if (asset.kind === 'video') {
    items.push({ trackId: TRACK_IDS.screen, clip: { ...base, id: newId('clip'), trackId: TRACK_IDS.screen, assetId: asset.id, start: at, srcIn: start, srcOut: end } })
  }

  const m = asset.audioMap
  if (asset.audioStreams.length > 0) {
    const split = m.game !== undefined && m.voice !== undefined && m.game !== m.voice && m.game < asset.audioStreams.length && m.voice < asset.audioStreams.length
    if (split) {
      items.push({ trackId: TRACK_IDS.game, clip: { ...base, id: newId('clip'), trackId: TRACK_IDS.game, assetId: asset.id, start: at, srcIn: start, srcOut: end, audioStream: m.game } })
      items.push({ trackId: TRACK_IDS.voice, clip: { ...base, id: newId('clip'), trackId: TRACK_IDS.voice, assetId: asset.id, start: at, srcIn: start, srcOut: end, audioStream: m.voice } })
    } else {
      items.push({ trackId: TRACK_IDS.game, clip: { ...base, id: newId('clip'), trackId: TRACK_IDS.game, assetId: asset.id, start: at, srcIn: start, srcOut: end, audioStream: Math.min(m.mix, asset.audioStreams.length - 1) } })
    }
  }

  if (camAsset) {
    const off = camAsset.syncOffsetSec ?? 0
    const s = Math.max(0, start + off)
    const e = Math.min(camAsset.durationSec, end + off)
    if (e - s > 0.1) items.push({ trackId: TRACK_IDS.webcam, clip: { ...base, id: newId('clip'), trackId: TRACK_IDS.webcam, assetId: camAsset.id, start: at + (s - (start + off)), srcIn: s, srcOut: e, label: `Kamera · ${label}` } })
  } else if (asset.webcamRegion && asset.kind === 'video') {
    items.push({ trackId: TRACK_IDS.webcam, clip: { ...base, id: newId('clip'), trackId: TRACK_IDS.webcam, assetId: asset.id, start: at, srcIn: start, srcOut: end, crop: asset.webcamRegion, label: `Kamera · ${label}` } })
  }
  return items
}

/** Yeni klibin varsayılan yerleşimi: mevcut içeriğin sonu */
export function appendPosition(tl: Timeline): number {
  return timelineDuration(tl)
}
