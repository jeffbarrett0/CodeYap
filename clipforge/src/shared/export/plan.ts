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
}

type AssetLookup = (id: ID) => Pick<MediaAsset, 'path' | 'kind' | 'audioStreams'> | undefined

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
    inputs.push(image ? ['-loop', '1', '-framerate', String(o.fps), '-t', f3(p.dur), '-i', path] : ['-ss', f3(p.srcIn), '-t', f3(p.dur), '-i', path])
    return inputs.length - 1
  }
  const usePlacement = tl.tracks.some((t) => t.placement)
  const textEvents: TextEvent[] = []

  const layout = resolveLayout(tl.aspect, tl.layout, W, H, tl.webcamOverlay)
  const lines: string[] = []

  lines.push(`color=c=${(tl.background ?? '#000000').replace('#', '0x')}:s=${W}x${H}:r=${o.fps}:d=${f3(D)},format=yuv420p[base]`)
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
          if (c.text) textEvents.push({ start: p.at, end: p.at + p.dur, spec: c.text, rect: r })
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
            ? `scale=${r.w}:${r.h}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}`
            : `scale=${r.w}:${r.h}:force_original_aspect_ratio=decrease`
        lines.push(`[${idx}:v]${alpha}setpts=PTS-STARTPTS,fps=${o.fps},${crop}${fit}${fade},setpts=PTS+${f3(p.at)}/TB[ly${L}]`)
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
      const head = `[${idx}:v]setpts=PTS-STARTPTS,fps=${o.fps}`
      if (layout.screenFit === 'cover') {
        lines.push(`${head},scale=${r.w}:${r.h}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}[sv${L}]`)
      } else {
        // oran korunur; boş alanlar aynı görüntünün bulanık hâliyle doldurulur
        lines.push(`${head},split=2[sa${L}][sb${L}]`)
        lines.push(`[sa${L}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:4,eq=brightness=-0.12[bg${L}]`)
        lines.push(`[sb${L}]scale=${r.w}:${r.h}:force_original_aspect_ratio=decrease[fg${L}]`)
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
      lines.push(`[${idx}:v]setpts=PTS-STARTPTS,fps=${o.fps},${crop}scale=${rect.w}:${rect.h}:force_original_aspect_ratio=increase,crop=${rect.w}:${rect.h}[cv${L}]`)
      place(`cv${L}`, p.at, rect)
    }
  }

  }

  // ── altyazı
  const files: ExportPlan['files'] = []
  const hasCaptions = tl.captionStyle.enabled && tl.captions.length > 0
  if (hasCaptions || textEvents.length > 0) {
    const ass = buildAss(hasCaptions ? tl.captions : [], tl.captionStyle, W, H, rs, re, textEvents)
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
        `[${idx}:a:${stream}]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol.toFixed(3)}${delay > 0 ? `,adelay=${delay}|${delay}` : ''}[${label}]`
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

  const rate =
    o.crf > 0
      ? ['-crf', String(o.crf), '-maxrate', `${Math.round(o.videoBitrateKbps * 1.5)}k`, '-bufsize', `${o.videoBitrateKbps * 3}k`]
      : ['-b:v', `${o.videoBitrateKbps}k`, '-maxrate', `${o.videoBitrateKbps}k`, '-bufsize', `${o.videoBitrateKbps * 2}k`]

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
    'medium',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(o.fps),
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
  return { args, files, durationSec: D, warnings }
}
