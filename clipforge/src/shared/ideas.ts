import { key } from './graphics/geo'
import { buildSegments } from './transcript/sentences'
import type { Segment, TranscriptWord } from './types'

/**
 * Video önerileri: uzun bir yayının transkriptinden "ayrı bir video olabilecek" konu bölümlerini bulur
 * (ör. 15 dakika boyunca yapay zekâ konuşulmuş). Yöntem: kelime dağarcığındaki değişimden konu sınırları (TextTiling benzeri),
 * bölümlere skor (tutarlılık, belirginlik, süre uygunluğu), anahtar kelimeler ve alıntı özet. Dil modeli GEREKTİRMEZ;
 * başlıklar burada yalnızca taslaktır — daha iyi başlıklar için isteğe bağlı yapay zekâ adımı main tarafındadır.
 */
export interface IdeaOptions {
  /** sınırlara eklenen pay (sn) */
  padSec: number
  /** en kısa / en uzun bölüm (sn) */
  minSec: number
  maxSec: number
  /** döndürülecek en fazla öneri */
  max: number
}
export const DEFAULT_IDEA_OPTIONS: IdeaOptions = { minSec: 120, maxSec: 1800, max: 10, padSec: 0.25 }

export interface VideoIdea {
  id: string
  /** konu (ör. "Batrakov") ve kısa cümle ("Batrakov hakkında konuşmuşsun") */
  label: string
  headline: string
  /** entity: bir özel isim bölümde yoğun anılıyor; topic: kelime dağarcığı değişimiyle ayrılan konu bölümü */
  kind: 'entity' | 'topic'
  /** konunun bölümde kaç kez anıldığı (entity) */
  mentions?: number
  start: number
  end: number
  durationSec: number
  /** bölüme en çok özgü kelimeler (ör. "yapay zeka", "model") */
  keywords: string[]
  /** bölümden temsilci cümleler (özet yerine geçen alıntı) */
  summary: string
  /** 0..1, yüksek = daha iyi ayrı video adayı */
  score: number
  firstWord: number
  lastWord: number
  /** başlık önerileri: ilki ana öneri */
  titles: string[]
  titleSource: 'draft' | 'ai'
  /** yapay zekâ: videonun açılışı için fikir */
  hook?: string
  /** yapay zekâ: 1-2 cümlelik özet */
  description?: string
}

export interface IdeasResult {
  ideas: VideoIdea[]
  totalSec: number
  ai: { requested: boolean; used: boolean; error?: string; provider?: string }
}

const STOP = new Set(
  `ve ile ama fakat ya da veya ki de da mi mı mu mü bu şu o bir iki üç ben sen biz siz onlar bana sana ona bize size onlara beni seni onu bizi sizi onları
  çok daha en gibi için kadar şey şeyi şeyler yani işte hani zaten sonra önce şimdi bugün dün yarın evet hayır tamam peki hem hep hiç her bazı bütün tüm
  olan olarak olur oldu olmuş olacak olması olduğu olduğunu var yok değil ise çünkü yani belki sanki ancak bile artık hala hâlâ tabii tabi aslında
  bence bunu bunun bunlar şunu şunun onun burada orada şurada nasıl neden niye ne kim kime kimin hangi nerede nereye mesela örneğin yine bile diye
  ediyor etti eder edecek yapıyor yaptı yapar yapacak geliyor geldi gelir gidiyor gitti gider bakıyor baktı bakın bak bakalım dedi diyor der deyip derim
  söylüyor söyledi biliyorum bilmiyorum düşünüyorum sanırım galiba herhalde acaba nasılsa ayrıca üstelik fazla az biraz tam gerçekten kesinlikle
  kendi kendine kendini kendisi kendime kendimi böyle şöyle öyle herkes kimse hiçbir başka tane defa kere zaman insan insanlar adam şeyin şeyde bunda orada burada`.split(/\s+/)
)
export const STOP_KEYS = new Set([...STOP].map((w) => key(w)))

/** Türkçe çekim eklerini kabaca birleştirmek için: aksansız küçük harf, ilk 5 harf ("yapay", "zeka", "model" aynı kökte toplanır) */
const stem = (k: string) => (k.length > 5 ? k.slice(0, 5) : k)

export function tokens(text: string): { surface: string; stem: string }[] {
  const out: { surface: string; stem: string }[] = []
  for (const raw of text.split(/\s+/)) {
    const surface = raw.replace(/[^\p{L}\p{N}'’]/gu, '').split(/['’]/)[0]
    if (!surface) continue
    const k = key(surface).replace(/ /g, '')
    // mastar ("dinlemek", "yapmak") konu değildir
    if (k.length < 4 || /^\d+$/.test(k) || STOP_KEYS.has(k) || (k.length >= 6 && /(mak|mek)$/.test(k))) continue
    out.push({ surface: surface.toLocaleLowerCase('tr-TR'), stem: stem(k) })
  }
  return out
}

type Vec = Map<string, number>
const add = (a: Vec, b: Vec) => {
  for (const [k, v] of b) a.set(k, (a.get(k) ?? 0) + v)
  return a
}
function cosine(a: Vec, b: Vec): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of a) (na += v * v, (dot += v * (b.get(k) ?? 0)))
  for (const v of b.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

interface Unit {
  /** cümle aralığı */
  a: number
  b: number
  start: number
  end: number
  tf: Vec
}

export const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Taslak başlıklar (yapay zekâ yoksa): anahtar kelimelerden basit kalıplar */
export function draftTitles(keywords: string[], durationSec: number): string[] {
  const [k1, k2, k3] = keywords.map(cap)
  if (!k1) return ['Yayından bir bölüm']
  const mins = Math.max(1, Math.round(durationSec / 60))
  const out = [`${k1} hakkında konuştuklarım`]
  if (k2) out.push(`${k1} ve ${k2}: yayında anlattıklarım`)
  out.push(k3 ? `${k1}, ${k2}, ${k3} — ${mins} dakikalık sohbet` : `${k1} üzerine ${mins} dakika`)
  return out
}

/** Kelime dağarcığı değişiminden konu bölümleri (TextTiling benzeri) */
function topicIdeas(words: TranscriptWord[], segs: Segment[], o: IdeaOptions): VideoIdea[] {
  const total = words.length ? words[words.length - 1].end : 0
  if (segs.length < 8 || total < 120) return []

  // 1) ~45 sn'lik birimler (cümle sınırlarında)
  const UNIT = 45
  const units: Unit[] = []
  let cur: Unit | null = null
  for (const [i, s] of segs.entries()) {
    if (!cur) cur = { a: i, b: i, start: s.start, end: s.end, tf: new Map() }
    cur.b = i
    cur.end = s.end
    for (const t of tokens(s.text)) cur.tf.set(t.stem, (cur.tf.get(t.stem) ?? 0) + 1)
    if (cur.end - cur.start >= UNIT) (units.push(cur), (cur = null))
  }
  if (cur) units.push(cur)
  if (units.length < 6) return []

  // 2) IDF (birim düzeyinde) ve tf-idf
  const df = new Map<string, number>()
  for (const u of units) for (const k of u.tf.keys()) df.set(k, (df.get(k) ?? 0) + 1)
  const idf = (k: string) => Math.log(1 + units.length / (df.get(k) ?? 1))
  const weigh = (tf: Vec): Vec => new Map([...tf].map(([k, v]) => [k, (1 + Math.log(v)) * idf(k)]))
  const wu = units.map((u) => weigh(u.tf))

  // 3) ardışık pencereler arası benzerlik: sınır = benzerliğin düşük olduğu yer
  const K = 5
  const sim: number[] = []
  for (let i = 0; i < units.length - 1; i++) {
    const l: Vec = new Map()
    const r: Vec = new Map()
    for (let j = Math.max(0, i - K + 1); j <= i; j++) add(l, wu[j])
    for (let j = i + 1; j <= Math.min(units.length - 1, i + K); j++) add(r, wu[j])
    sim.push(cosine(l, r))
  }
  const mean = sim.reduce((n, x) => n + x, 0) / sim.length
  const sd = Math.sqrt(sim.reduce((n, x) => n + (x - mean) ** 2, 0) / sim.length)
  const unitSec = total / units.length
  const minUnits = Math.max(2, Math.round(o.minSec / unitSec))
  const depth = sim.map((s, i) => {
    const lo = Math.max(...sim.slice(Math.max(0, i - 4), i + 1))
    const hi = Math.max(...sim.slice(i, Math.min(sim.length, i + 5)))
    return lo + hi - 2 * s
  })
  const order = sim.map((_, i) => i).sort((x, y) => depth[y] - depth[x])
  const cuts: number[] = [] // sınır: units[i] ile units[i+1] arası
  for (const i of order) {
    if (sim[i] > mean - 0.3 * sd) continue
    if (cuts.every((c) => Math.abs(c - i) >= minUnits)) cuts.push(i)
  }
  cuts.sort((x, y) => x - y)
  let bounds = [-1, ...cuts, units.length - 1] // birim indisleri (bitiş dahil)
  // çok kısa baştaki/sondaki parçaları komşuya kat
  const secOf = (a: number, b: number) => units[b].end - units[a].start
  for (let pass = 0; pass < 10; pass++) {
    const segUnits = bounds.slice(1).map((e, k) => [bounds[k] + 1, e] as [number, number])
    const shortIdx = segUnits.findIndex(([a, b]) => secOf(a, b) < o.minSec)
    if (shortIdx < 0 || segUnits.length === 1) break
    // kısa parçayı, birleştiği taraftaki sınırı kaldırarak komşuyla birleştir (daha az belirgin sınırı sil)
    const left = shortIdx > 0 ? depth[bounds[shortIdx]] : -Infinity
    const right = shortIdx < segUnits.length - 1 ? depth[bounds[shortIdx + 1]] : -Infinity
    bounds.splice(left <= right ? shortIdx : shortIdx + 1, 1)
  }
  // çok uzun parçaları en belirgin iç sınırdan böl
  const splitLong = (a: number, b: number): [number, number][] => {
    if (secOf(a, b) <= o.maxSec || b - a < minUnits * 2) return [[a, b]]
    let best = -1
    let bd = -Infinity
    for (let i = a + minUnits - 1; i <= b - minUnits; i++) if (depth[i] > bd) (bd = depth[i], (best = i))
    return best < 0 ? [[a, b]] : [...splitLong(a, best), ...splitLong(best + 1, b)]
  }
  const finalSegs = bounds.slice(1).flatMap((e, k) => splitLong(bounds[k] + 1, e))

  // 4) bölüm özellikleri
  const globalVec: Vec = new Map()
  for (const w of wu) add(globalVec, w)

  const ideas = finalSegs.map(([ua, ub], idx) => {
    const sa = units[ua].a
    const sb = units[ub].b
    const first = segs[sa].firstWord
    const last = segs[sb].lastWord
    const start = segs[sa].start
    const end = segs[sb].end
    const dur = end - start
    const centroid: Vec = new Map()
    for (let j = ua; j <= ub; j++) add(centroid, wu[j])
    const coh = wu.slice(ua, ub + 1).reduce((n, v) => n + cosine(v, centroid), 0) / (ub - ua + 1)
    const distinct = 1 - cosine(centroid, globalVec)
    const durFit = dur >= 360 && dur <= 1500 ? 1 : dur < 360 ? Math.max(0, dur / 360) : Math.max(0.3, 1 - (dur - 1500) / 1500)
    // anahtar kelimeler: bölüm tf × genel idf
    const tf: Vec = new Map()
    const surf = new Map<string, Map<string, number>>()
    for (let j = sa; j <= sb; j++) {
      for (const t of tokens(segs[j].text)) {
        tf.set(t.stem, (tf.get(t.stem) ?? 0) + 1)
        const m = surf.get(t.stem) ?? new Map<string, number>()
        m.set(t.surface, (m.get(t.surface) ?? 0) + 1)
        surf.set(t.stem, m)
      }
    }
    const ranked = [...tf].filter(([, c]) => c >= 3).map(([k, c]) => [k, c * idf(k) * (1 + Math.log(1 + c))] as const).sort((x, y) => y[1] - x[1])
    const top = ranked.slice(0, 6).map(([k]) => k)
    const form = (k: string) => [...(surf.get(k) ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0] ?? k
    // iki kök ardışık geçiyorsa ("yapay zeka") birleştir
    const bigram = new Map<string, number>()
    for (let j = sa; j <= sb; j++) {
      const ts = tokens(segs[j].text)
      for (let q = 0; q + 1 < ts.length; q++) if (top.includes(ts[q].stem) && top.includes(ts[q + 1].stem) && ts[q].stem !== ts[q + 1].stem) bigram.set(`${ts[q].stem}|${ts[q + 1].stem}`, (bigram.get(`${ts[q].stem}|${ts[q + 1].stem}`) ?? 0) + 1)
    }
    const keywords: string[] = []
    const used = new Set<string>()
    for (const [pair, c] of [...bigram].sort((x, y) => y[1] - x[1])) {
      const [x, y] = pair.split('|')
      if (c >= 3 && !used.has(x) && !used.has(y)) (keywords.push(`${form(x)} ${form(y)}`), used.add(x), used.add(y))
    }
    for (const k of top) if (!used.has(k) && keywords.length < 5) (keywords.push(form(k)), used.add(k))
    const focus = ranked.length ? Math.min(1, ranked[0][1] / (ranked.reduce((n, r) => n + r[1], 0) / 3)) : 0
    // temsilci cümleler: en çok anahtar kelime yoğunluğu
    const keyStems = new Set(top)
    const scored = segs.slice(sa, sb + 1).map((s, q) => {
      const ts = tokens(s.text)
      const hit = ts.filter((t) => keyStems.has(t.stem)).length
      return { q: sa + q, v: hit / Math.sqrt(Math.max(4, ts.length + 4)), len: s.text.length }
    }).filter((x) => x.len > 25 && x.len < 220)
    const pick = scored.sort((x, y) => y.v - x.v).slice(0, 3).map((x) => x.q).sort((x, y) => x - y)
    const summary = clip(pick.map((q) => segs[q].text).join(' '), 420)
    const score = Math.round((0.35 * coh + 0.3 * distinct + 0.25 * durFit + 0.1 * focus) * 0.85 * 1000) / 1000
    const label = keywords.slice(0, 2).map((k) => k).join(' ve ')
    return { id: '', label: cap(label), headline: `${cap(label)} hakkında konuşmuşsun`, kind: 'topic' as const, start, end, durationSec: dur, keywords, summary, score, firstWord: first, lastWord: last, titles: draftTitles(keywords, dur), titleSource: 'draft' as const, _idx: idx }
  })
  return ideas
    .filter((i) => i.keywords.length > 0 && i.durationSec >= Math.min(o.minSec, 90))
    .map(({ _idx, ...i }) => (void _idx, i))
}

export const NOT_ENTITY = new Set(['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar', 'evet', 'hayir', 'tamam', 'peki', 'allah'])

/**
 * Özel isim yoğunluğu: büyük harfle yazılmış (cümle başı olmayan) bir ad bir bölümde tekrar tekrar anılıyorsa
 * ("Batrakov" 6 dakikada 11 kez) o bölüm "X hakkında konuşmuşsun" önerisidir.
 */
function entityIdeas(words: TranscriptWord[], segs: Segment[], o: IdeaOptions): VideoIdea[] {
  if (segs.length < 5) return []
  const segOf = new Array<number>(words.length).fill(0)
  segs.forEach((g, i) => {
    for (let w = g.firstWord; w <= g.lastWord; w++) segOf[w] = i
  })
  const isUpper = (s: string) => s.charAt(0) !== s.charAt(0).toLocaleLowerCase('tr-TR') && s.charAt(0) === s.charAt(0).toLocaleUpperCase('tr-TR')
  const clean = (t: string) => t.replace(/[^\p{L}\p{N}'’]/gu, '').split(/['’]/)[0]
  interface Mention { t: number; seg: number; wi: number }
  interface Ent { surfaces: Map<string, number>; at: Mention[] }
  const ents = new Map<string, Ent>()
  const cand = new Array<string | null>(words.length).fill(null)
  for (const [wi, w] of words.entries()) {
    const raw = w.text.trim()
    const surface = clean(raw)
    if (surface.length < 3 || !isUpper(surface) || /^\d/.test(surface)) continue
    if (wi === segs[segOf[wi]].firstWord) continue // cümle başı büyük harf bilgi vermez
    const k = key(surface).replace(/ /g, '')
    if (k.length < 3 || NOT_ENTITY.has(k) || STOP_KEYS.has(k)) continue
    const stemKey = k.slice(0, 6)
    cand[wi] = stemKey
    const e: Ent = ents.get(stemKey) ?? { surfaces: new Map<string, number>(), at: [] }
    e.surfaces.set(surface, (e.surfaces.get(surface) ?? 0) + 1)
    e.at.push({ t: w.start, seg: segOf[wi], wi })
    ents.set(stemKey, e)
  }
  const GAP = 150
  const MIN_MENTIONS = 4
  const out: VideoIdea[] = []
  for (const e of ents.values()) {
    if (e.at.length < MIN_MENTIONS) continue
    // ardışık geçişleri ≤150 sn aralıkla kümele
    const clusters: Mention[][] = []
    for (const m of e.at) {
      const last = clusters[clusters.length - 1]
      if (last && m.t - last[last.length - 1].t <= GAP) last.push(m)
      else clusters.push([m])
    }
    const bySurface = [...e.surfaces].sort((x, y) => y[1] - x[1])[0][0]
    // "Victor Osimhen": komşu büyük harfli ad hep yanındaysa birlikte yaz
    let label = bySurface
    const prevCount = new Map<string, number>()
    const nextCount = new Map<string, number>()
    for (const m of e.at) {
      const p = m.wi > 0 ? cand[m.wi - 1] : null
      const nx = m.wi + 1 < words.length ? cand[m.wi + 1] : null
      if (p) prevCount.set(clean(words[m.wi - 1].text.trim()), (prevCount.get(clean(words[m.wi - 1].text.trim())) ?? 0) + 1)
      if (nx) nextCount.set(clean(words[m.wi + 1].text.trim()), (nextCount.get(clean(words[m.wi + 1].text.trim())) ?? 0) + 1)
    }
    const bestPrev = [...prevCount].sort((x, y) => y[1] - x[1])[0]
    const bestNext = [...nextCount].sort((x, y) => y[1] - x[1])[0]
    if (bestPrev && bestPrev[1] >= 0.6 * e.at.length) label = `${bestPrev[0]} ${bySurface}`
    else if (bestNext && bestNext[1] >= 0.6 * e.at.length) label = `${bySurface} ${bestNext[0]}`

    for (const cl of clusters) {
      if (cl.length < MIN_MENTIONS) continue
      const near = (i: number, j: number) => segs[Math.max(i, j)].start - segs[Math.min(i, j)].end <= 8
      let a = cl[0].seg
      let b = cl[cl.length - 1].seg
      const dur = (x: number, y: number) => segs[y].end - segs[x].start
      if (a > 0 && near(a - 1, a)) a--
      if (b < segs.length - 1 && near(b, b + 1)) b++
      // en uzun sınırı aş: en çok geçişi içeren pencere
      const mentionsIn = (x: number, y: number) => cl.filter((m) => m.seg >= x && m.seg <= y).length
      if (dur(a, b) > o.maxSec) {
        let best: [number, number] | null = null
        let bm = -1
        for (let x = a; x <= b; x++) {
          let y = x
          while (y + 1 <= b && dur(x, y + 1) <= o.maxSec) y++
          const c = mentionsIn(x, y)
          if (c > bm) (bm = c, (best = [x, y]))
        }
        if (best) [a, b] = best
      }
      // çok kısaysa komşu cümlelerle (yakınsa) uzat
      while (dur(a, b) < o.minSec && (a > 0 || b < segs.length - 1)) {
        if (a > 0 && near(a - 1, a) && dur(a - 1, b) <= o.maxSec) a--
        else if (b < segs.length - 1 && near(b, b + 1) && dur(a, b + 1) <= o.maxSec) b++
        else break
      }
      const d = dur(a, b)
      const mentions = mentionsIn(a, b)
      if (d < o.minSec * 0.6 || mentions < MIN_MENTIONS) continue
      const density = mentions / (d / 60)
      const durFit = d >= 180 && d <= 1500 ? 1 : d < 180 ? d / 180 : Math.max(0.3, 1 - (d - 1500) / 1500)
      const share = mentions / e.at.length
      const score = Math.round((0.4 * Math.min(1, mentions / 10) + 0.25 * Math.min(1, density / 2) + 0.25 * durFit + 0.1 * share) * 1000) / 1000
      const sa = segs[a]
      const sb = segs[b]
      out.push({
        id: '',
        label,
        headline: `${label} hakkında konuşmuşsun`,
        kind: 'entity',
        mentions,
        start: Math.max(0, sa.start - o.padSec),
        end: sb.end + o.padSec,
        durationSec: d,
        keywords: [label],
        summary: clip(segs.slice(a, b + 1).filter((g) => g.text.includes(bySurface)).slice(0, 3).map((g) => g.text).join(' '), 420),
        score,
        firstWord: sa.firstWord,
        lastWord: sb.lastWord,
        titles: [`${label} hakkında konuştuklarım`],
        titleSource: 'draft'
      })
    }
  }
  return out
}

export function findVideoIdeas(words: TranscriptWord[], options: Partial<IdeaOptions> = {}): VideoIdea[] {
  const total = words.length ? words[words.length - 1].end : 0
  const o: IdeaOptions = { ...DEFAULT_IDEA_OPTIONS, ...options, padSec: 0.25 }
  o.minSec = Math.min(o.minSec, Math.max(60, total / 4)) // kısa kayıtta alt sınır küçülür
  const segs: Segment[] = buildSegments(words)
  if (segs.length < 5 || total < 120) return []
  const all = [...entityIdeas(words, segs, o), ...topicIdeas(words, segs, o)].sort((x, y) => y.score - x.score)
  // örtüşenleri ele: daha yüksek skorlu kalır (kısa olanın %50'sinden fazlası örtüşüyorsa)
  const kept: VideoIdea[] = []
  for (const c of all) {
    const dup = kept.some((k) => {
      const ov = Math.min(k.end, c.end) - Math.max(k.start, c.start)
      return ov > 0.5 * Math.min(k.durationSec, c.durationSec)
    })
    if (!dup) kept.push(c)
    if (kept.length >= o.max) break
  }
  return kept.map((c, n) => ({ ...c, id: `idea${n + 1}` }))
}
