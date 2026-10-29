import type { Player, Video } from '@prisma/client'
import { signResource } from './lib/sign.js'

export function videoDTO(v: Video) {
  return {
    id: v.id,
    title: v.title,
    originalName: v.originalName,
    mimeType: v.mimeType,
    sizeBytes: Number(v.sizeBytes),
    durationSec: v.durationSec,
    fps: v.fps,
    width: v.width,
    height: v.height,
    status: v.status,
    error: v.error,
    angle: v.angle,
    syncOffset: v.syncOffset,
    tags: v.tags as string[],
    matchId: v.matchId,
    createdAt: v.createdAt,
    streamUrl: `/api/videos/${v.id}/stream?${signResource(`video:${v.id}`)}`,
    thumbnailUrl: v.thumbnailPath
      ? `/api/videos/${v.id}/thumbnail?${signResource(`thumb:${v.id}`)}`
      : null,
  }
}

/** Uploaded photos are stored as `photos/<file>` and served through a signed URL; external http(s) URLs pass through. */
export function playerDTO(p: Player) {
  const photoUrl = !p.photoUrl
    ? null
    : /^https?:\/\//.test(p.photoUrl)
      ? p.photoUrl
      : `/api/players/${p.id}/photo?${signResource(`photo:${p.id}`)}&v=${encodeURIComponent(p.photoUrl.split('?')[1] ?? '')}`
  return { ...p, positions: p.positions as string[], photoUrl }
}
