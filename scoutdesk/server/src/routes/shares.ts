import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { prisma } from '../db.js'
import { videoDTO } from '../dto.js'
import { displayClips } from '../lib/display.js'
import { playlistPayload } from './playlists.js'
import { HttpError, parse } from '../validate.js'

const hash = (pw: string) => {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`
}
const verify = (pw: string, stored: string) => {
  const [salt, h] = stored.split(':')
  const a = scryptSync(pw, Buffer.from(salt!, 'hex'), 32)
  const b = Buffer.from(h!, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// Failed-password throttle: 8 attempts per minute per (token, ip).
const attempts = new Map<string, { n: number; reset: number }>()
const throttled = (key: string) => {
  const now = Date.now()
  const a = attempts.get(key)
  return !!a && a.reset > now && a.n >= 8
}
const fail = (key: string) => {
  const now = Date.now()
  const a = attempts.get(key)
  attempts.set(key, !a || a.reset <= now ? { n: 1, reset: now + 60_000 } : { n: a.n + 1, reset: a.reset })
}

export const shareDTO = (s: { id: string; token: string; kind: string; refId: string; label: string; passwordHash: string | null; expiresAt: Date | null; createdAt: Date; views: number }) => ({
  id: s.id, token: s.token, kind: s.kind, refId: s.refId, label: s.label, hasPassword: !!s.passwordHash, expiresAt: s.expiresAt, createdAt: s.createdAt, views: s.views,
})

export async function shareRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { kind?: string; refId?: string } }>('/api/shares', { preHandler: canWrite }, async (req) => {
    const { kind, refId } = req.query
    return (await prisma.shareLink.findMany({ where: { ...(kind ? { kind } : {}), ...(refId ? { refId } : {}) }, orderBy: { createdAt: 'desc' } })).map(shareDTO)
  })

  app.post('/api/shares', { preHandler: canWrite }, async (req, reply) => {
    const b = parse(z.object({ kind: z.enum(['playlist', 'match']), refId: z.string(), password: z.string().min(4).max(100).optional(), expiresInDays: z.number().min(0.01).max(365).optional() }), req.body)
    let label: string
    if (b.kind === 'playlist') {
      const p = await prisma.playlist.findUnique({ where: { id: b.refId } })
      if (!p) throw new HttpError(404, 'Playlist not found')
      label = p.title
    } else {
      const m = await prisma.match.findUnique({ where: { id: b.refId }, include: { homeTeam: true, awayTeam: true } })
      if (!m) throw new HttpError(404, 'Match not found')
      label = `${m.homeTeam.name} v ${m.awayTeam.name}`
    }
    const s = await prisma.shareLink.create({
      data: {
        token: randomBytes(18).toString('base64url'), kind: b.kind, refId: b.refId, label, createdById: req.user!.id,
        passwordHash: b.password ? hash(b.password) : null,
        expiresAt: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86_400_000) : null,
      },
    })
    return reply.code(201).send(shareDTO(s))
  })

  app.delete<{ Params: { id: string } }>('/api/shares/:id', { preHandler: canWrite }, async (req, reply) => {
    await prisma.shareLink.deleteMany({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── Public (no sign-in): read-only view of a playlist or a match ───────────
  app.get<{ Params: { token: string } }>('/api/public/shares/:token', async (req: FastifyRequest<{ Params: { token: string } }>, reply) => {
    const share = await prisma.shareLink.findUnique({ where: { token: req.params.token } })
    if (!share || share.revoked) throw new HttpError(404, 'This link is no longer available')
    if (share.expiresAt && share.expiresAt < new Date()) throw new HttpError(410, 'This link has expired')
    if (share.passwordHash) {
      const key = `${share.token}:${req.ip}`
      if (throttled(key)) throw new HttpError(429, 'Too many attempts. Try again in a minute.')
      const pw = req.headers['x-share-password']
      if (typeof pw !== 'string' || pw === '') return reply.code(401).send({ error: 'Password required', passwordRequired: true, label: share.label })
      if (!verify(pw, share.passwordHash)) {
        fail(key)
        return reply.code(403).send({ error: 'Wrong password', passwordRequired: true, label: share.label })
      }
    }
    await prisma.shareLink.update({ where: { id: share.id }, data: { views: { increment: 1 } } })

    if (share.kind === 'playlist') {
      const p = await playlistPayload(share.refId)
      if (!p) throw new HttpError(404, 'This link is no longer available')
      const display = new Map((await displayClips(p.items.map((i) => i.clip as never))).map((c) => [c.id, c]))
      return {
        kind: 'playlist', label: share.label, title: p.title, description: p.description, expiresAt: share.expiresAt,
        videos: p.videos,
        items: p.items.map((i) => ({ id: i.id, title: i.title, transition: i.transition, clip: display.get(i.clip.id)! })),
      }
    }
    const m = await prisma.match.findUnique({ where: { id: share.refId }, include: { homeTeam: true, awayTeam: true, videos: { where: { status: 'ready' } } } })
    if (!m) throw new HttpError(404, 'This link is no longer available')
    const clips = await prisma.clip.findMany({ where: { matchId: m.id }, orderBy: { timeSec: 'asc' } })
    return {
      kind: 'match', label: share.label, expiresAt: share.expiresAt,
      match: { id: m.id, date: m.date, competition: m.competition, home: m.homeTeam.name, away: m.awayTeam.name, homeScore: m.homeScore, awayScore: m.awayScore },
      videos: m.videos.map(videoDTO), clips: await displayClips(clips),
    }
  })
}
