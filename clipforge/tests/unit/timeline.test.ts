import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, clipEnd, findClip, timelineDuration, TRACK_IDS } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { History } from '@shared/timeline/history'
import { cmd } from '@shared/timeline/commands'
import { captionsForTimeline, captionsFromWords, wrapCaption } from '@shared/timeline/captions'
import type { Clip, Timeline } from '@shared/types'
import { wordsFromLines, createTimelineWithGame } from './helpers'

const mk = (id: string, trackId: string, start: number, srcIn: number, srcOut: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId, assetId: 'a1', start, srcIn, srcOut, volume: 1, label: id, ...extra
})
const clipsOf = (tl: Timeline, trackId: string) => tl.tracks.find((t) => t.id === trackId)!.clips

function base(): Timeline {
  let tl = createTimelineWithGame()
  tl = ops.addClip(tl, TRACK_IDS.screen, mk('v1', TRACK_IDS.screen, 0, 100, 110, { groupId: 'g1' }))
  tl = ops.addClip(tl, TRACK_IDS.game, mk('a1', TRACK_IDS.game, 0, 100, 110, { groupId: 'g1', audioStream: 1 }))
  tl = ops.addClip(tl, TRACK_IDS.screen, mk('v2', TRACK_IDS.screen, 12, 500, 505))
  return tl
}

describe('zaman çizelgesi işlemleri', () => {
  it('GERÇEK varsayılan: yalnızca tek tam kare Video katmanı; görsel/metin/oyun ekranı yok; oran otomatik; hiçbir alan dolu değil', () => {
    const tl = createDefaultTimeline()
    expect(tl.tracks.map((t) => t.id)).toEqual(['V1', 'V2', 'V3', 'I1', 'I2', 'A1'])
    expect(tl.tracks.map((t) => t.name)).toEqual(['Video 1', 'Video 2', 'Video 3', 'Fotoğraf 1', 'Fotoğraf 2', 'Ses']) // Konuşma izi yok
    expect(tl.tracks.some((t) => t.kind === 'text')).toBe(false)
    expect(tl.tracks.flatMap((t) => t.clips)).toEqual([])
    expect(tl.aspectAuto).toBe(true) // ilk video eklenince videonun boyutuna göre
    const video = tl.tracks.find((t) => t.id === 'V1')!
    expect(video.name).toBe('Video 1')
    expect(video.placement).toMatchObject({ fit: 'contain', visible: true, rect: { x: 0, y: 0, w: 1, h: 1 } })
  })

  it('ekleme çakışmayı önler', () => {
    const tl = ops.addClip(base(), TRACK_IDS.screen, mk('x', TRACK_IDS.screen, 5, 0, 4))
    const c = clipsOf(tl, 'V1')
    expect(c.map((x) => x.id)).toEqual(['v1', 'v2', 'x'].sort((a, b) => c.find((k) => k.id === a)!.start - c.find((k) => k.id === b)!.start))
    for (let i = 1; i < c.length; i++) expect(c[i].start).toBeGreaterThanOrEqual(clipEnd(c[i - 1]) - 1e-9)
  })

  it('taşıma grup üyelerini birlikte kaydırır; komşu klibin içine girmez', () => {
    let tl = ops.moveClip(base(), 'v1', 30)
    expect(findClip(tl, 'v1')!.clip.start).toBe(30)
    expect(findClip(tl, 'a1')!.clip.start).toBe(30)
    // v2 (12-17) üzerine taşımaya çalış → yapışır, çakışmaz
    tl = ops.moveClip(base(), 'v1', 8)
    const v1 = findClip(tl, 'v1')!.clip
    const v2 = findClip(tl, 'v2')!.clip
    expect(v1.start >= clipEnd(v2) - 1e-9 || clipEnd(v1) <= v2.start + 1e-9).toBe(true)
    // negatif başlangıç engellenir
    expect(findClip(ops.moveClip(base(), 'v2', -5), 'v2')!.clip.start).toBeGreaterThanOrEqual(0)
  })

  it('kenardan kırpma: başlangıç kaynak girişini, bitiş çıkışını değiştirir', () => {
    let tl = ops.trimStart(base(), 'v2', 14)
    let c = findClip(tl, 'v2')!.clip
    expect(c).toMatchObject({ start: 14, srcIn: 502, srcOut: 505 })
    tl = ops.trimEnd(base(), 'v2', 15)
    c = findClip(tl, 'v2')!.clip
    expect(c).toMatchObject({ start: 12, srcIn: 500, srcOut: 503 })
    // kaynak süresini aşamaz
    tl = ops.trimEnd(base(), 'v2', 100, () => 508)
    expect(findClip(tl, 'v2')!.clip.srcOut).toBe(508)
    // kaynağın başından öteye genişletilemez
    tl = ops.trimStart(ops.moveClip(base(), 'v2', 50), 'v2', 0)
    expect(findClip(tl, 'v2')!.clip.srcIn).toBeGreaterThanOrEqual(0)
    // minimum süre korunur
    tl = ops.trimStart(base(), 'v2', 99)
    expect(findClip(tl, 'v2')!.clip.srcOut - findClip(tl, 'v2')!.clip.srcIn).toBeGreaterThan(0)
  })

  it('bölme: kaynak zamanı sürekli kalır, grup birlikte bölünür', () => {
    const tl = ops.splitClip(base(), 'v1', 4)
    const v = clipsOf(tl, 'V1').filter((c) => c.srcIn >= 100 && c.srcIn < 110)
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({ start: 0, srcIn: 100, srcOut: 104 })
    expect(v[1]).toMatchObject({ start: 4, srcIn: 104, srcOut: 110 })
    const a = clipsOf(tl, 'A1')
    expect(a).toHaveLength(2)
    expect(a[1]).toMatchObject({ start: 4, srcIn: 104 })
    // ayrılan sağ yarılar aynı (yeni) gruba aittir
    expect(v[1].groupId).toBe(a[1].groupId)
    expect(v[1].groupId).not.toBe(v[0].groupId)
    // kenara çok yakın bölme yok sayılır
    expect(clipsOf(ops.splitClip(base(), 'v1', 0.01), 'V1')).toHaveLength(2)
  })

  it('silme grubu siler; ripple sonrakini sola çeker', () => {
    let tl = ops.deleteClip(base(), 'v1')
    expect(findClip(tl, 'v1')).toBeNull()
    expect(findClip(tl, 'a1')).toBeNull()
    tl = ops.deleteClip(base(), 'v1', true)
    expect(findClip(tl, 'v2')!.clip.start).toBe(2)
  })

  it('kilitli iz değişmez', () => {
    const locked = ops.updateTrack(base(), 'V1', { locked: true })
    expect(ops.deleteClip(locked, 'v2')).toBe(locked)
    expect(ops.splitClip(locked, 'v2', 14)).toBe(locked)
  })

  it('süre = en geç biten klip', () => {
    expect(timelineDuration(base())).toBe(17)
  })
})

describe('geri al / yinele (komut deseni)', () => {
  it('komutlar geri alınır ve yinelenir', () => {
    const h = new History(base())
    h.execute(cmd.split('v2', 14))
    expect(clipsOf(h.present, 'V1')).toHaveLength(3)
    h.execute(cmd.remove('v1'))
    expect(findClip(h.present, 'v1')).toBeNull()
    h.undo()
    expect(findClip(h.present, 'v1')).not.toBeNull()
    expect(clipsOf(h.present, 'V1')).toHaveLength(3)
    h.undo()
    expect(clipsOf(h.present, 'V1')).toHaveLength(2)
    expect(h.canUndo).toBe(false)
    h.redo()
    h.redo()
    expect(findClip(h.present, 'v1')).toBeNull()
    expect(h.canRedo).toBe(false)
  })

  it('yeni komut yinele yığınını temizler; etkisiz komut geçmişe girmez', () => {
    const h = new History(base())
    h.execute(cmd.split('v2', 14))
    h.undo()
    h.execute(cmd.remove('v2'))
    expect(h.canRedo).toBe(false)
    const n = h.execute(cmd.remove('yok'))
    expect(n).toBe(h.present)
    h.undo()
    expect(findClip(h.present, 'v2')).not.toBeNull()
  })

  it('sürükleme komutları tek adımda geri alınır', () => {
    let t = 0
    const h = new History(base(), 200, () => t)
    for (const s of [20, 21, 22, 23, 24]) {
      t += 50
      h.execute(cmd.move('v2', s))
    }
    expect(findClip(h.present, 'v2')!.clip.start).toBe(24)
    h.undo()
    expect(findClip(h.present, 'v2')!.clip.start).toBe(12)
    h.redo()
    expect(findClip(h.present, 'v2')!.clip.start).toBe(24)
  })
})

describe('altyazılar', () => {
  const words = wordsFromLines([
    { at: 100, text: 'Merhaba arkadaşlar bugün sizlere bir hikaye anlatacağım.' },
    { at: 106, text: 'Victor Nelson ile tanıştığım gün.' }
  ])
  it('kelimelerden satır üretir; uzunluk ve süre sınırlarına uyar', () => {
    const caps = captionsFromWords(words, 100, 112, { maxCharsPerLine: 22 })
    expect(caps.length).toBeGreaterThan(2)
    for (const c of caps) {
      expect(c.text.length).toBeLessThanOrEqual(22 * 2 + 12)
      expect(c.end - c.start).toBeLessThanOrEqual(3.6)
      expect(c.start).toBeGreaterThanOrEqual(100)
    }
    expect(caps.map((c) => c.text).join(' ')).toContain('Victor Nelson')
  })
  it('zaman çizelgesi zamanına çevirir', () => {
    let tl = createTimelineWithGame()
    tl = ops.addClip(tl, TRACK_IDS.screen, mk('v', TRACK_IDS.screen, 2, 100, 112))
    const caps = captionsForTimeline(tl, { a1: words })
    expect(caps[0].start).toBeGreaterThanOrEqual(2)
    expect(caps.at(-1)!.end).toBeLessThanOrEqual(14 + 1e-6)
  })
  it('transkripti olan klibin hangi izde olduğu fark etmez (yüz/webcam, ses izi…)', () => {
    for (const trackId of ['V1', 'V2', 'A1', 'A2']) {
      let tl = createTimelineWithGame()
      tl = ops.addClip(tl, trackId, mk('x', trackId, 0, 100, 112))
      const caps = captionsForTimeline(tl, { a1: words })
      expect(caps.length, trackId).toBeGreaterThan(2)
    }
    // görüntü + ses aynı kaynaktan: satırlar tekrarlanmaz
    let tl = createTimelineWithGame()
    tl = ops.addClip(tl, 'V2', mk('v', 'V2', 0, 100, 112))
    tl = ops.addClip(tl, 'A2', mk('a', 'A2', 0, 100, 112, { audioStream: 0 }))
    const one = captionsForTimeline(ops.addClip(createTimelineWithGame(), 'V2', mk('v', 'V2', 0, 100, 112)), { a1: words })
    expect(captionsForTimeline(tl, { a1: words })).toHaveLength(one.length)
    // transkripti olmayan kaynak → boş
    expect(captionsForTimeline(tl, {})).toEqual([])
  })
  it('wrapCaption kelime ortasında bölmez', () => {
    expect(wrapCaption('Merhaba arkadaşlar bugün sizlere', 14)).toEqual(['Merhaba', 'arkadaşlar', 'bugün sizlere'])
  })
})

describe('snapDropTime: bırakılan dosya 0. sn\'den başlar', () => {
  const track = { clips: [{ id: 'c', trackId: 'V1', assetId: 'a', start: 5, srcIn: 0, srcOut: 10, volume: 1, label: 'c' }] as Clip[] }
  it('şeridin başına yakın (≤2 sn) → tam 0', () => {
    expect(ops.snapDropTime(track, 0)).toBe(0)
    expect(ops.snapDropTime(track, 1)).toBe(0)
    expect(ops.snapDropTime(track, 1.9)).toBe(0)
  })
  it('klibin sonuna yakın → hemen sonrası; uzaksa olduğu gibi', () => {
    expect(ops.snapDropTime(track, 15.6)).toBe(15)
    expect(ops.snapDropTime(track, 30)).toBe(30)
  })
})
