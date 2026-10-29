import type { Caption, CaptionStyle, Clip, ID, LayoutPreset, AspectRatio, NormRect, Timeline } from '../types'
import { makeCommand, type Command } from './history'
import * as ops from './ops'

/** Zaman çizelgesi komutları (UI bunları History üzerinden çalıştırır). */
export type TimelineCommand = Command<Timeline>

export const cmd = {
  addClip: (trackId: ID, clip: Clip): TimelineCommand => makeCommand('Klip ekle', (t) => ops.addClip(t, trackId, clip)),
  addClips: (items: { trackId: ID; clip: Clip }[], label = 'Klip oluştur'): TimelineCommand =>
    makeCommand(label, (t) => items.reduce((acc, it) => ops.addClip(acc, it.trackId, it.clip), t)),
  move: (clipId: ID, start: number, trackId?: ID): TimelineCommand =>
    makeCommand('Klibi taşı', (t) => ops.moveClip(t, clipId, start, trackId), `move:${clipId}`),
  trimStart: (clipId: ID, start: number): TimelineCommand => makeCommand('Başlangıcı kırp', (t) => ops.trimStart(t, clipId, start), `trimS:${clipId}`),
  trimEnd: (clipId: ID, end: number, srcDur?: (c: Clip) => number): TimelineCommand =>
    makeCommand('Bitişi kırp', (t) => ops.trimEnd(t, clipId, end, srcDur), `trimE:${clipId}`),
  split: (clipId: ID, time: number): TimelineCommand => makeCommand('Böl', (t) => ops.splitClip(t, clipId, time)),
  remove: (clipId: ID, ripple = false): TimelineCommand => makeCommand('Sil', (t) => ops.deleteClip(t, clipId, ripple)),
  updateClip: (clipId: ID, patch: Partial<Clip>, coalesce = false): TimelineCommand =>
    makeCommand('Klip özelliği', (t) => ops.updateClip(t, clipId, patch), coalesce ? `upd:${clipId}:${Object.keys(patch).join(',')}` : undefined),
  track: (trackId: ID, patch: Parameters<typeof ops.updateTrack>[2], coalesce = false): TimelineCommand =>
    makeCommand('İz ayarı', (t) => ops.updateTrack(t, trackId, patch), coalesce ? `trk:${trackId}:${Object.keys(patch).join(',')}` : undefined),
  captions: (captions: Caption[]): TimelineCommand => makeCommand('Altyazıları güncelle', (t) => ops.setCaptions(t, captions)),
  captionStyle: (patch: Partial<CaptionStyle>, coalesce = true): TimelineCommand =>
    makeCommand('Altyazı stili', (t) => ({ ...t, captionStyle: { ...t.captionStyle, ...patch } }), coalesce ? `cap:${Object.keys(patch).join(',')}` : undefined),
  aspect: (aspect: AspectRatio): TimelineCommand => makeCommand('En-boy oranı', (t) => ({ ...t, aspect })),
  layout: (layout: LayoutPreset): TimelineCommand => makeCommand('Düzen', (t) => ({ ...t, layout })),
  webcamOverlay: (r: NormRect): TimelineCommand => makeCommand('Kamera konumu', (t) => ({ ...t, webcamOverlay: r }), 'webcam'),
  replace: (label: string, next: Timeline): TimelineCommand => makeCommand(label, () => next)
}
