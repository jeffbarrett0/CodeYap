/**
 * SportDeoPlus (yenilendi): kullanıcı bir DİKEY MP4 verir (yukarıda yüzü, ortada sosyal medya şeridi, aşağıda ekran görüntüsü — Auto Clips düzeni).
 * Ortadaki şerit ve alttaki ekran SİLİNİR; yalnızca üstteki yüz alanı kalır ve MP4 olarak kaydedilir (ses aynen kalır).
 * Yüz alanı = karenin üst `faceShare` kısmı (Auto Clips varsayılanı %41,5); şerit yüz/ekran birleşim çizgisine ortalı durduğu için
 * şeridin alt-yarısı yüz alanına taşar: `stripCut` açıkken kesim çizgisi şeridin üst kenarının biraz üstüne çekilir.
 */
export type FaceTrimShape = 'asis' | 'square' | 'horizontal' | 'vertical'

export interface FaceTrimOptions {
  /** yüz alanının kare yüksekliğine oranı (0.2–0.7) */
  faceShare: number
  /** ortada sosyal medya şeridi var: onu da kes */
  stripCut: boolean
  shape: FaceTrimShape
}

export const FACE_TRIM_DEFAULT: FaceTrimOptions = { faceShare: 0.415, stripCut: true, shape: 'asis' }

export const FACE_TRIM_SHAPES: { id: FaceTrimShape; label: string }[] = [
  { id: 'asis', label: 'Olduğu gibi (yalnızca üst bölge, büyütme yok — en net)' },
  { id: 'square', label: 'Kare (1:1, yüz ortada kırpılır)' },
  { id: 'horizontal', label: 'Yatay 16:9 (1920×1080; büyütülür)' },
  { id: 'vertical', label: 'Dikey 9:16 (1080×1920; çok büyütülür, keskinlik düşer)' }
]

/** Şerit görüntüsünün (resources/overlays/sosyal-medya.png) genişlik/yükseklik oranı ve kare genişliğine oranı (Auto Clips ile aynı) */
export const STRIP_RATIO = 1801 / 160
export const STRIP_WIDTH_FRAC = 0.86

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

export interface FaceTrimGeometry {
  /** kaynaktan kesilecek dikdörtgen */
  cropW: number
  cropH: number
  cropX: number
  cropY: number
  /** çıkış boyutu (ölçekleme varsa farklı) */
  outW: number
  outH: number
  /** yüz alanının (şerit payı düşülmüş) yüksekliği */
  faceH: number
}

export function faceTrimGeometry(W: number, H: number, o: FaceTrimOptions): FaceTrimGeometry {
  const share = Math.min(0.7, Math.max(0.2, o.faceShare))
  const seam = share * H
  // şerit birleşim çizgisine ortalı: yarısı yüz alanına taşar (+ küçük güvenlik payı)
  const stripHalf = o.stripCut ? (STRIP_WIDTH_FRAC * W) / STRIP_RATIO / 2 + 4 * (H / 1920) : 0
  const faceH = Math.min(H, even(seam - stripHalf))
  if (o.shape === 'square') {
    const s = even(Math.min(W, faceH))
    return { cropW: s, cropH: s, cropX: even((W - s) / 2), cropY: 0, outW: s, outH: s, faceH }
  }
  if (o.shape === 'horizontal') {
    const cropH = even(Math.min(faceH, (W * 9) / 16))
    const cropW = even(Math.min(W, (cropH * 16) / 9))
    return { cropW, cropH, cropX: even((W - cropW) / 2), cropY: even((faceH - cropH) / 2), outW: 1920, outH: 1080, faceH }
  }
  if (o.shape === 'vertical') {
    const cropW = even(Math.min(W, (faceH * 9) / 16))
    return { cropW, cropH: faceH, cropX: even((W - cropW) / 2), cropY: 0, outW: 1080, outH: 1920, faceH }
  }
  return { cropW: even(W), cropH: faceH, cropX: 0, cropY: 0, outW: even(W), outH: faceH, faceH }
}

/** ffmpeg -vf zinciri */
export function faceTrimFilter(g: FaceTrimGeometry): string {
  const scale = g.outW !== g.cropW || g.outH !== g.cropH ? `,scale=${g.outW}:${g.outH}:flags=lanczos` : ''
  return `crop=${g.cropW}:${g.cropH}:${g.cropX}:${g.cropY}${scale},setsar=1`
}
