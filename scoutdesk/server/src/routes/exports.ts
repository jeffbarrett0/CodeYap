import fs from 'node:fs'
import path from 'node:path'
import type { ExportJob } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { EXPORT_DIR } from '../config.js'
import { prisma } from '../db.js'
import { ffmpegAvailable } from '../lib/ffmpeg.js'
import { pumpExports } from '../lib/exporter.js'
import { signResource, verifyResource } from '../lib/sign.js'
import { HttpError, parse } from '../validate.js'

const exportDTO = (j: ExportJob) => ({
  id: j.id, kind: j.kind, refId: j.refId, label: j.label, status: j.status, progress: j.progress, error: j.error,
  fileName: j.fileName, sizeBytes: Number(j.sizeBytes), createdAt: j.createdAt, finishedAt: j.finishedAt,
  downloadUrl: j.status === 'done' ? `/api/exports/${j.id}/download?${signResource(`export:${j.id}`)}` : null,
})

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/exports', async () => (await prisma.exportJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })).map(exportDTO))

  app.post('/api/exports', { preHandler: canWrite }, async (req, reply) => {
    const body = parse(z.object({ kind: z.enum(['clip', 'playlist']), refId: z.string(), titles: z.boolean().optional() }), req.body)
    if (!(await ffmpegAvailable())) throw new HttpError(503, 'ffmpeg is not installed on the server, so export is unavailable')
    let label: string
    if (body.kind === 'clip') {
      const c = await prisma.clip.findUnique({ where: { id: body.refId }, include: { tagType: true, player: true } })
      if (!c) throw new HttpError(404, 'Clip not found')
      if (!c.videoId) throw new HttpError(400, 'This clip has no video attached')
      label = `${c.tagType.name}${c.player ? ` · ${c.player.name}` : ''}`
    } else {
      const p = await prisma.playlist.findUnique({ where: { id: body.refId }, include: { _count: { select: { items: true } } } })
      if (!p) throw new HttpError(404, 'Playlist not found')
      if (p._count.items === 0) throw new HttpError(400, 'Playlist is empty')
      label = p.title
    }
    const job = await prisma.exportJob.create({
      data: { kind: body.kind, refId: body.refId, label, options: { titles: body.titles ?? body.kind === 'playlist' }, createdById: req.user!.id },
    })
    void pumpExports()
    return reply.code(201).send(exportDTO(job))
  })

  app.get<{ Params: { id: string } }>('/api/exports/:id', async (req) => {
    const j = await prisma.exportJob.findUnique({ where: { id: req.params.id } })
    if (!j) throw new HttpError(404, 'Export not found')
    return exportDTO(j)
  })

  app.delete<{ Params: { id: string } }>('/api/exports/:id', { preHandler: canWrite }, async (req, reply) => {
    const j = await prisma.exportJob.findUnique({ where: { id: req.params.id } })
    if (j) {
      if (j.status === 'running') throw new HttpError(409, 'Export is running')
      fs.rmSync(path.join(EXPORT_DIR, `${j.id}.mp4`), { force: true })
      await prisma.exportJob.delete({ where: { id: j.id } })
    }
    return reply.code(204).send()
  })

  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>('/api/exports/:id/download', async (req, reply) => {
    if (!verifyResource(`export:${req.params.id}`, req.query.exp, req.query.sig)) throw new HttpError(403, 'Invalid or expired link')
    const j = await prisma.exportJob.findUnique({ where: { id: req.params.id } })
    const file = path.join(EXPORT_DIR, `${req.params.id}.mp4`)
    if (!j || j.status !== 'done' || !fs.existsSync(file)) throw new HttpError(404, 'Export not available')
    const size = fs.statSync(file).size
    return reply
      .header('Content-Type', 'video/mp4')
      .header('Content-Length', size)
      .header('Content-Disposition', `attachment; filename="${(j.fileName ?? 'export.mp4').replace(/"/g, '')}"`)
      .send(fs.createReadStream(file))
  })
}
