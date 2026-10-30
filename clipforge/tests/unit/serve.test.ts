import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseRange, serveFile } from '../../src/main/media/serve'

describe('parseRange', () => {
  it('başlık yoksa tüm dosya', () => expect(parseRange(null, 1000)).toBe('none'))
  it('a-b, a-, -n biçimleri', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual([0, 99])
    expect(parseRange('bytes=900-', 1000)).toEqual([900, 999])
    expect(parseRange('bytes=-100', 1000)).toEqual([900, 999])
    expect(parseRange('bytes=500-5000', 1000)).toEqual([500, 999])
  })
  it('aralık dışı → 416', () => expect(parseRange('bytes=2000-', 1000)).toBeNull())
})

describe('serveFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-serve-'))
  const f = join(dir, 'çğ dosya.mp4')
  writeFileSync(f, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251)))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it('Range → 206 + doğru bayt ve Content-Range', async () => {
    const r = await serveFile(f, 'bytes=10-19')
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual(Array.from({ length: 10 }, (_, i) => (10 + i) % 251))
  })
  it('Range yok → 200 tam boyut, Accept-Ranges', async () => {
    const r = await serveFile(f, null)
    expect(r.status).toBe(200)
    expect(r.headers.get('accept-ranges')).toBe('bytes')
    expect((await r.arrayBuffer()).byteLength).toBe(1000)
  })
  it('geçersiz aralık → 416', async () => expect((await serveFile(f, 'bytes=5000-')).status).toBe(416))
})
