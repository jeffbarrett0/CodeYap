import { describe, expect, it } from 'vitest'
import { buildAss, highlightedLines } from '@shared/export/ass'
import { captionsFromWords } from '@shared/timeline/captions'
import { assignHighlights, CAPTION_PRESETS, highlightCount, presetById, wordsWithHighlight } from '@shared/timeline/captionStyles'
import { DEFAULT_CAPTION_STYLE } from '@shared/timeline/model'
import type { Caption, CaptionStyle, TranscriptWord } from '@shared/types'

const ref: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...presetById('boxed-highlight').style } as CaptionStyle
const words = (t: string): TranscriptWord[] => t.split(' ').map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.35, confidence: 1 }) as TranscriptWord)

describe('referans altyazı stili (vurgulu kutulu)', () => {
  it('hazır stiller: klasik ve referans', () => {
    expect(CAPTION_PRESETS.map((p) => p.id)).toEqual(['classic', 'boxed-highlight'])
    expect(ref).toMatchObject({ italic: true, uppercase: true, maxWords: 4, box: { enabled: true }, highlight: { enabled: true } })
    expect(ref.highlight!.colors).toHaveLength(3) // sarı, kırmızı, mavi
  })
  it('satır başına en fazla N kelime', () => {
    const caps = captionsFromWords(words('bir iki üç dört beş altı yedi sekiz dokuz'), 0, 100, { maxWords: 4, maxLines: 1, maxCharsPerLine: 40 })
    expect(caps.map((c) => c.text.split(' ').length)).toEqual([4, 4, 1])
  })
  it('vurgu: son 1-2 kelime, renkler sırayla döner; kapalıysa temizlenir', () => {
    expect([1, 2, 3, 4, 5].map(highlightCount)).toEqual([1, 1, 1, 2, 2])
    const caps: Caption[] = ['a b c d', 'a b', 'a b c', 'x y z w'].map((text, i) => ({ id: `c${i}`, start: i, end: i + 1, text }))
    const hl = assignHighlights(caps, ref)
    expect(hl.map((c) => c.hl)).toEqual([
      { from: 2, to: 3, color: '#FFE600' },
      { from: 1, to: 1, color: '#FF1A1A' },
      { from: 2, to: 2, color: '#18C8FF' },
      { from: 2, to: 3, color: '#FFE600' }
    ])
    expect(assignHighlights(hl, { highlight: { enabled: false, colors: [] } }).every((c) => c.hl === undefined)).toBe(true)
  })
  it('metin düzenlenip kelime sayısı değişse de vurgu sınırlara kırpılır', () => {
    expect(wordsWithHighlight('tek', { from: 2, to: 3, color: '#f00' })).toEqual([{ text: 'tek', color: '#f00' }])
    expect(highlightedLines('A B C', ['A B', 'C'], { from: 2, to: 2, color: '#0f0' })).toEqual([[{ text: 'A' }, { text: 'B' }], [{ text: 'C', color: '#0f0' }]])
  })
  it('ASS: kutu katmanı (BorderStyle 3), eğik, kelime rengi, Türkçe büyük harf', () => {
    const caps = assignHighlights([{ id: 'c', start: 1, end: 3, text: 'sekize kadar düşüyor' }], ref)
    const ass = buildAss(caps, ref, 1080, 1920)
    expect(ass).toMatch(/Style: Box,.*,3,\d+(\.\d+)?,0,5,/) // BorderStyle 3
    expect(ass).toMatch(/Style: Default,Impact,\d+,.*,-1,-1,/) // kalın + eğik
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:03.00,Box')
    expect(ass).toContain('Dialogue: 1,0:00:01.00,0:00:03.00,Default')
    expect(ass).toContain('SEKİZE KADAR {\\1c&H0000E6FF&}DÜŞÜYOR') // sarı #FFE600 → BGR
  })
  it('klasik stil: kutu ve vurgu katmanı yok (eski çıktı korunur)', () => {
    const ass = buildAss([{ id: 'c', start: 1, end: 3, text: 'merhaba' }], DEFAULT_CAPTION_STYLE, 1080, 1920)
    expect(ass).not.toContain('Style: Box')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:03.00,Default')
  })
})
