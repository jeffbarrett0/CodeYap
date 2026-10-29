import type { ClipforgeApi } from '@shared/ipc'
import { resolveLayout } from '@shared/export/layout'
import { aspectSize, clipDuration, clipEnd } from '@shared/timeline/model'
import { clipsAt, timelineToSource } from '@shared/timeline/ops'
import { wrapCaption } from '@shared/timeline/captions'
import { captionLayout, wrapTextForRect } from '@shared/export/ass'
import type { Clip, MediaAsset, NormRect, TextSpec, Timeline, Track } from '@shared/types'

/** Kaynak karenin hedefi dolduracak (cover) bölgesi */
export function coverSource(sw: number, sh: number, dw: number, dh: number, crop?: NormRect) {
  const bx = crop ? crop.x * sw : 0
  const by = crop ? crop.y * sh : 0
  const bw = crop ? crop.w * sw : sw
  const bh = crop ? crop.h * sh : sh
  const scale = Math.max(dw / bw, dh / bh)
  const w = dw / scale
  const h = dh / scale
  return { sx: bx + (bw - w) / 2, sy: by + (bh - h) / 2, sw: w, sh: h }
}

export function containRect(sw: number, sh: number, r: { x: number; y: number; w: number; h: number }) {
  const scale = Math.min(r.w / sw, r.h / sh)
  const w = sw * scale
  const h = sh * scale
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }
}

/**
 * Gerçek zamanlı önizleme: gizli <video>/<audio> öğelerini zaman çizelgesine göre eşler, kareleri canvas'ta
 * dışa aktarmayla aynı düzen kurallarıyla (resolveLayout) birleştirir. Böylece timeline değişiklikleri anında yansır.
 */
export class PreviewEngine {
  private videos = new Map<string, HTMLVideoElement>()
  private audios = new Map<string, HTMLAudioElement>()
  private images = new Map<string, HTMLImageElement>()
  /** Kırpma modunda düzenlenen klip: tamamı (kırpmasız, sığdırılmış) gösterilir */
  cropClipId: string | null = null

  constructor(private api: ClipforgeApi) {}

  private mediaFor(clip: Clip, assets: MediaAsset[], kind: 'video' | 'audio', index = 0): string | null {
    const a = assets.find((x) => x.id === clip.assetId)
    return a ? this.api.mediaUrl(a, kind, index) : null
  }

  /** Oynatma başlığına göre öğeleri eşitler (arama, oynat/duraklat, ses seviyesi). */
  sync(tl: Timeline, assets: MediaAsset[], t: number, playing: boolean, rate: number) {
    const active = clipsAt(tl, t)
    const want = new Set<string>()
    const trackOf = (c: Clip): Track => tl.tracks.find((x) => x.id === c.trackId) as Track

    for (const c of active) {
      const track = trackOf(c)
      if (!track || (track.muted && track.kind === 'audio')) continue
      const target = timelineToSource(c, t)
      if (track.kind === 'image') {
        const a = assets.find((x) => x.id === c.assetId)
        const url = a ? this.api.mediaUrl(a, 'image') : null
        if (url) this.imageFor(url)
      } else if (track.kind === 'video') {
        if (track.placement && !track.placement.visible) continue // kapalı katman çözülmez (CPU tasarrufu)
        want.add(c.id)
        let v = this.videos.get(c.id)
        const src = this.mediaFor(c, assets, 'video')
        if (!v) {
          v = document.createElement('video')
          v.muted = true
          v.playsInline = true
          v.preload = 'auto'
          this.videos.set(c.id, v)
        }
        if (src && v.getAttribute('data-src') !== src) {
          v.setAttribute('data-src', src)
          v.src = src
        }
        this.align(v, target, playing, rate)
      } else if (track.kind === 'audio') {
        want.add(c.id)
        let a = this.audios.get(c.id)
        const src = this.mediaFor(c, assets, 'audio', c.audioStream ?? 0)
        if (!a) {
          a = new Audio()
          a.preload = 'auto'
          this.audios.set(c.id, a)
        }
        if (src && a.getAttribute('data-src') !== src) {
          a.setAttribute('data-src', src)
          a.src = src
        }
        a.volume = Math.min(1, Math.max(0, track.volume * c.volume))
        this.align(a, target, playing, rate)
      }
    }
    // Artık etkin olmayan öğeleri bırak
    for (const [id, v] of this.videos) if (!want.has(id)) (v.pause(), v.removeAttribute('src'), v.load(), this.videos.delete(id))
    for (const [id, a] of this.audios) if (!want.has(id)) (a.pause(), a.removeAttribute('src'), a.load(), this.audios.delete(id))
  }

  private align(el: HTMLMediaElement, target: number, playing: boolean, rate: number) {
    el.playbackRate = rate
    const drift = Math.abs(el.currentTime - target)
    if (!playing) {
      if (drift > 0.03) el.currentTime = target
      if (!el.paused) el.pause()
    } else {
      if (drift > 0.3) el.currentTime = target
      if (el.paused) void el.play().catch(() => undefined)
    }
  }

  private imageFor(url: string): HTMLImageElement {
    let img = this.images.get(url)
    if (!img) {
      img = new Image()
      img.src = url
      this.images.set(url, img)
    }
    return img
  }

  /** Katman konumlu (yeni) projeler: alttan üste çizer. `guides` açıkken içeriği olmayan katmanlar kesik çizgili yer tutucu gösterir. */
  private drawLayers(ctx: CanvasRenderingContext2D, W: number, H: number, tl: Timeline, assets: MediaAsset[], t: number, guides: boolean) {
    ctx.fillStyle = tl.background ?? '#000'
    ctx.fillRect(0, 0, W, H)
    const scale = Math.min(W, H) / 1080
    for (const track of [...tl.tracks].reverse()) {
      const pl = track.placement
      if (!pl || !pl.visible) continue
      const r = { x: pl.rect.x * W, y: pl.rect.y * H, w: pl.rect.w * W, h: pl.rect.h * H }
      let drew = false
      for (const c of track.clips) {
        if (t < c.start || t >= clipEnd(c)) continue
        ctx.save()
        ctx.globalAlpha = pl.opacity
        if (track.kind === 'text' && c.text) {
          if (c.text.text.trim()) {
            this.drawText(ctx, c.text, r, scale, t - c.start, clipDuration(c))
            drew = true
          }
        } else {
          let src: CanvasImageSource | null = null
          let sw = 0
          let sh = 0
          if (track.kind === 'video') {
            const v = this.videos.get(c.id)
            if (v && v.readyState >= 2 && v.videoWidth) (src = v, sw = v.videoWidth, sh = v.videoHeight)
          } else if (track.kind === 'image') {
            const a = assets.find((x) => x.id === c.assetId)
            const url = a ? this.api.mediaUrl(a, 'image') : null
            const img = url ? this.imageFor(url) : null
            if (img && img.complete && img.naturalWidth) (src = img, sw = img.naturalWidth, sh = img.naturalHeight)
          }
          if (src) {
            const cropping = c.id === this.cropClipId
            const crop = cropping ? undefined : c.crop
            if (pl.fit === 'cover' && !cropping) {
              const s = coverSource(sw, sh, r.w, r.h, crop)
              ctx.drawImage(src, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
            } else {
              // sığdır: kırpma varsa yalnızca kırpılmış bölge sığdırılır
              const bx = crop ? crop.x * sw : 0
              const by = crop ? crop.y * sh : 0
              const bw = crop ? crop.w * sw : sw
              const bh = crop ? crop.h * sh : sh
              const d = containRect(bw, bh, r)
              ctx.drawImage(src, bx, by, bw, bh, d.x, d.y, d.w, d.h)
            }
            drew = true
          }
        }
        ctx.restore()
      }
      if (guides && !drew) {
        ctx.save()
        ctx.setLineDash([10 * scale, 8 * scale])
        ctx.strokeStyle = 'rgba(83,252,24,.55)'
        ctx.lineWidth = Math.max(1, 2 * scale)
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255,255,255,.55)'
        ctx.font = `${Math.round(22 * scale)}px sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(track.name, r.x + 10 * scale, r.y + 8 * scale)
        ctx.restore()
      }
    }
  }

  /** Dışa aktarmadaki ASS animasyonlarının (fade / pulse / slide-up) canvas karşılığı */
  private drawText(ctx: CanvasRenderingContext2D, spec: TextSpec, r: { x: number; y: number; w: number; h: number }, scale: number, local: number, dur: number) {
    const { lines, fontPx } = wrapTextForRect(spec, r.w, scale)
    let alpha = 1
    let zoom = 1
    let dy = 0
    if (spec.animation === 'fade') alpha = Math.max(0, Math.min(1, local / 0.35, (dur - local) / 0.35))
    else if (spec.animation === 'slide-up') {
      const k = Math.min(1, local / 0.35)
      dy = 48 * scale * (1 - k)
      alpha = Math.min(1, local / 0.25)
    } else if (spec.animation === 'pulse' && local > 0.4) {
      const ph = (local - 0.4) % 1.2
      zoom = ph < 0.3 ? 1 + 0.08 * (ph / 0.3) : ph < 0.6 ? 1.08 - 0.08 * ((ph - 0.3) / 0.3) : 1
    }
    ctx.globalAlpha *= alpha
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2 + dy)
    ctx.scale(zoom, zoom)
    ctx.font = `${spec.italic ? 'italic ' : ''}${spec.bold ? '700' : '400'} ${fontPx}px "${spec.fontFamily}", Impact, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = spec.outlineWidth * scale * 2
    ctx.strokeStyle = spec.outlineColor
    ctx.fillStyle = spec.color
    lines.forEach((l, i) => {
      const y = (i - (lines.length - 1) / 2) * fontPx * 1.12
      if (spec.outlineWidth > 0) ctx.strokeText(l, 0, y)
      ctx.fillText(l, 0, y)
    })
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, tl: Timeline, assets: MediaAsset[], t: number, guides = false) {
    if (tl.tracks.some((x) => x.placement)) {
      this.drawLayers(ctx, W, H, tl, assets, t, guides)
      this.drawCaption(ctx, W, H, tl, t)
      return
    }
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    const layout = resolveLayout(tl.aspect, tl.layout, W, H, tl.webcamOverlay)
    const active = clipsAt(tl, t)

    for (const c of active) {
      const track = tl.tracks.find((x) => x.id === c.trackId)
      if (!track || track.kind !== 'video' || track.muted) continue
      const v = this.videos.get(c.id)
      if (!v || v.readyState < 2 || !v.videoWidth) continue
      if (track.role === 'webcam') {
        const r = layout.cam && tl.aspect === '9:16' && tl.layout !== 'fill' && tl.layout !== 'cam-overlay-corner' ? layout.cam : { x: (c.overlay ?? tl.webcamOverlay).x * W, y: (c.overlay ?? tl.webcamOverlay).y * H, w: (c.overlay ?? tl.webcamOverlay).w * W, h: (c.overlay ?? tl.webcamOverlay).h * H }
        const s = coverSource(v.videoWidth, v.videoHeight, r.w, r.h, c.crop)
        ctx.drawImage(v, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
      } else if (layout.screenFit === 'cover') {
        const r = layout.screen
        const s = coverSource(v.videoWidth, v.videoHeight, r.w, r.h)
        ctx.drawImage(v, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
      } else {
        const bg = coverSource(v.videoWidth, v.videoHeight, W, H)
        ctx.save()
        ctx.filter = `blur(${Math.round(W / 40)}px) brightness(0.75)`
        ctx.drawImage(v, bg.sx, bg.sy, bg.sw, bg.sh, 0, 0, W, H)
        ctx.restore()
        const d = containRect(v.videoWidth, v.videoHeight, layout.screen)
        ctx.drawImage(v, d.x, d.y, d.w, d.h)
      }
    }
    this.drawCaption(ctx, W, H, tl, t)
  }

  private drawCaption(ctx: CanvasRenderingContext2D, W: number, H: number, tl: Timeline, t: number) {
    const st = tl.captionStyle
    if (!st.enabled) return
    const cap = tl.captions.find((c) => t >= c.start && t < c.end)
    if (!cap) return
    const scale = Math.min(W, H) / 1080
    const { lines, fontPx, cx, cy } = captionLayout(st, cap, W, H)
    ctx.save()
    ctx.font = `${st.bold ? '700' : '400'} ${fontPx}px "${st.fontFamily}", Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = st.outlineWidth * scale * 2
    ctx.strokeStyle = st.outlineColor
    ctx.fillStyle = st.color
    lines.forEach((l, i) => {
      const ly = cy + (i - (lines.length - 1) / 2) * fontPx * 1.15
      ctx.strokeText(l, cx, ly)
      ctx.fillText(l, cx, ly)
    })
    ctx.restore()
  }

  dispose() {
    for (const v of this.videos.values()) (v.pause(), v.removeAttribute('src'))
    for (const a of this.audios.values()) (a.pause(), a.removeAttribute('src'))
    this.images.clear()
    this.videos.clear()
    this.audios.clear()
  }
}

export function previewSize(tl: Timeline): { width: number; height: number } {
  return aspectSize(tl.aspect, tl.aspect === '16:9' ? 540 : 540)
}

export const totalDuration = (tl: Timeline) => tl.tracks.reduce((m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + clipDuration(c)), m), 0)
