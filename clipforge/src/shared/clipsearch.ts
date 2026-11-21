import { mentionedNames } from './chapters'
import { hotWindows, refineClipBounds, sentenceEnergy, MAX_CLIP_SEC, MIN_CLIP_SEC, type AutoClipCandidate } from './autoclips'
import { buildSegments } from './transcript/sentences'
import { phoneticFold, tokenize } from './text'
import type { Segment, TranscriptWord } from './types'

/**
 * Auto Clips: kullanıcı BİR İSİM (oyuncu/takım) yazar → transkriptte o ismin geçtiği yerlerden klip adayları.
 * Konu tahmini yok: neyin klip olacağına kullanıcı karar verir; program yalnızca "nerede konuşuldu"yu bulur ve sınırları temiz keser.
 */
export interface TranscriptLine {
  start: number
  end: number
  text: string
}

/** Arama sorgusu: virgül / ";" / satır / " ve " ile ayrılan birden çok isim. Her isim için SON sözcük (soyadı) eşleşirse cümle isabettir. */
export function mentionMatcher(query: string): ((text: string) => boolean) | null {
  const terms = query
    .split(/[,;\n]+|\s+ve\s+/i)
    .map((t) => tokenize(t).map(phoneticFold).filter((x) => x.length >= 2))
    .filter((t) => t.length > 0)
    .map((t) => t[t.length - 1])
  if (terms.length === 0) return null
  return (text) => {
    const toks = tokenize(text).map(phoneticFold)
    // ≥4 harfli ad: ek alabilir (Osimhen'in → osimhenin); kısa adlar tam eşleşir
    return terms.some((q) => toks.some((w) => (q.length >= 4 ? w.startsWith(q) : w === q)))
  }
}

const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Transkript satırları (cümleler); arayüzdeki transkript görünümü bunu gösterir */
export const transcriptLines = (words: TranscriptWord[]): TranscriptLine[] => buildSegments(words).map((g) => ({ start: g.start, end: g.end, text: g.text }))

export interface MentionSuggestion {
  name: string
  /** anıldığı cümle sayısı */
  count: number
  /** ilk anıldığı an (sn) */
  firstAt: number
  /** bu ismin konuşulduğu yaklaşık toplam süre (sn): yakın (≤25 sn) anışlar tek konuşma sayılır */
  talkSec: number
}

/** "Şu oyuncu hakkında konuştun" önerileri: konuşmada anılan adlar, kaç cümlede anıldığı ve ilk anıldığı yer */
export function mentionSuggestions(words: TranscriptWord[], limit = 60): MentionSuggestion[] {
  const segs = buildSegments(words)
  const out: MentionSuggestion[] = []
  for (const { name } of mentionedNames(words)) {
    const m = mentionMatcher(name)
    if (!m) continue
    const hits = segs.filter((g) => m(g.text))
    if (hits.length === 0) continue
    // yakın anışları bir konuşmada topla: toplam konuşma süresi
    let talk = 0
    let a = hits[0]
    let b = hits[0]
    for (const h of hits.slice(1)) {
      if (h.start - b.end <= 25) b = h
      else (talk += b.end - a.start, (a = h), (b = h))
    }
    talk += b.end - a.start
    out.push({ name, count: hits.length, firstAt: hits[0].start, talkSec: Math.round(talk) })
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit)
}

/**
 * İsmin geçtiği yerlerden klip adayları. Birbirine ≤25 sn yakın anılar TEK klip olur (konu yarıda kesilmez); klip ilk anıştan 1 cümle önce
 * başlar, son anıştan 2 cümle sonra biter (cümle sınırında, başı/sonu `refineClipBounds` ile temizlenir). minSec'ten kısaysa komşu cümlelerle uzatılır;
 * maxSec'i aşarsa en yoğun pencere(ler) alınır.
 */
export function findMentionClips(words: TranscriptWord[], query: string, opts: { minSec?: number; maxSec?: number } = {}): AutoClipCandidate[] {
  const match = mentionMatcher(query)
  if (!match || words.length === 0) return []
  const maxSec = Math.min(MAX_CLIP_SEC, Math.max(30, opts.maxSec ?? MAX_CLIP_SEC))
  const minSec = Math.min(maxSec - 10, Math.max(8, opts.minSec ?? MIN_CLIP_SEC))
  const segs = buildSegments(words)
  const hitIdx = segs.flatMap((g, i) => (match(g.text) ? [i] : []))
  if (hitIdx.length === 0) return []
  // yakın anıları grupla
  const groups: number[][] = []
  for (const i of hitIdx) {
    const g = groups[groups.length - 1]
    if (g && segs[i].start - segs[g[g.length - 1]].end <= 25) g.push(i)
    else groups.push([i])
  }
  const subject = query.trim().replace(/\s+/g, ' ')
  const out: Omit<AutoClipCandidate, 'id'>[] = []
  for (const g of groups) {
    const a0 = Math.max(0, g[0] - 1)
    let b0 = Math.min(segs.length - 1, g[g.length - 1] + 2)
    let inside = segs.slice(a0, b0 + 1)
    // çok kısaysa sonrasına (sonra öncesine) cümle ekle
    let a = a0
    while (inside[inside.length - 1].end - inside[0].start < minSec && (b0 < segs.length - 1 || a > 0)) {
      if (b0 < segs.length - 1) b0++
      else a--
      inside = segs.slice(a, b0 + 1)
    }
    const pieces: Segment[][] = inside[inside.length - 1].end - inside[0].start > maxSec ? hotWindows(inside, (s) => match(s.text), minSec, maxSec, Math.min(5, Math.max(2, Math.ceil((inside[inside.length - 1].end - inside[0].start) / maxSec)))) : [inside]
    for (const p of pieces) {
      const ref = refineClipBounds(p, segs, words, minSec, maxSec)
      const dur = ref.end - ref.start
      if (dur < Math.min(minSec, 8) || dur > maxSec + 0.01) continue
      const hits = ref.piece.filter((s) => match(s.text))
      if (hits.length === 0) continue
      const energy = ref.piece.reduce((n, s) => n + sentenceEnergy(s.text), 0) / Math.max(1, ref.piece.length)
      out.push({
        start: ref.start,
        end: ref.end,
        durationSec: dur,
        subject,
        headline: `${subject} hakkında konuşmuşsun · ${hits.length} anış`,
        summary: clipText(hits.slice(0, 2).map((s) => s.text).join(' '), 200),
        score: Math.round((hits.length * 1.5 + Math.min(energy * 2, 3)) * 10) / 10
      })
    }
  }
  return out.sort((x, y) => x.start - y.start).map((c, i) => ({ ...c, id: `m${i + 1}` }))
}
