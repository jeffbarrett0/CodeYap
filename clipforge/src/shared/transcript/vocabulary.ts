import type { Segment, Transcript, TranscriptWord } from '../types'
import { foldTr, similarity } from '../text'
import { buildSegments } from './sentences'

/** Sözlük metnini (satır / virgül / noktalı virgül ayraçlı) benzersiz terimlere ayırır. */
export function parseVocabulary(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n,;]+/)) {
    const t = raw.trim()
    if (/=>|→/.test(t)) continue // "yanlış => doğru" satırları düzeltme listesidir (parseAliases), terim değil
    const k = foldTr(t)
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

/** "Osman => Osimhen" satırları: konuşma tanımanın SIK yaptığı, gerçek bir kelimeye benzediği için bulanık düzeltmenin yakalayamadığı yanlışlar. */
export function parseAliases(text: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = /^(.+?)\s*(?:=>|→)\s*(.+)$/.exec(line.trim())
    if (m) for (const f of m[1].split('|')) if (f.trim() && m[2].trim()) out.push({ from: f.trim(), to: m[2].trim() })
  }
  return out
}

/** Whisper'a verilecek başlangıç ipucu: sözlük terimleri (+ isteğe bağlı dolgu sesi örneği). `extra`: yerleşik futbol adları (kullanıcı terimlerinden SONRA, sığdığı kadar). Whisper'ın bağlam sınırı için kısaltılır. */
export function buildPrompt(vocabulary: string, fillers: boolean, maxChars = 500, extra: string[] = []): string {
  const terms = parseVocabulary(vocabulary)
  const have = new Set(terms.map((t) => foldTr(t)))
  // tam adı olan terimin soyadı ayrıca yazılmaz (ipucu kısıtlı)
  const full = extra.filter((t) => /\s/.test(t.trim()))
  for (const t of extra) {
    const k = foldTr(t)
    if (have.has(k) || (!/\s/.test(t.trim()) && full.some((f) => foldTr(f).endsWith(` ${k}`) || foldTr(f).startsWith(`${k} `)))) continue
    have.add(k)
    terms.push(t)
  }
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

const FRONT = new Set('eiöü')
const BACK = new Set('aıou')
const TO_FRONT: Record<string, string> = { a: 'e', ı: 'i', o: 'ö', u: 'ü' }
const TO_BACK: Record<string, string> = { e: 'a', i: 'ı', ö: 'o', ü: 'u' }
/** Kök değişince ek ünlü uyumuna girer: "Osman'ın" → "Osimhen'in" (son ünlü ince ise ek ince, kalın ise kalın) */
export function harmonizeSuffix(stem: string, suffix: string): string {
  const last = [...stem.toLocaleLowerCase('tr-TR')].reverse().find((c) => FRONT.has(c) || BACK.has(c))
  if (!last) return suffix
  const map = FRONT.has(last) ? TO_FRONT : TO_BACK
  return suffix.replace(/[aeıioöuü]/g, (c) => map[c] ?? c)
}
/** Yanlış yazılmış köke eklenebilen yaygın çekim ekleri ("Osman'ın", "Osmana", "Osmandan"); başka ek ("Osmanlı") eşleşmez */
const CASE_SUFFIX = /^(?:nın|nin|nun|nün|ın|in|un|ün|ya|ye|na|ne|a|e|yı|yi|yu|yü|nı|ni|nu|nü|ı|i|u|ü|da|de|ta|te|dan|den|tan|ten|la|le|yla|yle|lar|ler|ları|leri|dır|dir|dur|dür|tır|tir)$/u
const MIN_LEN = 5
const THRESHOLD = 0.84

/** Sözlükteki tek bir kelime ile bir transkript kelimesinin (ekli olabilir) eşleşip eşleşmediğini döner: yeni yazım ya da null. */
function correctWord(text: string, vocabWords: string[], threshold = THRESHOLD): string | null {
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
    // kesme işaretli kelime ya da bir harf eksik yazılmış kök (Osimen → Osimhen): kök doğrudan karşılaştırılır
    if (apos || folded.length === tf.length - 1) {
      const sim0 = similarity(folded, tf)
      if (sim0 >= threshold && sim0 < 1 && (!best || sim0 > best.sim)) best = { term, sim: sim0, cut: stemRaw.length }
      if (apos) continue
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
      if (sim >= threshold && sim < 1 && (!best || sim > best.sim)) best = { term, sim, cut: tf.length }
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
export function applyVocabulary(words: TranscriptWord[], vocabulary: string[], soft: string[] = [], aliases: { from: string; to: string }[] = []): VocabResult {
  const toWords = (list: string[]) => [...new Set(list.flatMap((t) => t.split(/\s+/)).filter((w) => (foldTr(w).match(LETTERS) ?? []).join('').length >= MIN_LEN))]
  const vocabWords = toWords(vocabulary)
  // yerleşik (futbol) sözlüğü: kullanıcı sözlüğünden daha temkinli — daha yüksek benzerlik; yalnızca büyük harfle başlayan ya da emin olunamayan kelimeler
  const softWords = toWords(soft).filter((w) => !vocabWords.includes(w) && (foldTr(w).match(LETTERS) ?? []).join('').length >= 6)
  const corrections: VocabResult['corrections'] = []
  // HIZ: aynı yazımdaki kelimeler (2 saatlik yayında ~25 bin kelimenin yalnızca birkaç bini farklıdır) için sonuç bir kez hesaplanır
  const fixMemo = new Map<string, string | null>()
  // açık düzeltme listesi ("Osman => Osimhen"): gerçek bir kelimeye benzeyen sık yanlışlar; çekim eki korunur (ünlü uyumuyla)
  const aliasMap = new Map<string, string>()
  for (const a of aliases) {
    const k = (foldTr(a.from).match(LETTERS) ?? []).join('')
    if (k) aliasMap.set(k, a.to)
  }
  const aliasFix = (text: string): string | null => {
    if (aliasMap.size === 0) return null
    const { pre, core, post } = split(text)
    const apos = /^(.*?)(['’])(.*)$/.exec(core)
    const stemRaw = apos ? apos[1] : core
    const folded = (foldTr(stemRaw).match(LETTERS) ?? []).join('')
    let to = aliasMap.get(folded)
    let suffix = apos ? apos[2] + apos[3] : ''
    if (!to && !apos) {
      // kesme işaretsiz ekli biçim: kök + yaygın çekim eki
      for (const [k, v] of aliasMap) {
        if (k.length >= 4 && folded.startsWith(k) && CASE_SUFFIX.test(folded.slice(k.length))) {
          to = v
          suffix = stemRaw.slice(k.length)
          break
        }
      }
    }
    if (!to) return null
    return pre + to + harmonizeSuffix(to, suffix) + post
  }
  let out = words.map((w, index) => {
    if (w.corrected !== undefined) return w // elle düzeltilmiş kelimeye dokunma
    const al = aliasFix(w.text)
    if (al && al !== w.text) {
      corrections.push({ index, from: w.text, to: al })
      return { ...w, text: al, corrected: w.text }
    }
    const soft = softWords.length > 0 && (/^[A-ZÇĞİÖŞÜ]/.test(w.text) || (w.confidence !== undefined && w.confidence < 0.6))
    const mk = `${w.text}|${soft ? 1 : 0}`
    let fixed = fixMemo.get(mk)
    if (fixed === undefined) {
      fixed = vocabWords.length ? correctWord(w.text, vocabWords) : null
      if (!fixed && soft) fixed = correctWord(w.text, softWords, 0.82)
      fixMemo.set(mk, fixed)
    }
    if (!fixed || fixed === w.text) return w
    corrections.push({ index, from: w.text, to: fixed })
    return { ...w, text: fixed, corrected: w.text }
  })
  // bölünmüş terimler: "Galata saray" → "Galatasaray", "Osim hen" → "Osimhen" (iki kelimenin birleşimi tek terime çok benziyorsa)
  const terms = [...new Set([...vocabWords, ...softWords])].filter((t) => (foldTr(t).match(LETTERS) ?? []).join('').length >= 7)
  if (terms.length) {
    const merged: TranscriptWord[] = []
    const pairMemo = new Map<string, string | null>()
    for (let i = 0; i < out.length; i++) {
      const a2 = out[i]
      const b2 = out[i + 1]
      if (b2 && a2.corrected === undefined && b2.corrected === undefined && b2.start - a2.end < 0.45 && /^[\p{L}]+$/u.test(a2.text.replace(/[.,;:!?]$/, '')) && !/[.!?]$/.test(a2.text)) {
        const sa = split(a2.text)
        const sb2 = split(b2.text)
        const joined = (foldTr(sa.core).match(LETTERS) ?? []).join('') + (foldTr(sb2.core.split(/['’]/)[0]).match(LETTERS) ?? []).join('')
        const pk = `${joined}|${sa.core.length >= 3 ? 1 : 0}${sb2.core.length >= 2 ? 1 : 0}`
        let hit = pairMemo.get(pk)
        if (hit === undefined) {
          hit =
            terms.find((t) => {
              const tf = (foldTr(t).match(LETTERS) ?? []).join('')
              return joined.length >= tf.length && joined.length <= tf.length + MAX_SUFFIX && similarity(joined.slice(0, tf.length), tf) >= 0.9 && sa.core.length >= 3 && sb2.core.length >= 2
            }) ?? null
          pairMemo.set(pk, hit)
        }
        if (hit) {
          const aps = /(['’].*)$/.exec(sb2.core)
          corrections.push({ index: i, from: `${a2.text} ${b2.text}`, to: hit + (aps ? aps[1] : '') + sb2.post })
          merged.push({ ...a2, text: hit + (aps ? aps[1] : '') + sb2.post, end: b2.end, corrected: `${a2.text} ${b2.text}`, confidence: Math.max(a2.confidence ?? 0, b2.confidence ?? 0) || undefined })
          i++
          continue
        }
      }
      merged.push(a2)
    }
    out = merged
  }
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
    const hit = i === index || (all && from.length > 0 && (k === from || (from.length >= 4 && k.startsWith(from) && CASE_SUFFIX.test(k.slice(from.length)))))
    if (!hit) return w
    const { pre, core, post } = split(w.text)
    const apos = /^(.*?)(['’].*)$/.exec(core)
    const stem = apos ? apos[1] : core
    // kesme işareti yoksa kökten sonraki harfler çekim ekidir ve korunur
    const extra = apos ? '' : stem.slice(Math.min(from.length, stem.length))
    const text = pre + clean + harmonizeSuffix(clean, extra + (apos ? apos[2] : '')) + post
    if (text === w.text) return w
    replaced++
    return { ...w, text, corrected: w.corrected ?? w.text, confidence: 1 }
  })
  return { transcript: withWords(t, words), replaced }
}
