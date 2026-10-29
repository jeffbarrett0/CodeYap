import type { Timeline, Transcript, TranscriptWord } from '@shared/types'
import { createDefaultTimeline } from '@shared/timeline/model'
import { applyTemplate, DEFAULT_TEMPLATE } from '@shared/timeline/templates'
import { buildSegments } from '@shared/transcript/sentences'
import { TranscriptIndex } from '@shared/search/engine'

export interface Line {
  /** cümlenin başladığı an (sn) */
  at: number
  text: string
}

/** Cümle satırlarından kelime düzeyinde zaman damgalı sahte bir transkript üretir. */
export function wordsFromLines(lines: Line[], secPerWord = 0.35): TranscriptWord[] {
  const out: TranscriptWord[] = []
  for (const l of lines) {
    let t = l.at
    for (const text of l.text.split(/\s+/).filter(Boolean)) {
      out.push({ text, start: t, end: t + secPerWord * 0.9, confidence: 0.9 })
      t += secPerWord
    }
  }
  return out
}

export function indexFromLines(lines: Line[]) {
  const words = wordsFromLines(lines)
  const segments = buildSegments(words)
  return { words, segments, index: new TranscriptIndex(words, segments) }
}

const FILLER = [
  'Evet arkadaşlar yeni maça giriyoruz şimdi.',
  'Bu harita gerçekten çok zor bir harita olmuş.',
  'Chat ne diyorsunuz devam edelim mi?',
  'Az önce şu adamı nasıl kaçırdım anlamadım.',
  'Bugün yayına biraz geç başladık kusura bakmayın.',
  'Kahvemi alıp geliyorum bir saniye bekleyin.',
  'Şu silahı hiç sevmiyorum çok geri tepiyor.',
  'Bağış yapan herkese teşekkür ederim çok sağ olun.',
  'Oha bu ne lan inanamıyorum şu işe bak!',
  'Neyse devam ediyoruz ekibi toplayalım.'
]

/** ~durationSec uzunluğunda dolgu konuşma; `inject` satırları ilgili saniyeye yerleştirilir. */
export function longTranscriptLines(durationSec: number, inject: Line[] = []): Line[] {
  const lines: Line[] = []
  let t = 0
  let i = 0
  const skip = (at: number) => inject.some((l) => at >= l.at - 8 && at <= l.at + 12)
  while (t < durationSec) {
    const text = FILLER[i % FILLER.length]
    const n = text.split(' ').length
    if (!skip(t)) lines.push({ at: t, text })
    t += n * 0.35 + 1.1
    i++
  }
  return [...lines, ...inject].sort((a, b) => a.at - b.at)
}

export function makeTranscript(words: TranscriptWord[]): Transcript {
  return {
    id: 't1',
    assetId: 'a1',
    language: 'tr',
    model: 'mock',
    provider: 'mock',
    audioTrack: 0,
    createdAt: new Date(0).toISOString(),
    durationSec: words.at(-1)?.end ?? 0,
    words,
    segments: buildSegments(words)
  }
}


/**
 * Eski varsayılan düzeni taklit eder: gerçek varsayılana ek olarak (gizli) oyun ekranı katmanı `V1`.
 * Gerçek varsayılanda V1 YOKTUR (kullanıcı elle ekler); birçok işlem testi V1'e ihtiyaç duyar.
 */
export function createTimelineWithGame(): Timeline {
  return applyTemplate(createDefaultTimeline(), {
    ...DEFAULT_TEMPLATE,
    layers: [...DEFAULT_TEMPLATE.layers, { id: 'V1', name: 'Oyun ekranı', kind: 'video', role: 'screen', placement: { rect: { x: 0, y: 0.415, w: 1, h: 0.585 }, fit: 'contain', visible: false, opacity: 1 } }]
  })
}
