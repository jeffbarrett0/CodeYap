import { foldTr } from '../text'

export interface SilenceOptions {
  /** Bu süreden uzun kelime arası sessizlik kesilir (sn) */
  minGapSec: number
  /** Kesimden sonra her iki yanda bırakılan doğal nefes payı (sn) */
  keepSec: number
  /** "ı", "ııı", "eee", "hımm" gibi tam konuşma olmayan dolgu sesleri de kesilir */
  cutFillers: boolean
  /** Bundan kısa kesimler yapılmaz (sn) */
  minCutSec: number
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = { minGapSec: 0.7, keepSec: 0.15, cutFillers: true, minCutSec: 0.2 }

/**
 * Tam konuşma olmayan dolgu sesleri (Türkçe: ı, ıı, ııı, e, ee, eee, hımm, ömm …). Gerçek sözcükleri (ah, oh, evet …) içermez.
 * Katlanmış (ı→i, ö→o) metin üzerinde: "ı", "ıı…", "ee…", "eh/ehm", "hm…", "him…", "mm…", "um/uh", "öö…".
 */
const FILLER = /^(?:i+|e{2,}h*|e?hm+|h+m{2,}|h?i+m{2,}|m{3,}|u+h+|um+|o{2,}|o+m{2,})$/

export function isFiller(text: string): boolean {
  const t = (foldTr(text).match(/[\p{L}]+/gu) ?? []).join('')
  // tek harfli "e" gerçek bir ünlem olabilir; yalnızca "i" (ı) ve en az iki harfli biçimler dolgu sayılır
  return t.length > 0 && t.length <= 8 && FILLER.test(t)
}

export interface CutPlan {
  /** Zaman çizelgesi zamanında kesilecek aralıklar (sıralı, çakışmasız) */
  cuts: [number, number][]
  removedSec: number
  silenceCount: number
  fillerCount: number
}

interface W {
  text: string
  start: number
  end: number
}

/**
 * Transkript kelimelerinden (çizelge zamanında) kesilecek sessizlik ve dolgu aralıklarını hesaplar.
 *  - Kelimeler arası `minGapSec`'ten uzun boşluklar, iki yandan `keepSec` pay bırakılarak kesilir.
 *  - Dolgu sesleri kelimeleriyle birlikte kesilir (komşu kelimeye taşmadan).
 *  - Baştaki ve sondaki sessizlik de kısaltılır. Hiç gerçek kelime yoksa HİÇBİR ŞEY kesilmez.
 * `totalSec`: zaman çizelgesi süresi (sondaki sessizlik için).
 */
export function planSilenceCuts(words: W[], totalSec: number, options: Partial<SilenceOptions> = {}): CutPlan {
  const o = { ...DEFAULT_SILENCE_OPTIONS, ...options }
  const sorted = [...words].sort((a, b) => a.start - b.start)
  const filler = sorted.map((w) => o.cutFillers && isFiller(w.text))
  const kept = sorted.filter((_, i) => !filler[i])
  if (kept.length === 0) return { cuts: [], removedSec: 0, silenceCount: 0, fillerCount: 0 }

  const raw: { r: [number, number]; kind: 'silence' | 'filler' }[] = []

  // baş ve son
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (first.start - o.keepSec - 0 >= o.minCutSec) raw.push({ r: [0, first.start - o.keepSec], kind: 'silence' })
  if (totalSec - (last.end + o.keepSec) >= o.minCutSec) raw.push({ r: [last.end + o.keepSec, totalSec], kind: 'silence' })

  // kelime arası uzun sessizlikler (dolgu kelimeleri aradaysa onlar da bu aralıkta değerlendirilir)
  for (let i = 0; i < kept.length - 1; i++) {
    const a = kept[i]
    const b = kept[i + 1]
    const gap = b.start - a.end
    if (gap >= o.minGapSec) {
      const r: [number, number] = [a.end + o.keepSec, b.start - o.keepSec]
      if (r[1] - r[0] >= o.minCutSec) raw.push({ r, kind: 'silence' })
    }
  }

  // dolgu sesleri: kendi aralıkları (komşu GERÇEK kelimelere taşmadan)
  let fillerCount = 0
  sorted.forEach((w, i) => {
    if (!filler[i]) return
    fillerCount++
    let lo = w.start - 0.03
    let hi = w.end + 0.03
    for (const k of kept) {
      if (k.end <= w.start + 1e-6) lo = Math.max(lo, k.end)
      else if (k.start >= w.end - 1e-6) {
        hi = Math.min(hi, k.start)
        break
      }
    }
    if (hi - lo >= 0.08) raw.push({ r: [Math.max(0, lo), hi], kind: 'filler' })
  })

  // çakışan / çok yakın aralıkları birleştir
  raw.sort((a, b) => a.r[0] - b.r[0])
  const cuts: [number, number][] = []
  for (const { r } of raw) {
    const prev = cuts[cuts.length - 1]
    if (prev && r[0] <= prev[1] + 0.25) prev[1] = Math.max(prev[1], r[1])
    else cuts.push([r[0], r[1]])
  }
  const silenceCount = raw.filter((x) => x.kind === 'silence').length
  return { cuts, removedSec: cuts.reduce((s, [a, b]) => s + (b - a), 0), silenceCount, fillerCount }
}
