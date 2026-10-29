import type { ChatColumnMapping, ChatMessage } from '../types'
import { foldTr } from '../text'

export const CHAT_EXPECTED_SCHEMA = [
  'Beklenen biçimler:',
  '  • CSV/TSV: başlık satırı + sütunlar  time,user,message  (ör. "00:12:31,ahmet,LUL")',
  '      zaman: saniye (753.2), SS:DD:SS(.ms), DD:SS ya da mutlak ISO-8601 / epoch zaman damgası',
  '  • JSON: [{ "time": 753.2, "user": "ahmet", "message": "LUL" }, …] veya { "messages": [ … ] }',
  '      Kick yayın sonrası dökümü ({ created_at, sender.username, content }) da tanınır.',
  '  • Düz metin: satır başına  [00:12:31] kullanıcı: mesaj',
  'Sütun adları farklıysa Ayarlar → Sohbet günlüğü sütun eşlemesinden belirtin.'
].join('\n')

export class ChatParseError extends Error {
  constructor(message: string, readonly expected: string = CHAT_EXPECTED_SCHEMA) {
    super(message)
    this.name = 'ChatParseError'
  }
  get userMessage() {
    return `${this.message}\n\n${this.expected}`
  }
}

export interface ChatParseResult {
  messages: ChatMessage[]
  format: 'csv' | 'json' | 'text'
  /** Mutlak zaman damgaları göreli saniyeye çevrildiyse kullanılan başlangıç (epoch ms) */
  baseMs?: number
  warnings: string[]
}

const TIME_KEYS = ['time', 'timestamp', 't', 'offset', 'offset_seconds', 'content_offset_seconds', 'seconds', 'sec', 'time_in_seconds', 'created_at', 'createdat', 'date', 'datetime', 'sent_at', 'zaman']
const USER_KEYS = ['user', 'username', 'user_name', 'sender', 'sender.username', 'author', 'author.name', 'commenter.display_name', 'commenter.name', 'display_name', 'name', 'nick', 'nickname', 'login', 'kullanici', 'kullanıcı', 'user.name', 'user.username']
const MSG_KEYS = ['message', 'message.body', 'text', 'content', 'body', 'msg', 'mesaj', 'chat', 'comment']

type Rec = Record<string, unknown>

function getPath(obj: Rec, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Rec)) cur = (cur as Rec)[part]
    else return undefined
  }
  return cur
}

function pickKey(keys: string[], candidates: string[]): string | undefined {
  const norm = new Map(keys.map((k) => [foldTr(k).replace(/\s+/g, '_'), k]))
  for (const c of candidates) {
    const hit = norm.get(foldTr(c))
    if (hit !== undefined) return hit
  }
  return undefined
}

type TimeValue = { kind: 'rel'; sec: number } | { kind: 'abs'; ms: number }

export function parseTimeValue(v: unknown): TimeValue | null {
  if (typeof v === 'number' && Number.isFinite(v)) return numTime(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return numTime(Number(s))
  const hms = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?$/)
  if (hms) {
    const [, h, m, sec, frac] = hms
    return { kind: 'rel', sec: Number(h ?? 0) * 3600 + Number(m) * 60 + Number(sec) + (frac ? Number('0.' + frac) : 0) }
  }
  if (/\d{4}-\d{2}-\d{2}/.test(s)) {
    const ms = Date.parse(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T'))
    if (Number.isFinite(ms)) return { kind: 'abs', ms }
  }
  return null
}

function numTime(n: number): TimeValue {
  if (n > 1e11) return { kind: 'abs', ms: n }
  if (n > 1e8) return { kind: 'abs', ms: n * 1000 }
  return { kind: 'rel', sec: n }
}

/** Alıntı-farkındalıklı CSV ayrıştırıcı. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else q = false
      } else cell += c
    } else if (c === '"') q = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

function detectDelimiter(headerLine: string): string {
  const counts = [',', ';', '\t', '|'].map((d) => [d, headerLine.split(d).length - 1] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

interface RawMsg {
  time: TimeValue
  user: string
  text: string
}

function finalize(raws: RawMsg[], format: ChatParseResult['format'], mapping: ChatColumnMapping, warnings: string[]): ChatParseResult {
  if (raws.length === 0) throw new ChatParseError('Dosyada zaman damgalı sohbet mesajı bulunamadı.')
  const hasAbs = raws.some((r) => r.time.kind === 'abs')
  let baseMs: number | undefined
  if (hasAbs) {
    const startMs = mapping.streamStart ? Date.parse(mapping.streamStart) : NaN
    if (Number.isFinite(startMs)) baseMs = startMs
    else {
      baseMs = Math.min(...raws.filter((r) => r.time.kind === 'abs').map((r) => (r.time as { ms: number }).ms))
      warnings.push('Mutlak zaman damgaları bulundu ama yayın başlangıcı verilmedi; ilk mesaj 0. saniye varsayıldı. Ayarlardan "yayın başlangıcı" girerek düzeltebilirsiniz.')
    }
  }
  const messages: ChatMessage[] = raws
    .map((r) => ({ t: r.time.kind === 'rel' ? r.time.sec : (r.time.ms - (baseMs as number)) / 1000, user: r.user, text: r.text }))
    .filter((m) => m.t >= -5)
    .map((m) => ({ ...m, t: Math.max(0, m.t) }))
    .sort((a, b) => a.t - b.t)
  return { messages, format, baseMs, warnings }
}

function parseJson(text: string, mapping: ChatColumnMapping): ChatParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ChatParseError('JSON okunamadı: dosya geçerli bir JSON değil.')
  }
  let arr: unknown = data
  if (!Array.isArray(arr) && arr && typeof arr === 'object') {
    const o = arr as Rec
    arr = o.messages ?? o.comments ?? o.chat ?? o.data ?? Object.values(o).find(Array.isArray)
  }
  if (!Array.isArray(arr)) throw new ChatParseError('JSON içinde mesaj dizisi bulunamadı.')
  const items = arr.filter((x): x is Rec => !!x && typeof x === 'object')
  if (items.length === 0) throw new ChatParseError('JSON mesaj dizisi boş.')

  const flat = flatKeys(items[0])
  const tk = mapping.time ?? pickKey(flat, TIME_KEYS)
  const uk = mapping.user ?? pickKey(flat, USER_KEYS)
  const mk = mapping.message ?? pickKey(flat, MSG_KEYS)
  if (!tk || !mk) throw new ChatParseError(`Zaman ya da mesaj alanı tanınamadı. Bulunan alanlar: ${flat.slice(0, 12).join(', ')}`)

  const raws: RawMsg[] = []
  for (const it of items) {
    const time = parseTimeValue(getPath(it, tk))
    const msg = getPath(it, mk)
    if (!time || msg == null) continue
    const u = uk ? getPath(it, uk) : ''
    raws.push({ time, user: u == null ? '' : String(u), text: String(msg) })
  }
  return finalize(raws, 'json', mapping, [])
}

function flatKeys(o: Rec, prefix = '', depth = 0): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k
    // yalnızca yaprak (ilkel değerli) yollar: "sender" nesnesi yerine "sender.username"
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (depth < 2) keys.push(...flatKeys(v as Rec, key, depth + 1))
    } else keys.push(key)
  }
  return keys
}

function parseDelimited(text: string, mapping: ChatColumnMapping): ChatParseResult {
  const firstLine = text.split(/\r?\n/, 1)[0]
  const rows = parseCsv(text, detectDelimiter(firstLine))
  if (rows.length === 0) throw new ChatParseError('Dosya boş.')
  const header = rows[0]
  const headerLooksLikeData = parseTimeValue(header[0]) !== null
  let ti: number, ui: number, mi: number
  let body: string[][]
  const idx = (name: string | undefined, fallback: string[]) => {
    if (name !== undefined && /^\d+$/.test(name)) return Number(name)
    const key = name ?? pickKey(header, fallback)
    return key ? header.indexOf(key) : -1
  }
  if (headerLooksLikeData && !mapping.time) {
    ;[ti, ui, mi] = [0, 1, 2]
    body = rows
  } else {
    ti = idx(mapping.time, TIME_KEYS)
    ui = idx(mapping.user, USER_KEYS)
    mi = idx(mapping.message, MSG_KEYS)
    body = rows.slice(1)
  }
  if (ti < 0 || mi < 0) throw new ChatParseError(`Zaman ya da mesaj sütunu tanınamadı. Başlıklar: ${header.join(' | ')}`)
  const raws: RawMsg[] = []
  for (const r of body) {
    const time = parseTimeValue(r[ti])
    if (!time) continue
    raws.push({ time, user: ui >= 0 ? (r[ui] ?? '') : '', text: r[mi] ?? '' })
  }
  return finalize(raws, 'csv', mapping, [])
}

const LINE_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?|\d{4}-\d{2}-\d{2}[T ][^\]\s]+)\]?\s+<?([^:>\s][^:>]*?)>?\s*[:>]\s*(.*)$/

function parseText(text: string, mapping: ChatColumnMapping): ChatParseResult {
  const raws: RawMsg[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line.trim())
    if (!m) continue
    const time = parseTimeValue(m[1])
    if (time) raws.push({ time, user: m[2].trim(), text: m[3] })
  }
  return finalize(raws, 'text', mapping, [])
}

/** Sohbet dökümünü (CSV/TSV/JSON/düz metin) tanıyıp mesaj listesine çevirir; tanınmazsa ChatParseError fırlatır. */
export function parseChatLog(text: string, fileName = '', mapping: ChatColumnMapping = {}): ChatParseResult {
  const clean = text.replace(/^﻿/, '').trim()
  if (!clean) throw new ChatParseError('Dosya boş.')
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'json') return parseJson(clean, mapping)
  if (clean.startsWith('{') || /^\[\s*[\[{"\d-]/.test(clean)) {
    // "[00:01:05] kullanıcı: mesaj" gibi düz metin satırları da '[' ile başlar: JSON olarak okunamazsa devam et
    try {
      JSON.parse(clean)
      return parseJson(clean, mapping)
    } catch {
      if (clean.startsWith('{')) throw new ChatParseError('JSON okunamadı: dosya geçerli bir JSON değil.')
    }
  }
  if (ext === 'csv' || ext === 'tsv' || /^[^\n]*[,;\t|][^\n]*\n/.test(clean)) {
    try {
      return parseDelimited(clean, mapping)
    } catch (e) {
      if (ext === 'csv' || ext === 'tsv') throw e
    }
  }
  try {
    return parseText(clean, mapping)
  } catch (e) {
    if (e instanceof ChatParseError) throw new ChatParseError('Dosya biçimi tanınamadı.')
    throw e
  }
}

// ───────── mesaj hızı zaman serisi ─────────

/** Mesajları `binSec` genişliğinde kutulara sayar. */
export function messageRateSeries(messages: ChatMessage[], durationSec: number, binSec = 1): number[] {
  const n = Math.max(1, Math.ceil(durationSec / binSec))
  const out = new Array<number>(n).fill(0)
  for (const m of messages) {
    const i = Math.floor(m.t / binSec)
    if (i >= 0 && i < n) out[i] += 1
  }
  return out
}

export function movingSum(series: number[], window: number): number[] {
  const out = new Array<number>(series.length).fill(0)
  let acc = 0
  for (let i = 0; i < series.length; i++) {
    acc += series[i]
    if (i >= window) acc -= series[i - window]
    out[i] = acc
  }
  return out
}

export interface Peak {
  index: number
  value: number
  z: number
}

/**
 * Yerel ortalama/standart sapmaya göre z-skor hesaplar ve tepe noktalarını döner.
 * `baselineBins`: z-skor için yuvarlanan taban penceresi.
 */
export function findPeaks(series: number[], opts: { baselineBins?: number; minZ?: number; minDistanceBins?: number; minValue?: number } = {}): Peak[] {
  const baseline = opts.baselineBins ?? 120
  const minZ = opts.minZ ?? 2.5
  const minDist = opts.minDistanceBins ?? 20
  const minValue = opts.minValue ?? 3
  const n = series.length
  const prefix = new Float64Array(n + 1)
  const prefix2 = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + series[i]
    prefix2[i + 1] = prefix2[i] + series[i] * series[i]
  }
  const peaks: Peak[] = []
  for (let i = 1; i < n - 1; i++) {
    if (series[i] < minValue || series[i] < series[i - 1] || series[i] < series[i + 1]) continue
    const lo = Math.max(0, i - baseline)
    const hi = Math.min(n, i + baseline + 1)
    const cnt = hi - lo
    const mean = (prefix[hi] - prefix[lo]) / cnt
    const variance = Math.max(0, (prefix2[hi] - prefix2[lo]) / cnt - mean * mean)
    const sd = Math.max(Math.sqrt(variance), 0.5)
    const z = (series[i] - mean) / sd
    if (z >= minZ) peaks.push({ index: i, value: series[i], z })
  }
  peaks.sort((a, b) => b.z - a.z)
  const chosen: Peak[] = []
  for (const p of peaks) if (chosen.every((c) => Math.abs(c.index - p.index) >= minDist)) chosen.push(p)
  return chosen.sort((a, b) => a.index - b.index)
}
