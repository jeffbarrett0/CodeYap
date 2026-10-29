import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canWrite } from '../auth.js'
import { applyImport } from '../lib/import/apply.js'
import { genericPreview } from '../lib/import/generic.js'
import { hudlPreview, listCompetitions, listMatches, mapHudlEvents, parseHudlRef, type RawEvent } from '../lib/import/hudl.js'
import { parseSofaScoreId, sofaScorePreview } from '../lib/import/sofascore.js'
import { ImportError, type EventsInfo, type MatchPreview } from '../lib/import/types.js'
import { HttpError, parse } from '../validate.js'

interface Cached { at: number; preview: MatchPreview; events: RawEvent[] | null }
const previews = new Map<string, Cached>()
const TTL = 30 * 60_000

function remember(preview: MatchPreview, events: RawEvent[] | null) {
  for (const [k, v] of previews) if (Date.now() - v.at > TTL) previews.delete(k)
  const id = randomUUID()
  previews.set(id, { at: Date.now(), preview, events })
  return id
}

const eventsInfo = (c: Cached): EventsInfo => {
  if (!c.events) return { available: false, summary: [], pressureCount: 0, outsideTwoHalves: 0 }
  const m = mapHudlEvents(c.events, c.preview.home.name, { includePressures: false })
  const count = new Map<string, number>()
  for (const x of m.clips) count.set(x.tag, (count.get(x.tag) ?? 0) + 1)
  return { available: true, summary: [...count].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count), pressureCount: m.pressureCount, outsideTwoHalves: m.outsideTwoHalves }
}

/** Run an importer, turning ImportError into a clean HTTP error. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ImportError) throw new HttpError(e.status, e.message)
    throw e
  }
}

export async function importRoutes(app: FastifyInstance) {
  app.get('/api/import/hudl/competitions', { preHandler: canWrite }, async () => guarded(listCompetitions))
  app.get<{ Querystring: { competitionId?: string; seasonId?: string } }>('/api/import/hudl/matches', { preHandler: canWrite }, async (req) => {
    const c = Number(req.query.competitionId)
    const s = Number(req.query.seasonId)
    if (!c || !s) throw new HttpError(400, 'competitionId and seasonId are required')
    return guarded(() => listMatches(c, s))
  })

  /** Resolve a link (or a Hudl match id) to a preview. Nothing is written yet. */
  app.post('/api/import/preview', { preHandler: canWrite }, async (req) => {
    const { url, hudlMatchId } = parse(z.object({ url: z.string().max(2000).optional(), hudlMatchId: z.number().int().optional() }), req.body)
    return guarded(async () => {
      const link = (url ?? '').trim()
      if (hudlMatchId == null && !link) throw new ImportError('Paste a match link first')
      const hudl = hudlMatchId != null ? { matchId: hudlMatchId } : parseHudlRef(link)
      if (hudl && 'browse' in hudl) return { kind: 'browse' as const, ...hudl.browse }
      let preview: MatchPreview
      let events: RawEvent[] | null = null
      if (hudl) {
        const r = await hudlPreview(hudl.matchId)
        preview = r.preview
        events = r.events.length ? r.events : null
      } else if (/sofascore\.com/i.test(link)) {
        const id = parseSofaScoreId(link)
        if (!id) throw new ImportError('That SofaScore link doesn’t contain a match id. Open the match page itself (the address ends with something like #id:12345678).')
        preview = await sofaScorePreview(id, link)
      } else preview = await genericPreview(link)
      const cached: Cached = { at: Date.now(), preview, events }
      const previewId = remember(preview, events)
      return { kind: 'preview' as const, previewId, preview, events: eventsInfo(cached) }
    })
  })

  app.post('/api/import/apply', { preHandler: canWrite }, async (req) => {
    const b = parse(
      z.object({
        previewId: z.string(),
        matchId: z.string().nullish(),
        // The user may correct fields the source didn't provide.
        overrides: z.object({ date: z.string().optional(), competition: z.string().optional(), venue: z.string().optional(), homeScore: z.number().int().nullable().optional(), awayScore: z.number().int().nullable().optional() }).optional(),
        updateMatch: z.boolean().default(true),
        importLineups: z.boolean().default(true),
        createMissing: z.boolean().default(true),
        importEvents: z.boolean().default(false),
        includePressures: z.boolean().default(false),
        firstHalfStart: z.number().default(0),
        secondHalfStart: z.number().optional(),
        preRoll: z.number().min(0).max(30).default(5),
        postRoll: z.number().min(0).max(30).default(5),
        replaceImported: z.boolean().default(true),
      }),
      req.body,
    )
    const c = previews.get(b.previewId)
    if (!c) throw new HttpError(410, 'That preview expired. Paste the link again.')
    const preview: MatchPreview = { ...c.preview, ...(b.overrides ?? {}), venue: b.overrides?.venue ?? c.preview.venue, date: b.overrides?.date ?? c.preview.date }
    const clips = b.importEvents && c.events ? mapHudlEvents(c.events, preview.home.name, { includePressures: b.includePressures }).clips : null
    return guarded(async () => {
      try {
        return await applyImport(preview, {
          matchId: b.matchId, updateMatch: b.updateMatch, importLineups: b.importLineups, createMissing: b.createMissing, clips,
          firstHalfStart: b.firstHalfStart, secondHalfStart: b.secondHalfStart ?? b.firstHalfStart + 3600, preRoll: b.preRoll, postRoll: b.postRoll,
          replaceImported: b.replaceImported, userId: req.user!.id,
        })
      } catch (e) {
        if (e instanceof Error && /doesn’t exist yet/.test(e.message)) throw new ImportError(e.message)
        throw e
      }
    })
  })
}
