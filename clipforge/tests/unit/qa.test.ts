import { describe, expect, it } from 'vitest'
import { findRetakes, onScreenNumbers, parseQaLine, qaReport, qaText, spokenNumbers, verifyNumbers } from '../../src/shared/qa'
import type { TranscriptWord } from '../../src/shared/types'

const W = (text: string, start: number): TranscriptWord => ({ text, start, end: start + 0.4, confidence: 1 }) as TranscriptWord
const sentence = (t: string, start: number): TranscriptWord[] => t.split(' ').map((w, i) => W(w, start + i * 0.45))

describe('çıkış kontrolü', () => {
  it('siyah/düz ilk kare, siyah ekran, uzun sessizlik, kısık ve patlayan ses uyarılır; temiz video uyarı vermez', () => {
    const clean = qaReport({ durationSec: 60, firstFrame: { mean: 90, std: 40 }, black: [], silence: [{ start: 10, end: 12 }], loudnessLufs: -14, peakDb: -2, hasAudio: true })
    expect(clean.ok).toBe(true)
    expect(qaText(clean.items)).toMatch(/Sorun bulunamadı/)
    const bad = qaReport({ durationSec: 60, firstFrame: { mean: 3, std: 1 }, black: [{ start: 20, end: 22 }, { start: 59.5, end: 60 }], silence: [{ start: 30, end: 38 }], loudnessLufs: -32, peakDb: 0.5, hasAudio: true })
    const ids = bad.items.map((i) => i.id)
    expect(bad.ok).toBe(false)
    expect(ids).toEqual(expect.arrayContaining(['first-frame', 'black', 'end-black', 'silence', 'loudness', 'peak']))
    expect(qaReport({ durationSec: 10, firstFrame: { mean: 100, std: 2 }, black: [], silence: [], hasAudio: false }).items.map((i) => i.id)).toEqual(['first-frame', 'no-audio'])
  })
  it('ffmpeg çıktısı satırları ayrıştırılır', () => {
    const acc = { black: [] as { start: number; end: number }[], silence: [] as { start: number; end: number }[] } as Parameters<typeof parseQaLine>[1]
    parseQaLine('[blackdetect @ 0x1] black_start:3.5 black_end:5 black_duration:1.5', acc)
    parseQaLine('[silencedetect @ 0x2] silence_start: 10.25', acc)
    parseQaLine('[silencedetect @ 0x2] silence_end: 15.5 | silence_duration: 5.25', acc)
    parseQaLine('    I:         -18.4 LUFS', acc)
    parseQaLine('    Peak:       -1.2 dBFS', acc)
    expect(acc.black).toEqual([{ start: 3.5, end: 5 }])
    expect(acc.silence).toEqual([{ start: 10.25, end: 15.5 }])
    expect(acc.lufs).toBe(-18.4)
    expect(acc.peak).toBe(-1.2)
  })
})

describe('rakam doğrulama', () => {
  it('Türkçe söylenen ve rakamla yazılan sayılar okunur', () => {
    expect(spokenNumbers('yüzde yetmiş bir'.split(' '))).toContain(71)
    expect(spokenNumbers('iki bin yirmi dört'.split(' '))).toContain(2024)
    expect(spokenNumbers('yüz yirmi'.split(' '))).toContain(120)
    expect(spokenNumbers(['92,7', 'pas', '%71'])).toEqual([92.7, 71])
    expect(onScreenNumbers('Fenerbahçe %71 · 92,7 · 2024')).toEqual([71, 92.7, 2024])
  })
  it('ekrandaki rakam konuşmada geçiyorsa doğru, geçmiyorsa doğrulanamadı', () => {
    const words = [...sentence('Fenerbahçe uygunluk puanı yetmiş bir çıktı', 5), ...sentence('Sezon başından beri otuz gol attı', 20)]
    const r = verifyNumbers([{ text: '%71', start: 6, end: 9 }, { text: '45 gol', start: 21, end: 24 }], words)
    expect(r.find((x) => x.number === 71)!.ok).toBe(true)
    expect(r.find((x) => x.number === 45)!.ok).toBe(false)
  })
})

describe('hata/tekrar önerisi', () => {
  it('aynı cümleyi tekrar söyleyince ilk söyleyiş önerilir; yarım kalan işaretlenir; farklı cümleler dokunulmaz', () => {
    const words = [
      ...sentence('Bu sezon Osimhen gerçekten çok iyi gol attı.', 0),
      ...sentence('Bu sezon Osimhen gerçekten çok iyi gol attı.', 12),
      ...sentence('Sonra rakip takım savunmada hata yaptı.', 25),
      ...sentence('Transfer döneminde kimi alacaklar bilmiyorum', 40),
      ...sentence('Transfer döneminde kimi alacaklar bilmiyorum ama çok merak ediyorum.', 46)
    ]
    const r = findRetakes(words)
    expect(r.map((x) => x.kind)).toEqual(['tekrar', 'yarım'])
    expect(r[0].start).toBe(0)
    expect(r[0].keepAt).toBe(12)
    expect(findRetakes([...sentence('Merhaba arkadaşlar bugün çok güzel bir gün.', 0), ...sentence('Hava tahmini yağmurlu olacak diyorlar.', 10)])).toEqual([])
  })
})
