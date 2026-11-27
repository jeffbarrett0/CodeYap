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

/** Buton animasyonunun süresi (sn): `youtube-abone.mp4` ~5 sn */
export const CTA_CLIP_SEC = 5.2

/**
 * KULLANICININ KARARI (kalıcı): İLK buton videonun 2. SANİYESİNDE, sonra YATAY videolarda HER 30 SANİYEDE bir (GTA 6 dikey klipte her 20 sn).
 * Son 0,5 sn'ye taşmaz; videoya sığmayacak kadar kısaysa (<~7,7 sn) eklenmez.
 */
export const CTA_FIRST_SEC = 2
export const CTA_EVERY_SEC = 30 // YATAY videolar (kullanıcı: ilk buton 2. sn, sonra her 30 sn)
export const GTA_EVERY_SEC = 20 // GTA 6 dikey klip
export function ctaTimesEvery(durationSec: number, everySec = CTA_EVERY_SEC, clipSec = CTA_CLIP_SEC): number[] {
  const out: number[] = []
  for (let t = CTA_FIRST_SEC; t + clipSec <= durationSec - 0.5 + 1e-6; t += everySec) out.push(Math.round(t * 10) / 10)
  return out
}

/**
 * DİKEY (9:16) buton yeri — KULLANICININ KIRMIZI İLE İŞARETLEDİĞİ yer: yatayda tam ortada, dikeyde yüz ile ekran görüntüsünün birleştiği çizginin biraz altında
 * (ekran görüntüsünün üst kısmı; alt kenar karenin %80'inde; buton kutusunun üst kısmında görünür, ~%63–72 arası). Genişlik karenin %72'si (kullanıcı: "çok küçük, büyüt"). Yatay ve kare videolar eskisi gibi alt ortada kalır.
 */
export const VERTICAL_CTA = { width: 0.72, bottom: 0.8 }
/** GTA 6 klibi: oyun kare altında boş kalan bölgenin ortasına (alt kenar karenin %94'ü), genişlik %72 */
/** GTA 6 klibinde oyun ekranının yakınlığı: 1 = tam sığar; 1,12 = "birazcık" büyük (yanlardan ~%4,5'er kırpılır) */
export const GTA_GAME_ZOOM = 1.12
export const GTA_CTA = { width: 0.62, bottom: 0.95 }
export function verticalCtaRect(entry: Pick<CtaEntry, 'crop'>, assetW: number, assetH: number, at: { width: number; bottom: number } = VERTICAL_CTA): NormRect {
  const crop = entry.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const ratio = (crop.w * Math.max(1, assetW)) / (crop.h * Math.max(1, assetH))
  const w = at.width
  const h = Math.min(0.5, (w / ratio) * frameAspectOf('9:16'))
  return { x: (1 - w) / 2, y: at.bottom - h, w, h }
}

/** Butonun varsayılan genişliği (kare genişliğinin oranı) ve yeri: ALTTA ORTA, göz almayacak küçüklükte (kullanıcı: "tam ortaya değil, çok göz almayacak") */
export const youtubeCtaSize = (aspect: string): number => (aspect === '9:16' ? 0.55 : aspect === '1:1' ? 0.42 : 0.3)

/**
 * (ESKİ kural, vlog `cta` komutu dışında kullanılmaz) YouTube yatay video kesitlerinde abone butonunun yerleri (kesit başından saniye). Kural (kullanıcı: "çok fazla olmasın; 3 dk ise 2 kere, 8 dk ise 2-4-6-7. dakikalar"):
 *  - 20 sn'den kısa: yok · 20–150 sn (90 sn'in altı dahil): ortada 1 · 150–240 sn (3 dk): üçte biri + üçte ikisi (1. ve 2. dakika)
 *  - 4 dk ve üstü: her ~2 dakikada bir (2., 4., 6. …) + sondan 1 dk önce bir tane (8 dk: 2-4-6-7)
 *  - çok uzun kesitlerde en çok 8 (aralık uzar). Hiçbir buton son 60 sn'ye taşmaz (buton 5 sn sürer).
 */
export function ctaTimes(durationSec: number): number[] {
  const D = durationSec
  if (D < 20) return [] // buton 5 sn sürer: bundan kısada sığmaz
  if (D < 150) return [Math.round(D / 2)]
  if (D < 240) return [Math.round(D / 3), Math.round((2 * D) / 3)]
  const step = Math.max(120, D / 8)
  const out: number[] = []
  for (let t = step; t <= D - 60 + 1e-6; t += step) out.push(Math.round(t))
  const last = Math.round(D - 60)
  if (out.length === 0 || last - out[out.length - 1] >= 45) out.push(last)
  return out
}
