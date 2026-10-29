import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { playerReport, teamReport } from '../lib/report.js'
import { HttpError, parse } from '../validate.js'

const input = { notes: z.string().max(8000).optional(), clipIds: z.array(z.string()).max(60).optional(), snapshotIds: z.array(z.string()).max(12).optional() }

export async function reportRoutes(app: FastifyInstance) {
  const send = (reply: import('fastify').FastifyReply, r: { pdf: Buffer; name: string }) =>
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${r.name}"`).header('Content-Length', r.pdf.length).send(r.pdf)

  app.post('/api/reports/player', { preHandler: canWrite }, async (req, reply) => {
    const b = parse(z.object({ playerId: z.string(), ...input }), req.body)
    try { return send(reply, await playerReport(b.playerId, b)) } catch (e) { throw new HttpError(404, e instanceof Error ? e.message : 'Report failed') }
  })
  app.post('/api/reports/team', { preHandler: canWrite }, async (req, reply) => {
    const b = parse(z.object({ teamId: z.string(), ...input }), req.body)
    try { return send(reply, await teamReport(b.teamId, b)) } catch (e) { throw new HttpError(404, e instanceof Error ? e.message : 'Report failed') }
  })
}
