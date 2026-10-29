import type { Clip } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { prisma } from '../db.js'
import { HttpError, outcomeSchema, parse } from '../validate.js'

const clipFields = {
  matchId: z.string(),
  videoId: z.string().nullish(),
  tagTypeId: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  timeSec: z.number().min(0),
  playerId: z.string().nullish(),
  teamId: z.string().nullish(),
  jersey: z.number().int().min(0).max(99).nullish(),
  outcome: outcomeSchema.default('neutral'),
  zone: z.string().nullish(),
  x: z.number().min(0).max(100).nullish(),
  y: z.number().min(0).max(100).nullish(),
  endX: z.number().min(0).max(100).nullish(),
  endY: z.number().min(0).max(100).nullish(),
  notes: z.string().default(''),
  labels: z.array(z.string()).default([]),
}

/** The client may mint ids so undo/redo can recreate a clip under the same id. */
const clipCreate = z.object({ id: z.string().min(1).max(64).optional(), ...clipFields })
const clipPatch = z.object(clipFields).partial()

export function clipDTO(c: Clip) {
  return { ...c, labels: c.labels as string[] }
}

function checkRange(c: { startSec?: number; endSec?: number }) {
  if (c.startSec !== undefined && c.endSec !== undefined && c.endSec <= c.startSec) {
    throw new HttpError(400, 'endSec must be greater than startSec')
  }
}

export async function clipRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { matchId?: string; playerId?: string } }>('/api/clips', async (req) => {
    const { matchId, playerId } = req.query
    const rows = await prisma.clip.findMany({
      where: { ...(matchId ? { matchId } : {}), ...(playerId ? { playerId } : {}) },
      orderBy: { timeSec: 'asc' },
    })
    return rows.map(clipDTO)
  })

  async function createMany(items: z.infer<typeof clipCreate>[], userId: string | null) {
    items.forEach(checkRange)
    const matchIds = [...new Set(items.map((i) => i.matchId))]
    const created = await prisma.$transaction(
      items.map((data) => prisma.clip.create({ data: { ...data, createdById: userId } })),
    )
    // First tag on a match flips it from "untagged" to "in progress".
    await prisma.match.updateMany({
      where: { id: { in: matchIds }, tagStatus: 'untagged' },
      data: { tagStatus: 'in_progress' },
    })
    return created.map(clipDTO)
  }

  app.post('/api/clips', { preHandler: canWrite }, async (req, reply) => {
    const [clip] = await createMany([parse(clipCreate, req.body)], req.user!.id)
    return reply.code(201).send(clip)
  })

  app.post('/api/clips/bulk', { preHandler: canWrite }, async (req, reply) => {
    const { clips } = parse(z.object({ clips: z.array(clipCreate).min(1).max(5000) }), req.body)
    return reply.code(201).send(await createMany(clips, req.user!.id))
  })

  app.patch<{ Params: { id: string } }>('/api/clips/:id', { preHandler: canWrite }, async (req) => {
    const patch = parse(clipPatch, req.body)
    checkRange(patch)
    return clipDTO(await prisma.clip.update({ where: { id: req.params.id }, data: patch }))
  })

  /** Heterogeneous patches in one transaction — used by bulk edits and by undo/redo. */
  app.post('/api/clips/batch-update', { preHandler: canWrite }, async (req) => {
    const { updates } = parse(
      z.object({ updates: z.array(z.object({ id: z.string(), patch: clipPatch })).min(1).max(5000) }),
      req.body,
    )
    updates.forEach((u) => checkRange(u.patch))
    const rows = await prisma.$transaction(
      updates.map((u) => prisma.clip.update({ where: { id: u.id }, data: u.patch })),
    )
    return rows.map(clipDTO)
  })

  app.post('/api/clips/batch-delete', { preHandler: canWrite }, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1).max(5000) }), req.body)
    const r = await prisma.clip.deleteMany({ where: { id: { in: ids } } })
    return { deleted: r.count }
  })

  app.delete<{ Params: { id: string } }>('/api/clips/:id', { preHandler: canWrite }, async (req, reply) => {
    await prisma.clip.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })
}
