import { denoiseKey, denoiseReady } from './denoiseState'
import type { ClipforgeApi } from '@shared/ipc'
import { resolveLayout } from '@shared/export/layout'
import { aspectSize, clipDuration, clipEnd } from '@shared/timeline/model'
import { clipsAt, timelineToSource } from '@shared/timeline/ops'
import { localizeCaption, wrapCaption } from '@shared/timeline/captions'
import { captionLayout, highlightedLines, wrapTextForRect } from '@shared/export/ass'
import { captionFont } from './measure'
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
  private lastClip = new WeakMap<HTMLMediaElement, string>()
  private lastSeek = new WeakMap<HTMLMediaElement, number>()
  /** Kırpma modunda düzenlenen klip: tamamı (kırpmasız, sığdırılmış) gösterilir */
  cropClipId: string | null = null

  constructor(private api: ClipforgeApi) {}

  private mediaFor(clip: Clip, assets: MediaAsset[], kind: 'video' | 'audio', index = 0): string | null {
    const a = assets.find((x) => x.id === clip.assetId)
    if (!a) return null
    // arka plan sesi azaltma açıksa ve temizlenmiş önizleme kopyası hazırsa o çalınır
    const dn = kind === 'audio' ? this.denoiseVariant(clip, index) : undefined
    return this.api.mediaUrl(a, kind, index, dn)
  }

  private denoiseVariant(clip: Clip, index: number): string | undefined {
    const lv = clip.fx?.denoise
    return lv && denoiseReady.has(denoiseKey(clip.assetId, index, lv)) ? lv : undefined
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
        // Öğe klip başına değil katman+kaynak başına tutulur: kesimden sonra yeni klip aynı öğeyi yeniden kullanır
        // (her kesimde yeni <video> yüklemek ~1 sn siyah ekran yapıyordu)
        const vk = this.key(c)
        want.add(vk)
        let v = this.videos.get(vk)
        const src = this.mediaFor(c, assets, 'video')
        if (!v) {
          v = document.createElement('video')
          v.muted = true
          v.playsInline = true
          v.preload = 'auto'
          this.videos.set(vk, v)
        }
        // oynatma sırasında kaynak değiştirilmez (proxy hazır olunca adres değişir; yeniden yükleme takılma yapar)
        if (src && v.getAttribute('data-src') !== src && (!playing || !v.getAttribute('data-src'))) {
          v.setAttribute('data-src', src)
          v.src = src
        }
        this.align(v, target, playing, rate, c.id)
      } else if (track.kind === 'audio') {
        const ak = `${this.key(c)}|${c.audioStream ?? 0}|${this.denoiseVariant(c, c.audioStream ?? 0) ?? ''}`
        want.add(ak)
        let a = this.audios.get(ak)
        const src = this.mediaFor(c, assets, 'audio', c.audioStream ?? 0)
        if (!a) {
          a = new Audio()
          a.preload = 'auto'
          this.audios.set(ak, a)
        }
        if (src && a.getAttribute('data-src') !== src && (!playing || !a.getAttribute('data-src'))) {
          a.setAttribute('data-src', src)
          a.src = src
        }
        a.volume = c.muted ? 0 : Math.min(1, Math.max(0, track.volume * c.volume))
        this.align(a, target, playing, rate, c.id)
      }
    }
    // Artık etkin olmayan öğeleri bırak
    for (const [id, v] of this.videos) if (!want.has(id)) (v.pause(), v.removeAttribute('src'), v.load(), this.videos.delete(id))
    for (const [id, a] of this.audios) if (!want.has(id)) (a.pause(), a.removeAttribute('src'), a.load(), this.audios.delete(id))
  }

  private key(c: Clip) {
    return `${c.trackId}|${c.assetId}`
  }

  private align(el: HTMLMediaElement, target: number, playing: boolean, rate: number, clipId: string) {
    el.playbackRate = rate
    const drift = Math.abs(el.currentTime - target)
    // klip değiştiyse (kesim/sonraki parça) hemen doğru yere git; sınırlama yalnızca ağır videoda aynı klip içindeki sapma içindir
    const changed = this.lastClip.get(el) !== clipId
    this.lastClip.set(el, clipId)
    if (changed && playing && drift > 0.05) {
      this.lastSeek.set(el, performance.now())
      el.currentTime = target
      if (el.paused) void el.play().catch(() => undefined)
      return
    }
    if (!playing) {
      if (drift > 0.03) el.currentTime = target
      if (!el.paused) el.pause()
    } else {
      // ağır videoda geride kalınca her karede yeniden aramak takılmayı büyütür: en çok ~1,5 sn'de bir düzelt
      const now = performance.now()
      if (drift > 0.3 && (drift > 2 || (!el.seeking && now - (this.lastSeek.get(el) ?? 0) > 1500))) {
        this.lastSeek.set(el, now)
        el.currentTime = target
      }
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
            const v = this.videos.get(this.key(c))
            if (v && (v.readyState >= 2 || (v.seeking && v.readyState >= 1)) && v.videoWidth) (src = v, sw = v.videoWidth, sh = v.videoHeight)
          } else if (track.kind === 'image') {
            const a = assets.find((x) => x.id === c.assetId)
            const url = a ? this.api.mediaUrl(a, 'image') : null
            const img = url ? this.imageFor(url) : null
            if (img && img.complete && img.naturalWidth) (src = img, sw = img.naturalWidth, sh = img.naturalHeight)
          }
          if (src) {
            const cropping = c.id === this.cropClipId
            const crop = cropping ? undefined : c.crop
            const keyed = !!c.fx?.chroma && !cropping
            if (pl.fit === 'cover' && !cropping) {
              const s = coverSource(sw, sh, r.w, r.h, crop)
              if (keyed) this.drawKeyed(ctx, src, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
              else ctx.drawImage(src, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
            } else {
              // sığdır: kırpma varsa yalnızca kırpılmış bölge sığdırılır
              const bx = crop ? crop.x * sw : 0
              const by = crop ? crop.y * sh : 0
              const bw = crop ? crop.w * sw : sw
              const bh = crop ? crop.h * sh : sh
              const d = containRect(bw, bh, r)
              if (c.fx?.blurFill && !cropping) {
                const s0 = coverSource(sw, sh, r.w, r.h, crop)
                ctx.save()
                ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip()
                ctx.filter = `blur(${Math.max(4, Math.round(r.w / 40))}px) brightness(0.85)`
                ctx.drawImage(src, s0.sx, s0.sy, s0.sw, s0.sh, r.x, r.y, r.w, r.h)
                ctx.restore()
              }
              if (keyed) this.drawKeyed(ctx, src, bx, by, bw, bh, d.x, d.y, d.w, d.h)
              else ctx.drawImage(src, bx, by, bw, bh, d.x, d.y, d.w, d.h)
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

  private keyCanvas: HTMLCanvasElement | null = null

  /** Yeşil perde önizlemesi: hedef boyutta bir tuvale çizilip yeşil baskın pikseller şeffaflaştırılır (dışa aktarmadaki chromakey'in yaklaşığı) */
  private drawKeyed(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
    const w = Math.max(1, Math.round(dw))
    const h = Math.max(1, Math.round(dh))
    const kc = (this.keyCanvas ??= document.createElement('canvas'))
    if (kc.width !== w || kc.height !== h) (kc.width = w, kc.height = h)
    const k = kc.getContext('2d', { willReadFrequently: true })
    if (!k) return ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)
    k.clearRect(0, 0, w, h)
    k.drawImage(src, sx, sy, sw, sh, 0, 0, w, h)
    const img = k.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const gd = d[i + 1] - Math.max(d[i], d[i + 2])
      if (gd > 90) d[i + 3] = 0
      else if (gd > 40) {
        d[i + 3] = Math.round(255 * (1 - (gd - 40) / 50))
        d[i + 1] = Math.min(d[i + 1], Math.max(d[i], d[i + 2]) + 10)
      }
    }
    k.putImageData(img, 0, 0)
    ctx.drawImage(kc, 0, 0, w, h, dx, dy, dw, dh)
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
      const v = this.videos.get(this.key(c))
      if (!v || (v.readyState < 2 && !(v.seeking && v.readyState >= 1)) || !v.videoWidth) continue
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
    const found = tl.captions.find((c) => t >= c.start && t < c.end)
    if (!found) return
    const cap = localizeCaption(found, tl.captionLang)
    const scale = Math.min(W, H) / 1080
    const { lines, fontPx, cx, cy } = captionLayout(st, cap, W, H)
    const upper = st.uppercase ? cap.text.toLocaleUpperCase('tr-TR') : cap.text
    const segs = highlightedLines(upper, lines, cap.hl)
    ctx.save()
    ctx.font = captionFont(st, fontPx)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const lh = fontPx * 1.15
    const space = ctx.measureText(' ').width
    const widthOf = (line: { text: string }[]) => line.reduce((n, w, i) => n + ctx.measureText(w.text).width + (i ? space : 0), 0)
    // kutu: metne oturan tek dikdörtgen (dışa aktarmadaki BorderStyle 3 kutusuyla aynı mantık)
    if (st.box?.enabled) {
      const pad = fontPx * 0.22
      ctx.globalAlpha = Math.min(1, Math.max(0, st.box.opacity))
      ctx.fillStyle = st.box.color
      segs.forEach((line, i) => {
        const w = widthOf(line) + pad * 2
        const ly = cy + (i - (segs.length - 1) / 2) * lh
        ctx.fillRect(cx - w / 2, ly - lh / 2 - pad * 0.1, w, lh + pad * 0.2)
      })
      ctx.globalAlpha = 1
    }
    ctx.lineWidth = st.outlineWidth * scale * 2
    ctx.strokeStyle = st.outlineColor
    segs.forEach((line, i) => {
      const ly = cy + (i - (segs.length - 1) / 2) * lh
      let x = cx - widthOf(line) / 2
      for (const w of line) {
        if (st.shadow) {
          ctx.fillStyle = 'rgba(0,0,0,.45)'
          ctx.fillText(w.text, x + st.shadow * scale, ly + st.shadow * scale)
        }
        ctx.strokeText(w.text, x, ly)
        ctx.fillStyle = w.color ?? st.color
        ctx.fillText(w.text, x, ly)
        x += ctx.measureText(w.text).width + space
      }
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
