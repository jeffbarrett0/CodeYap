import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { VIDEO_DIR } from '../src/config.js'
import { prisma } from '../src/db.js'

/**
 * Integration tests against the seeded dev database (`npm run seed` first).
 * Everything a test creates is removed again in afterAll.
 */
let app: FastifyInstance
const analyst = { 'x-user-id': 'u_analyst' }
const viewer = { 'x-user-id': 'u_viewer' }
const admin = { 'x-user-id': 'u_admin' }
const createdClipIds: string[] = []
const createdVideoIds: string[] = []

beforeAll(async () => {
  app = await buildApp()
})
afterAll(async () => {
  await prisma.clip.deleteMany({ where: { id: { in: createdClipIds } } })
  for (const id of createdVideoIds) {
    await prisma.video.deleteMany({ where: { id } })
    fs.rmSync(path.join(VIDEO_DIR, `${id}.mp4`), { force: true })
    fs.rmSync(path.join(VIDEO_DIR, `${id}.webm`), { force: true })
  }
  await app.close()
})

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type: string }) {
  const boundary = '----scoutdesktest'
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

describe('reference data', () => {
  it('health reports counts', async () => {
    const r = await app.inject('/api/health')
    expect(r.statusCode).toBe(200)
    expect(r.json().counts.clips).toBeGreaterThanOrEqual(30)
  })

  it('serves seeded teams, players, taxonomy and matches', async () => {
    expect((await app.inject('/api/teams')).json()).toHaveLength(2)
    expect((await app.inject('/api/players')).json()).toHaveLength(3)
    const tax = (await app.inject('/api/taxonomy')).json()
    expect(tax.map((c: { name: string }) => c.name)).toEqual(['Attacking', 'Defending', 'Transitions', 'Set pieces', 'Goalkeeper', 'Negative events'])
    const hotkeys = tax.flatMap((c: { tagTypes: { hotkey: string }[] }) => c.tagTypes.map((t) => t.hotkey))
    expect(new Set(hotkeys).size).toBe(hotkeys.length) // no clashes in the default taxonomy
    const matches = (await app.inject('/api/matches')).json()
    expect(matches[0].clipCount).toBeGreaterThanOrEqual(30)
  })
})

describe('roles', () => {
  const body = { name: 'Test Team', shortName: 'TST' }
  it('rejects anonymous writes with 401', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/teams', payload: body })).statusCode).toBe(401)
  })
  it('rejects viewer writes with 403', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/teams', payload: body, headers: viewer })).statusCode).toBe(403)
  })
  it('lets analysts write but only admins edit the taxonomy', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/teams', payload: body, headers: analyst })
    expect(r.statusCode).toBe(201)
    const id = r.json().id
    const tax = await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'X', color: '#ffffff' }, headers: analyst })
    expect(tax.statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/teams/${id}`, headers: analyst })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/teams/${id}`, headers: admin })).statusCode).toBe(204)
  })
})

describe('clips', () => {
  const tagTypeId = async () => (await prisma.tagType.findFirstOrThrow({ where: { name: 'Shot' } })).id
  const mk = async (id: string, startSec = 10, endSec = 20) => ({
    id, matchId: 'm_demo', tagTypeId: await tagTypeId(), startSec, endSec, timeSec: (startSec + endSec) / 2,
  })

  it('creates with a client-supplied id, patches, batch-updates and deletes', async () => {
    const id = `t_clip_${Date.now()}`
    createdClipIds.push(id)
    const created = await app.inject({ method: 'POST', url: '/api/clips', payload: await mk(id), headers: analyst })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ id, outcome: 'neutral', labels: [], createdById: 'u_analyst' })

    const patched = await app.inject({ method: 'PATCH', url: `/api/clips/${id}`, payload: { outcome: 'success', notes: 'hi' }, headers: analyst })
    expect(patched.json()).toMatchObject({ outcome: 'success', notes: 'hi' })

    const batch = await app.inject({ method: 'POST', url: '/api/clips/batch-update', payload: { updates: [{ id, patch: { outcome: 'fail' } }] }, headers: analyst })
    expect(batch.json()[0].outcome).toBe('fail')

    const del = await app.inject({ method: 'POST', url: '/api/clips/batch-delete', payload: { ids: [id] }, headers: analyst })
    expect(del.json()).toEqual({ deleted: 1 })
    expect((await app.inject({ method: 'PATCH', url: `/api/clips/${id}`, payload: { notes: 'x' }, headers: analyst })).statusCode).toBe(404)
  })

  it('rejects inverted ranges and unknown outcomes', async () => {
    const id = `t_clip_bad_${Date.now()}`
    createdClipIds.push(id)
    expect((await app.inject({ method: 'POST', url: '/api/clips', payload: await mk(id, 30, 20), headers: analyst })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/clips', payload: { ...(await mk(id)), outcome: 'great' }, headers: analyst })).statusCode).toBe(400)
  })

  it('refuses viewer writes', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/clips', payload: await mk('t_viewer'), headers: viewer })
    expect(r.statusCode).toBe(403)
  })
})

describe('video upload + range streaming', () => {
  let id: string
  let streamUrl: string
  const data = Buffer.alloc(300_000, 7) // not a real video — exercises the transport, not the codec

  it('accepts a streamed multipart upload and reports processing → failed (not a real video)', async () => {
    const m = multipart({ title: 'Test upload', matchId: 'm_demo', angle: 'Tactical' }, { name: 'fake.mp4', data, type: 'video/mp4' })
    const r = await app.inject({ method: 'POST', url: '/api/videos', headers: { ...analyst, ...m.headers }, payload: m.payload })
    expect(r.statusCode).toBe(201)
    const v = r.json()
    id = v.id
    createdVideoIds.push(id)
    streamUrl = v.streamUrl
    expect(v).toMatchObject({ title: 'Test upload', matchId: 'm_demo', angle: 'Tactical', sizeBytes: data.length, status: 'processing' })
    expect(fs.existsSync(path.join(VIDEO_DIR, `${id}.mp4`))).toBe(true)
  })

  it('rejects unsupported file types and viewer uploads', async () => {
    const bad = multipart({}, { name: 'x.exe', data: Buffer.from('MZ'), type: 'application/octet-stream' })
    expect((await app.inject({ method: 'POST', url: '/api/videos', headers: { ...analyst, ...bad.headers }, payload: bad.payload })).statusCode).toBe(415)
    const ok = multipart({}, { name: 'x.mp4', data, type: 'video/mp4' })
    expect((await app.inject({ method: 'POST', url: '/api/videos', headers: { ...viewer, ...ok.headers }, payload: ok.payload })).statusCode).toBe(403)
  })

  it('serves 206 partial content with correct headers', async () => {
    const r = await app.inject({ url: streamUrl, headers: { range: 'bytes=100-199' } })
    expect(r.statusCode).toBe(206)
    expect(r.headers['content-range']).toBe(`bytes 100-199/${data.length}`)
    expect(r.headers['content-length']).toBe('100')
    expect(r.headers['accept-ranges']).toBe('bytes')
    expect(r.rawPayload.length).toBe(100)
  })

  it('serves open-ended and suffix ranges (what browsers use for seeking)', async () => {
    const tail = await app.inject({ url: streamUrl, headers: { range: `bytes=${data.length - 10}-` } })
    expect(tail.statusCode).toBe(206)
    expect(tail.rawPayload.length).toBe(10)
    const suffix = await app.inject({ url: streamUrl, headers: { range: 'bytes=-5' } })
    expect(suffix.headers['content-range']).toBe(`bytes ${data.length - 5}-${data.length - 1}/${data.length}`)
  })

  it('serves the full file with 200 when no Range is sent', async () => {
    const r = await app.inject(streamUrl)
    expect(r.statusCode).toBe(200)
    expect(r.rawPayload.length).toBe(data.length)
  })

  it('answers 416 for ranges past EOF', async () => {
    const r = await app.inject({ url: streamUrl, headers: { range: `bytes=${data.length + 5}-` } })
    expect(r.statusCode).toBe(416)
    expect(r.headers['content-range']).toBe(`bytes */${data.length}`)
  })

  it('rejects missing, tampered or expired signatures', async () => {
    expect((await app.inject(`/api/videos/${id}/stream`)).statusCode).toBe(403)
    expect((await app.inject(streamUrl.replace(/sig=./, 'sig=X'))).statusCode).toBe(403)
    expect((await app.inject(streamUrl.replace(/exp=\d+/, 'exp=1'))).statusCode).toBe(403)
    // a signature for one video must not unlock another
    expect((await app.inject(streamUrl.replace(id, 'v_demo'))).statusCode).toBe(403)
  })

  it('keeps signed URLs stable across reads so <video src> never reloads', async () => {
    const a = (await app.inject(`/api/videos/${id}`)).json().streamUrl
    const b = (await app.inject(`/api/videos/${id}`)).json().streamUrl
    expect(a).toBe(b)
  })

  it('ends up failed with a reason once ffprobe rejects the fake file', async () => {
    let v
    for (let i = 0; i < 40; i++) {
      v = (await app.inject(`/api/videos/${id}`)).json()
      if (v.status !== 'processing') break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(v.status).toBe('failed')
    expect(v.error).toBeTruthy()
  })

  it('deletes the row and the file (admin only)', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/videos/${id}`, headers: analyst })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/videos/${id}`, headers: admin })).statusCode).toBe(204)
    expect(fs.existsSync(path.join(VIDEO_DIR, `${id}.mp4`))).toBe(false)
  })
})

describe('real video processing', () => {
  it('probes the seeded demo video and produces a thumbnail', async () => {
    const v = (await app.inject('/api/videos/v_demo')).json()
    expect(v.status).toBe('ready')
    expect(v.durationSec).toBeCloseTo(180, 0)
    expect(v.fps).toBe(25)
    expect(v.width).toBe(1280)
    const thumb = await app.inject(v.thumbnailUrl)
    expect(thumb.statusCode).toBe(200)
    expect(thumb.headers['content-type']).toBe('image/jpeg')
  })
})
