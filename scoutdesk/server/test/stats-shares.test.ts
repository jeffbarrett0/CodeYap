import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma } from '../src/db.js'
import { computeStats } from '../src/lib/stats.js'

const json = (r: { json: () => unknown }) => r.json() as any
const analyst = { 'x-user-id': 'u_analyst' }
let app: FastifyInstance
beforeAll(async () => { app = await buildApp() })
afterAll(async () => { await prisma.shareLink.deleteMany({ where: { label: { contains: 'Rivermouth' } } }); await prisma.shareLink.deleteMany({ where: { label: 'T8 pl' } }); await prisma.playlist.deleteMany({ where: { title: 'T8 pl' } }); await app.close() })

describe('computeStats', () => {
  const names: Record<string, string> = { a: 'Shot', b: 'Shot on target', c: 'Goal', d: 'Key pass', e: 'Duel won', f: 'Duel lost', g: 'Aerial duel', h: 'Dribble', i: 'Tackle' }
  const row = (t: string, outcome: 'success' | 'fail' | 'neutral', matchId = 'm1') => ({ tagTypeId: t, matchId, outcome, playerId: 'p', teamId: 't' })
  const s = computeStats([row('a', 'neutral'), row('b', 'success'), row('c', 'success', 'm2'), row('d', 'success'), row('d', 'fail'), row('e', 'success'), row('f', 'fail'), row('g', 'success'), row('g', 'fail'), row('h', 'success'), row('i', 'success')], (id) => names[id] ?? '')
  it('counts shots, targets and goals (a goal is a shot on target)', () => expect([s.shots, s.shotsOnTarget, s.goals]).toEqual([3, 2, 1]))
  it('derives pass accuracy from key passes', () => expect([s.passesAttempted, s.passesCompleted, s.passAccuracy]).toEqual([2, 1, 50]))
  it('derives duels incl. aerial outcomes', () => expect([s.duelsWon, s.duelsLost, s.duelsWonPct]).toEqual([2, 2, 50]))
  it('counts distinct matches (+ lineup-only matches)', () => {
    expect(s.matches).toBe(2)
    expect(computeStats([], () => '', ['x', 'y']).matches).toBe(2)
  })
  it('returns null rates with no data', () => expect(computeStats([], () => '').passAccuracy).toBeNull())
})

describe('player profile', () => {
  it('returns stats, a radar vs peers, and decorated clips', async () => {
    const p = json(await app.inject('/api/players/p_hale/profile'))
    expect(p.stats.goals).toBe(2)
    expect(p.stats.shots).toBe(4)
    expect(p.radar.axes).toHaveLength(8)
    expect(p.radar.peers).toBe('everyone') // only one forward in the seed → falls back to all other players
    expect(p.radar.axes.every((a: any) => a.value >= 0 && a.value <= 100)).toBe(true)
    expect(p.clips.every((c: any) => c.tag && c.category)).toBe(true)
    expect((await app.inject('/api/players/nope/profile')).statusCode).toBe(404)
  })
})

describe('share links', () => {
  let token: string
  it('creates a password-protected, expiring match link and serves it publicly', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/shares', headers: analyst, payload: { kind: 'match', refId: 'm_demo', password: 'hunter22', expiresInDays: 7 } })
    expect(r.statusCode).toBe(201)
    const s = json(r)
    token = s.token
    expect(s.hasPassword).toBe(true)
    expect(JSON.stringify(s)).not.toContain('passwordHash')
    expect((await app.inject(`/api/public/shares/${token}`)).statusCode).toBe(401)
    const wrong = await app.inject({ url: `/api/public/shares/${token}`, headers: { 'x-share-password': 'nope' } })
    expect(wrong.statusCode).toBe(403)
    const ok = await app.inject({ url: `/api/public/shares/${token}`, headers: { 'x-share-password': 'hunter22' } })
    expect(ok.statusCode).toBe(200)
    const body = json(ok)
    expect(body.kind).toBe('match')
    expect(body.clips.length).toBeGreaterThanOrEqual(30)
    expect(body.videos[0].streamUrl).toContain('/stream?exp=')
    expect((await app.inject(body.videos[0].streamUrl)).statusCode).toBe(200) // the signed URL in a share works without sign-in
  })
  it('blocks brute force', async () => {
    let last = 0
    for (let i = 0; i < 12; i++) last = (await app.inject({ url: `/api/public/shares/${token}`, headers: { 'x-share-password': `bad${i}` } })).statusCode
    expect(last).toBe(429)
  })
  it('expired and revoked links are gone', async () => {
    const pl = json(await app.inject({ method: 'POST', url: '/api/playlists', headers: analyst, payload: { title: 'T8 pl', clipIds: ['c_seed_01'] } }))
    const s = json(await app.inject({ method: 'POST', url: '/api/shares', headers: analyst, payload: { kind: 'playlist', refId: pl.id } }))
    const open = await app.inject(`/api/public/shares/${s.token}`)
    expect(open.statusCode).toBe(200)
    expect(json(open).items[0].clip.tag).toBeTruthy()
    await prisma.shareLink.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await app.inject(`/api/public/shares/${s.token}`)).statusCode).toBe(410)
    await app.inject({ method: 'DELETE', url: `/api/shares/${s.id}`, headers: analyst })
    expect((await app.inject(`/api/public/shares/${s.token}`)).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/shares', headers: { 'x-user-id': 'u_viewer' }, payload: { kind: 'match', refId: 'm_demo' } })).statusCode).toBe(403)
  })
})

describe('PDF reports', () => {
  const post = (url: string, payload: object, headers = analyst) => app.inject({ method: 'POST', url, headers, payload })
  it('generates a player report PDF with real content', async () => {
    const r = await post('/api/reports/player', { playerId: 'p_hale', notes: 'T8 written note' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    expect(r.rawPayload.length).toBeGreaterThan(5000)
  })
  it('generates a team report and honours explicit clip selection', async () => {
    expect((await post('/api/reports/team', { teamId: 't_nbfc' })).statusCode).toBe(200)
    expect((await post('/api/reports/team', { teamId: 't_rmu', clipIds: ['c_seed_05'] })).statusCode).toBe(200)
  })
  it('404s on unknown subjects, 403s viewers', async () => {
    expect((await post('/api/reports/player', { playerId: 'nope' })).statusCode).toBe(404)
    expect((await post('/api/reports/player', { playerId: 'p_hale' }, { 'x-user-id': 'u_viewer' })).statusCode).toBe(403)
  })
})
