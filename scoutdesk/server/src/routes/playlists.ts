import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminOnly, canWrite } from '../auth.js'
import { prisma } from '../db.js'
import { videoDTO } from '../dto.js'
import { clipDTO } from './clips.js'
import { HttpError, parse } from '../validate.js'

const itemSchema = z.object({
  clipId: z.string(),
  title: z.string().max(120).nullish(),
  transition: z.enum(['cut', 'fade']).default('cut'),
})

/** Full playlist with expanded clips and the videos they reference (signed stream URLs). */
export async function playlistPayload(id: string) {
  const pl = await prisma.playlist.findUnique({
    where: { id },
    include: { items: { orderBy: { position: 'asc' }, include: { clip: true } } },
  })
  if (!pl) return null
  const videoIds = [...new Set(pl.items.map((i) => i.clip.videoId).filter(Boolean))] as string[]
  const videos = await prisma.video.findMany({ where: { id: { in: videoIds } } })
  const durationSec = pl.items.reduce((a, i) => a + (i.clip.endSec - i.clip.startSec), 0)
  return {
    id: pl.id, title: pl.title, description: pl.description, createdAt: pl.createdAt, updatedAt: pl.updatedAt, durationSec,
    items: pl.items.map((i) => ({ id: i.id, position: i.position, title: i.title, transition: i.transition, clip: clipDTO(i.clip) })),
    videos: videos.map(videoDTO),
  }
}

export async function playlistRoutes(app: FastifyInstance) {
  app.get('/api/playlists', async () => {
    const rows = await prisma.playlist.findMany({ orderBy: { updatedAt: 'desc' }, include: { items: { include: { clip: { select: { startSec: true, endSec: true } } } } } })
    return rows.map((p) => ({
      id: p.id, title: p.title, description: p.description, createdAt: p.createdAt, updatedAt: p.updatedAt,
      itemCount: p.items.length, durationSec: p.items.reduce((a, i) => a + (i.clip.endSec - i.clip.startSec), 0),
    }))
  })

  app.get<{ Params: { id: string } }>('/api/playlists/:id', async (req) => {
    const p = await playlistPayload(req.params.id)
    if (!p) throw new HttpError(404, 'Playlist not found')
    return p
  })

  app.post('/api/playlists', { preHandler: canWrite }, async (req, reply) => {
    const body = parse(z.object({ title: z.string().min(1).max(120), description: z.string().default(''), clipIds: z.array(z.string()).default([]) }), req.body)
    const pl = await prisma.playlist.create({
      data: {
        title: body.title, description: body.description, createdById: req.user!.id,
        items: { create: body.clipIds.map((clipId, position) => ({ clipId, position })) },
      },
    })
    return reply.code(201).send(await playlistPayload(pl.id))
  })

  app.patch<{ Params: { id: string } }>('/api/playlists/:id', { preHandler: canWrite }, async (req) => {
    const data = parse(z.object({ title: z.string().min(1).max(120), description: z.string() }).partial(), req.body)
    await prisma.playlist.update({ where: { id: req.params.id }, data })
    return playlistPayload(req.params.id)
  })

  /** Replace the ordered item list (reorder, retitle, remove, transitions) atomically. */
  app.put<{ Params: { id: string } }>('/api/playlists/:id/items', { preHandler: canWrite }, async (req) => {
    const { items } = parse(z.object({ items: z.array(itemSchema).max(1000) }), req.body)
    const id = req.params.id
    if (!(await prisma.playlist.findUnique({ where: { id } }))) throw new HttpError(404, 'Playlist not found')
    const existing = new Set((await prisma.clip.findMany({ where: { id: { in: items.map((i) => i.clipId) } }, select: { id: true } })).map((c) => c.id))
    const missing = items.find((i) => !existing.has(i.clipId))
    if (missing) throw new HttpError(400, `Clip ${missing.clipId} does not exist`)
    await prisma.$transaction([
      prisma.playlistItem.deleteMany({ where: { playlistId: id } }),
      prisma.playlistItem.createMany({ data: items.map((i, position) => ({ playlistId: id, clipId: i.clipId, position, title: i.title || null, transition: i.transition })) }),
      prisma.playlist.update({ where: { id }, data: { updatedAt: new Date() } }),
    ])
    return playlistPayload(id)
  })

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', { preHandler: canWrite }, async (req, reply) => {
    await prisma.playlist.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })
  void adminOnly
}
