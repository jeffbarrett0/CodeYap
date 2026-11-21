/**
 * CapCut tarzı görüntü ayarları (Ayarla → Temel): her değer -100..100 (efektler 0..100), 0 = değişiklik yok.
 * Dışa aktarma: `adjustFilter` (ffmpeg); önizleme: `previewFilter` (canvas CSS filtresi, yaklaşık: yalnızca parlaklık/kontrast/doygunluk).
 */
export type AdjustKey =
  | 'temp' | 'tint' | 'saturation'
  | 'exposure' | 'contrast' | 'highlight' | 'shadow' | 'whites' | 'blacks' | 'brilliance'
  | 'sharpen' | 'clarity' | 'particles' | 'fade' | 'vignette'
export type Adjust = Partial<Record<AdjustKey, number>>

export interface AdjustDef { key: AdjustKey; label: string; min: number; max: number; group: 'Renk' | 'Işık' | 'Efektler' }
export const ADJUST_DEFS: AdjustDef[] = [
  { key: 'temp', label: 'Sıcaklık', min: -100, max: 100, group: 'Renk' },
  { key: 'tint', label: 'Renk tonu', min: -100, max: 100, group: 'Renk' },
  { key: 'saturation', label: 'Doygunluk', min: -100, max: 100, group: 'Renk' },
  { key: 'exposure', label: 'Pozlama', min: -100, max: 100, group: 'Işık' },
  { key: 'contrast', label: 'Kontrast', min: -100, max: 100, group: 'Işık' },
  { key: 'highlight', label: 'Parlak alanlar', min: -100, max: 100, group: 'Işık' },
  { key: 'shadow', label: 'Gölgeler', min: -100, max: 100, group: 'Işık' },
  { key: 'whites', label: 'Beyazlar', min: -100, max: 100, group: 'Işık' },
  { key: 'blacks', label: 'Siyahlar', min: -100, max: 100, group: 'Işık' },
  { key: 'brilliance', label: 'Parlaklık (brilliance)', min: -100, max: 100, group: 'Işık' },
  { key: 'sharpen', label: 'Keskinlik', min: 0, max: 100, group: 'Efektler' },
  { key: 'clarity', label: 'Netlik', min: 0, max: 100, group: 'Efektler' },
  { key: 'particles', label: 'Tanecik', min: 0, max: 100, group: 'Efektler' },
  { key: 'fade', label: 'Solma', min: 0, max: 100, group: 'Efektler' },
  { key: 'vignette', label: 'Vinyet (kenar karartma)', min: 0, max: 100, group: 'Efektler' }
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const f3 = (n: number) => n.toFixed(3)

export const adjustValue = (a: Adjust | undefined, k: AdjustKey): number => {
  const d = ADJUST_DEFS.find((x) => x.key === k)!
  return clamp(Number(a?.[k]) || 0, d.min, d.max)
}
export const adjustIsDefault = (a: Adjust | undefined): boolean => !a || ADJUST_DEFS.every((d) => adjustValue(a, d.key) === 0)
/** Yalnızca sıfırdan farklı değerleri tutar (proje dosyası küçük kalır) */
export function cleanAdjust(a: Adjust): Adjust | undefined {
  const out: Adjust = {}
  for (const d of ADJUST_DEFS) {
    const v = adjustValue(a, d.key)
    if (v !== 0) out[d.key] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** ffmpeg filtre zinciri parçası; boşsa ''. Başta `,` ile başlar (videoFx zincirine eklenir). */
export function adjustFilter(a: Adjust | undefined): string {
  if (adjustIsDefault(a)) return ''
  const v = (k: AdjustKey) => adjustValue(a, k) / 100 // -1..1 (efektler 0..1)
  const parts: string[] = []
  // pozlama (EV) + kontrast + doygunluk
  const eq: string[] = []
  if (v('contrast') !== 0) eq.push(`contrast=${f3(1 + v('contrast') * 0.5)}`)
  if (v('saturation') !== 0) eq.push(`saturation=${f3(Math.max(0, 1 + v('saturation')))}`)
  if (eq.length) parts.push(`eq=${eq.join(':')}`)
  if (v('exposure') !== 0) parts.push(`exposure=exposure=${f3(v('exposure') * 1.2)}`)
  // sıcaklık (kırmızı↔mavi) ve renk tonu (yeşil↔macenta)
  const rr = 1 + v('temp') * 0.18
  const bb = 1 - v('temp') * 0.18
  const gg = 1 - v('tint') * 0.15
  if (v('temp') !== 0 || v('tint') !== 0) parts.push(`colorchannelmixer=rr=${f3(rr)}:gg=${f3(gg)}:bb=${f3(bb)}`)
  // ışık eğrisi: gölge (0,25), parlak alan (0,75), siyah/beyaz uçları, solma (siyahları kaldırır), brilliance (gölge aç + parlakları bastır)
  const bril = v('brilliance')
  const sh = clamp(v('shadow') * 0.12 + bril * 0.06, -0.2, 0.2)
  const hi = clamp(v('highlight') * 0.12 - bril * 0.05, -0.2, 0.2)
  const bl = clamp(v('blacks') * 0.1 + v('fade') * 0.14, -0.1, 0.25)
  const wh = clamp(v('whites') * 0.1, -0.1, 0.1)
  if (sh !== 0 || hi !== 0 || bl !== 0 || wh !== 0) {
    const p = (x: number, y: number) => `${f3(clamp(x, 0, 1))}/${f3(clamp(y, 0, 1))}`
    parts.push(`curves=all='${p(0, bl)} ${p(0.25, 0.25 + sh + bl * 0.6)} ${p(0.75, 0.75 + hi + wh * 0.5)} ${p(1, 1 + wh)}'`)
  }
  // keskinlik (küçük yarıçap) ve netlik (büyük yarıçap, yerel kontrast)
  if (v('sharpen') > 0) parts.push(`unsharp=5:5:${f3(v('sharpen') * 2)}:5:5:0`)
  if (v('clarity') > 0) parts.push(`unsharp=13:13:${f3(v('clarity') * 1.1)}:13:13:0`)
  if (v('particles') > 0) parts.push(`noise=alls=${Math.round(v('particles') * 30)}:allf=t`)
  if (v('vignette') > 0) parts.push(`vignette=angle=${f3(Math.PI / 2 - v('vignette') * (Math.PI / 2 - 0.35))}`)
  return parts.length ? `,${parts.join(',')}` : ''
}

/** Önizleme (canvas): yalnızca pozlama/kontrast/doygunluk; diğer ayarlar dışa aktarmada tam uygulanır */
export function previewFilter(a: Adjust | undefined): string {
  if (adjustIsDefault(a)) return 'none'
  const v = (k: AdjustKey) => adjustValue(a, k) / 100
  const f: string[] = []
  if (v('exposure') !== 0) f.push(`brightness(${f3(1 + v('exposure') * 0.6)})`)
  if (v('contrast') !== 0) f.push(`contrast(${f3(1 + v('contrast') * 0.5)})`)
  if (v('saturation') !== 0) f.push(`saturate(${f3(Math.max(0, 1 + v('saturation')))})`)
  return f.length ? f.join(' ') : 'none'
}

/** Ayarlardan otomatik görüntü ayarı (kapalıysa ya da hepsi 0 ise undefined) */
export function autoAdjustFrom(s: { autoAdjustEnabled?: boolean; autoAdjustContrast?: number; autoAdjustSharpen?: number }): Adjust | undefined {
  if (s.autoAdjustEnabled === false) return undefined
  return cleanAdjust({ contrast: s.autoAdjustContrast ?? 0, sharpen: s.autoAdjustSharpen ?? 0 })
}

/**
 * Zaman çizelgesindeki VİDEO kliplerine varsayılan ayarı ekler: kendi ayarı (fx.adjust) olan klibe, yeşil perdeli (çağrı butonu)
 * kliplere, görsel (şerit/PNG, saydamlık bozulmasın) ve metin kliplerine DOKUNMAZ. Proje dosyası değişmez; yalnızca dışa aktarılan çizelgeye uygulanır.
 */
export function withDefaultAdjust<T extends { tracks: { kind: string; clips: { assetId?: string; fx?: { adjust?: Adjust; chroma?: unknown } }[] }[] }>(tl: T, adjust: Adjust | undefined): T {
  if (!adjust) return tl
  return {
    ...tl,
    tracks: tl.tracks.map((t) => (t.kind !== 'video' ? t : { ...t, clips: t.clips.map((c) => (!c.assetId || c.fx?.adjust || c.fx?.chroma ? c : { ...c, fx: { ...c.fx, adjust: { ...adjust } } })) }))
  }
}
