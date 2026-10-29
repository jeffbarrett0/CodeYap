import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { prisma } from '../db.js'
import { HttpError, parse } from '../validate.js'

const include = { author: { select: { id: true, name: true, color: true, role: true } } } as const

export async function commentRoutes(app: FastifyInstance) {
  /** Flat list, oldest first; the client nests by parentId. */
  app.get<{ Querystring: { clipId?: string } }>('/api/comments', async (req) => {
    if (!req.query.clipId) throw new HttpError(400, 'clipId is required')
    return prisma.comment.findMany({ where: { clipId: req.query.clipId }, orderBy: { createdAt: 'asc' }, include })
  })

  app.post('/api/comments', { preHandler: canWrite }, async (req, reply) => {
    const body = parse(z.object({ id: z.string().optional(), clipId: z.string(), parentId: z.string().nullish(), body: z.string().trim().min(1).max(2000) }), req.body)
    if (body.parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: body.parentId } })
      if (!parent || parent.clipId !== body.clipId) throw new HttpError(400, 'Invalid parent comment')
    }
    const c = await prisma.comment.create({ data: { ...body, parentId: body.parentId ?? null, authorId: req.user!.id }, include })
    return reply.code(201).send(c)
  })

  app.delete<{ Params: { id: string } }>('/api/comments/:id', { preHandler: canWrite }, async (req, reply) => {
    const c = await prisma.comment.findUnique({ where: { id: req.params.id } })
    if (!c) throw new HttpError(404, 'Comment not found')
    if (c.authorId !== req.user!.id && req.user!.role !== 'admin') throw new HttpError(403, 'You can only delete your own comments')
    await prisma.comment.delete({ where: { id: c.id } })
    return reply.code(204).send()
  })
}
