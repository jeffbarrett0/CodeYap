import type { Caption, ID, Timeline, Transcript, TranscriptWord } from '../types'
import { assignHighlights } from './captionStyles'
import { timelineWords } from './transcript'

export interface CaptionOptions {
  maxCharsPerLine: number
  maxLines: number
  maxDurationSec: number
  /** Bu kadar sessizlik satırı böler */
  gapSec: number
  /** Satır başına en fazla kelime (0: sınırsız) */
  maxWords: number
  /** Satır başına en az kelime (0: yok): tek kelimelik satır komşusuyla birleşir (en fazla maxWords+1) */
  minWords: number
}

export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = { maxCharsPerLine: 22, maxLines: 2, maxDurationSec: 3.2, gapSec: 0.6, maxWords: 0, minWords: 0 }

const END_PUNCT = /[.!?…]$/u

/** Bir kaynak aralığındaki kelimelerden zamanlanmış altyazı satırları üretir (zamanlar kaynak zamanıdır). */
export function captionsFromWords(words: TranscriptWord[], from: number, to: number, opts: Partial<CaptionOptions> = {}): Caption[] {
  const o = { ...DEFAULT_CAPTION_OPTIONS, ...opts }
  const inside = words.filter((w) => w.end > from && w.start < to)
  const out: Caption[] = []
  let cur: TranscriptWord[] = []
  const flush = () => {
    if (cur.length === 0) return
    out.push({
      id: `cap_${out.length}`,
      start: Math.max(from, cur[0].start),
      end: Math.min(to, cur[cur.length - 1].end + 0.15),
      text: cur.map((w) => w.text.trim()).join(' ')
    })
    cur = []
  }
  for (const w of inside) {
    const prev = cur[cur.length - 1]
    const text = [...cur, w].map((x) => x.text.trim()).join(' ')
    const tooLong = text.length > o.maxCharsPerLine * o.maxLines
    const tooManyWords = o.maxWords > 0 && cur.length >= o.maxWords
    const tooLongTime = cur.length > 0 && w.end - cur[0].start > o.maxDurationSec
    const gap = prev ? w.start - prev.end > o.gapSec : false
    if (prev && (tooLong || tooLongTime || gap || tooManyWords)) flush()
    cur.push(w)
    if (END_PUNCT.test(w.text.trim())) flush()
  }
  flush()
  return o.minWords > 1 ? mergeShortCaptions(out, o) : out
}

const wordCount = (c: Caption) => c.text.split(/\s+/).filter(Boolean).length

/** Tek kelimelik satırları komşuya katar (önce sonrakine, sonra öncekine); sessizlikle ayrılmış satırlar birleşmez */
function mergeShortCaptions(caps: Caption[], o: CaptionOptions): Caption[] {
  const res = caps.map((c) => ({ ...c }))
  const limit = o.maxWords > 0 ? o.maxWords + 1 : 99
  for (let i = 0; i < res.length; i++) {
    if (wordCount(res[i]) >= o.minWords) continue
    const next = res[i + 1]
    const prev = res[i - 1]
    if (next && next.start - res[i].end <= 0.5 && wordCount(next) + wordCount(res[i]) <= limit) {
      next.text = `${res[i].text} ${next.text}`
      next.start = res[i].start
      res.splice(i, 1)
      i--
    } else if (prev && res[i].start - prev.end <= 0.5 && wordCount(prev) + wordCount(res[i]) <= limit) {
      prev.text = `${prev.text} ${res[i].text}`
      prev.end = res[i].end
      res.splice(i, 1)
      i--
    }
  }
  return res.map((c, i) => ({ ...c, id: `cap_${i}` }))
}

/**
 * Zaman çizelgesindeki, transkripti olan TÜM video/ses kliplerinden (hangi izde olursa olsun: ekran, yüz, oyun/konuşma sesi)
 * altyazı üretir. Kaynak zamanları zaman çizelgesi zamanına çevrilir; aynı kaynağın görüntü + ses olarak
 * birden çok izde kullanılması satırları tekrarlamaz.
 */
export function captionsForTimeline(
  tl: Timeline,
  wordsByAsset: Record<ID, TranscriptWord[]>,
  opts: Partial<CaptionOptions> = {}
): Caption[] {
  const fake = Object.fromEntries(Object.entries(wordsByAsset).map(([id, words]) => [id, { words } as unknown as Transcript]))
  const words = timelineWords(tl, fake)
  const st = tl.captionStyle
  const caps = captionsFromWords(words, 0, Infinity, { maxCharsPerLine: st.maxCharsPerLine, maxWords: st.maxWords ?? 0, minWords: st.minWords ?? 0, ...(st.maxWords ? { maxLines: 1, maxDurationSec: 2.4 } : {}), ...opts })
  return assignHighlights(caps, st)
}

/** Satırı `maxChars` genişlikte sarar (kelime ortasında bölmez). */
export function wrapCaption(text: string, maxChars: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur)
      cur = w
    } else cur = cur ? cur + ' ' + w : w
  }
  if (cur) lines.push(cur)
  return lines
}

export const CAPTION_LANGS: { code: string; name: string }[] = [
  { code: 'orig', name: 'Özgün (konuşulan dil)' },
  { code: 'en', name: 'English (İngilizce)' }
]

/** Altyazının seçili dildeki görünümü: metin ve vurgu çeviriden gelir; çeviri yoksa özgün metin */
export function localizeCaption(c: Caption, lang?: string): Caption {
  if (!lang || lang === 'orig') return c
  const t = c.tr?.[lang]
  return t ? { ...c, text: t.text, hl: t.hl } : c
}

export const localizeCaptions = (tl: Pick<Timeline, 'captions' | 'captionLang'>): Caption[] => (tl.captionLang && tl.captionLang !== 'orig' ? tl.captions.map((c) => localizeCaption(c, tl.captionLang)) : tl.captions)

/** Seçili dilde çevirisi olmayan altyazılar */
export const untranslated = (tl: Pick<Timeline, 'captions'>, lang: string): Caption[] => tl.captions.filter((c) => !c.tr?.[lang]?.text)
