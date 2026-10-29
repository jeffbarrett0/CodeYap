import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './db.js'

export type Role = 'admin' | 'analyst' | 'viewer'

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; name: string; role: Role } | null
  }
}

/**
 * Demo-grade auth: the client sends `x-user-id` and we trust it. Good enough to
 * exercise the role model (admin / analyst / viewer) end to end; swap this one
 * function for a real session/JWT check before exposing the server publicly.
 */
export async function resolveUser(req: FastifyRequest): Promise<void> {
  const id = req.headers['x-user-id']
  req.user = null
  if (typeof id !== 'string' || !id) return
  const u = await prisma.user.findUnique({ where: { id } })
  if (u) req.user = { id: u.id, name: u.name, role: u.role as Role }
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'Sign in required' })
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({ error: `Requires role: ${roles.join(' or ')}` })
    }
  }
}

export const canWrite = requireRole('admin', 'analyst')
export const adminOnly = requireRole('admin')
