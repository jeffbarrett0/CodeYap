import type { Caption, ID, Timeline, Transcript, TranscriptWord } from '../types'
import { timelineWords } from './transcript'

export interface CaptionOptions {
  maxCharsPerLine: number
  maxLines: number
  maxDurationSec: number
  /** Bu kadar sessizlik satırı böler */
  gapSec: number
}

export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = { maxCharsPerLine: 22, maxLines: 2, maxDurationSec: 3.2, gapSec: 0.6 }

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
    const tooLongTime = cur.length > 0 && w.end - cur[0].start > o.maxDurationSec
    const gap = prev ? w.start - prev.end > o.gapSec : false
    if (prev && (tooLong || tooLongTime || gap)) flush()
    cur.push(w)
    if (END_PUNCT.test(w.text.trim())) flush()
  }
  flush()
  return out
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
  return captionsFromWords(words, 0, Infinity, { maxCharsPerLine: tl.captionStyle.maxCharsPerLine, ...opts })
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
