import { describe, expect, it } from 'vitest'
import { buildAss, captionLayout, highlightedLines } from '@shared/export/ass'
import { captionsFromWords } from '@shared/timeline/captions'
import { assignHighlights, CAPTION_PRESETS, highlightCount, presetById, wordsWithHighlight } from '@shared/timeline/captionStyles'
import { createDefaultTimeline, DEFAULT_CAPTION_STYLE } from '@shared/timeline/model'
import { setCaptionBox } from '@shared/timeline/ops'
import type { Caption, CaptionStyle, TranscriptWord } from '@shared/types'

const ref: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...presetById('boxed-highlight').style } as CaptionStyle
const words = (t: string): TranscriptWord[] => t.split(' ').map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.35, confidence: 1 }) as TranscriptWord)

describe('referans altyazı stili (vurgulu kutulu)', () => {
  it('hazır stiller: klasik ve referans', () => {
    expect(CAPTION_PRESETS.map((p) => p.id)).toEqual(['classic', 'boxed-highlight', 'premium-gold'])
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

describe('altyazı boyutu (önizlemede çekerek)', () => {
  const caps: Caption[] = [{ id: 'a', start: 0, end: 2, text: 'merhaba dünya', hl: { from: 1, to: 1, color: '#f00' } }, { id: 'b', start: 2, end: 4, text: 'ikinci' }]
  const tl = { captions: caps } as never
  it('setCaptionBox: sınırlar, konum, null = sıfırla; konum sıfırlamak vurgu/boyutu silmez', async () => {
    const ops = await import('@shared/timeline/ops')
    let t = ops.setCaptionBox(tl, 'a', { scale: 1.6, pos: { x: 0.4, y: 0.7 } })
    expect(t.captions[0]).toMatchObject({ scale: 1.6, pos: { x: 0.4, y: 0.7 } })
    expect(ops.setCaptionBox(t, 'a', { scale: 99 }).captions[0].scale).toBe(ops.MAX_CAPTION_SCALE)
    expect(ops.setCaptionBox(t, 'a', { scale: 0.01 }).captions[0].scale).toBe(ops.MIN_CAPTION_SCALE)
    t = ops.setCaptionPos(t, 'a', undefined)
    expect(t.captions[0]).toMatchObject({ scale: 1.6, hl: { color: '#f00' } })
    expect(t.captions[0].pos).toBeUndefined()
    expect(ops.setAllCaptionScale(t, 2).captions.map((c) => c.scale)).toEqual([2, 2])
    expect(ops.setCaptionBox(ops.setAllCaptionScale(t, 2), 'b', { scale: null }).captions[1].scale).toBeUndefined()
  })
  it('ASS: boyutlandırılmış altyazıya satır içi yazı boyutu (ve kutu iç boşluğu) eklenir; boyutsuz olana eklenmez', () => {
    const big: Caption[] = [{ id: 'a', start: 1, end: 3, text: 'merhaba', scale: 2 }, { id: 'b', start: 3, end: 5, text: 'selam' }]
    const ass = buildAss(big, ref, 1080, 1920)
    const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue'))
    expect(lines.find((l) => l.includes('MERHABA') && l.includes(',Default,'))).toMatch(/\\fs132\\bord/) // 66 × 2
    expect(lines.find((l) => l.includes('MERHABA') && l.includes(',Box,'))).toMatch(/\\fs132\\bord29/)
    expect(lines.find((l) => l.includes('SELAM') && l.includes(',Default,'))).not.toContain('\\fs')
  })
})

describe('Premium altın stili ve satır genişliği', () => {
  it('altın sarısı yazı, ince siyah kontur, kutusuz', () => {
    const st = { ...DEFAULT_CAPTION_STYLE, ...presetById('premium-gold').style } as CaptionStyle
    expect(st.color.toUpperCase()).toBe('#F2B705')
    expect(st.outlineColor).toBe('#000000')
    expect(st.outlineWidth).toBeLessThanOrEqual(3)
    expect(st.box).toBeUndefined()
  })
  it('altyazıya özel satır genişliği: sekiz kelime tek satıra yayılır, sıfırlayınca stile döner', () => {
    const st = { ...DEFAULT_CAPTION_STYLE, maxCharsPerLine: 14 } as CaptionStyle
    const cap = { id: 'c', start: 0, end: 2, text: 'bir iki üç dört beş altı yedi sekiz' }
    expect(captionLayout(st, cap, 1080, 1920).lines.length).toBeGreaterThan(2)
    expect(captionLayout(st, { ...cap, maxChars: 60 }, 1080, 1920).lines).toHaveLength(1)
    const tl = { ...createDefaultTimeline(), captions: [cap] }
    const w = setCaptionBox(tl, 'c', { maxChars: 500 })
    expect(w.captions[0].maxChars).toBe(60) // üst sınır
    expect(setCaptionBox(w, 'c', { maxChars: null }).captions[0].maxChars).toBeUndefined()
  })
})
