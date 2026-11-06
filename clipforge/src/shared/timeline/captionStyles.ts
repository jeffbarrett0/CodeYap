import type { Caption, CaptionStyle } from '../types'
import { DEFAULT_CAPTION_STYLE } from './model'

export interface CaptionPreset {
  id: string
  name: string
  description: string
  style: Partial<CaptionStyle>
}

/**
 * "Vurgulu kutulu": referans videodaki altyazı — kalın, dar, eğik, BÜYÜK HARF; beyaz yazı + kalın siyah kontur + gölge;
 * metne oturan koyu gri yarı saydam kutu; satır başına 2-4 kelime; satırın son 1-2 kelimesi sarı / kırmızı / mavi ile vurgulanır.
 */
export const CAPTION_PRESETS: CaptionPreset[] = [
  { id: 'classic', name: 'Klasik', description: 'Kutusuz, tek renk, kontur', style: { ...DEFAULT_CAPTION_STYLE, italic: false, box: undefined, highlight: undefined, maxWords: 0, shadow: 0 } },
  {
    id: 'boxed-highlight',
    name: 'Vurgulu kutulu (referans)',
    description: 'Eğik kalın BÜYÜK HARF, gri kutu, son kelimeler renkli; satır başına en fazla 4 kelime',
    style: {
      fontFamily: 'Impact',
      fontSize: 66,
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 5,
      bold: true,
      italic: true,
      uppercase: true,
      maxCharsPerLine: 26,
      maxWords: 4,
      shadow: 3,
      box: { enabled: true, color: '#6B6B6B', opacity: 0.88 },
      highlight: { enabled: true, colors: ['#FFE600', '#FF1A1A', '#18C8FF'] }
    }
  },
  {
    id: 'shorts',
    name: 'Kısa video (2–4 kelime, büyük beyaz)',
    description: 'Dikey kliplerde yüzün hemen altında: iri beyaz kalın yazı + siyah kontur, kutusuz, satırda 2–4 kelime (tek kelime kalmaz)',
    style: {
      fontFamily: 'Arial Black',
      fontSize: 80,
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 7,
      bold: true,
      italic: false,
      uppercase: false,
      maxCharsPerLine: 24,
      maxWords: 4,
      minWords: 2,
      shadow: 3,
      box: undefined,
      highlight: undefined,
      positionY: 0.68
    }
  },
  {
    id: 'premium-gold',
    name: 'Premium altın',
    description: 'Altın sarısı kalın yazı, ince siyah kontur, hafif gölge; kutusuz. Son kelimeler açık sarıyla öne çıkar',
    style: {
      fontFamily: 'Arial Black',
      fontSize: 60,
      color: '#F2B705',
      outlineColor: '#000000',
      outlineWidth: 3,
      bold: true,
      italic: false,
      uppercase: true,
      maxCharsPerLine: 24,
      maxWords: 4,
      shadow: 2,
      box: undefined,
      highlight: { enabled: true, colors: ['#FFE766', '#FFD21F'] }
    }
  }
]

export const presetById = (id: string) => CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0]

/** Satırdaki kelime sayısına göre vurgulanacak SON kelime sayısı: 1-2 kelime → 1; 3 → 1; 4+ → 2 */
export function highlightCount(words: number): number {
  return words >= 4 ? 2 : 1
}

/**
 * Altyazılara vurgu atar: her satırda son 1-2 kelime, renkler sırayla döner (deterministik: aynı girdi aynı çıktı).
 * Vurgu kapalıysa mevcut `hl` alanları temizlenir.
 */
export function assignHighlights(captions: Caption[], style: Pick<CaptionStyle, 'highlight'>): Caption[] {
  const colors = style.highlight?.enabled ? style.highlight.colors.filter(Boolean) : []
  const hlOf = (text: string, i: number): Caption['hl'] => {
    if (colors.length === 0) return undefined
    const n = text.split(/\s+/).filter(Boolean).length
    if (n === 0) return undefined
    const k = Math.min(n, highlightCount(n))
    return { from: n - k, to: n - 1, color: colors[i % colors.length] }
  }
  return captions.map((c, i) => {
    const { hl: _old, ...rest } = c
    void _old
    const hl = hlOf(c.text, i)
    // çevirilerin vurgusu da kendi metnine göre yeniden atanır (kelime sayısı dile göre değişir)
    const tr = c.tr ? Object.fromEntries(Object.entries(c.tr).map(([lang, v]) => [lang, { text: v.text, hl: hlOf(v.text, i) }])) : undefined
    return { ...rest, ...(hl ? { hl } : {}), ...(tr ? { tr } : {}) }
  })
}

/** Metni kelimelere böler, vurgu aralığını mevcut kelime sayısına kırpar */
export function wordsWithHighlight(text: string, hl: Caption['hl']): { text: string; color?: string }[] {
  const ws = text.split(/\s+/).filter(Boolean)
  if (!hl || ws.length === 0) return ws.map((t) => ({ text: t }))
  const from = Math.max(0, Math.min(hl.from, ws.length - 1))
  const to = Math.max(from, Math.min(hl.to, ws.length - 1))
  return ws.map((t, i) => ({ text: t, color: i >= from && i <= to ? hl.color : undefined }))
}
