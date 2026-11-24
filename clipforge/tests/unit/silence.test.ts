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
    // ses analizi YOKKEN temkinli paylar: sözün bitişinden 0,22 sn sonra, bir sonraki sözden 0,3 sn önce ('arkadaşlar' 1.2'de biter, 'bugün' 4.0'da başlar)
    expect(p.cuts).toHaveLength(1)
    expect(p.cuts[0][0]).toBeCloseTo(1.42)
    expect(p.cuts[0][1]).toBeCloseTo(3.7)
    expect(p.silenceCount).toBe(1)
    expect(p.removedSec).toBeCloseTo(2.28)
  })

  it('baştaki ve sondaki sessizlik kısaltılır', () => {
    const p = planSilenceCuts([w('Merhaba', 3), w('dünya', 3.4)], 10, { keepSec: 0.2 })
    expect(p.cuts[0][0]).toBe(0)
    expect(p.cuts[0][1]).toBeCloseTo(2.7) // konuşmanın başından 0,3 sn önce biter
    expect(p.cuts[1][0]).toBeCloseTo(3.92) // 'dünya' 3.7'de biter, +0,22
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
    expect(b).toBeGreaterThanOrEqual(2.25)
    // dolgu kesme kapalıysa dokunulmaz
    expect(planSilenceCuts(words, 3, { cutFillers: false }).fillerCount).toBe(0)
  })

  it('dolgu + uzun sessizlik tek kesimde birleşir', () => {
    const words = [w('Evet', 0), w('ııı', 1.2), w('tamam', 3.5)]
    const p = planSilenceCuts(words, 4)
    expect(p.cuts).toHaveLength(1)
    expect(p.cuts[0][0]).toBeCloseTo(0.52)
    expect(p.cuts[0][1]).toBeCloseTo(3.2)
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

describe('sessizlik eşiği varsayılanı', () => {
  it('0,55 sn: 0,6 sn boşluk artık kesilir (eskiden 0,7 sn altı atlanırdı)', async () => {
    const { DEFAULT_SETTINGS } = await import('@shared/settings')
    expect(DEFAULT_SETTINGS.silenceMinGapSec).toBe(0.55)
    const words = [w('bir', 0.3), w('iki', 1.2), w('üç', 4)]
    const p = planSilenceCuts(words, 6)
    expect(p.cuts.length).toBeGreaterThan(0)
  })
})


describe('KONUŞMA KORUMASI: gerçek konuşma asla kesilmez (kullanıcı şikâyeti: "tam konuşmaya başlamışım, oraları kesmişsin")', () => {
  const inCut = (cuts: [number, number][], a: number, b: number) => cuts.some(([x, y]) => x < b - 1e-9 && y > a + 1e-9)

  it('KÖK NEDEN 1 — kısa kelime iki kesim arasında silinmezdi: "ve" + hemen ardından "ııı" artık korunur', () => {
    const words = [w('tamam', 0, 1), w('ve', 4.0, 0.1), w('ııı', 4.12, 0.38), w('devam', 8, 0.4)]
    const p = planSilenceCuts(words, 9, { minGapSec: 0.55, keepSec: 0.15, cutFillers: true })
    expect(inCut(p.cuts, 4.0, 4.1)).toBe(false) // "ve" kesimin içinde DEĞİL
    expect(inCut(p.cuts, 0, 1)).toBe(false)
    expect(inCut(p.cuts, 8, 8.4)).toBe(false)
  })

  it('KÖK NEDEN 2 — Whisper konuşmanın başlangıcını GEÇ verirse (0,45 sn): ses seviyesi koruması başlangıcı korur; korumasız kesim konuşmaya girerdi', () => {
    const words = [w('selam', 0, 0.5), w('bugün', 5.6, 0.4)] // gerçekte konuşma 5.15'te başlıyor
    const voiced: [number, number][] = [[0, 0.5], [5.15, 6.1]]
    const without = planSilenceCuts(words, 7, { keepSec: 0.15, voiced: undefined })
    // koruma yokken de temkinli pay (0,3) var ama 0,45 sn'lik gecikmeyi karşılayamaz → konuşmaya giriyor (eski hata)
    expect(inCut(without.cuts, 5.15, 5.3)).toBe(true)
    const guarded = planSilenceCuts(words, 7, { keepSec: 0.15, voiced })
    expect(inCut(guarded.cuts, 5.15, 6.1)).toBe(false) // artık konuşmanın hiçbir yeri kesilmiyor
    expect(inCut(guarded.cuts, 0, 0.5)).toBe(false)
    // ve gerçekten sessiz yer hâlâ kesiliyor
    expect(guarded.cuts.length).toBeGreaterThanOrEqual(1)
    expect(guarded.removedSec).toBeGreaterThan(3)
  })

  it('KÖK NEDEN 3 — Whisper\'ın HİÇ yazmadığı ama söylenen sözler: ses varsa "sessizlik" sayılıp kesilmez', () => {
    const words = [w('başla', 0, 0.5), w('devam', 10, 0.4)] // 3–5. sn arası konuşulmuş ama transkripte girmemiş
    const p = planSilenceCuts(words, 11, { keepSec: 0.15, voiced: [[0, 0.5], [3, 5], [10, 10.4]] })
    expect(inCut(p.cuts, 3, 5)).toBe(false)
    expect(p.cuts.length).toBe(3) // 3-5 öncesi, sonrası ve sondaki sessizlik ayrı ayrı kesilir
    expect(inCut(p.cuts, 0.65, 2.7)).toBe(true) // gerçek sessizlik hâlâ kesiliyor
  })

  it('RASTGELE ÖZELLİK TESTİ: 300 farklı konuşma düzeninde (başlangıç 0–0,4 sn erken, bitiş 0–0,3 sn geç, atlanmış sözler) hiçbir gerçek ses kesilmez', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    for (let run = 0; run < 300; run++) {
      const words: { text: string; start: number; end: number }[] = []
      const voiced: [number, number][] = []
      let t = rnd() * 2
      for (let i = 0; i < 25; i++) {
        const dur = 0.15 + rnd() * 0.5
        const early = rnd() * 0.4 // Whisper başlangıcı bu kadar geç yazar
        const late = rnd() * 0.3 // Whisper bitişi bu kadar erken yazar
        const isFiller = rnd() < 0.12
        const skipped = rnd() < 0.08 // Whisper hiç yazmadı
        if (!skipped) words.push({ text: isFiller ? 'ııı' : `k${i}`, start: t + early, end: t + dur - late > t + early + 0.05 ? t + dur - late : t + early + 0.05 })
        voiced.push([t, t + dur])
        t += dur + (rnd() < 0.3 ? 0.6 + rnd() * 3 : 0.05 + rnd() * 0.3)
      }
      const total = t + 2
      if (!words.some((x) => x.text !== 'ııı')) continue
      const p = planSilenceCuts(words, total, { minGapSec: 0.55, keepSec: 0.15, cutFillers: true, voiced })
      for (const [v0, v1] of voiced) {
        // dolgu sesleri bilerek kesilir; gerçek (dolgu olmayan) sözlerin sesi ise kesilemez
        const isFillerSpan = words.some((x) => x.text === 'ııı' && x.start < v1 && x.end > v0 && x.start >= v0 - 0.45)
        if (isFillerSpan) continue
        expect(inCut(p.cuts, v0 + 0.02, v1 - 0.02), `koşu ${run}: ses ${v0.toFixed(2)}–${v1.toFixed(2)} kesildi`).toBe(false)
      }
    }
  })
})
