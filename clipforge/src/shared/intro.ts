/**
 * Yayın başı videosu (ör. "Yayın başlıyor" geri sayım ekranı + telifli şarkı) tespiti: videonun ilk dakikalarından saniyede bir
 * küçük gri kare alınır ve kullanıcının referans ekran görüntüsüyle karşılaştırılır (Pearson korelasyonu: geri sayım rakamı
 * değişse de yerleşim aynı kalır). Yalnızca videonun BAŞINDA bulunursa kesilir; başka yerde eşleşme/eşleşme yoksa hiçbir şey kesilmez.
 */
export const INTRO_W = 64
export const INTRO_H = 36

/** İki gri kare (INTRO_W×INTRO_H) arasındaki Pearson korelasyonu (-1..1); sabit (düz renk) karede 0 */
export function frameCorrelation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) (ma += a[i], (mb += b[i]))
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da < 1e-6 || db < 1e-6 ? 0 : num / Math.sqrt(da * db)
}

export interface IntroDetection {
  found: boolean
  /** kesilecek aralık (kaynak saniyesi): [0, endSec] */
  endSec: number
  matched: number
  firstMatch?: number
  lastMatch?: number
  reason: string
}

export interface IntroOptions {
  /** yayın başı videosunun bilinen süresi (sn); varsayılan 164 (2:44) */
  durationSec: number
  /** örnekleme aralığı (sn) */
  stepSec: number
  /** eşleşme için en az korelasyon */
  threshold: number
  /** intro sayılması için en az eşleşen kare */
  minMatches: number
}
export const DEFAULT_INTRO_OPTIONS: IntroOptions = { durationSec: 164, stepSec: 1, threshold: 0.8, minMatches: 8 }

/**
 * `frames[i]` = i*stepSec. Kural: eşleşmeler videonun başında (ilk eşleşme ≤ durationSec) ve yeterliyse intro vardır;
 * kesim [0, max(durationSec, son eşleşme + 1 sn)] (kayıt intro'nun başından başlıyorsa tam süre kesilir).
 */
export function findIntro(frames: ArrayLike<number>[], ref: ArrayLike<number>, options: Partial<IntroOptions> = {}): IntroDetection {
  const o = { ...DEFAULT_INTRO_OPTIONS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) } as IntroOptions
  const idx: number[] = []
  frames.forEach((f, i) => {
    if (frameCorrelation(f, ref) >= o.threshold) idx.push(i)
  })
  if (idx.length < o.minMatches) return { found: false, endSec: 0, matched: idx.length, reason: idx.length ? `Yalnızca ${idx.length} kare eşleşti (en az ${o.minMatches} gerekir): kesilmedi.` : 'Referans ekrana benzeyen kare bulunamadı: kesilmedi.' }
  const first = idx[0] * o.stepSec
  const last = idx[idx.length - 1] * o.stepSec
  if (first > o.durationSec) return { found: false, endSec: 0, matched: idx.length, firstMatch: first, lastMatch: last, reason: `Eşleşme ${Math.round(first)}. sn'de başlıyor (yayın başında değil): kesilmedi.` }
  const end = Math.max(o.durationSec, last + o.stepSec)
  return { found: true, endSec: end, matched: idx.length, firstMatch: first, lastMatch: last, reason: `Yayın başı videosu bulundu (${idx.length} kare eşleşti, ${Math.round(first)}–${Math.round(last)} sn): ilk ${Math.round(end)} sn kesilecek.` }
}
