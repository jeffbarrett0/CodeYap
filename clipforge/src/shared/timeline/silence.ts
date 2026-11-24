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
  /**
   * KONUŞMA KORUMASI: GERÇEK ses seviyesinden bulunan "ses var" aralıkları (çizelge zamanı, sn). Verilirse sessizlik kesimleri bunların İÇİNE giremez;
   * konuşmanın öncesinde `voicedLeadSec`, sonrasında `voicedTailSec` pay bırakılır. (Whisper kelime zamanları konuşmanın başlangıcını sıklıkla GEÇ verir;
   * ayrıca Whisper'ın hiç yazmadığı ama söylenen sözler "sessizlik" sanılırdı.)
   */
  voiced?: [number, number][]
  voicedLeadSec: number
  voicedTailSec: number
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = { minGapSec: 0.55, keepSec: 0.15, cutFillers: true, minCutSec: 0.2, voicedLeadSec: 0.25, voicedTailSec: 0.2 }

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
/** `r` aralığından, genişletilmiş "ses var" aralıklarını çıkarır; kalan parçalardan `minCut`'tan kısaları atılır */
export function subtractVoiced(r: [number, number], voiced: [number, number][], lead: number, tail: number, minCut: number): [number, number][] {
  let pieces: [number, number][] = [[r[0], r[1]]]
  for (const [v0, v1] of voiced) {
    const a = v0 - lead
    const b = v1 + tail
    if (b <= r[0] || a >= r[1]) continue
    const next: [number, number][] = []
    for (const [x, y] of pieces) {
      if (b <= x || a >= y) next.push([x, y])
      else {
        if (a - x >= minCut) next.push([x, a])
        if (y - b >= minCut) next.push([b, y])
      }
    }
    pieces = next
  }
  return pieces.filter(([x, y]) => y - x >= minCut)
}

export function planSilenceCuts(words: W[], totalSec: number, options: Partial<SilenceOptions> = {}): CutPlan {
  const o = { ...DEFAULT_SILENCE_OPTIONS, ...options }
  // Ses seviyesi koruması YOKSA (analiz yapılamadıysa) konuşmanın başı için daha geniş pay: Whisper başlangıç zamanları geç olabilir
  const lead = o.voiced ? o.keepSec : Math.max(o.keepSec, 0.3)
  const tail = o.voiced ? o.keepSec : Math.max(o.keepSec, 0.22) // sözün bitişi de erken verilebilir
  const sorted = [...words].sort((a, b) => a.start - b.start)
  const filler = sorted.map((w) => o.cutFillers && isFiller(w.text))
  const kept = sorted.filter((_, i) => !filler[i])
  if (kept.length === 0) return { cuts: [], removedSec: 0, silenceCount: 0, fillerCount: 0 }

  const raw: { r: [number, number]; kind: 'silence' | 'filler' }[] = []

  // baş ve son
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (first.start - lead >= o.minCutSec) raw.push({ r: [0, first.start - lead], kind: 'silence' })
  if (totalSec - (last.end + tail) >= o.minCutSec) raw.push({ r: [last.end + tail, totalSec], kind: 'silence' })

  // kelime arası uzun sessizlikler (dolgu kelimeleri aradaysa onlar da bu aralıkta değerlendirilir)
  for (let i = 0; i < kept.length - 1; i++) {
    const a = kept[i]
    const b = kept[i + 1]
    const gap = b.start - a.end
    if (gap >= o.minGapSec) {
      const r: [number, number] = [a.end + tail, b.start - lead]
      if (r[1] - r[0] >= o.minCutSec) raw.push({ r, kind: 'silence' })
    }
  }

  // dolgu sesleri: kendi aralıkları (komşu GERÇEK kelimelere taşmadan)
  let fillerCount = 0
  sorted.forEach((w, i) => {
    if (!filler[i]) return
    fillerCount++
    let lo = w.start - 0.02
    let hi = w.end + 0.02
    for (const k of kept) {
      if (k.end <= w.start + 1e-6) lo = Math.max(lo, k.end)
      else if (k.start >= w.end - 1e-6) {
        // sonraki GERÇEK kelime hemen arkasından başlıyorsa onun ilk hecesi kesilmesin (başlangıç zamanları geç olabilir)
        hi = Math.min(hi, k.start - (k.start - w.end < 0.12 ? 0.06 : 0))
        break
      }
    }
    if (hi - lo >= 0.08) raw.push({ r: [Math.max(0, lo), hi], kind: 'filler' })
  })

  // KONUŞMA KORUMASI: sessizlik kesimlerinden, gerçekten ses olan yerler (öncesi/sonrası payıyla) çıkarılır. Dolgu sesleri (ııı/eee) ses içerir: onlara uygulanmaz.
  const guarded: { r: [number, number]; kind: 'silence' | 'filler' }[] = []
  for (const x of raw) {
    if (x.kind === 'silence' && o.voiced?.length) for (const piece of subtractVoiced(x.r, o.voiced, o.voicedLeadSec, o.voicedTailSec, o.minCutSec)) guarded.push({ r: piece, kind: 'silence' })
    else guarded.push(x)
  }
  // çakışan ya da BİTİŞİK aralıkları birleştir (araya kelime giriyorsa birleştirme YOK: eskiden 0,25 sn'den kısa araya sıkışan kısa kelime silinebiliyordu)
  guarded.sort((a, b) => a.r[0] - b.r[0])
  const cuts: [number, number][] = []
  for (const { r } of guarded) {
    const prev = cuts[cuts.length - 1]
    if (prev && r[0] <= prev[1] + 0.04) prev[1] = Math.max(prev[1], r[1])
    else cuts.push([r[0], r[1]])
  }
  const silenceCount = guarded.filter((x) => x.kind === 'silence').length
  return { cuts, removedSec: cuts.reduce((s, [a, b]) => s + (b - a), 0), silenceCount, fillerCount }
}

/** Kesim raporu: her kesilen yerin zamanı, süresi, türü ve öncesinde/sonrasında söylenenler (kullanıcı anlam bütünlüğünü kontrol edebilsin) */
export function cutReportText(o: { cuts: [number, number][]; words: W[]; toSource?: (t: number) => number; guardNote?: string }): string {
  const ts = (t: number) => {
    const s = Math.max(0, t)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : String(m)}:${(s % 60).toFixed(1).padStart(4, '0')}`
  }
  const src = o.toSource ?? ((t: number) => t)
  const sorted = [...o.words].sort((a, b) => a.start - b.start)
  const lines: string[] = []
  let total = 0
  for (const [a, b] of o.cuts) {
    total += b - a
    const before = sorted.filter((w) => w.end <= a + 0.02 && !isFiller(w.text)).slice(-4).map((w) => w.text).join(' ')
    const after = sorted.filter((w) => w.start >= b - 0.02 && !isFiller(w.text)).slice(0, 4).map((w) => w.text).join(' ')
    const fillers = sorted.filter((w) => isFiller(w.text) && w.start >= a - 0.05 && w.end <= b + 0.05).map((w) => w.text)
    const kind = fillers.length ? `dolgu sesi (${fillers.join(' ')})${b - a > 1.2 ? ' + sessizlik' : ''}` : 'sessizlik'
    lines.push(`${ts(src(a))} – ${ts(src(b))}  (${(b - a).toFixed(1)} sn)  ${kind}\n    önce: “…${before || '(başlangıç)'}”   sonra: “${after || '(son)'}…”`)
  }
  return [
    'AUTO KICK KESİM RAPORU',
    `Toplam ${o.cuts.length} kesim, ${total.toFixed(0)} sn (${(total / 60).toFixed(1)} dk) çıkarıldı. Zamanlar ORİJİNAL KAYIT zamanıdır.`,
    o.guardNote ? `Konuşma koruması: ${o.guardNote}` : 'Konuşma koruması kapalı: yalnızca transkript zamanlarına bakıldı.',
    'Bir yerin yanlış kesildiğini düşünürsen zamanı ve "önce/sonra" sözlerini bana yaz.',
    '',
    ...lines
  ].join('\n')
}
