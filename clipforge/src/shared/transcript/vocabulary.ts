import type { Segment, Transcript, TranscriptWord } from '../types'
import { foldTr, similarity } from '../text'
import { buildSegments } from './sentences'

/** Sözlük metnini (satır / virgül / noktalı virgül ayraçlı) benzersiz terimlere ayırır. */
export function parseVocabulary(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n,;]+/)) {
    const t = raw.trim()
    const k = foldTr(t)
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

/** Whisper'a verilecek başlangıç ipucu: sözlük terimleri (+ isteğe bağlı dolgu sesi örneği). Whisper'ın bağlam sınırı için kısaltılır. */
export function buildPrompt(vocabulary: string, fillers: boolean, maxChars = 500): string {
  const terms = parseVocabulary(vocabulary)
  const parts: string[] = []
  // Dolgu sesi örneği: Whisper bunları atlamak yerine yazıya dökmeye yönelir (sessizlik/dolgu kesme için gerekli)
  if (fillers) parts.push('Şey, ııı, eee, hımm, yani.')
  if (terms.length) parts.push(`${terms.join(', ')}.`)
  let p = parts.join(' ')
  if (p.length > maxChars) p = p.slice(0, maxChars).replace(/[^.,\s]*$/, '').trim()
  return p
}

const LETTERS = /[\p{L}\p{N}]+/gu

/** Kelimedeki harf kısmı (öncesi/sonrası noktalama ve kesme işareti sonrası ek ayrı tutulur). */
function split(text: string): { pre: string; core: string; post: string } {
  const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?)([^\p{L}\p{N}]*)$/u.exec(text)
  return m ? { pre: m[1], core: m[2], post: m[3] } : { pre: '', core: text, post: '' }
}

const MAX_SUFFIX = 5
const MIN_LEN = 5
const THRESHOLD = 0.84

/** Sözlükteki tek bir kelime ile bir transkript kelimesinin (ekli olabilir) eşleşip eşleşmediğini döner: yeni yazım ya da null. */
function correctWord(text: string, vocabWords: string[]): string | null {
  const { pre, core, post } = split(text)
  const apos = /^(.*?)(['’])(.*)$/.exec(core)
  const stemRaw = apos ? apos[1] : core
  const suffixRaw = apos ? apos[2] + apos[3] : ''
  const folded = (foldTr(stemRaw).match(LETTERS) ?? []).join('')
  if (folded.length < MIN_LEN - 1) return null
  let best: { term: string; sim: number; cut: number } | null = null
  for (const term of vocabWords) {
    const tf = foldTr(term)
    if (tf.length < MIN_LEN) continue
    if (folded === tf) {
      // harfler aynı: yalnızca aksan/ünlü işareti farkı varsa (Ozbek → Özbek) sözlük yazımına çevir; büyük/küçük harf farkına dokunma
      if (stemRaw.toLocaleLowerCase('tr-TR') === term.toLocaleLowerCase('tr-TR')) return null
      return pre + term + suffixRaw + post
    }
    // ek almış biçim: kök, sözlük kelimesinden en fazla MAX_SUFFIX harf uzun olabilir
    for (let extra = 0; extra <= MAX_SUFFIX; extra++) {
      const len = tf.length + extra
      if (folded.length < len) break
      if (folded.length !== len && !apos && extra > 0) {
        // kesme işareti yoksa ek, kelimenin sonunda olmalı: kökü uzunluğa göre kes
      }
      const stem = folded.slice(0, tf.length)
      const rest = folded.length - tf.length
      if (rest > MAX_SUFFIX) break
      if (apos && rest !== 0) break // kesme işaretli kelimede kök zaten ayrıdır
      const sim = similarity(stem, tf)
      if (sim >= THRESHOLD && sim < 1 && (!best || sim > best.sim)) best = { term, sim, cut: tf.length }
      break
    }
  }
  if (!best) return null
  // yeni yazım: sözlük terimi + özgün ek (özgün kelimedeki kökten sonraki kısım)
  const stemLen = apos ? stemRaw.length : best.cut
  const suffix = apos ? suffixRaw : stemRaw.slice(stemLen) + suffixRaw
  return pre + best.term + suffix + post
}

export interface VocabResult {
  words: TranscriptWord[]
  corrections: { index: number; from: string; to: string }[]
}

/**
 * Özel sözlüğe göre bulanık düzeltme: "kabukçu" → "Kavukçu", "Kabukçu'nun" → "Kavukçu'nun".
 * Yalnızca ≥5 harfli sözlük kelimelerine, yüksek benzerlikle (≥0.84) ve çekim ekleri korunarak uygulanır;
 * kısa/yaygın sözcükler (ör. "kabuk") değiştirilmez. Düzeltilen kelimede özgün yazım `corrected` alanında saklanır.
 * Çok sözcüklü terimler ("Abdullah Kavukçu") sözcük sözcük eşlenir.
 */
export function applyVocabulary(words: TranscriptWord[], vocabulary: string[]): VocabResult {
  const vocabWords = [...new Set(vocabulary.flatMap((t) => t.split(/\s+/)).filter((w) => (foldTr(w).match(LETTERS) ?? []).join('').length >= MIN_LEN))]
  const corrections: VocabResult['corrections'] = []
  const out = words.map((w, index) => {
    if (w.corrected !== undefined) return w // elle düzeltilmiş kelimeye dokunma
    const fixed = vocabWords.length ? correctWord(w.text, vocabWords) : null
    if (!fixed || fixed === w.text) return w
    corrections.push({ index, from: w.text, to: fixed })
    return { ...w, text: fixed, corrected: w.text }
  })
  return { words: out, corrections }
}

/** Güveni eşiğin altındaki (emin olunamayan) kelimelerin indeksleri */
export function uncertainIndexes(words: TranscriptWord[], threshold = 0.5): number[] {
  const out: number[] = []
  words.forEach((w, i) => {
    if (w.confidence !== undefined && w.confidence < threshold && w.corrected === undefined && /[\p{L}]/u.test(w.text)) out.push(i)
  })
  return out
}

/** Transkripti yeni kelimelerle (zamanlar aynı) yeniden kurar: cümle metinleri güncellenir */
export function withWords(t: Transcript, words: TranscriptWord[]): Transcript {
  const segments: Segment[] = buildSegments(words)
  return { ...t, words, segments }
}

/**
 * Elle düzeltme: `index`'teki kelimeyi `to` ile değiştirir; `all` ise aynı yazımdaki (harfler, büyük/küçük harf ve noktalama farkı hariç)
 * tüm kelimeleri düzeltir. Çekim ekleri ve noktalama korunur.
 */
export function fixWord(t: Transcript, index: number, to: string, all = false): { transcript: Transcript; replaced: number } {
  const target = t.words[index]
  if (!target) return { transcript: t, replaced: 0 }
  const key = (x: string) => (foldTr(split(x).core.split(/['’]/)[0]).match(LETTERS) ?? []).join('')
  const from = key(target.text)
  const clean = to.trim()
  let replaced = 0
  const words = t.words.map((w, i) => {
    const k = key(w.text)
    // aynı kök (en fazla 5 harf ekli biçimler dahil; çok kısa köklerde ek eşleşmesi yapılmaz)
    const hit = i === index || (all && from.length > 0 && (k === from || (from.length >= 4 && k.startsWith(from) && k.length - from.length <= MAX_SUFFIX)))
    if (!hit) return w
    const { pre, core, post } = split(w.text)
    const apos = /^(.*?)(['’].*)$/.exec(core)
    const stem = apos ? apos[1] : core
    // kesme işareti yoksa kökten sonraki harfler çekim ekidir ve korunur
    const extra = apos ? '' : stem.slice(Math.min(from.length, stem.length))
    const text = pre + clean + extra + (apos ? apos[2] : '') + post
    if (text === w.text) return w
    replaced++
    return { ...w, text, corrected: w.corrected ?? w.text, confidence: 1 }
  })
  return { transcript: withWords(t, words), replaced }
}
