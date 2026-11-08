import type { NormRect } from './types'

/**
 * Çağrı butonları (abone ol / takip et): kullanıcının kendi YEŞİL PERDELİ (chroma key) animasyonlu videoları. `resources/cta/cta.json`:
 * perde rengi, her butonun hareket alanı (kırpma) ve gösterim sırası. Buton alttan yükselir, tıklanır, geri iner (5 sn, sesli).
 */
export interface CtaEntry {
  id: string
  label: string
  file: string
  /** butonun hareket ettiği bölge (normalize); köşeye yerleştirmek için yalnızca burası kullanılır */
  crop?: NormRect
  /** kırpma bölgesinin alt kenarı karenin alt kenarına yapışır (buton gerçekten alttan yükselir) */
  flushBottom?: boolean
}
export interface CtaManifest {
  version: number
  /** yeşil perde rengi #RRGGBB */
  chroma: string
  /** gösterim sırası (buton kimlikleri; döngü) */
  rotation: string[]
  buttons: CtaEntry[]
}

export type CtaPos = 'bottom-left' | 'bottom-right' | 'bottom-center'

/** Kare en-boy oranı (genişlik/yükseklik) */
export const frameAspectOf = (aspect: string): number => (aspect === '9:16' ? 9 / 16 : aspect === '1:1' ? 1 : 16 / 9)

/** Varsayılan buton genişliği (kare genişliğinin oranı): yatayda ~%34, dikeyde neredeyse tam genişlik */
export const defaultCtaSize = (aspect: string): number => (aspect === '9:16' ? 0.92 : aspect === '1:1' ? 0.55 : 0.34)

/** Butonun kare içindeki dikdörtgeni: oran korunur; alt kenara yapışık (alttan yükselme) ya da köşe boşluklu */
export function ctaRect(entry: Pick<CtaEntry, 'crop' | 'flushBottom'>, assetW: number, assetH: number, aspect: string, opts: { pos?: CtaPos; size?: number } = {}): NormRect {
  const crop = entry.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const fa = frameAspectOf(aspect)
  const w = Math.min(1, Math.max(0.1, opts.size ?? defaultCtaSize(aspect)))
  const ratio = (crop.w * Math.max(1, assetW)) / (crop.h * Math.max(1, assetH))
  const h = Math.min(1, (w / ratio) * fa)
  const m = 0.03
  const pos = opts.pos ?? 'bottom-left'
  const x = pos === 'bottom-right' ? 1 - w - m : pos === 'bottom-center' ? (1 - w) / 2 : m
  const y = entry.flushBottom ? 1 - h : Math.max(0, 1 - h - m * fa)
  return { x, y, w, h }
}

/** `count` gösterim için sırayla buton kimlikleri (rotasyon döngüsü; tanımsız kimlikler atlanır) */
export function ctaSequence(m: CtaManifest, count: number): CtaEntry[] {
  const ids = m.rotation.length ? m.rotation : m.buttons.map((b) => b.id)
  const list = ids.map((id) => m.buttons.find((b) => b.id === id)).filter((b): b is CtaEntry => !!b)
  if (list.length === 0) return []
  return Array.from({ length: count }, (_, i) => list[i % list.length])
}

export function parseCtaManifest(raw: unknown): CtaManifest | null {
  const o = raw as Partial<CtaManifest> | null
  if (!o || !Array.isArray(o.buttons) || o.buttons.length === 0) return null
  const buttons = o.buttons.filter((b): b is CtaEntry => !!b && typeof b.id === 'string' && typeof b.file === 'string').map((b) => ({ ...b, label: b.label ?? b.id }))
  if (buttons.length === 0) return null
  return { version: 1, chroma: typeof o.chroma === 'string' ? o.chroma : '#00FF00', rotation: Array.isArray(o.rotation) ? o.rotation.filter((x) => typeof x === 'string') : [], buttons }
}
