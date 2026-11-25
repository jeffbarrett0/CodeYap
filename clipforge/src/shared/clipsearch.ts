import { mentionedNames } from './chapters'
import { hotWindows, refineClipBounds, sentenceEnergy, MAX_CLIP_SEC, MIN_CLIP_SEC, type AutoClipCandidate } from './autoclips'
import { buildSegments } from './transcript/sentences'
import { foldTr, phoneticFold, tokenize } from './text'
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


const PAUSE_SEC = 0.9
const LEAD_MAX_SEC = 40
const TAIL_MAX_SEC = 30

/** İlk anıştan geriye: en çok LEAD_MAX_SEC içinde en büyük konuşma boşluğundan (≥0,9 sn) sonraki cümle; boşluk yoksa 1 cümle önce */
export function topicStart(segs: Segment[], hit: number, fallbackBack = 1): number {
  let best = -1
  let bestGap = PAUSE_SEC
  for (let i = hit; i > 0; i--) {
    if (segs[hit].start - segs[i - 1].start > LEAD_MAX_SEC) break
    const gap = segs[i].start - segs[i - 1].end
    if (gap >= bestGap) (bestGap = gap, (best = i))
  }
  return best >= 0 ? best : Math.max(0, hit - fallbackBack)
}

/** Son anıştan ileriye: en çok TAIL_MAX_SEC içinde en büyük boşluktan ÖNCEKİ cümle; boşluk yoksa 3 cümle sonra */
export function topicEnd(segs: Segment[], hit: number): number {
  let best = -1
  let bestGap = PAUSE_SEC
  for (let i = hit; i < segs.length - 1; i++) {
    if (segs[i].end - segs[hit].end > TAIL_MAX_SEC) break
    const gap = segs[i + 1].start - segs[i].end
    if (gap >= bestGap) (bestGap = gap, (best = i))
  }
  return best >= 0 ? Math.max(best, Math.min(segs.length - 1, hit + 1)) : Math.min(segs.length - 1, hit + 3)
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
    // KONUNUN GERÇEK BAŞI/SONU (kullanıcı: "1 dk anlatmışım, 30. saniyede adı geçti diye 30. saniyeden almışsın"): isim konuşmanın ortasında geçebilir;
    // ismin öncesinde (≤40 sn) ve sonrasında (≤30 sn) konuşma duraklarının en belirgininde (en büyük boşluk, ≥0,9 sn) başlayıp biter.
    const a0 = topicStart(segs, g[0], g[g.length - 1] > g[0] ? 0 : 1)
    let b0 = topicEnd(segs, g[g.length - 1])
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

/* ───────────── "Klip çıkar": düz Türkçe açıklamadan an bulma ───────────── */

/** Anlamsız/bağlaç sözcükler (arama açıklamasında yok sayılır) */
const SCENE_STOP = new Set(['ve', 'ile', 'bir', 'bu', 'su', 'o', 'de', 'da', 'mi', 'mu', 'ki', 'icin', 'gibi', 'olan', 'yer', 'yeri', 'yerde', 'yerin', 'zaman', 'an', 'ani', 'kisim', 'kismi', 'bolum', 'bolumu', 'klip', 'klibi', 'cikar', 'bana', 'ben', 'sen', 'maci', 'macin', 'orada', 'surada', 'nokta', 'noktayi', 'bolge', 'sahne', 'sahneyi', 'ver'])

/** Futbol olayları: tek kavram, birden çok söyleniş ("kırmızı kart" = atıldı = oyundan atıldı = ihraç …) */
const SCENE_CONCEPTS: { re: RegExp; label: string; alts: string[] }[] = [
  { re: /kirmizi\s*kart/, label: 'kırmızı kart', alts: ['kirmizi kart', 'kirmizi', 'atildi', 'atilmis', 'atilir', 'oyundan atil', 'oyundan at', 'ihrac'] },
  { re: /sari\s*kart/, label: 'sarı kart', alts: ['sari kart', 'sari'] },
  { re: /penalt/, label: 'penaltı', alts: ['penalt', '11 metre', 'on bir metre', 'beyaz nokta'] },
  { re: /ofsayt/, label: 'ofsayt', alts: ['ofsayt', 'offside'] },
  { re: /\bvar\b|video\s*yardimci/, label: 'VAR', alts: ['var ', ' var', 'video yardimci', 'var hakemi'] },
  { re: /sakat/, label: 'sakatlık', alts: ['sakat', 'sakatlan', 'yerde kal'] },
  { re: /degisiklik|oyuncu\s*degis/, label: 'oyuncu değişikliği', alts: ['degisiklik', 'oyuncu degis', 'oyundan cik', 'oyuna gir'] }
]

const foldPh = (s: string) => phoneticFold(foldTr(s))

interface SceneGroup {
  label: string
  /** aranan kalıplar (katlanmış); kelime başı eşleşmesi, çok sözcüklüde alt dizi */
  alts: string[]
  /** 1 = zorunlu, 0.5 = yumuşak (fiil çekimi: "gördüğü") */
  weight: number
}

/** Açıklamadan arama grupları: özel adlar (büyük harfli ardışık sözcükler) tek grup (herhangi biri yeter), olaylar tek kavram, kalan sözcükler ayrı grup */
export function sceneGroups(query: string): SceneGroup[] {
  const groups: SceneGroup[] = []
  const folded = foldTr(query)
  let rest = query
  // 1) olay kavramları
  for (const c of SCENE_CONCEPTS) {
    if (c.re.test(folded)) {
      groups.push({ label: c.label, alts: c.alts.map(foldPh), weight: 1 })
      // kavramı oluşturan sözcükleri açıklamadan çıkar (aynı sözcük ikinci kez ayrı grup olmasın)
      const m = c.re.exec(folded)
      if (m) rest = (query.slice(0, m.index) + ' ' + query.slice(m.index + m[0].length)).trim()
    }
  }
  // 2) kalan sözcükler: ardışık büyük harfliler = ad grubu
  const words = rest.split(/[\s,;]+/).map((w) => w.replace(/['’].*$/, '').replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  let name: string[] = []
  const flush = () => {
    if (name.length) groups.push({ label: name.join(' '), alts: name.map((n) => foldPh(n).slice(0, Math.max(4, foldPh(n).length - 1))), weight: 1 })
    name = []
  }
  words.forEach((w, i) => {
    const f = foldTr(w)
    const upper = w[0] !== w[0].toLocaleLowerCase('tr-TR') && (i > 0 || words.length === 1 || /^\p{Lu}/u.test(words[1] ?? ''))
    if (SCENE_STOP.has(f) || f.length < 2) return flush()
    if (upper) return void name.push(w)
    flush()
    const p = foldPh(w)
    const soft = /(digi|dugu|tigi|tugu)$/.test(p)
    groups.push({ label: w, alts: [p.slice(0, Math.max(4, Math.min(p.length, soft ? 4 : 5)))], weight: soft ? 0.5 : 1 })
  })
  flush()
  return groups
}

export interface SceneCandidate {
  start: number
  end: number
  /** 0..1: aranan kavramların ne kadarı bu pencerede geçiyor */
  score: number
  matched: string[]
  missing: string[]
  /** eşleşen cümlelerden kısa alıntı */
  text: string
}

/**
 * Açıklamadaki kavramların (kim + ne oldu) BİRLİKTE geçtiği yerler: kayan pencere (≤45 sn), zorunlu kavramların kapsamı + yoğunluk.
 * Başlangıç ilk eşleşen cümlenin biraz öncesi, bitiş son eşleşen cümlenin biraz sonrası: kullanıcı zaten ince ayar yapar. Konuşma yoksa bulunamaz (görüntüye bakılmaz).
 */
export function findSceneClips(words: TranscriptWord[], query: string, opts: { windowSec?: number; max?: number } = {}): SceneCandidate[] {
  const groups = sceneGroups(query)
  if (groups.length === 0 || words.length === 0) return []
  const segs = buildSegments(words)
  const folded = segs.map((g) => ` ${foldPh(g.text)} `)
  const hit = (gi: number, si: number): boolean => groups[gi].alts.some((a) => (a.includes(' ') ? folded[si].includes(a) : folded[si].includes(` ${a}`)))
  const total = groups.reduce((n, g) => n + g.weight, 0)
  const windowSec = opts.windowSec ?? 45
  type Win = { a: number; b: number; cover: number; hits: number; matched: number[] }
  const wins: Win[] = []
  for (let a = 0; a < segs.length; a++) {
    const got = new Set<number>()
    let hits = 0
    for (let b = a; b < segs.length && segs[b].end - segs[a].start <= windowSec; b++) {
      let any = false
      for (let gi = 0; gi < groups.length; gi++) if (hit(gi, b)) (got.add(gi), (hits += 1), (any = true))
      if (!any) continue
      const cover = [...got].reduce((n, gi) => n + groups[gi].weight, 0) / total
      wins.push({ a, b, cover, hits, matched: [...got] })
    }
  }
  const need = groups.length === 1 ? 1 : 0.6
  const good = wins.filter((w) => w.cover >= need - 1e-9)
  // en iyi: kapsam yüksek, sonra dar pencere, sonra çok isabet
  good.sort((x, y) => y.cover - x.cover || segs[x.b].end - segs[x.a].start - (segs[y.b].end - segs[y.a].start) || y.hits - x.hits)
  const out: SceneCandidate[] = []
  const max = opts.max ?? 8
  for (const w of good) {
    if (out.length >= max) break
    const start = segs[w.a].start
    const end = segs[w.b].end
    if (out.some((o) => !(end < o.start - 20 || start > o.end + 20))) continue // yakın/örtüşen aday yok
    // pencereyi sıkılaştır: ilk ve son EŞLEŞEN cümle
    let a = w.a
    let b = w.b
    while (a < b && !groups.some((_, gi) => hit(gi, a))) a++
    while (b > a && !groups.some((_, gi) => hit(gi, b))) b--
    const prev = segs[a - 1]?.end ?? 0
    const next = segs[b + 1]?.start ?? segs[b].end + 6
    const s0 = Math.max(prev + 0.1, segs[a].start - 3, 0)
    const e0 = Math.min(next - 0.1, segs[b].end + 5)
    const snippet = segs.slice(a, b + 1).filter((_, i) => groups.some((__, gi) => hit(gi, a + i))).map((g) => g.text).join(' ')
    out.push({
      start: Math.round(s0 * 10) / 10,
      end: Math.round(Math.max(e0, s0 + 3) * 10) / 10,
      score: Math.round(w.cover * 100) / 100,
      matched: w.matched.map((gi) => groups[gi].label),
      missing: groups.map((g, gi) => (w.matched.includes(gi) ? '' : g.label)).filter(Boolean),
      text: clipText(snippet, 260)
    })
  }
  return out.sort((x, y) => y.score - x.score || x.start - y.start)
}
