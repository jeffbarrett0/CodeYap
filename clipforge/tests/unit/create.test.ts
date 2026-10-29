import { describe, expect, it } from 'vitest'
import { clipItemsForSource, clipForTrack } from '@shared/timeline/create'
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

describe('ayrı dosyalar (ekran / oyun sesi / konuşma / kamera)', () => {
  const vid = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => asset({ id, name: id + '.mp4', audioStreams: [], audioMap: { mix: 0 }, durationSec: 1000, ...over })
  const aud = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => asset({ id, name: id + '.wav', kind: 'audio', width: 0, height: 0, audioStreams: [audio(0)], audioMap: { mix: 0 }, durationSec: 1000, ...over })
  const all = new Map<string, MediaAsset>()
  const lookup = (id: string) => all.get(id)

  it('konuşma dosyasından klip: ekran, oyun sesi ve kamera bağlı dosyalardan aynı aralıkta (ofsetli) gelir', () => {
    const voice = aud('voice', { role: 'voice', sources: { screen: 'screen', game: 'game', cam: 'cam' } })
    const screen = vid('screen', { syncOffsetSec: 2 })
    const game = aud('game', { syncOffsetSec: -1 })
    const cam = vid('cam', { syncOffsetSec: 0.5 })
    ;[voice, screen, game, cam].forEach((a) => all.set(a.id, a))
    const items = clipItemsForSource(voice, { start: 100, end: 130 }, 5, { query: 'x' }, lookup)
    const by = (t: string) => items.find((i) => i.trackId === t)!.clip
    expect(items.map((i) => i.trackId).sort()).toEqual(['A1', 'A2', 'V1', 'V2'])
    expect(by('V1')).toMatchObject({ assetId: 'screen', srcIn: 102, srcOut: 132, start: 5 })
    expect(by('A1')).toMatchObject({ assetId: 'game', srcIn: 99, srcOut: 129 })
    expect(by('A2')).toMatchObject({ assetId: 'voice', srcIn: 100, srcOut: 130 })
    expect(by('V2')).toMatchObject({ assetId: 'cam', srcIn: 100.5 })
    expect(new Set(items.map((i) => i.clip.groupId)).size).toBe(1)
    expect(by('A2').origin).toMatchObject({ assetId: 'voice', sourceStart: 100 })
  })

  it('ofset negatif başlangıçta klibin başı kırpılıp zaman çizelgesinde geciktirilir', () => {
    const voice = aud('voice', { role: 'voice', sources: { game: 'game' } })
    const game = aud('game', { syncOffsetSec: -3 })
    ;[voice, game].forEach((a) => all.set(a.id, a))
    const items = clipItemsForSource(voice, { start: 1, end: 11 }, 0, {}, lookup)
    expect(items.find((i) => i.trackId === 'A1')!.clip).toMatchObject({ srcIn: 0, start: 2 })
  })

  it('rol: konuşma dosyası A2, oyun sesi dosyası A1; kamera rolündeki video V2', () => {
    const v = clipItemsForSource(aud('v', { role: 'voice' }), { start: 0, end: 10 }, 0)
    expect(v.map((i) => i.trackId)).toEqual(['A2'])
    const g = clipItemsForSource(aud('g', { role: 'game' }), { start: 0, end: 10 }, 0)
    expect(g.map((i) => i.trackId)).toEqual(['A1'])
    const c = clipItemsForSource(vid('c', { role: 'cam' }), { start: 0, end: 10 }, 0)
    expect(c.map((i) => i.trackId)).toEqual(['V2'])
  })

  it('clipForTrack: uyumluluk denetimi ve varsayılanlar', () => {
    const png = asset({ id: 'p', kind: 'image', durationSec: 0, audioStreams: [] })
    expect(clipForTrack(png, { id: 'I1', kind: 'image', role: 'image' }, { at: 3 })).toMatchObject({ clip: { srcIn: 0, srcOut: 8, start: 3 } })
    expect(clipForTrack(png, { id: 'V1', kind: 'video', role: 'screen' }, { at: 0 })).toHaveProperty('error')
    expect(clipForTrack(vid('v'), { id: 'I1', kind: 'image', role: 'image' }, { at: 0 })).toHaveProperty('error')
    expect(clipForTrack(vid('v'), { id: 'A1', kind: 'audio', role: 'game' }, { at: 0 })).toHaveProperty('error') // sessiz video
    const multi = asset({})
    expect(clipForTrack(multi, { id: 'A2', kind: 'audio', role: 'voice' }, { at: 0, srcIn: 10, duration: 5 })).toMatchObject({ clip: { audioStream: 2, srcIn: 10, srcOut: 15 } })
    expect(clipForTrack(multi, { id: 'A1', kind: 'audio', role: 'game' }, { at: 0, srcIn: 5000 })).toHaveProperty('error')
  })
})
