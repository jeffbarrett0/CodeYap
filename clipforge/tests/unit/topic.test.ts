import { describe, expect, it } from 'vitest'
import { findTopicCandidates, topicTokens, wordMatches } from '../../src/shared/topic'
import type { TranscriptWord } from '../../src/shared/types'

/** Cümle listesinden (başlangıç sn, metin) kelime kelime transkript */
function words(sentences: [number, string][]): TranscriptWord[] {
  const out: TranscriptWord[] = []
  for (const [t0, text] of sentences) {
    let t = t0
    for (const w of text.split(' ')) {
      out.push({ text: w, start: t, end: t + 0.35, confidence: 1 } as TranscriptWord)
      t += 0.4
    }
  }
  return out
}

describe('konu eşleşmesi', () => {
  it('Türkçe ek, aksan ve küçük yazım hataları', () => {
    expect(topicTokens("Victor Osimhen'le")).toEqual(['victor', 'osimhen'])
    expect(wordMatches("Osimhen'in", 'osimhen')).toBe('osimhen')
    expect(wordMatches('OSİMHEN', 'osimhen')).toBe('osimhen')
    expect(wordMatches('Osimen', 'osimhen')).toBe('osimhen') // Whisper yazımı
    expect(wordMatches('Victor', 'osimhen')).toBeNull()
    expect(wordMatches('osimhenin', 'osimhen')).toBe('osimhen')
    expect(wordMatches('kuşlar', 'kuş')).toBeNull() // 3 harfte ek eşleşmesi yok
  })
})

describe('aday klipler', () => {
  const w = words([
    [0, 'Bugün hava çok güzel ve herkes sahada.'],
    [20, "Osimhen'in transferi çok konuşuldu."],
    [26, 'Galatasaray ona büyük para verdi.'],
    [33, 'Osimhen gol atmaya devam ediyor mu bakalım.'],
    [37, 'Taraftar buna çok seviniyor tabii.'],
    [300, 'Şimdi başka bir konuya geçelim hemen.'],
    [310, 'Mertens oyunun kalbiydi bence.'],
    [600, 'Osimen kadar iyi bir forvet yok bence.'],
    [606, 'Gerçekten yok yani o kadar net.']
  ])
  it('yakın geçişler tek blokta, uzaktakiler ayrı aday; en çok geçen en üstte', () => {
    const c = findTopicCandidates(w, "Osimhen'le ilgili")
    expect(c).toHaveLength(2)
    expect(c[0].hits).toBe(2)
    expect(c[0].start).toBeGreaterThan(10)
    expect(c[0].start).toBeLessThan(21)
    expect(c[0].end).toBeGreaterThan(38)
    expect(c[0].text).toContain('transferi')
    expect(c[1].hits).toBe(1)
    expect(c[1].mentions[0].text).toBe('Osimen')
    expect(c.map((x) => x.id)).toEqual(['c1', 'c2'])
  })
  it('sınırlar cümle başı/sonuna oturur, süre sınırlarına uyar', () => {
    const c = findTopicCandidates(w, 'Osimhen', { maxSec: 15, minSec: 5 })
    for (const x of c) expect(x.durationSec).toBeLessThanOrEqual(15 + 0.6)
    // uzun blok pencerelere bölünür: iki geçiş de bir klipte kalmıyorsa ayrı adaylar olur
    expect(c.reduce((n, x) => n + x.hits, 0)).toBe(3)
  })
  it('çok kısa blok minSec kadar genişletilir; konu yoksa boş', () => {
    const c = findTopicCandidates(w, 'Osimen', { minSec: 5 })
    expect(c.every((x) => x.durationSec >= 3)).toBe(true)
    // yakın cümle yoksa alakasız uzak içerik katılmaz
    const far = findTopicCandidates(w, 'Osimen', { minSec: 30 })
    expect(far.find((x) => x.mentions[0].t > 500)!.durationSec).toBeLessThan(15)
    expect(findTopicCandidates(w, 'Neymar')).toEqual([])
    expect(findTopicCandidates(w, 'ab')).toEqual([])
  })
})
