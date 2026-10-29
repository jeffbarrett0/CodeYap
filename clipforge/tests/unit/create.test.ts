import { describe, expect, it } from 'vitest'
import { clipItemsForSource } from '@shared/timeline/create'
import { createDefaultTimeline, findClip } from '@shared/timeline/model'
import { cmd } from '@shared/timeline/commands'
import * as ops from '@shared/timeline/ops'
import type { MediaAsset } from '@shared/types'

const audio = (i: number) => ({ index: i, streamIndex: i + 1, codec: 'aac', channels: 2, sampleRate: 48000 })
const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a1', name: 'yayın.mkv', path: '/x/yayın.mkv', kind: 'video', container: 'mkv', durationSec: 3600, width: 1920, height: 1080, fps: 60, sizeBytes: 1,
  audioStreams: [audio(0), audio(1), audio(2)], obs: { isObs: true, encoder: 'x264', evidence: [] }, chapters: [], transcriptionTrack: 0, audioMap: { mix: 0, game: 1, voice: 2 }, importedAt: '', ...over
})

describe('sonuçtan klip oluşturma', () => {
  it('ekran + oyun/konuşma sesi ayrı iz; kaynak zaman damgası meta veride; aynı grup', () => {
    const items = clipItemsForSource(asset(), { start: 1394, end: 1424 }, 0, { query: 'Victor Nelson', resultId: 'r-1', matchTime: 1402 })
    expect(items.map((i) => i.trackId).sort()).toEqual(['A1', 'A2', 'V1'])
    const v = items.find((i) => i.trackId === 'V1')!.clip
    expect(v).toMatchObject({ srcIn: 1394, srcOut: 1424, start: 0 })
    expect(v.origin).toMatchObject({ assetId: 'a1', sourceStart: 1394, sourceEnd: 1424, query: 'Victor Nelson', matchTime: 1402 })
    expect(new Set(items.map((i) => i.clip.groupId)).size).toBe(1)
    expect(items.find((i) => i.trackId === 'A1')!.clip.audioStream).toBe(1)
    expect(items.find((i) => i.trackId === 'A2')!.clip.audioStream).toBe(2)
    expect(v.label).toContain('23:14')
  })

  it('tek ses track\'i varsa karışım A1\'e', () => {
    const items = clipItemsForSource(asset({ audioStreams: [audio(0)], audioMap: { mix: 0 } }), { start: 10, end: 20 }, 5)
    expect(items.map((i) => i.trackId).sort()).toEqual(['A1', 'V1'])
    expect(items[0].clip.start).toBe(5)
  })

  it('kaynak süresini aşmaz; sessiz kayıtta ses klibi yok', () => {
    const items = clipItemsForSource(asset({ audioStreams: [], durationSec: 100 }), { start: 90, end: 130 }, 0)
    expect(items).toHaveLength(1)
    expect(items[0].clip.srcOut).toBe(100)
  })

  it('tek dosyadaki kamera bölgesi kırpma olarak V2\'ye; ayrı kamera dosyası ofsetle', () => {
    const region = { x: 0.75, y: 0.7, w: 0.25, h: 0.3 }
    const single = clipItemsForSource(asset({ webcamRegion: region }), { start: 10, end: 20 }, 0)
    expect(single.find((i) => i.trackId === 'V2')!.clip).toMatchObject({ assetId: 'a1', crop: region, srcIn: 10 })
    const cam = asset({ id: 'cam', name: 'kamera.mp4', durationSec: 3600, syncOffsetSec: 1.5, audioStreams: [], webcamRegion: undefined })
    const sep = clipItemsForSource(asset(), { start: 10, end: 20 }, 0, {}, cam)
    expect(sep.find((i) => i.trackId === 'V2')!.clip).toMatchObject({ assetId: 'cam', srcIn: 11.5, srcOut: 21.5 })
  })

  it('timeline\'a eklenir, geri alınır', () => {
    const tl0 = createDefaultTimeline()
    const items = clipItemsForSource(asset(), { start: 10, end: 40 }, 0)
    const c = cmd.addClips(items)
    const tl1 = c.do(tl0)
    expect(findClip(tl1, items[0].clip.id)).not.toBeNull()
    expect(c.undo(tl1)).toBe(tl0)
    // ikinci klip sona eklenir ve çakışmaz
    const items2 = clipItemsForSource(asset(), { start: 100, end: 130 }, 30)
    const tl2 = ops.addClip(tl1, 'V1', items2[0].clip)
    expect(tl2.tracks.find((t) => t.id === 'V1')!.clips).toHaveLength(2)
  })
})
