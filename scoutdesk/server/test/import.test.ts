import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma } from '../src/db.js'
import { norm } from '../src/lib/import/apply.js'
import { mapHudlEvents, parseHudlRef, positionCode, type RawEvent } from '../src/lib/import/hudl.js'
import { assertPublicUrl } from '../src/lib/import/net.js'
import { parseSofaScoreId } from '../src/lib/import/sofascore.js'

const json = (r: { json: () => unknown }) => r.json() as any
const analyst = { 'x-user-id': 'u_analyst' }

describe('link parsing', () => {
  it('reads SofaScore ids from the usual URL shapes', () => {
    expect(parseSofaScoreId('https://www.sofascore.com/football/match/brazil-belgium/gsU#id:7352131')).toBe(7352131)
    expect(parseSofaScoreId('https://api.sofascore.com/api/v1/event/12437631')).toBe(12437631)
    expect(parseSofaScoreId('https://www.sofascore.com/team/football/arsenal/42')).toBeNull()
  })
  it('recognises Hudl open-data references', () => {
    expect(parseHudlRef('8650')).toEqual({ matchId: 8650 })
    expect(parseHudlRef('https://github.com/hudl/open-data/blob/master/data/events/3869685.json')).toEqual({ matchId: 3869685 })
    expect(parseHudlRef('https://raw.githubusercontent.com/hudl/open-data/master/data/lineups/8650.json')).toEqual({ matchId: 8650 })
    expect(parseHudlRef('https://github.com/hudl/open-data')).toEqual({ browse: {} })
    expect(parseHudlRef('https://github.com/hudl/open-data/blob/master/data/matches/43/3.json')).toEqual({ browse: { competitionId: 43, seasonId: 3 } })
    expect(parseHudlRef('https://www.transfermarkt.com/x')).toBeNull()
  })
  it('maps positions and normalises names', () => {
    expect(['Goalkeeper', 'Right Back', 'Left Center Back', 'Right Wing Back', 'Center Defensive Midfield', 'Left Center Midfield', 'Right Attacking Midfield', 'Left Wing', 'Striker', 'Left Midfield', 'Left Back'].map(positionCode))
      .toEqual(['GK', 'RB', 'CB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'ST', 'LM', 'LB'])
    expect(norm('Mousa Sidi Yaya Dembélé')).toBe('mousa sidi yaya dembele')
  })
})

describe('SSRF protection', () => {
  it.each(['http://example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x', 'https://[::1]/x', 'not a url'])('refuses %s', async (u) => {
    await expect(assertPublicUrl(u)).rejects.toThrow()
  })
})

describe('event mapping', () => {
  const ev = (type: string, extra: Partial<RawEvent> = {}): RawEvent => ({ type: { name: type }, period: 1, timestamp: '00:10:05.000', minute: 10, second: 5, team: { name: 'Home' }, player: { name: 'A B' }, location: [60, 40], ...extra })
  const run = (events: RawEvent[], pressures = false) => mapHudlEvents(events, 'Home', { includePressures: pressures })
  it('turns shots, passes and defensive actions into our tags and outcomes', () => {
    const { clips } = run([
      ev('Shot', { shot: { outcome: { name: 'Goal' }, statsbomb_xg: 0.4, end_location: [120, 40, 1] } }),
      ev('Shot', { shot: { outcome: { name: 'Saved' } } }),
      ev('Shot', { shot: { outcome: { name: 'Off T' } } }),
      ev('Pass', { pass: { shot_assist: true, end_location: [100, 40] } }),
      ev('Pass', { pass: { cross: true, outcome: { name: 'Incomplete' } } }),
      ev('Pass', {}), // plain passes are skipped (too many to be useful)
      ev('Duel', { duel: { type: { name: 'Tackle' }, outcome: { name: 'Won' } } }),
      ev('Foul Committed', { foul_committed: { card: { name: 'Yellow Card' } } }),
      ev('Goal Keeper', { goalkeeper: { type: { name: 'Shot Saved' } } }),
    ])
    expect(clips.map((c) => `${c.tag}:${c.outcome}`)).toEqual(['Goal:success', 'Shot on target:neutral', 'Shot:neutral', 'Key pass:success', 'Cross:fail', 'Tackle:success', 'Foul:fail', 'Card:fail', 'Save:success'])
    expect(clips[0]).toMatchObject({ x: 50, y: 50, endX: 100, team: 'home', ts: 605 })
    expect(clips[0]!.notes).toContain('xG 0.40')
  })
  it('counts pressures separately and only includes them on request', () => {
    expect(run([ev('Pressure')]).clips).toHaveLength(0)
    expect(run([ev('Pressure')]).pressureCount).toBe(1)
    expect(run([ev('Pressure')], true).clips[0]!.tag).toBe('Pressing action')
  })
  it('skips extra time and assigns the away side', () => {
    const r = run([ev('Shot', { period: 3, shot: { outcome: { name: 'Goal' } } }), ev('Error', { team: { name: 'Away' } })])
    expect(r.outsideTwoHalves).toBe(1)
    expect(r.clips).toHaveLength(1)
    expect(r.clips[0]).toMatchObject({ tag: 'Error', team: 'away' })
  })
})

// Real data from github.com/hudl/open-data. Skipped automatically when GitHub isn't reachable.
const online = await fetch('https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json', { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false)

describe.skipIf(!online)('Hudl open data (live)', () => {
  let app: FastifyInstance
  let matchId: string | undefined
  beforeAll(async () => { app = await buildApp() })
  afterAll(async () => {
    if (matchId) await prisma.match.deleteMany({ where: { id: matchId } })
    await prisma.player.deleteMany({ where: { team: { name: { in: ['Brazil', 'Belgium'] } } } })
    await prisma.team.deleteMany({ where: { name: { in: ['Brazil', 'Belgium'] } } })
    await app.close()
  })

  it('lists competitions and matches', async () => {
    const comps = json(await app.inject({ url: '/api/import/hudl/competitions', headers: analyst }))
    expect(comps.length).toBeGreaterThan(20)
    const wc = comps.find((c: any) => c.name === 'FIFA World Cup' && c.season === '2018')
    const ms = json(await app.inject({ url: `/api/import/hudl/matches?competitionId=${wc.competitionId}&seasonId=${wc.seasonId}`, headers: analyst }))
    expect(ms.length).toBe(64)
  }, 60_000)

  it('previews Brazil v Belgium from a GitHub link, then imports teams, lineups and events', async () => {
    const pv = json(await app.inject({ method: 'POST', url: '/api/import/preview', headers: analyst, payload: { url: 'https://github.com/hudl/open-data/blob/master/data/events/8650.json' } }))
    expect(pv.kind).toBe('preview')
    expect(pv.preview).toMatchObject({ date: '2018-07-06', home: { name: 'Brazil' }, away: { name: 'Belgium' }, homeScore: 1, awayScore: 2, source: 'hudl' })
    expect(pv.preview.competition).toContain('FIFA World Cup')
    expect(pv.preview.home.players.filter((p: any) => p.starter)).toHaveLength(11)
    expect(pv.preview.home.formation).toMatch(/^\d(-\d)+$/)
    expect(pv.events.available).toBe(true)
    expect(pv.events.summary.find((s: any) => s.tag === 'Goal').count).toBe(3) // 1 Brazil + 1 Belgium + 1 Belgium own-goal-for (final score 1–2)
    const ap = json(await app.inject({ method: 'POST', url: '/api/import/apply', headers: analyst, payload: { previewId: pv.previewId, importEvents: true, firstHalfStart: 60, secondHalfStart: 3900 } }))
    matchId = ap.matchId
    expect(ap.createdTeams.sort()).toEqual(['Belgium', 'Brazil'])
    expect(ap.createdPlayers).toBeGreaterThan(25)
    expect(ap.clipsCreated).toBeGreaterThan(200)
    const m = await prisma.match.findUniqueOrThrow({ where: { id: ap.matchId }, include: { homeTeam: true, awayTeam: true } })
    expect([m.homeTeam.name, m.awayTeam.name, m.homeScore, m.awayScore]).toEqual(['Brazil', 'Belgium', 1, 2])
    expect(m.date.toISOString().slice(0, 10)).toBe('2018-07-06')
    expect(((m.lineups as any).home as string[]).length).toBeGreaterThanOrEqual(11)
    const goals = await prisma.clip.findMany({ where: { matchId: ap.matchId, tagType: { name: 'Goal' } }, orderBy: { timeSec: 'asc' } })
    expect(goals.length).toBeGreaterThanOrEqual(2)
    expect(goals[0]!.timeSec).toBeGreaterThanOrEqual(60) // offset by first-half kick-off in the video
    expect(goals.filter((g) => g.playerId).length).toBe(2) // real goals are linked to the created roster; the own goal has no scorer on this side
    // re-import replaces, never duplicates
    const again = json(await app.inject({ method: 'POST', url: '/api/import/apply', headers: analyst, payload: { previewId: pv.previewId, matchId: ap.matchId, importEvents: true } }))
    expect(again.matchId).toBe(ap.matchId)
    expect(await prisma.clip.count({ where: { matchId: ap.matchId } })).toBe(again.clipsCreated)
    expect(again.createdTeams).toEqual([])
  }, 120_000)

  it('shows the browse flow for the repo link and rejects unknown ids', async () => {
    expect(json(await app.inject({ method: 'POST', url: '/api/import/preview', headers: analyst, payload: { url: 'https://github.com/hudl/open-data' } })).kind).toBe('browse')
    expect((await app.inject({ method: 'POST', url: '/api/import/preview', headers: analyst, payload: { hudlMatchId: 1 } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/import/preview', headers: { 'x-user-id': 'u_viewer' }, payload: { url: '8650' } })).statusCode).toBe(403)
  }, 120_000)
})

describe('JSON files the user already has', () => {
  let app: FastifyInstance
  beforeAll(async () => { app = await buildApp() })
  afterAll(async () => {
    await prisma.player.deleteMany({ where: { name: { in: ['Ada One', 'Bob Two'] } } })
    await prisma.team.deleteMany({ where: { name: { in: ['Alpha FC', 'Beta United'] } } })
    await app.close()
  })
  const post = (body: unknown) => app.inject({ method: 'POST', url: '/api/import/preview-json', headers: analyst, payload: body as object })

  const simple = {
    date: '2025-03-02', competition: 'Test League', venue: 'Test Park', homeScore: 2, awayScore: 1,
    home: { name: 'Alpha FC', formation: '4-4-2', players: [{ name: 'Ada One', jersey: 9, position: 'st' }, 'Bob Two'] },
    away: 'Beta United',
    events: [
      { minute: 12, second: 5, team: 'home', player: 'Ada One', tag: 'Goal', outcome: 'success' },
      { minute: 63, second: 30, team: 'Beta United', tag: 'Shot' },
    ],
  }

  it('reads the simple format, including events, and imports it', async () => {
    const r = await post({ files: [{ name: 'match.json', data: simple }] })
    expect(r.statusCode).toBe(200)
    const b = json(r)
    expect(b.preview.home.name).toBe('Alpha FC')
    expect(b.preview.away.name).toBe('Beta United')
    expect(b.preview.home.players[0]).toMatchObject({ name: 'Ada One', jersey: 9, position: 'ST' })
    expect(b.events.summary.map((s: any) => s.tag).sort()).toEqual(['Goal', 'Shot'])
    const a = await app.inject({ method: 'POST', url: '/api/import/apply', headers: analyst, payload: { previewId: b.previewId, importEvents: true } })
    expect(a.statusCode).toBe(200)
    const out = json(a)
    expect(out.clipsCreated).toBe(2)
    const clips = json(await app.inject({ method: 'GET', url: `/api/clips?matchId=${out.matchId}`, headers: analyst }))
    // 63:30 on the match clock is 18:30 into the second half
    expect(clips.some((c: any) => c.timeSec === 3600 + 18 * 60 + 30)).toBe(true)
    await prisma.match.delete({ where: { id: out.matchId } })
  })

  it('can swap home and away', async () => {
    const b = json(await post({ files: [{ name: 'match.json', data: simple }], swap: true }))
    expect(b.preview.home.name).toBe('Beta United')
    expect(b.preview.homeScore).toBe(1)
  })

  it('combines StatsBomb-style match, lineups and events files', async () => {
    const match = [{ match_id: 1, match_date: '2024-05-01', competition: { competition_name: 'Cup' }, season: { season_name: '2024' }, home_team: { home_team_name: 'Reds' }, away_team: { away_team_name: 'Blues' }, home_score: 1, away_score: 0, stadium: { name: 'Arena' } }]
    const lineups = [
      { team_name: 'Reds', lineup: [{ player_name: 'Rita Red', player_nickname: null, jersey_number: 10, positions: [{ position: 'Striker', start_reason: 'Starting XI' }] }] },
      { team_name: 'Blues', lineup: [] },
    ]
    const events = [{ type: { name: 'Shot' }, period: 1, timestamp: '00:10:00.000', minute: 10, second: 0, team: { name: 'Reds' }, player: { name: 'Rita Red' }, shot: { outcome: { name: 'Goal' } } }]
    const b = json(await post({ files: [{ name: 'matches.json', data: match }, { name: 'lineups.json', data: lineups }, { name: 'events.json', data: events }] }))
    expect(b.preview).toMatchObject({ date: '2024-05-01', venue: 'Arena', homeScore: 1, source: 'file' })
    expect(b.preview.home.players[0]).toMatchObject({ name: 'Rita Red', position: 'ST', starter: true })
    expect(b.events.summary).toEqual([{ tag: 'Goal', count: 1 }])
    expect(b.recognised.map((x: any) => x.kind)).toEqual(['Match info (StatsBomb / Hudl)', 'Lineups (StatsBomb / Hudl)', 'Events (StatsBomb / Hudl)'])
  })

  it('reads SofaScore event + lineups JSON', async () => {
    const event = { event: { homeTeam: { name: 'Lions' }, awayTeam: { name: 'Tigers' }, startTimestamp: 1700000000, homeScore: { current: 3 }, awayScore: { current: 3 }, tournament: { name: 'Liga' } } }
    const lineups = { home: { formation: '4-3-3', players: [{ player: { name: 'Leo Lion', position: 'F' }, jerseyNumber: 9, substitute: false }] }, away: { players: [] } }
    const b = json(await post({ files: [{ name: 'e.json', data: event }, { name: 'l.json', data: lineups }] }))
    expect(b.preview).toMatchObject({ date: '2023-11-14', homeScore: 3 })
    expect(b.preview.home).toMatchObject({ name: 'Lions', formation: '4-3-3' })
    expect(b.preview.home.players[0]).toMatchObject({ name: 'Leo Lion', position: 'ST', jersey: 9 })
  })

  it('explains unrecognised files', async () => {
    const r = await post({ files: [{ name: 'junk.json', data: { hello: 'world' } }] })
    expect(r.statusCode).toBe(400)
    expect(json(r).error ?? json(r).message).toMatch(/recognise/)
  })
})
