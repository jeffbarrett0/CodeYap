import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildClipProject, safeFileName } from '../../src/shared/project/clipProject'
import { seedDataDir } from '../../src/main/project/io'
import { PROJECT_VERSION, type MediaAsset, type Project } from '../../src/shared/types'
import { createDefaultTimeline } from '../../src/shared/timeline/model'

const asset = (id: string, extra: Partial<MediaAsset> = {}) => ({ id, name: id, path: `/v/${id}.mp4`, kind: 'video', durationSec: 100, width: 1920, height: 1080, fps: 60, audioStreams: [], ...extra }) as unknown as MediaAsset
const base = (): Project => ({ version: PROJECT_VERSION, id: 'p', name: 'Ana', createdAt: '', updatedAt: '', assets: [asset('a1', { sources: { voice: 'a2' } as never }), asset('a2'), asset('a3')], timeline: createDefaultTimeline(), chatLogs: [], candidates: [], markers: { a1: [{ time: 3 } as never] }, searchHistory: ['x'], transcriptRefs: {}, exportJobs: [] })

describe('buildClipProject', () => {
  it('yalnızca ilgili ve bağlı varlıkları alır; kaynak projeyi DEĞİŞTİRMEZ', () => {
    const src = base()
    const snap = JSON.stringify(src)
    const p = buildClipProject(src, 'a1', 'Klip')!
    expect(p.assets.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(p.id).not.toBe(src.id)
    expect(p.timeline.tracks.flatMap((t) => t.clips)).toHaveLength(0)
    expect(p.searchHistory).toEqual([])
    p.assets[0].name = 'değişti'
    expect(JSON.stringify(src)).toBe(snap)
  })
  it('bilinmeyen varlık → null', () => expect(buildClipProject(base(), 'yok', 'x')).toBeNull())
})

describe('safeFileName', () => {
  it('yasak karakterleri temizler, Türkçe karakter korunur', () => {
    expect(safeFileName('Ğüzel: "söz"/klip?')).toBe('Ğüzel_ _söz__klip_')
    expect(safeFileName('   ')).toBe('klip')
  })
})

describe('seedDataDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-seed-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it('yalnızca verilen dosyaları taşır, kaynağı bozmaz, olmayanı atlar', async () => {
    const from = join(dir, 'a-data')
    const to = join(dir, 'b-data')
    mkdirSync(join(from, 'transcripts'), { recursive: true })
    writeFileSync(join(from, 'transcripts', 'a1.json'), '{"k":1}')
    writeFileSync(join(from, 'baska.bin'), 'x')
    await seedDataDir(from, to, ['transcripts/a1.json', 'yok/dosya.m4a'])
    expect(readFileSync(join(to, 'transcripts', 'a1.json'), 'utf8')).toBe('{"k":1}')
    expect(existsSync(join(to, 'baska.bin'))).toBe(false)
    expect(readFileSync(join(from, 'transcripts', 'a1.json'), 'utf8')).toBe('{"k":1}')
  })
})
