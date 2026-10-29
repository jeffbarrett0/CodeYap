import { prisma } from '../../db.js'
import type { ImportClip, ImportPlayer, ImportTeam, MatchPreview } from './types.js'

export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const PALETTE = ['#3b82f6', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6', '#0ea5e9', '#e11d48', '#14b8a6']

export interface ApplyOptions {
  matchId?: string | null
  updateMatch: boolean
  importLineups: boolean
  createMissing: boolean
  clips: ImportClip[] | null
  firstHalfStart: number
  secondHalfStart: number
  preRoll: number
  postRoll: number
  replaceImported: boolean
  userId: string
}

export interface ApplyResult {
  matchId: string
  createdTeams: string[]
  createdPlayers: number
  matchedPlayers: number
  clipsCreated: number
  clipsSkipped: number
  unknownTags: string[]
}

async function teamFor(t: ImportTeam, created: string[], create: boolean) {
  const all = await prisma.team.findMany()
  const n = norm(t.name)
  const found = all.find((x) => norm(x.name) === n) ?? all.find((x) => n.length >= 4 && (norm(x.name).includes(n) || n.includes(norm(x.name))))
  if (found) return found
  if (!create) throw new Error(`Team “${t.name}” doesn’t exist yet`)
  created.push(t.name)
  const short = t.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean)
  return prisma.team.create({
    data: { name: t.name, shortName: (short.length > 1 ? short.map((w) => w[0]).join('') : (short[0] ?? 'TEAM')).slice(0, 3).toUpperCase(), color: PALETTE[all.length % PALETTE.length]!, country: t.country ?? null, formation: t.formation ?? '4-3-3' },
  })
}

async function playersFor(teamId: string, list: ImportPlayer[], create: boolean) {
  const existing = await prisma.player.findMany({ where: { teamId } })
  const map = new Map<string, string>() // normalised name → player id
  let createdN = 0
  let matched = 0
  for (const p of list) {
    const n = norm(p.name)
    const last = n.split(' ').slice(-1)[0]!
    let hit = existing.find((e) => norm(e.name) === n) ?? existing.find((e) => p.jersey != null && e.jersey === p.jersey && norm(e.name).split(' ').slice(-1)[0] === last)
    if (hit) matched++
    else if (create) {
      hit = await prisma.player.create({ data: { name: p.name, jersey: p.jersey, positions: p.position ? [p.position] : [], nationality: p.country ?? null, teamId, notes: '' } })
      existing.push(hit)
      createdN++
    }
    if (hit) map.set(n, hit.id)
  }
  return { map, createdN, matched }
}

const zone3 = (x: number, y: number) => `3x3:${Math.min(2, Math.floor((y / 100) * 3)) * 3 + Math.min(2, Math.floor((x / 100) * 3)) + 1}`

/** Write a previewed match into the database: teams, match record, lineups and (optionally) tagged clips. */
export async function applyImport(preview: MatchPreview, o: ApplyOptions): Promise<ApplyResult> {
  const createdTeams: string[] = []
  const home = await teamFor(preview.home, createdTeams, o.createMissing)
  const away = await teamFor(preview.away, createdTeams, o.createMissing)

  let matchId = o.matchId ?? null
  const data = {
    ...(preview.date ? { date: new Date(preview.date) } : {}),
    competition: preview.competition,
    venue: preview.venue,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeScore: preview.homeScore,
    awayScore: preview.awayScore,
  }
  if (matchId) {
    if (o.updateMatch) await prisma.match.update({ where: { id: matchId }, data })
  } else {
    matchId = (await prisma.match.create({ data: { ...data, date: data.date ?? new Date(), lineups: { home: [], away: [] } } })).id
  }

  let createdPlayers = 0
  let matchedPlayers = 0
  const ids = { home: new Map<string, string>(), away: new Map<string, string>() }
  if (o.importLineups) {
    for (const side of ['home', 'away'] as const) {
      const r = await playersFor(side === 'home' ? home.id : away.id, preview[side].players, o.createMissing)
      ids[side] = r.map
      createdPlayers += r.createdN
      matchedPlayers += r.matched
    }
    await prisma.match.update({ where: { id: matchId }, data: { lineups: { home: [...ids.home.values()], away: [...ids.away.values()] } } })
    for (const [side, team] of [['home', home], ['away', away]] as const) {
      if (preview[side].formation && createdTeams.includes(preview[side].name)) await prisma.team.update({ where: { id: team.id }, data: { formation: preview[side].formation! } })
    }
  }

  let clipsCreated = 0
  let clipsSkipped = 0
  const unknown = new Set<string>()
  if (o.clips) {
    const tags = new Map((await prisma.tagType.findMany()).map((t) => [t.name.toLowerCase(), t.id]))
    const video = (await prisma.video.findMany({ where: { matchId, status: 'ready' }, orderBy: { createdAt: 'asc' } })).sort((a, b) => Number(b.angle === 'Main') - Number(a.angle === 'Main'))[0]
    if (o.replaceImported) {
      const old = await prisma.clip.findMany({ where: { matchId }, select: { id: true, labels: true } })
      const ids2 = old.filter((c) => (c.labels as string[]).includes('imported')).map((c) => c.id)
      if (ids2.length) await prisma.clip.deleteMany({ where: { id: { in: ids2 } } })
    }
    const rows = []
    for (const c of o.clips) {
      const tagId = tags.get(c.tag.toLowerCase())
      if (!tagId) { unknown.add(c.tag); clipsSkipped++; continue }
      const t = (c.period === 1 ? o.firstHalfStart : o.secondHalfStart) + c.ts
      if (t < 0 || (video && video.durationSec > 0 && t > video.durationSec)) { clipsSkipped++; continue }
      const side = c.team
      const playerId = c.playerName ? (ids[side].get(norm(c.playerName)) ?? null) : null
      rows.push({
        matchId, videoId: video?.id ?? null, tagTypeId: tagId,
        startSec: +Math.max(0, t - o.preRoll).toFixed(2), endSec: +Math.max(t + o.postRoll, Math.max(0, t - o.preRoll) + 1).toFixed(2), timeSec: +t.toFixed(2),
        playerId, teamId: side === 'home' ? home.id : away.id, jersey: null, outcome: c.outcome,
        zone: c.x != null && c.y != null ? zone3(c.x, c.y) : null, x: c.x, y: c.y, endX: c.endX, endY: c.endY,
        notes: [c.playerName && !playerId ? c.playerName : '', c.notes].filter(Boolean).join(' · '), labels: ['imported'], createdById: o.userId,
      })
    }
    for (let i = 0; i < rows.length; i += 500) await prisma.clip.createMany({ data: rows.slice(i, i + 500) })
    clipsCreated = rows.length
    if (clipsCreated) await prisma.match.updateMany({ where: { id: matchId, tagStatus: 'untagged' }, data: { tagStatus: 'in_progress' } })
  }
  return { matchId, createdTeams, createdPlayers, matchedPlayers, clipsCreated, clipsSkipped, unknownTags: [...unknown] }
}
