import type { Caption, Clip, ID, Timeline, TranscriptWord } from '../types'
import { clipDuration } from './model'

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
 * Zaman çizelgesindeki video kliplerinin kaynak transkriptlerinden altyazı üretir ve
 * kaynak zamanlarını zaman çizelgesi zamanına çevirir.
 */
export function captionsForTimeline(
  tl: Timeline,
  wordsByAsset: Record<ID, TranscriptWord[]>,
  opts: Partial<CaptionOptions> = {}
): Caption[] {
  const out: Caption[] = []
  const seen = new Set<string>()
  const clips: Clip[] = tl.tracks.filter((t) => t.role === 'screen').flatMap((t) => t.clips)
  for (const c of clips.sort((a, b) => a.start - b.start)) {
    const words = wordsByAsset[c.assetId]
    if (!words) continue
    const caps = captionsFromWords(words, c.srcIn, c.srcOut, { maxCharsPerLine: tl.captionStyle.maxCharsPerLine, ...opts })
    for (const cap of caps) {
      const start = c.start + (cap.start - c.srcIn)
      const end = Math.min(c.start + clipDuration(c), c.start + (cap.end - c.srcIn))
      const key = `${start.toFixed(3)}|${cap.text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: `cap_${out.length}`, start, end, text: cap.text })
    }
  }
  return out
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
