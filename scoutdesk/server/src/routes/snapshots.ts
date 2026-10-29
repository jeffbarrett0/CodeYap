import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { Snapshot } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { SNAPSHOT_DIR } from '../config.js'
import { prisma } from '../db.js'
import { signResource, verifyResource } from '../lib/sign.js'
import { HttpError, parse } from '../validate.js'

export const snapshotDTO = (s: Snapshot) => ({
  id: s.id, matchId: s.matchId, videoId: s.videoId, clipId: s.clipId, playerId: s.playerId, timeSec: s.timeSec, caption: s.caption, createdAt: s.createdAt,
  url: `/api/snapshots/${s.id}/image?${signResource(`snap:${s.id}`)}`,
})

export async function snapshotRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { matchId?: string; playerId?: string } }>('/api/snapshots', async (req) => {
    const { matchId, playerId } = req.query
    const rows = await prisma.snapshot.findMany({ where: { ...(matchId ? { matchId } : {}), ...(playerId ? { playerId } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 })
    return rows.map(snapshotDTO)
  })

  app.post('/api/snapshots', { preHandler: canWrite }, async (req, reply) => {
    const fields: Record<string, string> = {}
    let saved: { id: string; file: string } | null = null
    for await (const part of req.parts()) {
      if (part.type === 'field') { fields[part.fieldname] = String(part.value); continue }
      if (saved) { part.file.resume(); continue }
      const ext = path.extname(part.filename).toLowerCase()
      if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') { part.file.resume(); throw new HttpError(415, 'Use PNG or JPEG') }
      const id = randomUUID()
      const file = `${id}${ext}`
      const dest = path.join(SNAPSHOT_DIR, file)
      await pipeline(part.file, fs.createWriteStream(dest))
      if (part.file.truncated) { fs.rmSync(dest, { force: true }); throw new HttpError(413, 'Snapshot too large') }
      saved = { id, file }
    }
    if (!saved) throw new HttpError(400, 'No file in request')
    const meta = parse(z.object({ matchId: z.string().optional(), videoId: z.string().optional(), clipId: z.string().optional(), playerId: z.string().optional(), timeSec: z.coerce.number().default(0), caption: z.string().max(300).default('') }), fields)
    const s = await prisma.snapshot.create({ data: { id: saved.id, filePath: `snapshots/${saved.file}`, createdById: req.user!.id, matchId: meta.matchId || null, videoId: meta.videoId || null, clipId: meta.clipId || null, playerId: meta.playerId || null, timeSec: meta.timeSec, caption: meta.caption } })
    return reply.code(201).send(snapshotDTO(s))
  })

  app.patch<{ Params: { id: string } }>('/api/snapshots/:id', { preHandler: canWrite }, async (req) => {
    const data = parse(z.object({ caption: z.string().max(300), playerId: z.string().nullable() }).partial(), req.body)
    return snapshotDTO(await prisma.snapshot.update({ where: { id: req.params.id }, data }))
  })

  app.delete<{ Params: { id: string } }>('/api/snapshots/:id', { preHandler: canWrite }, async (req, reply) => {
    const s = await prisma.snapshot.findUnique({ where: { id: req.params.id } })
    if (s) { fs.rmSync(path.join(SNAPSHOT_DIR, path.basename(s.filePath)), { force: true }); await prisma.snapshot.delete({ where: { id: s.id } }) }
    return reply.code(204).send()
  })

  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>('/api/snapshots/:id/image', async (req, reply) => {
    if (!verifyResource(`snap:${req.params.id}`, req.query.exp, req.query.sig)) throw new HttpError(403, 'Invalid or expired link')
    const s = await prisma.snapshot.findUnique({ where: { id: req.params.id } })
    if (!s) throw new HttpError(404, 'Not found')
    const file = path.join(SNAPSHOT_DIR, path.basename(s.filePath))
    if (!fs.existsSync(file)) throw new HttpError(404, 'File missing')
    return reply.header('Content-Type', file.endsWith('.png') ? 'image/png' : 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(fs.createReadStream(file))
  })
}
