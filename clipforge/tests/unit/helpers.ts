import type { Timeline, Transcript, TranscriptWord } from '@shared/types'
import { createDefaultTimeline } from '@shared/timeline/model'
import { applyTemplate } from '@shared/timeline/templates'
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
 * Eski (3 bölgeli) varsayılan düzeni taklit eder: orta görsel yeri I2, üst video V2, alt görsel I1 ve (gizli) oyun ekranı V1; 9:16.
 * GERÇEK varsayılan artık yalnızca tek tam kare "Video" katmanıdır; birçok işlem testi bu çok katmanlı düzene ihtiyaç duyar.
 */
export function createTimelineWithGame(): Timeline {
  const P = (x: number, y: number, w: number, h: number, fit: 'cover' | 'contain' = 'cover', visible = true) => ({ rect: { x, y, w, h }, fit, visible, opacity: 1 })
  const tl = applyTemplate(createDefaultTimeline(), {
    id: 'legacy-3zone',
    name: 'eski',
    aspect: '9:16',
    background: '#000000',
    layers: [
      { id: 'I2', name: 'Orta alan (görsel)', kind: 'image', role: 'image', placement: P(0.03, 0.34, 0.94, 0.14, 'contain') },
      { id: 'V2', name: 'Video', kind: 'video', role: 'webcam', placement: P(0, 0, 1, 0.415, 'contain') },
      { id: 'I1', name: 'Konu görseli', kind: 'image', role: 'image', placement: P(0, 0.415, 1, 0.585) },
      { id: 'V1', name: 'Oyun ekranı', kind: 'video', role: 'screen', placement: P(0, 0.415, 1, 0.585, 'contain', false) }
    ]
  })
  return { ...tl, aspectAuto: false }
}
