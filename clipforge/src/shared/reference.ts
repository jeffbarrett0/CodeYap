/** Referans videolar: kullanıcının beğendiği bir video buraya atılır; ölçümleri + kare tabloları çıkarılır, Claude Code inceleyip siteye uyarlar. */
export interface ReferenceEntry {
  id: string
  name: string
  /** Kaynak dosya (kopyalanmaz, yerinde okunur) */
  path: string
  addedAt: number
  durationSec: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  /** Sahne/plan değişimi zamanları (sn) */
  cuts: number[]
  /** Ortalama plan süresi (sn) */
  avgShotSec: number
  /** Karede belirgin yatay bölme çizgisi varsa yüksekliğin oranı (0..1): yüz/görüntü ayrımı gibi; yoksa null */
  splitLine: number | null
  /** Kare tablosu dosya adları (referans klasöründe) */
  sheets: string[]
  /** Claude Code'un incelemesi / kullanıcı notu */
  notes: string
  status: 'analyzed' | 'adapted'
}

export const aspectLabel = (w: number, h: number): string => {
  if (!w || !h) return '?'
  const r = w / h
  if (Math.abs(r - 9 / 16) < 0.03) return '9:16 dikey'
  if (Math.abs(r - 16 / 9) < 0.03) return '16:9 yatay'
  if (Math.abs(r - 1) < 0.03) return '1:1 kare'
  if (Math.abs(r - 4 / 5) < 0.03) return '4:5'
  return `${w}×${h}`
}

/** Satır farkları dizisinden (kare başına ortalama |satır[i]-satır[i+1]|) belirgin tek bir yatay çizgi bulur; yoksa null */
export function findSplitLine(rowDiff: number[]): number | null {
  const n = rowDiff.length
  if (n < 20) return null
  const lo = Math.floor(n * 0.2)
  const hi = Math.ceil(n * 0.8)
  let best = -1
  let bestV = 0
  for (let i = lo; i < hi; i++) if (rowDiff[i] > bestV) (bestV = rowDiff[i], best = i)
  const sorted = [...rowDiff].sort((a, b) => a - b)
  const median = sorted[Math.floor(n / 2)] || 0.01
  // çizgi, ortanca satır farının çok üstünde ve komşularından belirgin olmalı
  const nb = ((rowDiff[best - 2] ?? 0) + (rowDiff[best + 2] ?? 0)) / 2
  if (best < 0 || bestV < median * 5 || bestV < nb * 2 || bestV < 6) return null
  return Math.round(((best + 1) / n) * 1000) / 1000
}

/** Kare kare ölçüm: her karenin en belirgin yatay çizgisi bulunur; kareler arasında en çok tekrarlanan (≥%30 kare) konum bölme çizgisidir */
export function findSplitLineFrames(frames: number[][]): number | null {
  const votes = new Map<number, number>()
  let used = 0
  for (const f of frames) {
    const v = findSplitLine(f)
    if (v === null) continue
    used++
    const key = Math.round(v * 50) // %2'lik kutular
    votes.set(key, (votes.get(key) ?? 0) + 1)
  }
  if (used === 0 || frames.length === 0) return null
  let bestKey = -1
  let bestN = 0
  for (const [k, n] of votes) {
    const near = n + (votes.get(k - 1) ?? 0) + (votes.get(k + 1) ?? 0)
    if (near > bestN) (bestN = near, bestKey = k)
  }
  return bestN >= Math.max(3, frames.length * 0.3) ? Math.round((bestKey / 50) * 1000) / 1000 : null
}
