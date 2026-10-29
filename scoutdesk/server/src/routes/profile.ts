import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { playerDTO } from '../dto.js'
import { displayClips } from '../lib/display.js'
import { STAT_DEFINITIONS, allPlayerStats, radarFor } from '../lib/stats.js'
import { HttpError } from '../validate.js'

export async function profileRoutes(app: FastifyInstance) {
  /** Everything a player profile / comparison screen needs, computed once on the server. */
  app.get<{ Params: { id: string } }>('/api/players/:id/profile', async (req) => {
    const { rows } = await allPlayerStats()
    const me = rows.find((r) => r.player.id === req.params.id)
    if (!me) throw new HttpError(404, 'Player not found')
    const clips = await prisma.clip.findMany({ where: { playerId: me.player.id }, orderBy: [{ matchId: 'asc' }, { timeSec: 'asc' }] })
    const matchIds = [...new Set(clips.map((c) => c.matchId))]
    const matches = await prisma.match.findMany({ where: { id: { in: matchIds } }, orderBy: { date: 'desc' } })
    return {
      player: playerDTO(me.player),
      stats: me.stats,
      radar: radarFor(me, rows),
      clips: await displayClips(clips),
      matches: matches.map((m) => ({ id: m.id, date: m.date, competition: m.competition, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, homeScore: m.homeScore, awayScore: m.awayScore })),
      definitions: STAT_DEFINITIONS,
    }
  })
}
