import { buildSegments } from './transcript/sentences'
import type { TranscriptWord } from './types'

/** ───── Çıkış kontrolü (QA): ölçümlerden uyarı üretir (ölçüm main/qa.ts'te ffmpeg ile yapılır) ───── */
export interface QaMeasure {
  durationSec: number
  /** ilk karenin gri ortalaması (0..255) ve standart sapması; ölçülemediyse yok */
  firstFrame?: { mean: number; std: number }
  /** siyah aralıklar (sn) */
  black: { start: number; end: number }[]
  /** uzun sessizlikler (sn) */
  silence: { start: number; end: number }[]
  /** entegre ses şiddeti (LUFS) ve gerçek tepe (dBFS) */
  loudnessLufs?: number
  peakDb?: number
  hasAudio: boolean
}
export interface QaItem {
  id: 'first-frame' | 'black' | 'silence' | 'loudness' | 'peak' | 'no-audio' | 'end-black'
  level: 'warn' | 'info'
  message: string
  /** ilgili zaman aralıkları (sn) */
  at?: { start: number; end: number }[]
}
export const QA = { maxSilenceSec: 4, lufsLow: -26, lufsHigh: -11, peakHigh: -1 }

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function qaReport(m: QaMeasure): { items: QaItem[]; ok: boolean } {
  const items: QaItem[] = []
  const f = m.firstFrame
  if (f && f.mean < 12) items.push({ id: 'first-frame', level: 'warn', message: 'İlk kare siyah: izleyici ilk saniyede boş ekran görür (kanca kaybolur). Videonun başını kısaltın ya da ilk kareyi değiştirin.' })
  else if (f && f.std < 6) items.push({ id: 'first-frame', level: 'warn', message: 'İlk kare düz (tek renk): küçük resimde ve başlangıçta boş görünür.' })
  const endBlack = m.black.find((b) => b.end >= m.durationSec - 0.6 && m.durationSec > 3)
  for (const b of m.black) if (b.start < 0.3 && !items.some((i) => i.id === 'first-frame')) items.push({ id: 'first-frame', level: 'warn', message: `Videonun başı ${(b.end - b.start).toFixed(1)} sn siyah.`, at: [b] })
  const mid = m.black.filter((b) => b.start >= 0.3 && b !== endBlack)
  if (mid.length) items.push({ id: 'black', level: 'warn', message: `${mid.length} yerde siyah ekran var (${mid.slice(0, 5).map((b) => mmss(b.start)).join(', ')}${mid.length > 5 ? '…' : ''}).`, at: mid })
  if (endBlack) items.push({ id: 'end-black', level: 'info', message: `Sonda ${(endBlack.end - endBlack.start).toFixed(1)} sn siyah ekran var.`, at: [endBlack] })
  if (!m.hasAudio) items.push({ id: 'no-audio', level: 'warn', message: 'Videoda ses yok.' })
  else {
    const long = m.silence.filter((s) => s.end - s.start >= QA.maxSilenceSec)
    if (long.length) items.push({ id: 'silence', level: 'warn', message: `${long.length} yerde ${QA.maxSilenceSec} sn'den uzun sessizlik var (${long.slice(0, 5).map((s) => `${mmss(s.start)} (${Math.round(s.end - s.start)} sn)`).join(', ')}${long.length > 5 ? '…' : ''}).`, at: long })
    if (m.loudnessLufs !== undefined && m.loudnessLufs < QA.lufsLow) items.push({ id: 'loudness', level: 'warn', message: `Ses çok kısık (${m.loudnessLufs.toFixed(1)} LUFS; YouTube için yaklaşık −14). Ses sekmesinden seviyeyi artırın ya da "Ses şiddetini eşitle" açın.` })
    if (m.loudnessLufs !== undefined && m.loudnessLufs > QA.lufsHigh) items.push({ id: 'loudness', level: 'warn', message: `Ses çok yüksek (${m.loudnessLufs.toFixed(1)} LUFS).` })
    if (m.peakDb !== undefined && m.peakDb > QA.peakHigh) items.push({ id: 'peak', level: 'warn', message: `Ses tepesi ${m.peakDb.toFixed(1)} dB: patlama/bozulma riski (−1 dB altında olmalı).` })
  }
  return { items, ok: !items.some((i) => i.level === 'warn') }
}
export const qaText = (items: QaItem[]): string => (items.length ? items.map((i) => `${i.level === 'warn' ? '⚠' : 'ℹ'} ${i.message}`).join('\n') : '✓ Sorun bulunamadı: ilk kare, siyah ekran, sessizlik ve ses seviyesi normal.')

/** ffmpeg stderr satırlarından ölçüm toplayıcı (blackdetect / silencedetect / ebur128) */
export function parseQaLine(line: string, acc: Pick<QaMeasure, 'black' | 'silence'> & { lufs?: number; peak?: number; silStart?: number }) {
  let m = /black_start:([\d.]+)\s+black_end:([\d.]+)/.exec(line)
  if (m) acc.black.push({ start: Number(m[1]), end: Number(m[2]) })
  m = /silence_start:\s*(-?[\d.]+)/.exec(line)
  if (m) acc.silStart = Math.max(0, Number(m[1]))
  m = /silence_end:\s*([\d.]+)/.exec(line)
  if (m && acc.silStart !== undefined) (acc.silence.push({ start: acc.silStart, end: Number(m[1]) }), (acc.silStart = undefined))
  m = /^\s*I:\s+(-?[\d.]+)\s+LUFS/.exec(line)
  if (m) acc.lufs = Number(m[1])
  m = /^\s*Peak:\s+(-?[\d.]+)\s+dBFS/.exec(line)
  if (m) acc.peak = Number(m[1])
}

/** ───── Rakam doğrulama: ekrandaki rakamlar konuşmada geçiyor mu ───── */
const ONES: Record<string, number> = { sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9 }
const TENS: Record<string, number> = { on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90 }
const fold = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]/g, '')

/** Konuşmadaki sayıları çıkarır: rakamla yazılanlar ("71", "92,7") ve Türkçe söylenenler ("yetmiş bir", "yüz yirmi", "iki bin yirmi dört") */
export function spokenNumbers(words: string[]): number[] {
  const out: number[] = []
  for (const w of words) {
    const m = /^\d+(?:[.,]\d+)?/.exec(w.trim().replace(/[%’']/g, ''))
    if (m) out.push(Number(m[0].replace(',', '.')))
  }
  const toks = words.map(fold)
  let i = 0
  while (i < toks.length) {
    let total = 0
    let cur = 0
    let used = 0
    let j = i
    for (; j < toks.length; j++) {
      const t = toks[j]
      if (t in ONES && !(t === 'sifir' && used > 0)) cur += ONES[t]
      else if (t in TENS) cur += TENS[t]
      else if (t === 'yuz') cur = (cur || 1) * 100
      else if (t === 'bin') { total += (cur || 1) * 1000; cur = 0 }
      else if (t === 'milyon') { total += (cur || 1) * 1_000_000; cur = 0 }
      else break
      used++
    }
    if (used > 0) {
      out.push(total + cur)
      i = j
    } else i++
  }
  return out
}

/** Ekran metnindeki sayılar ("%71", "92,7", "3-4", "2024") */
export function onScreenNumbers(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(Number(m[0].replace(',', '.')))
  return out
}

export interface NumberCheck { text: string; start: number; end: number; number: number; ok: boolean }
/** Her ekran yazısı için: içindeki her sayı, yazının göründüğü aralığın ±pad sn çevresindeki konuşmada geçiyor mu */
export function verifyNumbers(items: { text: string; start: number; end: number }[], words: TranscriptWord[], padSec = 12): NumberCheck[] {
  const res: NumberCheck[] = []
  for (const it of items) {
    const near = words.filter((w) => w.end >= it.start - padSec && w.start <= it.end + padSec).map((w) => w.text)
    const spoken = spokenNumbers(near)
    for (const n of onScreenNumbers(it.text)) res.push({ text: it.text.replace(/\s+/g, ' ').trim(), start: it.start, end: it.end, number: n, ok: spoken.some((s) => Math.abs(s - n) < 1e-9) })
  }
  return res
}

/** ───── Hata/tekrar önerisi: aynı cümleyi tekrar söyleme, yanlış başlayıp baştan alma ───── */
export interface RetakeSuggestion { kind: 'tekrar' | 'yarım'; start: number; end: number; text: string; keepAt: number; note: string }
const grams = (text: string): Set<string> => {
  const t = text.split(/\s+/).map(fold).filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + 2 < t.length; i++) out.add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`)
  return out
}
/** Önceki cümle sonraki cümleyle büyük ölçüde aynıysa ya da yarım kalıp aynı sözle yeniden başlandıysa ÖNCEKİ (ilk deneme) kesilmesi önerilir. Hiçbir şey kesilmez. */
export function findRetakes(words: TranscriptWord[], opts: { windowSec?: number; minOverlap?: number } = {}): RetakeSuggestion[] {
  const windowSec = opts.windowSec ?? 40
  const minOverlap = opts.minOverlap ?? 0.5
  const segs = buildSegments(words)
  const out: RetakeSuggestion[] = []
  const used = new Set<number>()
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]
    const ga = grams(a.text)
    if (ga.size < 2) continue
    for (let j = i + 1; j < segs.length && segs[j].start - a.end <= windowSec; j++) {
      const b = segs[j]
      const gb = grams(b.text)
      if (gb.size < 2 || used.has(i)) continue
      let inter = 0
      for (const g of ga) if (gb.has(g)) inter++
      const overlap = inter / Math.min(ga.size, gb.size)
      if (overlap >= minOverlap) {
        const unfinished = !/[.!?…]\s*$/.test(a.text.trim())
        out.push({ kind: unfinished ? 'yarım' : 'tekrar', start: a.start, end: a.end, text: a.text.trim(), keepAt: b.start, note: unfinished ? 'Cümle yarım kalmış, ardından aynı sözle yeniden başlanmış.' : 'Aynı cümle kısa süre sonra tekrar söylenmiş; ilk söyleyiş kesilebilir.' })
        used.add(i)
        break
      }
    }
  }
  return out
}
