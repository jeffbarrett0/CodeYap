import type { Caption, CaptionStyle, Clip, ID, LayoutPreset, AspectRatio, LayoutTemplate, NormRect, Placement, TextSpec, Timeline, TrackKind, TrackRole } from '../types'
import { applyTemplate } from './templates'
import { assignHighlights } from './captionStyles'
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
  remove: (clipId: ID, ripple = false, single = false): TimelineCommand => makeCommand('Sil', (t) => ops.deleteClip(t, clipId, ripple, single)),
  /** Birden çok klibi TEK geri alma adımında siler (kilitli izler atlanır) */
  removeMany: (ids: ID[], single = true, label = 'Toplu sil'): TimelineCommand => makeCommand(label, (t) => ids.reduce((acc, id) => ops.deleteClip(acc, id, false, single), t)),
  updateClip: (clipId: ID, patch: Partial<Clip>, coalesce = false): TimelineCommand =>
    makeCommand('Klip özelliği', (t) => ops.updateClip(t, clipId, patch), coalesce ? `upd:${clipId}:${Object.keys(patch).join(',')}` : undefined),
  track: (trackId: ID, patch: Parameters<typeof ops.updateTrack>[2], coalesce = false): TimelineCommand =>
    makeCommand('İz ayarı', (t) => ops.updateTrack(t, trackId, patch), coalesce ? `trk:${trackId}:${Object.keys(patch).join(',')}` : undefined),
  captions: (captions: Caption[]): TimelineCommand => makeCommand('Altyazıları güncelle', (t) => ops.setCaptions(t, captions)),
  /** Altyazı dilini değiştirir (özgün/İngilizce…) */
  captionLang: (lang: string): TimelineCommand => makeCommand(lang === 'orig' ? 'Altyazı dili: özgün' : `Altyazı dili: ${lang}`, (t) => ({ ...t, captionLang: lang === 'orig' ? undefined : lang })),
  /** Çevirileri ekler (id → metin) ve dili açar; çevirinin vurgusu stile göre atanır. Tek geri alma adımı. */
  captionTranslations: (lang: string, texts: Record<ID, string>): TimelineCommand =>
    makeCommand(`Altyazı çevirisi (${lang})`, (t) => {
      const withTr = t.captions.map((c) => (texts[c.id] ? { ...c, tr: { ...c.tr, [lang]: { text: texts[c.id] } } } : c))
      return { ...t, captions: assignHighlights(withTr, t.captionStyle), captionLang: lang }
    }),
  /** Seçili dildeki altyazı metnini düzenler: özgün dilde `text`, çeviri dilinde `tr[lang].text` */
  captionText: (id: ID, text: string, lang?: string): TimelineCommand =>
    makeCommand('Altyazı metni', (t) => {
      const cs = t.captions.map((c) => (c.id !== id ? c : !lang || lang === 'orig' ? { ...c, text } : { ...c, tr: { ...c.tr, [lang]: { text } } }))
      return { ...t, captions: assignHighlights(cs, t.captionStyle) }
    }, `ctext:${id}:${lang ?? 'orig'}`),
  captionStyle: (patch: Partial<CaptionStyle>, coalesce = true): TimelineCommand =>
    makeCommand('Altyazı stili', (t) => ({ ...t, captionStyle: { ...t.captionStyle, ...patch } }), coalesce ? `cap:${Object.keys(patch).join(',')}` : undefined),
  /** Stili topluca değiştirir; altyazı satırları verilirse onlarla değişir, verilmezse yalnızca vurguları yeniden atanır (tek geri alma adımı) */
  captionPreset: (style: CaptionStyle, captions?: Caption[], label = 'Altyazı stili'): TimelineCommand =>
    makeCommand(label, (t) => ({ ...t, captionStyle: style, captions: captions ?? assignHighlights(t.captions, style) })),
  captionPos: (id: ID, pos: { x: number; y: number } | undefined, coalesce = true): TimelineCommand =>
    makeCommand('Altyazı konumu', (t) => ops.setCaptionPos(t, id, pos), coalesce ? `cpos:${id}` : undefined),
  /** Altyazı boyutu/konumu (köşe ve kenar tutamaçlarıyla sürüklerken tek geri alma adımında birleşir) */
  captionBox: (id: ID, patch: { scale?: number | null; pos?: { x: number; y: number } }, coalesce = true): TimelineCommand =>
    makeCommand('Altyazı boyutu', (t) => ops.setCaptionBox(t, id, patch), coalesce ? `cbox:${id}` : undefined),
  allCaptionScale: (scale: number | null): TimelineCommand => makeCommand('Tüm altyazı boyutu', (t) => ops.setAllCaptionScale(t, scale)),
  allCaptionPos: (pos: { x: number; y: number } | undefined): TimelineCommand => makeCommand('Tüm altyazı konumu', (t) => ops.setAllCaptionPos(t, pos)),
  /** Elle oran seçimi: otomatik oran kapanır */
  aspect: (aspect: AspectRatio): TimelineCommand => makeCommand('En-boy oranı', (t) => ({ ...t, aspect, aspectAuto: false })),
  /** Otomatik oranı aç/kapat; `aspect` verilirse (videodan hesaplanan) uygulanır */
  aspectAuto: (auto: boolean, aspect?: AspectRatio): TimelineCommand => makeCommand(auto ? 'Otomatik oran' : 'Oranı sabitle', (t) => ({ ...t, aspectAuto: auto, ...(aspect ? { aspect } : {}) })),
  layout: (layout: LayoutPreset): TimelineCommand => makeCommand('Düzen', (t) => ({ ...t, layout })),
  webcamOverlay: (r: NormRect): TimelineCommand => makeCommand('Kamera konumu', (t) => ({ ...t, webcamOverlay: r }), 'webcam'),
  replace: (label: string, next: Timeline): TimelineCommand => makeCommand(label, () => next),
  placement: (trackId: ID, patch: Partial<Placement>, coalesce = true): TimelineCommand =>
    makeCommand('Katman konumu', (t) => ops.setPlacement(t, trackId, patch), coalesce ? `pl:${trackId}:${Object.keys(patch).join(',')}` : undefined),
  addTrack: (spec: { id?: ID; name: string; kind: Exclude<TrackKind, 'caption'>; role: TrackRole; placement?: Placement; textDefault?: TextSpec }): TimelineCommand =>
    makeCommand('Katman ekle', (t) => ops.addTrack(t, spec)),
  removeTrack: (trackId: ID): TimelineCommand => makeCommand('Katmanı sil', (t) => ops.removeTrack(t, trackId)),
  moveTrack: (trackId: ID, dir: 'up' | 'down'): TimelineCommand => makeCommand('Katman sırası', (t) => ops.moveTrackOrder(t, trackId, dir)),
  applyTemplate: (tpl: LayoutTemplate): TimelineCommand => makeCommand('Şablon uygula', (t) => ({ ...ops.fillTextTracks(applyTemplate(t, tpl)), aspectAuto: false })), // şablonun kendi oranı geçerli olur
  fillText: (): TimelineCommand => makeCommand('Metin katmanlarını doldur', (t) => ops.fillTextTracks(t)),
  extendToEnd: (clipId: ID): TimelineCommand => makeCommand('Sona kadar uzat', (t) => ops.extendToEnd(t, clipId)),
  cutRange: (a: number, b: number, ripple = true): TimelineCommand => makeCommand('Aralığı kes', (t) => ops.cutRange(t, a, b, ripple)),
  cutRanges: (ranges: [number, number][], label = 'Sessizlikleri kes'): TimelineCommand => makeCommand(label, (t) => ops.cutRanges(t, ranges)),
  join: (clipId: ID): TimelineCommand => makeCommand('Birleştir', (t) => ops.joinWithNext(t, clipId)),
  closeGaps: (): TimelineCommand => makeCommand('Boşlukları kapat', (t) => ops.closeGaps(t)),
  updateTrackText: (trackId: ID, spec: TextSpec): TimelineCommand => makeCommand('Varsayılan metin', (t) => ops.updateTrack(t, trackId, { textDefault: spec }), `tdef:${trackId}`),
  textSpec: (clipId: ID, patch: Partial<TextSpec>): TimelineCommand =>
    makeCommand('Metin', (t) => {
      const f = t.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId)
      return f?.text ? ops.updateClip(t, clipId, { text: { ...f.text, ...patch }, label: (patch.text ?? f.text.text).split('\n')[0].slice(0, 40) || 'Metin' }) : t
    }, `txt:${clipId}:${Object.keys(patch).join(',')}`)
}
