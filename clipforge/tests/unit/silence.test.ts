import { createTimelineWithGame } from './helpers'
import { describe, expect, it } from 'vitest'
import { isFiller, planSilenceCuts } from '@shared/timeline/silence'
import { cutBoundsForWords, timelineWords } from '@shared/timeline/transcript'
import { createDefaultTimeline } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { cmd } from '@shared/timeline/commands'
import { History } from '@shared/timeline/history'
import { buildSegments } from '@shared/transcript/sentences'
import type { Clip, Transcript } from '@shared/types'

const w = (text: string, start: number, dur = 0.3) => ({ text, start, end: start + dur })

describe('dolgu sesleri', () => {
  it('ı / ııı / eee / hımm / ömm dolgudur; gerçek sözcükler değil', () => {
    for (const t of ['ı', 'ıı', 'ııı', 'Iıı', 'eee', 'Eee,', 'ee', 'hımm', 'Hmm', 'hmm...', 'ömm', 'ehm', 'öö', 'mmm', 'uh', 'um', 'ııııı...']) expect(isFiller(t), t).toBe(true)
    for (const t of ['evet', 'e', 'ev', 'ama', 'iyi', 'imam', 'ah', 'oh', 'eh', 'hım', 'ben', 'Kavukçu', '', '...', 'eeeeeeeeeeeeee']) expect(isFiller(t), t).toBe(false)
  })
})

describe('sessizlik ve dolgu kesme planı', () => {
  it('uzun boşluğu iki yandan nefes payı bırakarak keser; kısa boşluğa dokunmaz', () => {
    const words = [w('Merhaba', 0.3), w('arkadaşlar', 0.9), w('bugün', 4.0), w('çok', 4.4)]
    const p = planSilenceCuts(words, 5, { minGapSec: 0.7, keepSec: 0.15 })
    // 'arkadaşlar' 1.2'de biter, 'bugün' 4.0'da başlar: [1.35, 3.85]
    expect(p.cuts).toHaveLength(1)
    expect(p.cuts[0][0]).toBeCloseTo(1.35)
    expect(p.cuts[0][1]).toBeCloseTo(3.85)
    expect(p.silenceCount).toBe(1)
    expect(p.removedSec).toBeCloseTo(2.5)
  })

  it('baştaki ve sondaki sessizlik kısaltılır', () => {
    const p = planSilenceCuts([w('Merhaba', 3), w('dünya', 3.4)], 10, { keepSec: 0.2 })
    expect(p.cuts[0][0]).toBe(0)
    expect(p.cuts[0][1]).toBeCloseTo(2.8)
    expect(p.cuts[1][0]).toBeCloseTo(3.9)
    expect(p.cuts[1][1]).toBe(10)
  })

  it('dolgu sesleri kelimeleriyle kesilir, komşu gerçek kelimelere taşmaz', () => {
    const words = [w('Şimdi', 1, 0.4), w('ııı', 1.45, 0.4), w('eee', 1.9, 0.4), w('bakalım', 2.35, 0.5)]
    const p = planSilenceCuts(words, 3, { cutFillers: true })
    expect(p.fillerCount).toBe(2)
    const [a, b] = p.cuts.find(([x, y]) => x < 1.9 && y > 1.9)!
    expect(a).toBeGreaterThanOrEqual(1.4 - 1e-9) // 'Şimdi' 1.4'te biter
    expect(b).toBeLessThanOrEqual(2.35 + 1e-9) // 'bakalım' 2.35'te başlar
    expect(a).toBeLessThanOrEqual(1.46)
    expect(b).toBeGreaterThanOrEqual(2.3)
    // dolgu kesme kapalıysa dokunulmaz
    expect(planSilenceCuts(words, 3, { cutFillers: false }).fillerCount).toBe(0)
  })

  it('dolgu + uzun sessizlik tek kesimde birleşir', () => {
    const words = [w('Evet', 0), w('ııı', 1.2), w('tamam', 3.5)]
    const p = planSilenceCuts(words, 4)
    expect(p.cuts).toHaveLength(1)
    expect(p.cuts[0][0]).toBeCloseTo(0.45)
    expect(p.cuts[0][1]).toBeCloseTo(3.35)
  })

  it('hiç gerçek kelime yoksa hiçbir şey kesilmez; boş girdi boş döner', () => {
    expect(planSilenceCuts([w('ııı', 1), w('eee', 2)], 10).cuts).toEqual([])
    expect(planSilenceCuts([], 10).cuts).toEqual([])
  })

  it('sürekli konuşmada kesim yok', () => {
    const words = Array.from({ length: 20 }, (_, i) => w(`k${i}`, 0.3 + i * 0.4))
    expect(planSilenceCuts(words, 8.3).cuts).toEqual([])
  })
})

describe('zaman çizelgesine uygulama', () => {
  const words = [w('Merhaba', 100.5), w('arkadaşlar', 100.9), w('ııı', 102), w('bugün', 105), w('çok', 105.4), w('güzel', 105.8)]
  const tr: Transcript = { id: 't', assetId: 'a1', language: 'tr', model: 'm', provider: 'mock', audioTrack: 0, createdAt: '', durationSec: 300, words, segments: buildSegments(words) }
  const mk = (id: string, trackId: string, extra: Partial<Clip> = {}): Clip => ({ id, trackId, assetId: 'a1', start: 0, srcIn: 100, srcOut: 107, volume: 1, label: id, groupId: 'g', ...extra })
  const tl0 = () => ops.addClip(ops.addClip(createTimelineWithGame(), 'V2', mk('v', 'V2')), 'A2', mk('a', 'A2', { audioStream: 0 }))

  it('çok kesim tek adımda uygulanır, bağlı klipler birlikte kısalır, tek geri almayla eski hâle döner', () => {
    const t0 = tl0()
    const tw = timelineWords(t0, { a1: tr })
    const plan = planSilenceCuts(tw, 7)
    expect(plan.cuts.length).toBeGreaterThanOrEqual(2) // baş + ııı/boşluk
    const h = new History(t0)
    h.execute(cmd.cutRanges(plan.cuts))
    const total = h.present.tracks.flatMap((t) => t.clips).reduce((m, c) => Math.max(m, c.start + (c.srcOut - c.srcIn)), 0)
    expect(total).toBeCloseTo(7 - plan.removedSec, 1)
    // kalan kelimelerde ııı yok ve konuşma kelimeleri hâlâ var
    const left = timelineWords(h.present, { a1: tr }).map((x) => x.text)
    expect(left).not.toContain('ııı')
    expect(left).toEqual(expect.arrayContaining(['Merhaba', 'arkadaşlar', 'bugün', 'çok', 'güzel']))
    // ses ve görüntü aynı sayıda parça
    expect(h.present.tracks.find((t) => t.id === 'V2')!.clips.length).toBe(h.present.tracks.find((t) => t.id === 'A2')!.clips.length)
    h.undo()
    expect(h.present).toBe(t0)
  })

  it('kalan konuşma arası boşluklar nefes payı kadardır', () => {
    const t0 = tl0()
    const plan = planSilenceCuts(timelineWords(t0, { a1: tr }), 7)
    const t1 = ops.cutRanges(t0, plan.cuts)
    const w1 = timelineWords(t1, { a1: tr })
    for (let i = 1; i < w1.length; i++) expect(w1[i].start - w1[i - 1].end).toBeLessThan(0.75)
  })
})

void cutBoundsForWords
