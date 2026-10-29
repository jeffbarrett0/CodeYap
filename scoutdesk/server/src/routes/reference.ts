import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminOnly, canWrite } from '../auth.js'
import { prisma } from '../db.js'
import { HttpError, parse } from '../validate.js'

const teamBody = z.object({
  name: z.string().min(1),
  shortName: z.string().min(1).max(5),
  color: z.string().default('#3b82f6'),
  isOwn: z.boolean().default(false),
  country: z.string().nullish(),
  formation: z.string().default('4-3-3'),
  notes: z.string().default(''),
})

const playerBody = z.object({
  name: z.string().min(1),
  photoUrl: z.string().nullish(),
  jersey: z.number().int().min(0).max(99).nullish(),
  positions: z.array(z.string()).default([]),
  foot: z.enum(['left', 'right', 'both']).nullish(),
  heightCm: z.number().int().min(100).max(230).nullish(),
  age: z.number().int().min(10).max(60).nullish(),
  nationality: z.string().nullish(),
  notes: z.string().default(''),
  teamId: z.string().nullish(),
})

const matchBody = z.object({
  date: z.coerce.date(),
  competition: z.string().default(''),
  venue: z.string().nullish(),
  homeTeamId: z.string(),
  awayTeamId: z.string(),
  homeScore: z.number().int().min(0).nullish(),
  awayScore: z.number().int().min(0).nullish(),
  tagStatus: z.enum(['untagged', 'in_progress', 'complete']).default('untagged'),
  lineups: z.object({ home: z.array(z.string()), away: z.array(z.string()) }).default({ home: [], away: [] }),
  notes: z.string().default(''),
})

export async function referenceRoutes(app: FastifyInstance) {
  app.get('/api/users', async () => prisma.user.findMany({ orderBy: { createdAt: 'asc' } }))

  // ── Teams ────────────────────────────────────────────────────────────────
  app.get('/api/teams', async () => prisma.team.findMany({ orderBy: [{ isOwn: 'desc' }, { name: 'asc' }] }))
  app.post('/api/teams', { preHandler: canWrite }, async (req, reply) => {
    const team = await prisma.team.create({ data: parse(teamBody, req.body) })
    return reply.code(201).send(team)
  })
  app.patch<{ Params: { id: string } }>('/api/teams/:id', { preHandler: canWrite }, async (req) =>
    prisma.team.update({ where: { id: req.params.id }, data: parse(teamBody.partial(), req.body) }),
  )
  app.delete<{ Params: { id: string } }>('/api/teams/:id', { preHandler: adminOnly }, async (req, reply) => {
    const used = await prisma.match.count({
      where: { OR: [{ homeTeamId: req.params.id }, { awayTeamId: req.params.id }] },
    })
    if (used) throw new HttpError(409, 'Team has matches; delete or reassign them first')
    await prisma.team.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── Players ──────────────────────────────────────────────────────────────
  app.get('/api/players', async () => prisma.player.findMany({ orderBy: { name: 'asc' } }))
  app.post('/api/players', { preHandler: canWrite }, async (req, reply) => {
    const player = await prisma.player.create({ data: parse(playerBody, req.body) })
    return reply.code(201).send(player)
  })
  app.patch<{ Params: { id: string } }>('/api/players/:id', { preHandler: canWrite }, async (req) =>
    prisma.player.update({ where: { id: req.params.id }, data: parse(playerBody.partial(), req.body) }),
  )
  app.delete<{ Params: { id: string } }>('/api/players/:id', { preHandler: adminOnly }, async (req, reply) => {
    await prisma.player.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── Matches ──────────────────────────────────────────────────────────────
  const matchInclude = { _count: { select: { clips: true, videos: true } } } as const
  const withCounts = <T extends { _count: { clips: number; videos: number } }>(m: T) => {
    const { _count, ...rest } = m
    return { ...rest, clipCount: _count.clips, videoCount: _count.videos }
  }

  app.get('/api/matches', async () => {
    const rows = await prisma.match.findMany({ orderBy: { date: 'desc' }, include: matchInclude })
    return rows.map(withCounts)
  })
  app.post('/api/matches', { preHandler: canWrite }, async (req, reply) => {
    const m = await prisma.match.create({ data: parse(matchBody, req.body), include: matchInclude })
    return reply.code(201).send(withCounts(m))
  })
  app.patch<{ Params: { id: string } }>('/api/matches/:id', { preHandler: canWrite }, async (req) => {
    const m = await prisma.match.update({
      where: { id: req.params.id },
      data: parse(matchBody.partial(), req.body),
      include: matchInclude,
    })
    return withCounts(m)
  })
  app.delete<{ Params: { id: string } }>('/api/matches/:id', { preHandler: adminOnly }, async (req, reply) => {
    await prisma.match.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })
}
