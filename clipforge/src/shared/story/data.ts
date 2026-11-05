import { key } from '../graphics/geo'
import type { LbRow, StoryContent } from './types'

/**
 * Bilgi paketi: sahnelerde kullanılacak doğrulanmış veri (gol krallığı, puan durumu…). Her veri kümesi KAYNAK, tarih (asOf) ve
 * doğruluk durumuyla gelir; eksik sıralar UYDURULMAZ (`complete:false`, değeri bilinmeyen satır `value:null`).
 * Veri bayatlar: sezonu süren veride `asOf` 1 günden eskiyse `datasetWarnings` uyarır ve `staleDatasets` kapısı videoyu çizdirmez (rakamlar her zaman güncel olmalı).
 */
export type DataStatus = 'official' | 'press' | 'snapshot' | 'unverified'
export interface DataRow {
  rank?: number
  name: string
  team?: string
  value?: number | null
  /** final: sezon sonu kesin değer; snapshot: o tarihteki ara değer */
  status?: 'final' | 'snapshot'
  note?: string
}
export interface Dataset {
  id: string
  title: string
  kind: 'leaderboard' | 'standings'
  /** rekabet kimliği (COMPETITIONS) */
  competition: string
  /** '2025/26' */
  season: string
  /** 'gol' | 'asist' | 'puan' */
  metric: string
  /** verinin geçerli olduğu tarih (YYYY-MM-DD) */
  asOf: string
  /** sezon bitti mi (bitmişse bayatlamaz) */
  final: boolean
  /** true: sıralamanın tamamı var; false: yalnızca bilinen üst sıralar (kalanı doğrulanmadı) */
  complete: boolean
  rows: DataRow[]
  sources: string[]
  verified: DataStatus
  note?: string
}

export const COMPETITIONS: Record<string, { name: string; aliases: string[] }> = {
  superlig: { name: 'Süper Lig', aliases: ['super lig', 'trendyol super lig', 'tff super lig', 'turkiye super ligi'] },
  bundesliga: { name: 'Bundesliga', aliases: ['bundesliga', 'almanya ligi', 'alman ligi'] },
  premierlig: { name: 'Premier Lig', aliases: ['premier lig', 'premier league', 'ingiltere premier ligi', 'ingiltere ligi'] },
  laliga: { name: 'La Liga', aliases: ['la liga', 'laliga', 'ispanya ligi'] },
  seriea: { name: 'Serie A', aliases: ['serie a', 'seri a', 'italya ligi'] },
  ligue1: { name: 'Ligue 1', aliases: ['ligue 1', 'fransa ligi'] },
  ucl: { name: 'Şampiyonlar Ligi', aliases: ['sampiyonlar ligi', 'champions league', 'uefa sampiyonlar ligi', 'avrupa sampiyonlar ligi'] }
}

export const METRICS: Record<string, { label: string; aliases: string[] }> = {
  gol: { label: 'GOL', aliases: ['gol kralligi', 'gol kralı', 'gol krali', 'en cok gol', 'golcu', 'skorer', 'gol sayisi', 'top scorer', 'golden boot', 'pichichi'] },
  asist: { label: 'ASİST', aliases: ['asist kralligi', 'asist krali', 'asist', 'en cok asist'] },
  puan: { label: 'PUAN', aliases: ['puan durumu', 'puan tablosu', 'siralama', 'lider', 'sampiyon', 'zirve', 'tablo'] }
}

const norm = (s: string) => key(s)
const lastName = (s: string) => norm(s).split(' ').filter(Boolean).pop() ?? ''

/** Bir metinde geçen rekabet kimliği (ör. "Süper Lig'de" → superlig) */
export function detectCompetition(text: string): string | null {
  const t = ` ${norm(text)} `
  let best: string | null = null
  let len = 0
  for (const [id, c] of Object.entries(COMPETITIONS)) for (const a of [norm(c.name), ...c.aliases.map(norm)]) if (a.length > len && t.includes(` ${a}`)) (best = id, (len = a.length))
  return best
}
/** Metindeki istatistik türü (gol krallığı → gol, puan durumu → puan…) */
export function detectMetric(text: string): string | null {
  const t = norm(text)
  let best: string | null = null
  let len = 0
  for (const [id, m] of Object.entries(METRICS)) for (const a of m.aliases.map(norm)) if (a.length > len && t.includes(a)) (best = id, (len = a.length))
  return best
}

const seasonStart = (s: string) => Number(s.slice(0, 4)) || 0

/** Uygun veri kümesi: önce rekabet+metrik, sonra en yeni sezon (aynı sezonda en yeni asOf, tam olan) */
export function findDataset(all: Dataset[], q: { competition?: string | null; metric?: string | null; season?: string }): Dataset | null {
  const c = all.filter((d) => (!q.competition || d.competition === q.competition) && (!q.metric || d.metric === q.metric) && (!q.season || d.season === q.season))
  c.sort((a, b) => seasonStart(b.season) - seasonStart(a.season) || b.asOf.localeCompare(a.asOf) || Number(b.complete) - Number(a.complete))
  return c[0] ?? null
}

/** Veri kümelerinde adı (soyadıyla) geçen satırlar */
export function findPlayerRows(all: Dataset[], name: string): { dataset: Dataset; row: DataRow }[] {
  const ln = lastName(name)
  if (ln.length < 3) return []
  return all.flatMap((dataset) => dataset.rows.filter((row) => lastName(row.name) === ln).map((row) => ({ dataset, row })))
}

const MONTHS_TR = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN', 'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK']
/** 2026-11-05 → "5 KASIM 2026" (ekrandaki kaynak satırında verinin tarihi görünsün) */
export function trDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS_TR[(m ?? 1) - 1] ?? ''} ${y}`
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/** Bayat ya da eksik veriyi söyler (kullanıcıya/Claude Code'a "yeniden araştır" uyarısı) */
export function datasetWarnings(d: Dataset, today: string): string[] {
  const w: string[] = []
  if (!d.final) {
    const age = daysBetween(d.asOf, today)
    if (age > 1) w.push(`"${d.title}" ${d.asOf} tarihli (${age} gün önce): sezon sürüyor, veri GÜNCEL DEĞİL (bayat) — web'den güncel değeri alıp yenileyin; bayat veriyle video çizilmez.`)
  }
  if (!d.complete) w.push(`"${d.title}": yalnızca bilinen üst ${d.rows.length} sıra var; diğer sıralar doğrulanmadı (uydurulmaz).`)
  if (d.rows.some((r) => r.status === 'snapshot')) w.push(`"${d.title}": bazı satırlar ara değer (snapshot), sezon sonu kesin değil.`)
  if (d.rows.some((r) => r.value === null || r.value === undefined)) w.push(`"${d.title}": bazı satırların değeri bilinmiyor (yalnızca sıra gösterilir).`)
  return w
}

export class DataError extends Error {}

/** Doğrulama: kullanıcı/Claude Code'un eklediği veri kümesi geçerli mi */
export function validateDataset(d: unknown): Dataset {
  const o = (d ?? {}) as Partial<Dataset>
  const bad = (m: string): never => {
    throw new DataError(`Veri kümesi geçersiz: ${m}`)
  }
  if (!o.id || !/^[a-z0-9-]{3,60}$/.test(o.id)) bad('id (küçük harf/rakam/tire, 3-60 karakter) gerekli')
  if (!o.title) bad('title gerekli')
  if (!o.competition || !(o.competition in COMPETITIONS)) bad(`competition şunlardan biri olmalı: ${Object.keys(COMPETITIONS).join(', ')}`)
  if (!o.season || !/^\d{4}\/\d{2}$/.test(o.season)) bad('season "2025/26" biçiminde olmalı')
  if (!o.metric || !(o.metric in METRICS)) bad(`metric şunlardan biri olmalı: ${Object.keys(METRICS).join(', ')}`)
  if (!o.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(o.asOf)) bad('asOf "YYYY-MM-DD" olmalı')
  if (!Array.isArray(o.rows) || o.rows.length === 0) bad('rows boş olamaz')
  if (!Array.isArray(o.sources) || o.sources.length === 0) bad('sources (en az bir kaynak adı/adresi) zorunlu: kaynaksız veri kabul edilmez')
  for (const [i, r] of (o.rows ?? []).entries()) {
    if (!r || typeof r.name !== 'string' || !r.name.trim()) bad(`rows[${i}].name gerekli`)
    if (r.value !== undefined && r.value !== null && !Number.isFinite(r.value)) bad(`rows[${i}].value sayı olmalı (bilinmiyorsa null)`)
  }
  return {
    id: o.id!,
    title: o.title!,
    kind: o.kind === 'standings' ? 'standings' : 'leaderboard',
    competition: o.competition!,
    season: o.season!,
    metric: o.metric!,
    asOf: o.asOf!,
    final: !!o.final,
    complete: !!o.complete,
    rows: o.rows!.map((r) => ({ rank: r.rank, name: r.name.trim(), team: r.team, value: r.value ?? null, status: r.status, note: r.note })),
    sources: o.sources!.map(String),
    verified: (['official', 'press', 'snapshot', 'unverified'] as const).includes(o.verified as DataStatus) ? (o.verified as DataStatus) : 'unverified',
    note: o.note
  }
}

/** `dataset` başvurusu olan sıralama sahnesini bilgi paketinden doldurur; vurgular adlarla eşleşir. Hata: veri kümesi yok. */
export function resolveLeaderboard(c: Extract<StoryContent, { type: 'leaderboard' }>, all: Dataset[]): Extract<StoryContent, { type: 'leaderboard' }> {
  if (!c.dataset) return c
  const d = all.find((x) => x.id === c.dataset)
  if (!d) throw new DataError(`Veri kümesi bulunamadı: "${c.dataset}". Var olanlar: ${all.map((x) => x.id).join(', ') || '(yok)'} — \`story data\` ile bakın ya da ekleyin.`)
  const top = Math.max(1, Math.min(10, c.top ?? 5))
  const hi = (c.highlight ?? []).map(lastName)
  let rows: LbRow[] = d.rows.slice(0, top).map((r, i) => ({ name: r.name, team: r.team, value: r.value ?? null, rank: r.rank ?? i + 1, note: r.note, highlight: hi.includes(lastName(r.name)) || undefined }))
  // vurgulanan oyuncu ilk N dışında ama listede varsa sona eklenir (sırasıyla)
  for (const h of hi) {
    if (rows.some((r) => lastName(r.name) === h)) continue
    const i = d.rows.findIndex((r) => lastName(r.name) === h)
    if (i >= 0) rows = [...rows, { name: d.rows[i].name, team: d.rows[i].team, value: d.rows[i].value ?? null, rank: d.rows[i].rank ?? i + 1, highlight: true }]
  }
  const incomplete = !d.complete && rows.length >= d.rows.length ? `ilk ${d.rows.length} sıra doğrulandı` : undefined
  return { ...c, rows, metric: c.metric ?? METRICS[d.metric]?.label, title: c.title ?? d.title, source: c.source ?? `${d.sources[0]} · ${trDate(d.asOf)}`, note: c.note ?? incomplete }
}

/** Takım için bilgi paketinden künyeler: lig sırası/puanı, gol kralı mı… (yalnızca kesin bilinenler) */
export function teamFacts(all: Dataset[], teamName: string): { label: string; value: string; source: string; dataset: string; asOf: string }[] {
  const t = norm(teamName)
  const out: { label: string; value: string; source: string; dataset: string; asOf: string }[] = []
  const sorted = [...all].sort((a, b) => seasonStart(b.season) - seasonStart(a.season) || (a.metric === 'puan' ? -1 : 1) - (b.metric === 'puan' ? -1 : 1))
  for (const d of sorted) {
    const idx = d.rows.findIndex((r) => r.team && (norm(r.team) === t || norm(r.team).includes(t) || t.includes(norm(r.team))))
    if (idx < 0) continue
    const r = d.rows[idx]
    const rank = r.rank ?? idx + 1
    const comp = COMPETITIONS[d.competition]?.name ?? d.competition
    if (d.metric === 'puan' && r.value != null) out.push({ label: `${comp} ${d.season}`, value: `${rank}. sıra · ${r.value} puan`, source: d.sources[0], dataset: d.id, asOf: d.asOf })
    else if (d.metric === 'gol' && r.value != null) out.push({ label: `${comp} gol krallığı ${d.season}`, value: `${r.name} · ${r.value} gol (${rank}.)`, source: d.sources[0], dataset: d.id, asOf: d.asOf })
  }
  return out
}

/** Sahnedeki veri başvurularını bilgi paketinden çözer (leaderboard.dataset, teamcard.facts boşsa künyeler). Diğer sahneler aynen döner. */
export function resolveSceneData(c: StoryContent, all: Dataset[]): StoryContent {
  if (c.type === 'leaderboard') return resolveLeaderboard(c, all)
  if (c.type === 'teamcard' && (!c.facts || c.facts.length === 0)) {
    const f = teamFacts(all, c.team).slice(0, 4)
    return { ...c, facts: f.map(({ label, value }) => ({ label, value })), source: c.source ?? (f[0] ? `${f[0].source} · ${trDate(f[0].asOf)}` : undefined) }
  }
  return c
}

export interface StaleInfo {
  id: string
  title: string
  asOf: string
  ageDays: number
}

/** Sahnelerin kullandığı veri kümeleri (id) — `dataset` başvurusu ve takım kartı künyeleri dahil */
export function usedDatasets(contents: StoryContent[], all: Dataset[]): Dataset[] {
  const ids = new Set<string>()
  for (const c of contents) {
    if (c.type === 'leaderboard' && c.dataset) ids.add(c.dataset)
    if (c.type === 'teamcard' && (!c.facts || c.facts.length === 0)) for (const f of teamFacts(all, c.team)) ids.add(f.dataset)
  }
  return all.filter((d) => ids.has(d.id))
}

/**
 * GÜNCELLİK KAPISI: sezonu süren (final:false) bir veri kümesi `maxAgeDays` günden eskiyse video çizilmez — rakamlar her zaman
 * güncel olmalı (örn. gol kralı sayısı o gün değişmiş olabilir). Sezonu bitmiş (final) veri kapıya takılmaz.
 */
export function staleDatasets(used: Dataset[], today: string, maxAgeDays = 1): StaleInfo[] {
  return used.filter((d) => !d.final && daysBetween(d.asOf, today) > maxAgeDays).map((d) => ({ id: d.id, title: d.title, asOf: d.asOf, ageDays: daysBetween(d.asOf, today) }))
}
