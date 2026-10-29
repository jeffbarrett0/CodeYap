import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { EXPORT_DIR } from '../src/config.js'
import { prisma } from '../src/db.js'

let app: FastifyInstance
const analyst = { 'x-user-id': 'u_analyst' }
const viewer = { 'x-user-id': 'u_viewer' }
const admin = { 'x-user-id': 'u_admin' }
const json = (r: { json: () => unknown }) => r.json() as any

beforeAll(async () => { app = await buildApp() })
afterAll(async () => {
  await prisma.playlist.deleteMany({ where: { title: { startsWith: 'T7 ' } } })
  const jobs = await prisma.exportJob.findMany({ where: { label: { startsWith: 'T7 ' } } })
  for (const j of jobs) fs.rmSync(path.join(EXPORT_DIR, `${j.id}.mp4`), { force: true })
  await prisma.exportJob.deleteMany({ where: { label: { startsWith: 'T7 ' } } })
  await prisma.comment.deleteMany({ where: { body: { startsWith: 'T7 ' } } })
  await app.close()
})

const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString())
async function waitForJob(id: string, ms = 90_000) {
  const end = Date.now() + ms
  for (;;) {
    const j = json(await app.inject(`/api/exports/${id}`))
    if (j.status === 'done' || j.status === 'failed') return j
    if (Date.now() > end) throw new Error('export timed out')
    await new Promise((r) => setTimeout(r, 300))
  }
}

describe('playlists', () => {
  let id: string
  it('creates from clips, preserves order, expands clips + videos', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/playlists', headers: analyst, payload: { title: 'T7 Best chances', clipIds: ['c_seed_03', 'c_seed_01'] } })
    expect(r.statusCode).toBe(201)
    const p = json(r)
    id = p.id
    expect(p.items.map((i: any) => i.clip.id)).toEqual(['c_seed_03', 'c_seed_01'])
    expect(p.videos[0].streamUrl).toContain('/stream?exp=')
    expect(p.durationSec).toBeGreaterThan(15)
  })
  it('reorders, retitles and sets transitions via PUT items', async () => {
    const r = await app.inject({ method: 'PUT', url: `/api/playlists/${id}/items`, headers: analyst, payload: { items: [{ clipId: 'c_seed_01', title: 'Opener', transition: 'cut' }, { clipId: 'c_seed_03', transition: 'fade' }, { clipId: 'c_seed_01', transition: 'cut' }] } })
    const p = json(r)
    expect(p.items.map((i: any) => [i.clip.id, i.title, i.transition])).toEqual([['c_seed_01', 'Opener', 'cut'], ['c_seed_03', null, 'fade'], ['c_seed_01', null, 'cut']])
  })
  it('rejects unknown clips and viewer writes', async () => {
    expect((await app.inject({ method: 'PUT', url: `/api/playlists/${id}/items`, headers: analyst, payload: { items: [{ clipId: 'nope' }] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/playlists', headers: viewer, payload: { title: 'T7 x' } })).statusCode).toBe(403)
  })
  it('lists with counts and duration', async () => {
    const l = json(await app.inject('/api/playlists')).find((p: any) => p.id === id)
    expect(l.itemCount).toBe(3)
  })
})

describe('FFmpeg export queue', () => {
  it('exports one clip as H.264 MP4 of the right length and serves it as a download', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/exports', headers: analyst, payload: { kind: 'clip', refId: 'c_seed_01' } })
    expect(r.statusCode).toBe(201)
    await prisma.exportJob.update({ where: { id: json(r).id }, data: { label: 'T7 clip' } })
    const job = await waitForJob(json(r).id)
    expect(job.status, job.error).toBe('done')
    expect(job.progress).toBe(1)
    const file = path.join(EXPORT_DIR, `${job.id}.mp4`)
    const info = probe(file)
    const v = info.streams.find((s: any) => s.codec_type === 'video')
    expect(v.codec_name).toBe('h264')
    expect(`${v.width}x${v.height}`).toBe('1280x720')
    expect(info.streams.some((s: any) => s.codec_type === 'audio')).toBe(true) // silent track is added when the source has none
    const clip = await prisma.clip.findUniqueOrThrow({ where: { id: 'c_seed_01' } })
    expect(Number(info.format.duration)).toBeCloseTo(clip.endSec - clip.startSec, 0)
    const dl = await app.inject(job.downloadUrl)
    expect(dl.statusCode).toBe(200)
    expect(dl.headers['content-disposition']).toContain('attachment')
    expect((await app.inject(`/api/exports/${job.id}/download`)).statusCode).toBe(403)
  }, 120_000)

  it('exports a playlist with a fade transition into one continuous file', async () => {
    const pl = json(await app.inject({ method: 'POST', url: '/api/playlists', headers: analyst, payload: { title: 'T7 export', clipIds: ['c_seed_01', 'c_seed_03'] } }))
    await app.inject({ method: 'PUT', url: `/api/playlists/${pl.id}/items`, headers: analyst, payload: { items: [{ clipId: 'c_seed_01', transition: 'cut' }, { clipId: 'c_seed_03', transition: 'fade' }] } })
    const r = await app.inject({ method: 'POST', url: '/api/exports', headers: analyst, payload: { kind: 'playlist', refId: pl.id } })
    await prisma.exportJob.update({ where: { id: json(r).id }, data: { label: 'T7 playlist' } })
    const job = await waitForJob(json(r).id)
    expect(job.status, job.error).toBe('done')
    const info = probe(path.join(EXPORT_DIR, `${job.id}.mp4`))
    const clips = await prisma.clip.findMany({ where: { id: { in: ['c_seed_01', 'c_seed_03'] } } })
    const expected = clips.reduce((a, c) => a + (c.endSec - c.startSec), 0)
    expect(Number(info.format.duration)).toBeCloseTo(expected, 0)
    expect(job.fileName).toBe('T7_export.mp4')
  }, 180_000)

  it('rejects empty playlists, missing refs and viewers; fails cleanly on a missing source', async () => {
    const empty = json(await app.inject({ method: 'POST', url: '/api/playlists', headers: analyst, payload: { title: 'T7 empty' } }))
    expect((await app.inject({ method: 'POST', url: '/api/exports', headers: analyst, payload: { kind: 'playlist', refId: empty.id } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/exports', headers: analyst, payload: { kind: 'clip', refId: 'nope' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/exports', headers: viewer, payload: { kind: 'clip', refId: 'c_seed_01' } })).statusCode).toBe(403)
  })
})

describe('comments', () => {
  it('supports threads, validates parents, and restricts deletion', async () => {
    const top = json(await app.inject({ method: 'POST', url: '/api/comments', headers: analyst, payload: { clipId: 'c_seed_03', body: 'T7 Great finish, see @0:16 for the keeper' } }))
    expect(top.author.name).toBe('Sam Rivera')
    const reply = json(await app.inject({ method: 'POST', url: '/api/comments', headers: admin, payload: { clipId: 'c_seed_03', parentId: top.id, body: 'T7 Agreed' } }))
    expect(reply.parentId).toBe(top.id)
    expect((await app.inject({ method: 'POST', url: '/api/comments', headers: analyst, payload: { clipId: 'c_seed_01', parentId: top.id, body: 'T7 wrong clip' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/comments', headers: viewer, payload: { clipId: 'c_seed_03', body: 'T7 hi' } })).statusCode).toBe(403)
    const list = json(await app.inject('/api/comments?clipId=c_seed_03'))
    expect(list.filter((c: any) => c.body.startsWith('T7 ')).length).toBe(2)
    expect((await app.inject({ method: 'DELETE', url: `/api/comments/${reply.id}`, headers: analyst })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/comments/${top.id}`, headers: analyst })).statusCode).toBe(204)
    expect(json(await app.inject('/api/comments?clipId=c_seed_03')).some((c: any) => c.id === reply.id)).toBe(false) // thread cascades
  })
})

describe('snapshots', () => {
  it('stores and serves a snapshot, then deletes it', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const b = '----snap'
    const payload = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="matchId"\r\n\r\nm_demo\r\n--${b}\r\nContent-Disposition: form-data; name="timeSec"\r\n\r\n78.2\r\n--${b}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nGoal build-up\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="s.png"\r\nContent-Type: image/png\r\n\r\n`),
      png, Buffer.from(`\r\n--${b}--\r\n`),
    ])
    const r = await app.inject({ method: 'POST', url: '/api/snapshots', headers: { ...analyst, 'content-type': `multipart/form-data; boundary=${b}` }, payload })
    expect(r.statusCode).toBe(201)
    const s = json(r)
    expect(s).toMatchObject({ matchId: 'm_demo', timeSec: 78.2, caption: 'Goal build-up' })
    expect((await app.inject(s.url)).headers['content-type']).toBe('image/png')
    expect(json(await app.inject('/api/snapshots?matchId=m_demo')).some((x: any) => x.id === s.id)).toBe(true)
    expect((await app.inject({ method: 'DELETE', url: `/api/snapshots/${s.id}`, headers: analyst })).statusCode).toBe(204)
  })
})
