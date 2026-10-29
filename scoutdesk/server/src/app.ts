import fs from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyError } from 'fastify'
import { ZodError } from 'zod'
import { resolveUser } from './auth.js'
import { CLIENT_DIST, MAX_UPLOAD_BYTES } from './config.js'
import { prisma } from './db.js'
import { ffmpegAvailable } from './lib/ffmpeg.js'
import { ensureStorage } from './lib/storage.js'
import { clipRoutes } from './routes/clips.js'
import { referenceRoutes } from './routes/reference.js'
import { taxonomyRoutes } from './routes/taxonomy.js'
import { videoRoutes } from './routes/videos.js'
import { commentRoutes } from './routes/comments.js'
import { exportRoutes } from './routes/exports.js'
import { profileRoutes } from './routes/profile.js'
import { playlistRoutes } from './routes/playlists.js'
import { reportRoutes } from './routes/reports.js'
import { shareRoutes } from './routes/shares.js'
import { snapshotRoutes } from './routes/snapshots.js'
import { HttpError } from './validate.js'

export async function buildApp({ logger = false }: { logger?: boolean | { level: string } } = {}) {
  ensureStorage()
  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 })

  await app.register(cors, { origin: true, exposedHeaders: ['Content-Range', 'Accept-Ranges'] })
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 } })

  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) await resolveUser(req)
  })

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message })
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Invalid request' })
    const code = (err as { code?: string }).code
    if (code === 'P2025') return reply.code(404).send({ error: 'Not found' })
    if (code === 'P2002') return reply.code(409).send({ error: 'Already exists' })
    if (code === 'P2003') return reply.code(409).send({ error: 'Referenced record does not exist' })
    if (code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'File exceeds the maximum upload size' })
    const status = (err as FastifyError).statusCode ?? 500
    if (status >= 500) app.log.error(err)
    return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message })
  })

  app.get('/api/health', async () => ({
    ok: true,
    ffmpeg: await ffmpegAvailable(),
    counts: {
      matches: await prisma.match.count(),
      videos: await prisma.video.count(),
      clips: await prisma.clip.count(),
    },
  }))

  await app.register(referenceRoutes)
  await app.register(taxonomyRoutes)
  await app.register(videoRoutes)
  await app.register(clipRoutes)
  await app.register(playlistRoutes)
  await app.register(exportRoutes)
  await app.register(commentRoutes)
  await app.register(snapshotRoutes)
  await app.register(profileRoutes)
  await app.register(shareRoutes)
  await app.register(reportRoutes)

  // Serve the built client (production). In dev, Vite serves it and proxies /api here.
  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    await app.register(fastifyStatic, { root: CLIENT_DIST })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'Not found' })
    })
  }

  return app
}
