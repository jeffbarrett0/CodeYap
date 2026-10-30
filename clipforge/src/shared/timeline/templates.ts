import type { AspectRatio, LayoutTemplate, Placement, Timeline, Track } from '../types'

const P = (x: number, y: number, w: number, h: number, fit: Placement['fit'] = 'cover', visible = true): Placement => ({ rect: { x, y, w, h }, fit, visible, opacity: 1 })

/**
 * Varsayılan şablon: Video 1-3 ve Fotoğraf 1-2 katmanları (hepsi tam kare, içerik yok → boş katman çizilmez), tek Ses izi ve Altyazı.
 * Kendiliğinden hiçbir içerik eklenmez; konumlar Katmanlar panelinden ayarlanır. Oran da başta dayatılmaz: ilk video eklenince videonun boyutuna göre ayarlanır.
 */
export const DEFAULT_TEMPLATE: LayoutTemplate = {
  id: 'default-video',
  name: 'Video 1-3 + Fotoğraf 1-2',
  builtin: true,
  aspect: '16:9',
  background: '#000000',
  layers: [
    { id: 'V1', name: 'Video 1', kind: 'video', role: 'screen', placement: P(0, 0, 1, 1, 'contain') },
    { id: 'V2', name: 'Video 2', kind: 'video', role: 'screen', placement: P(0, 0, 1, 1, 'contain') },
    { id: 'V3', name: 'Video 3', kind: 'video', role: 'screen', placement: P(0, 0, 1, 1, 'contain') },
    { id: 'I1', name: 'Fotoğraf 1', kind: 'image', role: 'image', placement: P(0, 0, 1, 1, 'contain') },
    { id: 'I2', name: 'Fotoğraf 2', kind: 'image', role: 'image', placement: P(0, 0, 1, 1, 'contain') }
  ]
}

export const BUILTIN_TEMPLATES: LayoutTemplate[] = [
  DEFAULT_TEMPLATE,
  {
    id: 'game-center-cam-bottom',
    name: 'Oyun ortada · kamera altta (9:16)',
    builtin: true,
    aspect: '9:16',
    background: '#0b0b0b',
    layers: [
      { id: 'V2', name: 'Yüz (webcam)', kind: 'video', role: 'webcam', placement: P(0.05, 0.675, 0.9, 0.3) },
      { id: 'V1', name: 'Oyun ekranı', kind: 'video', role: 'screen', placement: P(0, 0.3418, 1, 0.3164, 'contain') }
    ]
  },
  {
    id: 'game-center-cam-top',
    name: 'Oyun ortada · kamera üstte (9:16)',
    builtin: true,
    aspect: '9:16',
    background: '#0b0b0b',
    layers: [
      { id: 'V2', name: 'Yüz (webcam)', kind: 'video', role: 'webcam', placement: P(0.05, 0.025, 0.9, 0.3) },
      { id: 'V1', name: 'Oyun ekranı', kind: 'video', role: 'screen', placement: P(0, 0.3418, 1, 0.3164, 'contain') }
    ]
  },
  {
    id: 'fullscreen-corner-cam',
    name: 'Tam kare oyun + köşe kamera (16:9)',
    builtin: true,
    aspect: '16:9',
    background: '#000000',
    layers: [
      { id: 'V2', name: 'Yüz (webcam)', kind: 'video', role: 'webcam', placement: P(0.72, 0.04, 0.26, 0.26) },
      { id: 'V1', name: 'Oyun ekranı', kind: 'video', role: 'screen', placement: P(0, 0, 1, 1) }
    ]
  }
]

export const AUDIO_TRACKS = (): Track[] => [
  { id: 'A1', name: 'Ses', kind: 'audio', role: 'game', clips: [], muted: false, locked: false, volume: 1 }
]

/**
 * Eski projeleri yeni adlara taşır: "Oyun sesi" → "Ses"; BOŞ "Konuşma" izi kaldırılır (kliplı izler veri kaybı olmasın diye korunur).
 */
export function normalizeTracks(tl: Timeline): Timeline {
  const tracks = tl.tracks
    .filter((t) => !(t.id === 'A2' && t.kind === 'audio' && t.clips.length === 0))
    .map((t) => (t.id === 'A1' && t.kind === 'audio' && t.name === 'Oyun sesi' ? { ...t, name: 'Ses' } : t.id === 'A2' && t.name === 'Konuşma' ? { ...t, name: 'Ses 2' } : t))
  return tracks.length === tl.tracks.length && tracks.every((t, i) => t === tl.tracks[i]) ? tl : { ...tl, tracks }
}

/**
 * Şablonu zaman çizelgesine uygular: eşleşen iz kimliklerinin konumunu günceller, eksik katmanları ekler,
 * Katmanlar şablon sırasında en üste dizilir; şablonda olmayan (kullanıcının eklediği) görsel katmanlar altlarında kalır.
 * Klipler korunur. Kare oranı ve arka plan şablondan gelir.
 */
export function applyTemplate(tl: Timeline, tpl: LayoutTemplate): Timeline {
  const byId = new Map(tl.tracks.map((t) => [t.id, t]))
  const layerTracks: Track[] = tpl.layers.map((l) => {
    const ex = byId.get(l.id)
    return {
      id: l.id,
      name: l.name,
      kind: ex?.kind ?? l.kind,
      role: ex?.role ?? l.role,
      clips: ex?.clips ?? [],
      muted: false,
      locked: ex?.locked ?? false,
      volume: ex?.volume ?? 1,
      placement: { ...l.placement, rect: { ...l.placement.rect } },
      textDefault: l.textDefault ? { ...l.textDefault } : ex?.textDefault
    }
  })
  const inTpl = new Set(tpl.layers.map((l) => l.id))
  const visualKinds = new Set(['video', 'image', 'text'])
  // Şablonda olmayan görsel katmanlar (kullanıcının eklediği) şablon katmanlarının altında kalır
  // Eski (v1) projelerden gelen, konumu olmayan görsel izler (ör. oyun ekranı V1) görünür bir varsayılan yer alır
  const extraVisual = tl.tracks
    .filter((t) => visualKinds.has(t.kind) && !inTpl.has(t.id))
    .map((t) => (t.placement ? t : { ...t, placement: { rect: { x: 0, y: 0.415, w: 1, h: 0.585 }, fit: 'contain' as const, visible: true, opacity: 1 } }))
  const rest = tl.tracks.filter((t) => !visualKinds.has(t.kind))
  return { ...tl, aspect: tpl.aspect, aspectAuto: tl.aspectAuto, background: tpl.background, tracks: [...layerTracks, ...extraVisual, ...rest] }
}

/** Mevcut katman düzenini (konumlar, görünürlük, metin biçimi) şablon olarak yakalar. */
export function templateFromTimeline(tl: Timeline, id: string, name: string): LayoutTemplate {
  const layers = tl.tracks
    .filter((t) => t.kind === 'video' || t.kind === 'image' || t.kind === 'text')
    .map((t) => {
      const firstText = t.clips.find((c) => c.text)?.text
      return {
        id: t.id,
        name: t.name,
        kind: t.kind as 'video' | 'image' | 'text',
        role: t.role,
        placement: { ...(t.placement ?? P(0, 0, 1, 1)), rect: { ...(t.placement?.rect ?? { x: 0, y: 0, w: 1, h: 1 }) } },
        textDefault: firstText ? { ...firstText } : t.textDefault ? { ...t.textDefault } : undefined
      }
    })
  return { id, name, aspect: tl.aspect as AspectRatio, background: tl.background ?? '#000000', layers }
}
