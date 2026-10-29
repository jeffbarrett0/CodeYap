import type { AspectRatio, LayoutPreset, NormRect } from '../types'

export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ResolvedLayout {
  /** Ekran görüntüsünün yerleşeceği dikdörtgen */
  screen: PxRect
  /** 'cover' kareyi doldurur (kırpar); 'contain' oranı korur ve arkada bulanık dolgu kullanır */
  screenFit: 'cover' | 'contain'
  /** Kamera dikdörtgeni (yoksa kamera bu düzende kullanılmaz → overlay konumu kullanılır) */
  cam: PxRect | null
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export function toPx(r: NormRect, W: number, H: number): PxRect {
  return { x: Math.round(r.x * W), y: Math.round(r.y * H), w: even(r.w * W), h: even(r.h * H) }
}

/** Düzen şablonunu çıkış çözünürlüğüne göre piksel dikdörtgenlerine çevirir. */
export function resolveLayout(aspect: AspectRatio, preset: LayoutPreset, W: number, H: number, overlay: NormRect): ResolvedLayout {
  const full: PxRect = { x: 0, y: 0, w: W, h: H }
  const corner = toPx(overlay, W, H)

  if (aspect !== '9:16') {
    // 16:9 ve 1:1: ekran kareyi doldurur, kamera köşe overlay'i
    return { screen: full, screenFit: 'cover', cam: corner }
  }

  const gameH = even((W * 9) / 16)
  const gameY = Math.round((H - gameH) / 2) // oyun ekranı dikey ortada
  const gameRect: PxRect = { x: 0, y: gameY, w: W, h: gameH }
  const areaH = gameY // üstte/altta kalan boşluk
  const pad = Math.round(H * 0.012)
  const camH = even(areaH - pad * 2)
  const camW = even(Math.min(W * 0.9, (camH * 3) / 2))
  const camX = Math.round((W - camW) / 2)

  switch (preset) {
    case 'game-center-cam-bottom':
      return { screen: gameRect, screenFit: 'contain', cam: { x: camX, y: gameY + gameH + pad, w: camW, h: camH } }
    case 'game-center-cam-top':
      return { screen: gameRect, screenFit: 'contain', cam: { x: camX, y: pad, w: camW, h: camH } }
    case 'cam-overlay-corner':
      return { screen: gameRect, screenFit: 'contain', cam: corner }
    case 'fill':
    default:
      return { screen: full, screenFit: 'cover', cam: corner }
  }
}
