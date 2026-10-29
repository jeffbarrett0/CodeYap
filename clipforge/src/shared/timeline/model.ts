import type { AspectRatio, CaptionStyle, Clip, ID, Timeline, Track } from '../types'
import { applyTemplate, AUDIO_TRACKS, DEFAULT_TEMPLATE } from './templates'

let counter = 0
/** Çakışmasız, serileştirilebilir kimlik. */
export function newId(prefix = 'id'): ID {
  counter = (counter + 1) % 1e9
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  enabled: true,
  fontFamily: 'Arial',
  fontSize: 64,
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 4,
  bold: true,
  positionY: 0.3,
  uppercase: false,
  maxCharsPerLine: 22
}

export const TRACK_IDS = { screen: 'V1', webcam: 'V2', image: 'I1', game: 'A1', voice: 'A2' } as const

export function createDefaultTimeline(): Timeline {
  const base: Timeline = {
    fps: 30,
    aspect: '9:16',
    layout: 'game-center-cam-bottom',
    tracks: AUDIO_TRACKS(),
    captions: [],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    // Eski sürüm projeleri için yedek; yeni projelerde katman konumları (Track.placement) geçerlidir
    webcamOverlay: { x: 0.68, y: 0.04, w: 0.3, h: 0.3 },
    background: '#000000'
  }
  return applyTemplate(base, DEFAULT_TEMPLATE)
}

export const clipDuration = (c: Clip) => c.srcOut - c.srcIn
export const clipEnd = (c: Clip) => c.start + clipDuration(c)
export const MIN_CLIP_SEC = 0.1

export function timelineDuration(tl: Timeline): number {
  let end = 0
  for (const t of tl.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c))
  return end
}

export function findClip(tl: Timeline, clipId: ID): { track: Track; clip: Clip } | null {
  for (const track of tl.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

export function groupMembers(tl: Timeline, clipId: ID): Clip[] {
  const f = findClip(tl, clipId)
  if (!f) return []
  const g = f.clip.groupId
  if (!g) return [f.clip]
  return tl.tracks.flatMap((t) => t.clips.filter((c) => c.groupId === g))
}

export function aspectSize(aspect: AspectRatio, shortSide = 1080): { width: number; height: number } {
  const even = (n: number) => Math.round(n / 2) * 2
  if (aspect === '9:16') return { width: shortSide, height: even((shortSide * 16) / 9) }
  if (aspect === '1:1') return { width: shortSide, height: shortSide }
  return { width: even((shortSide * 16) / 9), height: shortSide }
}
