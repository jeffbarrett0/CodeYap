import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adminOnly, canWrite } from '../auth.js'
import { THUMB_DIR, VIDEO_DIR } from '../config.js'
import { prisma } from '../db.js'
import { videoDTO } from '../dto.js'
import { processVideo } from '../lib/ffmpeg.js'
import { parseRange } from '../lib/range.js'
import { verifyResource } from '../lib/sign.js'
import { HttpError, parse } from '../validate.js'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
}

/** Clips imported before any footage existed have no video yet: link them to the first video attached to the match. */
async function adoptOrphanClips(matchId: string | null, videoId: string) {
  if (!matchId) return
  const others = await prisma.video.count({ where: { matchId, id: { not: videoId } } })
  if (others === 0) await prisma.clip.updateMany({ where: { matchId, videoId: null }, data: { videoId } })
}

const videoPatch = z
  .object({
    title: z.string().min(1),
    matchId: z.string().nullable(),
    angle: z.string().min(1),
    syncOffset: z.number().min(-600).max(600),
    tags: z.array(z.string()),
    // Reported by the browser when ffmpeg is unavailable server-side.
    durationSec: z.number().min(0),
    fps: z.number().min(1).max(240),
    width: z.number().int().min(0),
    height: z.number().int().min(0),
  })
  .partial()

export async function videoRoutes(app: FastifyInstance) {
  app.get('/api/videos', async () => {
    const rows = await prisma.video.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(videoDTO)
  })

  app.get<{ Params: { id: string } }>('/api/videos/:id', async (req) => {
    const v = await prisma.video.findUnique({ where: { id: req.params.id } })
    if (!v) throw new HttpError(404, 'Video not found')
    return videoDTO(v)
  })

  /**
   * Multipart upload, streamed straight to disk (never buffered in memory).
   * The client appends text fields (title, matchId, angle, tags) *before* the
   * file part so they are known by the time the file arrives.
   */
  app.post('/api/videos', { preHandler: canWrite }, async (req, reply) => {
    if (!req.isMultipart()) throw new HttpError(415, 'Expected multipart/form-data')
    const fields: Record<string, string> = {}
    let saved: { id: string; file: string; originalName: string; mime: string; size: number } | null = null

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value)
        continue
      }
      if (saved) {
        part.file.resume()
        continue
      }
      const ext = path.extname(part.filename).toLowerCase()
      if (!MIME[ext]) {
        part.file.resume()
        throw new HttpError(415, `Unsupported file type "${ext || part.filename}". Use mp4, mov, m4v, webm or mkv.`)
      }
      const id = randomUUID()
      const file = `${id}${ext}`
      const dest = path.join(VIDEO_DIR, file)
      try {
        await pipeline(part.file, fs.createWriteStream(dest))
      } catch (err) {
        fs.rmSync(dest, { force: true })
        throw err
      }
      if (part.file.truncated) {
        fs.rmSync(dest, { force: true })
        throw new HttpError(413, 'File exceeds the maximum upload size')
      }
      saved = { id, file, originalName: part.filename, mime: MIME[ext], size: fs.statSync(dest).size }
    }
    if (!saved) throw new HttpError(400, 'No file in request')

    let tags: string[] = []
    try {
      tags = fields.tags ? (JSON.parse(fields.tags) as string[]) : []
    } catch {
      tags = fields.tags.split(',').map((t) => t.trim()).filter(Boolean)
    }
    const matchId = fields.matchId || null
    if (matchId && !(await prisma.match.findUnique({ where: { id: matchId } }))) {
      fs.rmSync(path.join(VIDEO_DIR, saved.file), { force: true })
      throw new HttpError(400, 'matchId does not exist')
    }

    const video = await prisma.video.create({
      data: {
        id: saved.id,
        title: fields.title?.trim() || saved.originalName.replace(/\.[^.]+$/, ''),
        originalName: saved.originalName,
        filePath: `videos/${saved.file}`,
        mimeType: saved.mime,
        sizeBytes: BigInt(saved.size),
        angle: fields.angle?.trim() || 'Main',
        tags,
        matchId,
        status: 'processing',
      },
    })
    await adoptOrphanClips(matchId, video.id)
    // Fire and forget; the client polls GET /api/videos until status flips.
    void processVideo(video.id)
    return reply.code(201).send(videoDTO(video))
  })

  app.patch<{ Params: { id: string } }>('/api/videos/:id', { preHandler: canWrite }, async (req) => {
    const v = await prisma.video.update({ where: { id: req.params.id }, data: parse(videoPatch, req.body) })
    if (v.matchId) await adoptOrphanClips(v.matchId, v.id)
    return videoDTO(v)
  })

  app.delete<{ Params: { id: string } }>('/api/videos/:id', { preHandler: adminOnly }, async (req, reply) => {
    const v = await prisma.video.findUnique({ where: { id: req.params.id } })
    if (!v) throw new HttpError(404, 'Video not found')
    await prisma.video.delete({ where: { id: v.id } })
    fs.rmSync(path.join(VIDEO_DIR, path.basename(v.filePath)), { force: true })
    fs.rmSync(path.join(THUMB_DIR, `${v.id}.jpg`), { force: true })
    return reply.code(204).send()
  })

  // ── Media delivery (signed URLs — <video>/<img> cannot send auth headers) ──

  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/api/videos/:id/stream',
    async (req, reply) => {
      const { id } = req.params
      if (!verifyResource(`video:${id}`, req.query.exp, req.query.sig)) {
        throw new HttpError(403, 'Invalid or expired stream link')
      }
      const v = await prisma.video.findUnique({ where: { id } })
      if (!v) throw new HttpError(404, 'Video not found')
      const abs = path.join(VIDEO_DIR, path.basename(v.filePath))
      let size: number
      try {
        size = (await fs.promises.stat(abs)).size
      } catch {
        throw new HttpError(404, 'Video file missing on disk')
      }

      reply.header('Accept-Ranges', 'bytes').header('Content-Type', v.mimeType).header('Cache-Control', 'private, max-age=3600')
      const range = parseRange(req.headers.range, size)
      if (range.kind === 'unsatisfiable') {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send()
      }
      if (range.kind === 'partial') {
        const { start, end } = range
        return reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${size}`)
          .header('Content-Length', end - start + 1)
          .send(fs.createReadStream(abs, { start, end }))
      }
      return reply.code(200).header('Content-Length', size).send(fs.createReadStream(abs))
    },
  )

  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/api/videos/:id/thumbnail',
    async (req, reply) => {
      const { id } = req.params
      if (!verifyResource(`thumb:${id}`, req.query.exp, req.query.sig)) {
        throw new HttpError(403, 'Invalid or expired link')
      }
      const abs = path.join(THUMB_DIR, `${id}.jpg`)
      if (!fs.existsSync(abs)) throw new HttpError(404, 'No thumbnail')
      return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(fs.createReadStream(abs))
    },
  )
}
