import { buildSegments } from '../transcript/sentences'
import type { Segment, TranscriptWord } from '../types'
import { findChapters, DENSITY } from '../chapters'
import { key } from '../graphics/geo'
import { simulateFootball } from './football'
import { resolveKits, findTeam } from './teams'
import { COMPETITIONS, METRICS, datasetWarnings, daysBetween, detectCompetition, detectMetric, findDataset, findPlayerRows, type Dataset } from './data'
import { CTA_RE, DEFAULT_STORY_THEME, type StatCard, type StoryContent, type StoryItem, type StoryPlan, type StoryScene, type StoryTheme, type StoryTone, type TimelinePeriod } from './types'

const NUM_WORDS: Record<string, number> = { bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yirmi: 20, otuz: 30, kırk: 40, elli: 50, altmış: 60, yetmiş: 70, seksen: 80, doksan: 90, yüz: 100 }
const UNITS: [RegExp, string][] = [
  [/^puan/, 'PUAN'], [/^maç/, 'MAÇ'], [/^gol/, 'GOL'], [/^sıra/, 'SIRA'], [/^galibiyet/, 'GALİBİYET'], [/^mağlubiyet/, 'MAĞLUBİYET'], [/^beraberlik/, 'BERABERLİK'],
  [/^milyon/, 'MİLYON'], [/^milyar/, 'MİLYAR'], [/^bin$/, 'BİN'], [/^yıl/, 'YIL'], [/^sezon/, 'SEZON'], [/^euro|^avro/, 'AVRO'], [/^dolar/, 'DOLAR'], [/^yüzde|^%/, '%'],
  [/^kez|^defa/, 'KEZ'], [/^kişi/, 'KİŞİ'], [/^taraftar/, 'TARAFTAR'], [/^şampiyonluk/, 'ŞAMPİYONLUK'], [/^kupa/, 'KUPA']
]
const ROLES = /^(teknik|başkan|antrenör|kaptan|futbolcu|oyuncu|kaleci|golcü|hoca|menajer|yönetmen|yazar|sporting|direktör|yardımcı|CEO)/i
const GOOD = /(şampiyon|kazan|yüksel|bilet|final|zafer|başarı|galibiyet|yenilgisiz|turla|çıktı|tamamla)/i
const BAD = /(küme düş|düştü|kaybet|yenil|elen|ayrıl|kovul|mağlup|çöktü|dışında|kriz|sakat)/i
const WARN = /(hat(t)?ı|tehlike|risk|zor|baskı|şüphe|belirsiz|kalıtı|kıl payı|ucu ucuna)/i
const SEASON_RE = /\b(\d{2})\s*[/\-–]\s*(\d{2})\b|\b(20\d{2})\s*[/\-–]\s*(\d{2,4})\b/

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '')
const upperTr = (s: string) => s.toLocaleUpperCase('tr-TR')
export const toneOf = (text: string): StoryTone => (BAD.test(text) ? 'bad' : WARN.test(text) ? 'warn' : GOOD.test(text) ? 'good' : 'neutral')
const short = (s: string, n: number) => {
  const t = clean(s)
  if (t.length <= n) return t
  const cut = t.slice(0, n).replace(/\s+\S*$/, '')
  return cut || t.slice(0, n)
}

export interface PlanOptions {
  /** Kelimeden yer bulucu (harita sahnesi için): büyük harfli kelime bilinen bir yerse adını döndürür */
  isPlace?: (word: string) => string | undefined
  /** Bilgi paketi: sıralama/takım kartı önerileri buradan yapılır */
  datasets?: Dataset[]
  /** Bugün (YYYY-MM-DD): veri bayatlığı uyarısı için */
  today?: string
  theme?: Partial<StoryTheme>
  maxSceneSec?: number
}

interface Cand {
  start: number
  end: number
  prio: number
  content: StoryContent
  reason: string
}

const wordsIn = (words: TranscriptWord[], a: number, b: number) => words.filter((w) => w.start >= a - 0.01 && w.start < b)

/** Sayı + birim eşleşmeleri: [{ value, unit, at, text }] */
function statsIn(words: TranscriptWord[]): { value: string; unit: string; at: number }[] {
  const out: { value: string; unit: string; at: number }[] = []
  for (let i = 0; i + 1 < words.length; i++) {
    const w = words[i].text.replace(/[.,;:!?]+$/, '')
    let val: string | undefined
    const m = /^(\d+(?:[.,]\d+)?)(?:\.|'?[a-zçğıöşü]*)?$/i.exec(w)
    if (m) val = m[1].replace(',', '.')
    else if (NUM_WORDS[key(w)] !== undefined && key(w) !== 'bir') val = String(NUM_WORDS[key(w)])
    if (!val) continue
    const next = key(words[i + 1].text)
    const unit = UNITS.find(([re]) => re.test(next))?.[1]
    if (unit) out.push({ value: val, unit, at: words[i].start })
  }
  return out
}

function periodsFrom(words: TranscriptWord[], sentences: Segment[]): TimelinePeriod[] {
  const periods: TimelinePeriod[] = []
  let cur: TimelinePeriod | undefined
  const base = sentences[0].start
  for (const s of sentences) {
    const ws = words.slice(s.firstWord, s.lastWord + 1)
    const m = SEASON_RE.exec(s.text)
    if (m) {
      const label = m[1] ? `${m[1]}/${m[2]}` : `${m[3].slice(2)}/${m[4].slice(-2)}`
      if (!cur || cur.label !== label) {
        cur = { label, items: [], at: Math.max(0, ws[0].start - base) }
        periods.push(cur)
      }
    }
    if (!cur) continue
    // cümleyi yan cümlelere böl; her biri kısa bir madde olsun
    const clauses = s.text.split(/,|;| ama | fakat | ve | çünkü | ardından | sonra /).map(clean).filter((c) => c.split(' ').length >= 2 && !SEASON_RE.test(c))
    for (const c of clauses.slice(0, 2)) {
      if (CTA_RE.test(c) || cur.items.length >= 3) continue
      const first = c.split(' ')[0]
      const at = ws.find((w) => key(w.text).startsWith(key(first).slice(0, 5)))?.start ?? ws[0].start
      cur.items.push({ text: upperTr(short(c, 34)), tone: toneOf(c), at: Math.max(0, at - base) })
    }
  }
  return periods.filter((p) => p.items.length > 0 || periods.length > 1)
}

/**
 * Anlatımdan (kelime zamanlı transkript) sahne planı çıkarır — kurallara dayalı TASLAK.
 * Seçilen yapay zekâ ayarlıysa `main/story/ai.ts` daha iyisini üretir; bu işlev anahtarsız da çalışır ve her zaman düzenlenebilir bir başlangıç verir.
 */
export function planStory(words: TranscriptWord[], opts: PlanOptions = {}): StoryPlan {
  const theme: StoryTheme = { ...DEFAULT_STORY_THEME, ...(opts.theme ?? {}) }
  const totalSec = words.length ? words[words.length - 1].end : 0
  const warnings: string[] = []
  if (words.length < 8) return { totalSec, theme, scenes: [], planner: 'auto', warnings: ['Anlatımda sahne çıkaracak kadar konuşma yok.'] }
  const sentences = buildSegments(words)
  const cands: Cand[] = []

  // 1) sezon/yıl çizelgesi: ardışık, sezon geçen cümleler
  let i = 0
  while (i < sentences.length) {
    if (!SEASON_RE.test(sentences[i].text)) {
      i++
      continue
    }
    let j = i
    let gap = 0
    for (let k = i + 1; k < sentences.length && gap < 2; k++) {
      if (SEASON_RE.test(sentences[k].text)) (j = k, (gap = 0))
      else gap++
    }
    // son sezonun açıklama cümlelerini de ekle (en çok 2)
    const last = Math.min(sentences.length - 1, j + 2)
    const grp = sentences.slice(i, last + 1)
    const periods = periodsFrom(words, grp)
    if (periods.length >= 2) {
      const first = grp[0]
      const end = Math.min(grp[grp.length - 1].end + 1.5, first.start + 90)
      cands.push({ start: first.start, end, prio: 5, content: { type: 'timeline', kicker: 'DÖNEMLER', title: 'ZAMAN ÇİZELGESİ', periods: periods.slice(0, 5) }, reason: short(first.text, 120) })
    }
    i = last + 1
  }

  // 2) rakam kartları: yakın cümlelerdeki sayı+birimler
  const stats = statsIn(words)
  for (let k = 0; k < stats.length; ) {
    const grp = [stats[k]]
    let m = k + 1
    while (m < stats.length && stats[m].at - grp[grp.length - 1].at <= 9 && grp.length < 3) grp.push(stats[m++])
    const start = Math.max(0, grp[0].at - 0.6)
    const sents = sentences.filter((s) => s.end > start && s.start < grp[grp.length - 1].at + 2)
    const cards: StatCard[] = grp.map((g) => {
      const s = sentences.find((x) => x.start <= g.at + 0.01 && x.end >= g.at)
      return { value: g.value, unit: g.unit, sub: s ? upperTr(short(s.text, 44)) : undefined, tone: toneOf(s?.text ?? ''), at: Math.max(0, g.at - start - 0.1) }
    })
    cands.push({ start, end: Math.max(grp[grp.length - 1].at + 3.5, start + 4), prio: 4, content: { type: 'stats', kicker: 'RAKAMLARLA', cards }, reason: short(sents.map((s) => s.text).join(' '), 140) })
    k = m
  }

  // 3) isim bandı: unvan + iki büyük harfli kelime
  const seen = new Set<string>()
  for (let w = 0; w + 2 < words.length; w++) {
    if (!ROLES.test(words[w].text)) continue
    let a = w + 1
    if (/^direktör/i.test(words[a]?.text ?? '')) a++
    const n1 = words[a]?.text.replace(/[.,;:!?'’].*$/, '') ?? ''
    const n2 = words[a + 1]?.text.replace(/[.,;:!?'’].*$/, '') ?? ''
    if (!/^[A-ZÇĞİÖŞÜ]/.test(n1) || !/^[A-ZÇĞİÖŞÜ]/.test(n2) || n1.length < 3 || n2.length < 3) continue
    const name = `${n1} ${n2}`
    if (seen.has(key(name))) continue
    seen.add(key(name))
    const role = clean(words.slice(w, a).map((x) => x.text).join(' '))
    cands.push({ start: words[w].start, end: words[w].start + 4.5, prio: 3, content: { type: 'person', role: upperTr(role), name: upperTr(name) }, reason: short(words.slice(Math.max(0, w - 2), a + 4).map((x) => x.text).join(' '), 100) })
  }

  // 4) harita: anılan yerler; "Paris'ten İstanbul'a" gibi çift varsa tek sahne (uçak rotası)
  if (opts.isPlace) {
    const hits: { w: number; name: string; from: boolean }[] = []
    for (let w = 0; w < words.length; w++) {
      const raw = words[w].text.replace(/[.,;:!?'’].*$/, '')
      if (!/^[A-ZÇĞİÖŞÜ]/.test(raw)) continue
      const name = opts.isPlace(raw)
      if (name) hits.push({ w, name, from: /['’](d[ae]n|t[ae]n)\b/i.test(words[w].text) })
    }
    const placed = new Set<string>()
    let lastAt = -99
    for (let h = 0; h < hits.length; h++) {
      const cur = hits[h]
      const next = hits[h + 1]
      const pair = next && next.w - cur.w <= 8 && key(next.name) !== key(cur.name) && (cur.from || /['’][dt]?[ae]\b/i.test(words[next.w].text)) ? next : null
      const names = pair ? [cur.name, pair.name] : [cur.name]
      if (names.every((n) => placed.has(key(n))) || words[cur.w].start - lastAt < (pair ? 6 : 25)) continue
      for (const n of names) placed.add(key(n))
      lastAt = words[cur.w].start
      const start = Math.max(0, words[cur.w].start - 0.4)
      const content: StoryContent = pair ? { type: 'place', from: cur.name, to: pair.name, label: upperTr(pair.name), sub: `${upperTr(cur.name)} → ${upperTr(pair.name)}`, vehicle: 'plane' } : { type: 'place', to: cur.name, label: upperTr(cur.name) }
      cands.push({ start, end: start + (pair ? 6 : 4), prio: pair ? 3.5 : 2, content, reason: short(words.slice(Math.max(0, cur.w - 3), (pair?.w ?? cur.w) + 4).map((x) => x.text).join(' '), 100) })
      if (pair) h++
    }
  }

  // 4b) takım kartı: anlatıda adı geçen takım (ilk geçiş; en az 25 sn arayla)
  const AMBIG = new Set(['real', 'city', 'united', 'paris', 'inter', 'spurs', 'villa', 'milan', 'ts', 'gs', 'fb', 'om'])
  const seenTeam = new Set<string>()
  let lastTeamAt = -99
  for (let w = 0; w < words.length; w++) {
    const raw1 = words[w].text.replace(/[.,;:!?'’].*$/, '')
    if (!/^[A-ZÇĞİÖŞÜ]/.test(raw1) || (/^[A-ZÇĞİÖŞÜ]{2,3}$/.test(raw1) && raw1.length < 4)) continue
    const raw2 = words[w + 1]?.text.replace(/[.,;:!?'’].*$/, '') ?? ''
    const two = /^[A-ZÇĞİÖŞÜ]/.test(raw2) ? findTeam(`${raw1} ${raw2}`) : null
    const one = AMBIG.has(key(raw1)) ? null : findTeam(raw1)
    const team = two ?? one
    if (!team || seenTeam.has(team.id) || words[w].start - lastTeamAt < 25) continue
    seenTeam.add(team.id)
    lastTeamAt = words[w].start
    cands.push({ start: Math.max(0, words[w].start - 0.4), end: words[w].start + 5, prio: 2.2, content: { type: 'teamcard', team: team.name }, reason: short(words.slice(Math.max(0, w - 3), w + 5).map((x) => x.text).join(' '), 100) })
  }

  // 4c) sıralama: "gol krallığı / puan durumu / asist" + lig ya da bilgi paketindeki oyuncu adı
  const ds = opts.datasets ?? []
  if (ds.length) {
    let lastLb = -99
    sentences.forEach((s, si) => {
      const win = `${sentences[si - 1]?.text ?? ''} ${s.text}`
      const metric = detectMetric(s.text)
      if (!metric || s.start - lastLb < 8) return
      const names = (win.match(/[A-ZÇĞİÖŞÜ][\p{L}'’-]{2,}/gu) ?? []).map((x) => x.replace(/['’].*$/, ''))
      const hit = names.flatMap((n) => findPlayerRows(ds, n)).find((m) => m.dataset.metric === metric)
      const comp = detectCompetition(win) ?? hit?.dataset.competition ?? null
      if (!comp && !hit) return
      const d = findDataset(ds, { competition: comp, metric })
      if (!d) {
        warnings.push(`"${COMPETITIONS[comp ?? '']?.name ?? 'lig'} ${METRICS[metric].label}" için bilgi paketinde veri yok (${s.start.toFixed(0)}. sn: "${short(s.text, 60)}"): web'den araştırıp \`story data add\` ile ekleyin.`)
        return
      }
      const highlight = names.filter((n) => d.rows.some((r) => key(r.name).split(' ').pop() === key(n))).slice(0, 3)
      const todayStr = opts.today ?? new Date().toISOString().slice(0, 10)
      // sezonu süren, güncel olmayan veriyle sahne ÖNERİLMEZ (güncel veri Claude Code'la internetten alınır)
      if (!d.final && daysBetween(d.asOf, todayStr) > 1) {
        const msg = 'Güncel veri gerektiren sahneler (gol krallığı, puan durumu) bu taslağa eklenmedi: rakamlar internetten güncel alınmalı. Bu videoyu Claude Code ile zenginleştirin (aşağıdaki düğme).'
        if (!warnings.includes(msg)) warnings.push(msg)
        return
      }
      lastLb = s.start
      for (const m of datasetWarnings(d, todayStr)) if (!warnings.includes(m) && !/doğrulanmadı|ara değer|bilinmiyor/.test(m)) warnings.push(m)
      cands.push({ start: Math.max(0, s.start - 0.3), end: s.start + 8, prio: 4.6, content: { type: 'leaderboard', rows: [], kicker: COMPETITIONS[d.competition]?.name?.toLocaleUpperCase('tr-TR'), dataset: d.id, top: 5, highlight: highlight.length ? highlight : undefined }, reason: short(s.text, 120) })
    })
  }

  // 5) konu başlıkları: bölüm geçişlerinde (sahne olmayan uzun aralıkları doldurur)
  for (const c of findChapters(words, DENSITY.low)) {
    if (c.title === 'Giriş' || c.title === 'Sohbet') continue
    cands.push({ start: c.start, end: c.start + 4, prio: 1, content: { type: 'title', text: upperTr(c.title), sub: undefined }, reason: `Konu: ${c.title}` })
  }

  // çakışmaları çöz: yüksek öncelik kalır; kalanlar start'a göre dizilir
  const kept: Cand[] = []
  for (const c of [...cands].sort((a, b) => b.prio - a.prio || a.start - b.start)) if (!kept.some((k) => c.start < k.end - 0.5 && k.start < c.end - 0.5)) kept.push(c)
  kept.sort((a, b) => a.start - b.start)

  const maxSec = opts.maxSceneSec ?? 40
  const scenes: StoryScene[] = kept.map((c, n) => {
    const next = kept[n + 1]?.start ?? totalSec
    const end = Math.max(c.start + 2.5, Math.min(next, c.start + maxSec, totalSec || c.end))
    return { id: `s${n + 1}`, start: Math.round(c.start * 10) / 10, end: Math.round(end * 10) / 10, enabled: true, content: c.content, reason: c.reason, source: 'auto' as const }
  })
  if (scenes.length === 0) warnings.push('Anlatımda rakam, sezon/yıl, unvanlı isim ya da yer bulunamadı: yapay zekâ ayarlayın ya da sahneleri elle ekleyin.')
  return { totalSec, theme, scenes, planner: 'auto', warnings }
}

/** Sahneleri geçerli, kesintisiz bir diziye çevirir: sırala, çakışanı kırp, her sahneyi sonrakine kadar uzat (sınırlı). */
export function normalizeScenes(scenes: StoryScene[], totalSec: number, maxSec = 40): StoryScene[] {
  const list = scenes.filter((s) => s.enabled).map((s) => ({ ...s, start: Math.max(0, s.start) })).sort((a, b) => a.start - b.start)
  return list.map((s, i) => {
    const next = list[i + 1]?.start ?? totalSec
    const end = Math.min(Math.max(s.end, s.start + 2), next > s.start ? next : s.start + 2, s.start + maxSec, totalSec > 0 ? totalSec : Infinity)
    return { ...s, end: Math.max(s.start + 1, end) }
  })
}

/** Yapay zekâdan ya da elle gelen içeriği güvenli hale getirir (uzunluk, çağrı metni, geçersiz tür) */
export function sanitizeContent(raw: unknown): StoryContent | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() && !CTA_RE.test(v) ? short(v, n) : undefined)
  const tone = (v: unknown): StoryTone | undefined => (v === 'good' || v === 'warn' || v === 'bad' || v === 'neutral' ? v : undefined)
  const at = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined)
  const items = (v: unknown, max: number): StoryItem[] => (Array.isArray(v) ? v : []).slice(0, max).flatMap((x) => {
    const o = (x && typeof x === 'object' ? x : { text: x }) as Record<string, unknown>
    const text = str(o.text, 40)
    return text ? [{ text, tone: tone(o.tone), at: at(o.at) }] : []
  })
  switch (c.type) {
    case 'stats': {
      const cards = (Array.isArray(c.cards) ? c.cards : []).slice(0, 4).flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>
        const value = typeof o.value === 'string' || typeof o.value === 'number' ? String(o.value).trim().slice(0, 10) : ''
        if (CTA_RE.test(value)) return []
        return value ? [{ label: str(o.label, 32), value, unit: str(o.unit, 14), sub: str(o.sub, 48), tone: tone(o.tone), at: at(o.at) }] : []
      })
      return cards.length ? { type: 'stats', kicker: str(c.kicker, 30), title: str(c.title, 40), cards, team: str(c.team, 40), source: str(c.source, 80) } : null
    }
    case 'timeline': {
      const periods = (Array.isArray(c.periods) ? c.periods : []).slice(0, 5).flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>
        const label = str(o.label, 12)
        return label ? [{ label, items: items(o.items, 4), at: at(o.at) }] : []
      })
      return periods.length ? { type: 'timeline', kicker: str(c.kicker, 30), title: str(c.title, 40), periods, team: str(c.team, 40), source: str(c.source, 80) } : null
    }
    case 'list': {
      const it = items(c.items, 6)
      return it.length ? { type: 'list', kicker: str(c.kicker, 30), title: str(c.title, 40), items: it, team: str(c.team, 40), source: str(c.source, 80) } : null
    }
    case 'person': {
      const name = str(c.name, 32)
      return name ? { type: 'person', role: str(c.role, 32), name, sub: str(c.sub, 40), team: str(c.team, 40) } : null
    }
    case 'quote': {
      const text = str(c.text, 160)
      return text ? { type: 'quote', text, by: str(c.by, 40), team: str(c.team, 40), source: str(c.source, 80) } : null
    }
    case 'title': {
      const text = str(c.text, 60)
      return text ? { type: 'title', text, sub: str(c.sub, 60), team: str(c.team, 40) } : null
    }
    case 'place': {
      const to = str(c.to, 40)
      return to ? { type: 'place', to, from: str(c.from, 40), label: str(c.label, 30), sub: str(c.sub, 48), vehicle: c.vehicle === 'none' ? 'none' : c.vehicle === 'plane' ? 'plane' : undefined } : null
    }
    case 'leaderboard': {
      const rows = (Array.isArray(c.rows) ? c.rows : []).slice(0, 10).flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>
        const name = str(o.name, 40)
        const v = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null
        return name ? [{ name, team: str(o.team, 40), value: v, rank: typeof o.rank === 'number' && o.rank >= 1 ? Math.round(o.rank) : undefined, highlight: o.highlight === true ? true : undefined, at: at(o.at), note: str(o.note, 40) }] : []
      })
      const dataset = typeof c.dataset === 'string' && /^[a-z0-9-]{3,60}$/.test(c.dataset) ? c.dataset : undefined
      if (rows.length === 0 && !dataset) return null
      const hi = (Array.isArray(c.highlight) ? c.highlight : []).filter((h): h is string => typeof h === 'string').slice(0, 5).map((h) => h.slice(0, 40))
      return { type: 'leaderboard', kicker: str(c.kicker, 30), title: str(c.title, 50), metric: str(c.metric, 12), rows, dataset, top: typeof c.top === 'number' ? Math.min(10, Math.max(1, Math.round(c.top))) : undefined, highlight: hi.length ? hi : undefined, reveal: c.reveal === 'down' ? 'down' : undefined, team: str(c.team, 40), source: str(c.source, 80), note: str(c.note, 70) }
    }
    case 'compare': {
      const side = (s: unknown) => {
        const o = (s ?? {}) as Record<string, unknown>
        const name = str(o.name, 30)
        return name ? { name, team: str(o.team, 40) } : null
      }
      const l = side(c.left)
      const r = side(c.right)
      const metrics = (Array.isArray(c.metrics) ? c.metrics : []).slice(0, 6).flatMap((m) => {
        const o = (m ?? {}) as Record<string, unknown>
        const label = str(o.label, 28)
        return label && typeof o.left === 'number' && typeof o.right === 'number' && Number.isFinite(o.left) && Number.isFinite(o.right) ? [{ label, left: o.left, right: o.right, lowerBetter: o.lowerBetter === true ? true : undefined, at: at(o.at) }] : []
      })
      return l && r && metrics.length ? { type: 'compare', kicker: str(c.kicker, 30), title: str(c.title, 50), left: l, right: r, metrics, source: str(c.source, 80) } : null
    }
    case 'teamcard': {
      const team = str(c.team, 40)
      if (!team) return null
      const facts = (Array.isArray(c.facts) ? c.facts : []).slice(0, 4).flatMap((f) => {
        const o = (f ?? {}) as Record<string, unknown>
        const label = str(o.label, 40)
        const value = str(o.value, 40)
        return label && value ? [{ label, value }] : []
      })
      return { type: 'teamcard', team, kicker: str(c.kicker, 30), facts: facts.length ? facts : undefined, source: str(c.source, 80) }
    }
    case 'football': {
      const ACTS = ['pass', 'shoot', 'run', 'dribble', 'label', 'zone', 'line', 'camera']
      const players = (Array.isArray(c.players) ? c.players : []).slice(0, 30).filter((x) => x && typeof (x as { id?: unknown }).id === 'string')
      const actions = (Array.isArray(c.actions) ? c.actions : []).slice(0, 80).filter((x) => x && ACTS.includes(String((x as { do?: unknown }).do)) && Number.isFinite((x as { at?: unknown }).at))
      if (players.length === 0) return null
      const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined)
      const cleanTeam = (t: unknown) => {
        if (!t || typeof t !== 'object') return undefined
        const o = t as Record<string, unknown>
        return { team: str(o.team, 40), name: str(o.name, 30), color: hex(o.color), color2: hex(o.color2), shorts: hex(o.shorts), socks: hex(o.socks), pattern: o.pattern === 'halves' || o.pattern === 'stripes' || o.pattern === 'solid' ? o.pattern : undefined, alt: o.alt === true ? true : undefined, formation: typeof o.formation === 'string' ? o.formation.slice(0, 12) : undefined }
      }
      const fb = { type: 'football', home: cleanTeam(c.home), away: cleanTeam(c.away), players, actions, ball: c.ball && typeof c.ball === 'object' ? c.ball : undefined, attack: c.attack === 'left' ? 'left' : undefined, camera: ['broadcast', 'follow', 'top', 'behind', 'goal'].includes(String(c.camera)) ? c.camera : undefined, title: str(c.title, 50) } as unknown as StoryContent
      for (const a of actions as { text?: unknown }[]) if (typeof a.text === 'string' && CTA_RE.test(a.text)) return null
      return fb
    }
    case 'media': {
      const file = typeof c.file === 'string' ? c.file.trim().slice(0, 500) : ''
      if (!file) return null
      const fit = c.fit === 'contain' ? 'contain' : c.fit === 'cover' ? 'cover' : undefined
      const align = c.align === 'left' || c.align === 'right' || c.align === 'center' ? c.align : undefined
      const zoom = c.zoom === 'in' || c.zoom === 'out' || c.zoom === 'none' ? c.zoom : undefined
      return { type: 'media', file, fit, align, zoom, title: str(c.title, 50), caption: str(c.caption, 120) }
    }
    default:
      return null
  }
}

/** Sahne içeriğinin (yazarken yakalanabilen) mantık hatası: futbol sahnesinde bilinmeyen oyuncu/nokta, üst üste binen top hareketi… */
export function contentProblem(c: StoryContent): string | null {
  if (c.type !== 'football') return null
  try {
    simulateFootball(c, 10)
    resolveKits(c.home, c.away)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
