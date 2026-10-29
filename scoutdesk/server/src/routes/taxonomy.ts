import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminOnly } from '../auth.js'
import { prisma } from '../db.js'
import { HttpError, outcomeSchema, parse } from '../validate.js'

const categoryBody = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().default(0),
})

const tagTypeBody = z.object({
  categoryId: z.string(),
  name: z.string().min(1),
  hotkey: z.string().max(20).nullish(),
  defaultOutcome: outcomeSchema.default('neutral'),
  sortOrder: z.number().int().default(0),
})

async function assertHotkeyFree(hotkey: string | null | undefined, exceptId?: string) {
  if (!hotkey) return
  const clash = await prisma.tagType.findFirst({
    where: { hotkey, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  })
  if (clash) throw new HttpError(409, `Hotkey "${hotkey}" is already used by "${clash.name}"`)
}

export async function taxonomyRoutes(app: FastifyInstance) {
  app.get('/api/taxonomy', async () =>
    prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { tagTypes: { orderBy: { sortOrder: 'asc' } } },
    }),
  )

  app.post('/api/categories', { preHandler: adminOnly }, async (req, reply) =>
    reply.code(201).send(await prisma.category.create({ data: parse(categoryBody, req.body) })),
  )
  app.patch<{ Params: { id: string } }>('/api/categories/:id', { preHandler: adminOnly }, async (req) =>
    prisma.category.update({ where: { id: req.params.id }, data: parse(categoryBody.partial(), req.body) }),
  )
  app.delete<{ Params: { id: string } }>('/api/categories/:id', { preHandler: adminOnly }, async (req, reply) => {
    const used = await prisma.clip.count({ where: { tagType: { categoryId: req.params.id } } })
    if (used) throw new HttpError(409, `${used} clips use tags in this category`)
    await prisma.category.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  app.post('/api/tag-types', { preHandler: adminOnly }, async (req, reply) => {
    const data = parse(tagTypeBody, req.body)
    await assertHotkeyFree(data.hotkey)
    return reply.code(201).send(await prisma.tagType.create({ data }))
  })
  app.patch<{ Params: { id: string } }>('/api/tag-types/:id', { preHandler: adminOnly }, async (req) => {
    const data = parse(tagTypeBody.partial(), req.body)
    await assertHotkeyFree(data.hotkey, req.params.id)
    return prisma.tagType.update({ where: { id: req.params.id }, data })
  })
  app.delete<{ Params: { id: string } }>('/api/tag-types/:id', { preHandler: adminOnly }, async (req, reply) => {
    const used = await prisma.clip.count({ where: { tagTypeId: req.params.id } })
    if (used) throw new HttpError(409, `${used} clips use this tag`)
    await prisma.tagType.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })
}
