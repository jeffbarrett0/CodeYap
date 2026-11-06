import { localizeCaptions } from '../timeline/captions'
import type { Clip, ExportOptions, ID, MediaAsset, Timeline, Track } from '../types'
import { clipEnd, timelineDuration } from '../timeline/model'
import { resolveLayout, toPx, type PxRect } from './layout'
import { buildAss, type TextEvent } from './ass'

export interface ExportPlan {
  /** ffmpeg argümanları (ffmpeg yolu hariç). Dosya adları `files` ile aynı çalışma klasörüne göredir. */
  args: string[]
  /** Çalışma klasörüne yazılacak yardımcı dosyalar (filtre betiği, ASS altyazı) */
  files: { name: string; content: string }[]
  durationSec: number
  warnings: string[]
  /** Filtreler `rnnoise.rnnn` model dosyasını kullanıyor: çalışma klasörüne kopyalanmalı (yoksa arnndn adımı atlanır) */
  needsRnnoise?: boolean
}

type AssetLookup = (id: ID) => Pick<MediaAsset, 'path' | 'kind' | 'audioStreams'> & Partial<Pick<MediaAsset, 'width' | 'height'>> | undefined

interface Piece {
  clip: Clip
  track: Track
  /** çıkış zamanı */
  at: number
  srcIn: number
  dur: number
}

const f3 = (n: number) => n.toFixed(3)

/** Bir klibin, dışa aktarma aralığı [rs, re] ile kesişen kısmı. */
function slice(clip: Clip, track: Track, rs: number, re: number): Piece | null {
  const s = Math.max(clip.start, rs)
  const e = Math.min(clipEnd(clip), re)
  if (e - s < 0.04) return null
  return { clip, track, at: s - rs, srcIn: clip.srcIn + (s - clip.start), dur: e - s }
}

/**
 * Zaman çizelgesini (ya da bir aralığını) tek bir ffmpeg komutuna çevirir.
 *  - Her video klibi ayrı bir `-ss/-t -i` girişi olur (uzun kayıtta yalnızca gereken kısım çözülür).
 *  - Görüntü: siyah taban → ekran klipleri → kamera klipleri → altyazı (ASS).
 *  - Ses: iz seviyeleri uygulanıp `amix` ile karıştırılır, isteğe bağlı loudnorm.
 */
/** Renk havaları (ffmpeg filtreleri) */
const GRADES: Record<string, string> = {
  warm: 'colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06,eq=saturation=1.08',
  cool: 'colorbalance=rs=-0.06:bs=0.08:rm=-0.04:bm=0.06',
  vivid: 'eq=saturation=1.35:contrast=1.08',
  cinematic: 'eq=contrast=1.12:saturation=0.92:gamma=0.97,colorbalance=rs=-0.03:bs=0.05:rh=0.04:bh=-0.03',
  bw: 'hue=s=0,eq=contrast=1.1',
  vintage: 'eq=saturation=0.8:contrast=0.95:brightness=0.02,colorbalance=rs=0.06:gs=0.02:bs=-0.08',
  bright: 'eq=brightness=0.05:contrast=1.05:saturation=1.1'
}

/** Klip efektleri (zoom + görüntü geçişi + renk havası) için filtre parçası; boyut: klibin çıkış kutusu (w×h), süre: klip süresi */
function videoFx(c: Clip, dur: number, w: number, h: number, fps: number, alpha: boolean): string {
  const fx = c.fx
  if (!fx) return ''
  let f = fx.grade && GRADES[fx.grade] ? `,${GRADES[fx.grade]}` : ''
  const z = fx.zoom
  if (z && (Math.abs(z.from - 1) > 1e-3 || Math.abs(z.to - 1) > 1e-3)) {
    const z0 = Math.min(4, Math.max(1, z.from))
    const z1 = Math.min(4, Math.max(1, z.to))
    const n = Math.max(1, Math.round(dur * fps))
    const fxp = Math.min(1, Math.max(0, z.x))
    const fyp = Math.min(1, Math.max(0, z.y))
    // iki kat büyütülüp zoompan'a verilir: kare kayması/titreme olmasın; zoompan her giriş karesi için bir çıkış karesi (d=1) üretir
    f += `,scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='${z0.toFixed(4)}+(${(z1 - z0).toFixed(4)})*on/${n}':x='(iw-iw/zoom)*${fxp.toFixed(3)}':y='(ih-ih/zoom)*${fyp.toFixed(3)}':d=1:s=${w}x${h}:fps=${fps}`
  }
  if (fx.fadeIn && fx.fadeIn > 0) f += `,fade=t=in:st=0:d=${Math.min(fx.fadeIn, dur).toFixed(3)}${alpha ? ':alpha=1' : ''}`
  if (fx.fadeOut && fx.fadeOut > 0) f += `,fade=t=out:st=${Math.max(0, dur - fx.fadeOut).toFixed(3)}:d=${Math.min(fx.fadeOut, dur).toFixed(3)}${alpha ? ':alpha=1' : ''}`
  return f
}

/**
 * Arka plan sesini azaltma zinciri: yüksek geçiren (uğultu/rüzgâr) + RNNoise sinir ağı modeli (araba, kalabalık gibi konuşma dışı sesler)
 * + (orta/güçlü) spektral gürültü azaltma + (güçlü) gürültü kapısı; konuşma için hafif sıkıştırıcı. Model yolu göreli ve ASCII (Windows'ta sorunsuz).
 */
export function denoiseChain(level: 'light' | 'medium' | 'strong'): string {
  const m = 'arnndn=m=rnnoise.rnnn'
  if (level === 'light') return `,highpass=f=80,${m}:mix=0.7`
  if (level === 'medium') return `,highpass=f=90,${m}:mix=1,afftdn=nr=8:nf=-45,acompressor=threshold=0.12:ratio=2.5:attack=5:release=120:makeup=1.5`
  return `,highpass=f=100,${m}:mix=1,${m}:mix=0.6,afftdn=nr=14:nf=-40,agate=threshold=0.015:ratio=2.5:attack=8:release=200,acompressor=threshold=0.1:ratio=3:attack=5:release=100:makeup=2`
}

/** Ses giriş/çıkış geçişi (afade) */
function audioFx(c: Clip, dur: number): string {
  const fx = c.fx
  if (!fx) return ''
  let f = ''
  if (fx.fadeIn && fx.fadeIn > 0) f += `,afade=t=in:st=0:d=${Math.min(fx.fadeIn, dur).toFixed(3)}`
  if (fx.fadeOut && fx.fadeOut > 0) f += `,afade=t=out:st=${Math.max(0, dur - fx.fadeOut).toFixed(3)}:d=${Math.min(fx.fadeOut, dur).toFixed(3)}`
  return f
}

export function buildExportPlan(
  tl: Timeline,
  assetOf: AssetLookup,
  o: ExportOptions,
  outputPath: string,
  range?: { start: number; end: number }
): ExportPlan {
  const rs = range?.start ?? 0
  const re = range?.end ?? timelineDuration(tl)
  const D = Math.max(0.1, re - rs)
  // fps=0 (kaynak) normalde çağıran tarafından çözülür; çözülmediyse 30
  const fps = o.fps > 0 ? o.fps : 30
  const W = o.width
  const H = o.height
  const warnings: string[] = []

  const inputs: string[][] = []
  const addInput = (p: Piece, image = false): number | null => {
    const a = assetOf(p.clip.assetId)
    if (!a) {
      warnings.push(`Kaynak medya bulunamadı: ${p.clip.label}`)
      return null
    }
    const path = a.path.startsWith('-') ? `./${a.path}` : a.path
    // Durağan görsel: döngüye alınır ve klip süresince akıtılır
    inputs.push(image ? ['-loop', '1', '-framerate', String(fps), '-t', f3(p.dur), '-i', path] : ['-ss', f3(p.srcIn), '-t', f3(p.dur), '-i', path])
    return inputs.length - 1
  }
  const usePlacement = tl.tracks.some((t) => t.placement)
  const textEvents: TextEvent[] = []

  const layout = resolveLayout(tl.aspect, tl.layout, W, H, tl.webcamOverlay)
  const lines: string[] = []

  lines.push(`color=c=${(tl.background ?? '#000000').replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${f3(D)},format=yuv420p[base]`)
  let cur = 'base'
  let layer = 0

  const videoTracks = tl.tracks.filter((t) => t.kind === 'video' && !t.muted)
  const screenTracks = videoTracks.filter((t) => t.role !== 'webcam')
  const camTracks = videoTracks.filter((t) => t.role === 'webcam')

  const place = (label: string, at: number, rect: PxRect) => {
    const shifted = `${label}s`
    lines.push(`[${label}]setpts=PTS-STARTPTS+${f3(at)}/TB[${shifted}]`)
    const next = `L${++layer}`
    lines.push(`[${cur}][${shifted}]overlay=${rect.x}:${rect.y}:eof_action=pass:repeatlast=0[${next}]`)
    cur = next
  }

  if (usePlacement) {
    // ── katmanlar: alttan üste (iz listesinin sonu en alttaki katmandır)
    for (const t of [...tl.tracks].reverse()) {
      if (!t.placement || !t.placement.visible) continue
      if (t.kind !== 'video' && t.kind !== 'image' && t.kind !== 'text') continue
      const r = toPx(t.placement.rect, W, H)
      for (const c of t.clips) {
        const p = slice(c, t, rs, re)
        if (!p) continue
        if (t.kind === 'text') {
          if (c.text && c.text.text.trim()) textEvents.push({ start: p.at, end: p.at + p.dur, spec: c.text, rect: r })
          continue
        }
        const idx = addInput(p, t.kind === 'image')
        if (idx === null) continue
        const L = layer + 1
        const crop = c.crop ? `crop=iw*${c.crop.w.toFixed(5)}:ih*${c.crop.h.toFixed(5)}:iw*${c.crop.x.toFixed(5)}:ih*${c.crop.y.toFixed(5)},` : ''
        const alpha = t.kind === 'image' || t.placement.opacity < 1 ? 'format=rgba,' : ''
        const fade = t.placement.opacity < 1 ? `,colorchannelmixer=aa=${t.placement.opacity.toFixed(3)}` : ''
        const fit =
          t.placement.fit === 'cover'
            ? `scale=${r.w}:${r.h}:flags=lanczos:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}`
            : `scale=${r.w}:${r.h}:flags=lanczos:force_original_aspect_ratio=decrease`
        // efekt (zoom) için kare boyutu: cover = kutu; contain = kaynağın (kırpılmış) oranıyla kutuya sığan boyut
        const asrc = assetOf(c.assetId)
        const sw = (asrc?.width ?? 0) * (c.crop?.w ?? 1)
        const sh = (asrc?.height ?? 0) * (c.crop?.h ?? 1)
        const k = t.placement.fit === 'cover' || sw <= 0 || sh <= 0 ? 0 : Math.min(r.w / sw, r.h / sh)
        const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
        const fx = k > 0 ? { w: even(sw * k), h: even(sh * k) } : { w: r.w, h: r.h }
        lines.push(`[${idx}:v]${alpha}setpts=PTS-STARTPTS,fps=${fps},${crop}${fit}${fade}${videoFx(c, p.dur, fx.w, fx.h, fps, alpha !== '')},setpts=PTS+${f3(p.at)}/TB[ly${L}]`)
        const next = `L${++layer}`
        const pos = t.placement.fit === 'cover' ? `${r.x}:${r.y}` : `x=${r.x}+(${r.w}-overlay_w)/2:y=${r.y}+(${r.h}-overlay_h)/2`
        lines.push(`[${cur}][ly${L}]overlay=${pos}:eof_action=pass:repeatlast=0[${next}]`)
        cur = next
      }
    }
  } else {
  // ── ekran
  for (const t of screenTracks) {
    for (const c of t.clips) {
      const p = slice(c, t, rs, re)
      const idx = p && addInput(p)
      if (!p || idx === null) continue
      const L = layer + 1
      const r = layout.screen
      const head = `[${idx}:v]setpts=PTS-STARTPTS,fps=${fps}`
      if (layout.screenFit === 'cover') {
        lines.push(`${head},scale=${r.w}:${r.h}:flags=lanczos:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}[sv${L}]`)
      } else {
        // oran korunur; boş alanlar aynı görüntünün bulanık hâliyle doldurulur
        lines.push(`${head},split=2[sa${L}][sb${L}]`)
        lines.push(`[sa${L}]scale=${W}:${H}:flags=lanczos:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:4,eq=brightness=-0.12[bg${L}]`)
        lines.push(`[sb${L}]scale=${r.w}:${r.h}:flags=lanczos:force_original_aspect_ratio=decrease[fg${L}]`)
        lines.push(`[bg${L}][fg${L}]overlay=x=${r.x}+(${r.w}-overlay_w)/2:y=${r.y}+(${r.h}-overlay_h)/2[sv${L}]`)
        place(`sv${L}`, p.at, { x: 0, y: 0, w: W, h: H })
        continue
      }
      place(`sv${L}`, p.at, { x: r.x, y: r.y, w: r.w, h: r.h })
    }
  }

  // ── kamera
  for (const t of camTracks) {
    for (const c of t.clips) {
      const p = slice(c, t, rs, re)
      const idx = p && addInput(p)
      if (!p || idx === null) continue
      const L = layer + 1
      const rect = layout.cam && tl.aspect === '9:16' && tl.layout !== 'fill' && tl.layout !== 'cam-overlay-corner' ? layout.cam : toPx(c.overlay ?? tl.webcamOverlay, W, H)
      const crop = c.crop ? `crop=iw*${c.crop.w.toFixed(5)}:ih*${c.crop.h.toFixed(5)}:iw*${c.crop.x.toFixed(5)}:ih*${c.crop.y.toFixed(5)},` : ''
      lines.push(`[${idx}:v]setpts=PTS-STARTPTS,fps=${fps},${crop}scale=${rect.w}:${rect.h}:flags=lanczos:force_original_aspect_ratio=increase,crop=${rect.w}:${rect.h}[cv${L}]`)
      place(`cv${L}`, p.at, rect)
    }
  }

  }

  // ── altyazı
  const files: ExportPlan['files'] = []
  const hasCaptions = tl.captionStyle.enabled && tl.captions.length > 0
  if (hasCaptions || textEvents.length > 0) {
    const ass = buildAss(hasCaptions ? localizeCaptions(tl) : [], tl.captionStyle, W, H, rs, re, textEvents)
    files.push({ name: 'captions.ass', content: ass })
    lines.push(`[${cur}]ass=captions.ass[vtxt]`)
    cur = 'vtxt'
  }
  lines.push(`[${cur}]format=yuv420p[vout]`)

  // ── ses
  const audioLabels: string[] = []
  const audioTracks = tl.tracks.filter((t) => !t.muted && (t.kind === 'audio' || t.kind === 'video'))
  for (const t of audioTracks) {
    for (const c of t.clips) {
      // Video kliplerinden yalnızca açıkça bir ses akışı seçilmişse ses alınır
      if (t.kind === 'video' && c.audioStream === undefined) continue
      const p = slice(c, t, rs, re)
      if (!p) continue
      const a = assetOf(c.assetId)
      if (!a || a.audioStreams.length === 0) continue
      // Ses için ayrı giriş: aynı dosya yeniden açılır (ses akışı seçimi için)
      const idx = addInput(p)
      if (idx === null) continue
      const stream = Math.min(c.audioStream ?? 0, a.audioStreams.length - 1)
      const vol = Math.max(0, t.volume * c.volume)
      const delay = Math.round(p.at * 1000)
      const label = `au${audioLabels.length}`
      lines.push(
        `[${idx}:a:${stream}]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo${c.fx?.denoise ? denoiseChain(c.fx.denoise) : ''},volume=${vol.toFixed(3)}${audioFx(c, p.dur)}${delay > 0 ? `,adelay=${delay}|${delay}` : ''}[${label}]`
      )
      audioLabels.push(label)
    }
  }
  if (audioLabels.length === 0) {
    lines.push(`anullsrc=r=48000:cl=stereo,atrim=0:${f3(D)}[amix]`)
  } else if (audioLabels.length === 1) {
    lines.push(`[${audioLabels[0]}]anull[amix]`)
  } else {
    lines.push(`${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0:dropout_transition=0[amix]`)
  }
  lines.push(`[amix]${o.normalizeAudio ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}alimiter=limit=0.95,apad=whole_dur=${f3(D)},atrim=0:${f3(D)}[aout]`)

  files.push({ name: 'filters.txt', content: lines.join(';\n') + '\n' })

  // crf açıkken bitrate yalnızca ÜST SINIRDIR (kaliteyi crf belirler); crf=0 ise hedef bitrate
  const cap = Math.max(1000, o.videoBitrateKbps)
  const rate = o.crf > 0 ? ['-crf', String(o.crf), '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`] : ['-b:v', `${cap}k`, '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`]

  const args = [
    '-hide_banner',
    '-nostats',
    '-progress',
    'pipe:1',
    '-y',
    ...inputs.flat(),
    '-filter_complex_script',
    'filters.txt',
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    o.encoderPreset ?? 'slow',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    // HD için renk bilgisi açıkça etiketlenir (oynatıcılar arası renk kayması olmasın)
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-r',
    String(fps),
    ...rate,
    '-c:a',
    'aac',
    '-b:a',
    `${o.audioBitrateKbps}k`,
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-t',
    f3(D),
    outputPath
  ]
  const needsRnnoise = lines.some((l) => l.includes('rnnoise.rnnn'))
  return { args, files, durationSec: D, warnings, needsRnnoise }
}
