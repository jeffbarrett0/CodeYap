import type { Clip } from '@prisma/client'
import { prisma } from '../db.js'

export interface DisplayClip {
  id: string; matchId: string; videoId: string | null; startSec: number; endSec: number; timeSec: number
  tag: string; category: string; color: string; player: string | null; jersey: number | null; team: string | null
  outcome: string; notes: string; labels: string[]; zone: string | null; x: number | null; y: number | null; endX: number | null; endY: number | null
}

/** Clips decorated with human-readable tag/category/player/team names (used by share links and reports). */
export async function displayClips(clips: Clip[]): Promise<DisplayClip[]> {
  const [tags, players, teams] = await Promise.all([
    prisma.tagType.findMany({ include: { category: true } }),
    prisma.player.findMany({ select: { id: true, name: true } }),
    prisma.team.findMany({ select: { id: true, shortName: true } }),
  ])
  const tagBy = new Map(tags.map((t) => [t.id, t]))
  const playerBy = new Map(players.map((p) => [p.id, p.name]))
  const teamBy = new Map(teams.map((t) => [t.id, t.shortName]))
  return clips.map((c) => {
    const t = tagBy.get(c.tagTypeId)
    return {
      id: c.id, matchId: c.matchId, videoId: c.videoId, startSec: c.startSec, endSec: c.endSec, timeSec: c.timeSec,
      tag: t?.name ?? '?', category: t?.category.name ?? '', color: t?.category.color ?? '#94a3b8',
      player: c.playerId ? (playerBy.get(c.playerId) ?? null) : null, jersey: c.jersey, team: c.teamId ? (teamBy.get(c.teamId) ?? null) : null,
      outcome: c.outcome, notes: c.notes, labels: c.labels as string[], zone: c.zone, x: c.x, y: c.y, endX: c.endX, endY: c.endY,
    }
  })
}
