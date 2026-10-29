import type { AudioStreamInfo, Chapter, MediaAsset, ObsEncoder, ObsInfo } from '../types'

/** ffprobe -show_format -show_streams -show_chapters -of json çıktısının kullandığımız kısmı */
export interface FfprobeJson {
  streams?: FfprobeStream[]
  format?: { format_name?: string; format_long_name?: string; duration?: string; size?: string; bit_rate?: string; tags?: Record<string, string> }
  chapters?: { start_time?: string; end_time?: string; tags?: Record<string, string> }[]
}
export interface FfprobeStream {
  index: number
  codec_type?: string
  codec_name?: string
  profile?: string
  width?: number
  height?: number
  pix_fmt?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  duration?: string
  channels?: number
  sample_rate?: string
  disposition?: { attached_pic?: number }
  tags?: Record<string, string>
}

export type ProbedMedia = Omit<MediaAsset, 'id' | 'path' | 'name' | 'importedAt' | 'transcriptionTrack' | 'audioMap'>

function frac(s?: string): number {
  if (!s) return 0
  const [a, b] = s.split('/').map(Number)
  return b ? a / b : a || 0
}

/** Etiket anahtarlarını büyük/küçük harf duyarsız okur (MKV: ENCODER, MP4: encoder) */
function tag(tags: Record<string, string> | undefined, key: string): string | undefined {
  if (!tags) return undefined
  const k = Object.keys(tags).find((x) => x.toLowerCase() === key.toLowerCase())
  return k ? tags[k] : undefined
}

/**
 * OBS kaydı olup olmadığını ve sürüm/kodlayıcıyı mümkün olduğunca etiketlerden, dosya adından ve
 * (verilmişse) dosyanın ilk baytlarındaki kodlayıcı imzasından çıkarır. Kesin değildir; dayanaklar listelenir.
 */
export function detectObs(probe: FfprobeJson, fileName: string, headBytes?: Uint8Array): ObsInfo {
  const evidence: string[] = []
  let isObs = false
  let version: string | undefined
  let encoder: ObsEncoder = 'unknown'

  const fmtTags = probe.format?.tags
  const all = [...Object.values(fmtTags ?? {}), ...(probe.streams ?? []).flatMap((s) => Object.values(s.tags ?? {}))].join('\n')

  const m = /libobs version ([\d.]+)/i.exec(all)
  if (m) {
    isObs = true
    version = m[1]
    evidence.push(`Etiket: libobs ${m[1]}`)
  } else if (/\bobs\b|obs-output|obs studio/i.test(all)) {
    isObs = true
    evidence.push('Etiket: OBS')
  }
  if (/^\d{4}-\d{2}-\d{2}[ _]\d{2}-\d{2}-\d{2}/.test(fileName) || /^replay[ _]\d{4}/i.test(fileName)) {
    isObs = isObs || /\.(mkv|flv|mp4|mov)$/i.test(fileName)
    evidence.push('Dosya adı OBS varsayılan biçiminde')
  }

  const sig = scanEncoderSignature(all + '\n' + (headBytes ? latin1(headBytes) : ''))
  if (sig) {
    encoder = sig.encoder
    evidence.push(sig.evidence)
  } else if (headBytes) {
    evidence.push('x264 imzası bulunamadı: donanım kodlayıcı (NVENC/AMF/QSV) olabilir; ayrım yapılamadı')
  }
  return { isObs, version, encoder, evidence }
}

function latin1(b: Uint8Array): string {
  let s = ''
  const n = Math.min(b.length, 1 << 20)
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[i])
  return s
}

export function scanEncoderSignature(text: string): { encoder: ObsEncoder; evidence: string } | null {
  if (/h264_nvenc|hevc_nvenc|av1_nvenc|jim_nvenc|nvenc/i.test(text)) return { encoder: 'nvenc', evidence: 'Kodlayıcı imzası: NVENC' }
  if (/h264_amf|hevc_amf|av1_amf|\bamf\b/i.test(text)) return { encoder: 'amf', evidence: 'Kodlayıcı imzası: AMF' }
  if (/h264_qsv|hevc_qsv|av1_qsv|\bqsv\b/i.test(text)) return { encoder: 'qsv', evidence: 'Kodlayıcı imzası: QuickSync' }
  if (/videotoolbox/i.test(text)) return { encoder: 'apple', evidence: 'Kodlayıcı imzası: VideoToolbox' }
  if (/x264 - core \d+|libx264/i.test(text)) return { encoder: 'x264', evidence: 'Kodlayıcı imzası: x264' }
  return null
}

export function parseProbe(probe: FfprobeJson, fileName: string, headBytes?: Uint8Array): ProbedMedia {
  const streams = probe.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.filter((s) => s.codec_type === 'audio')
  const durFmt = Number(probe.format?.duration)
  const durVideo = Number(video?.duration)
  const durationSec = Number.isFinite(durFmt) && durFmt > 0 ? durFmt : Number.isFinite(durVideo) ? durVideo : 0

  const audioStreams: AudioStreamInfo[] = audio.map((s, i) => ({
    index: i,
    streamIndex: s.index,
    codec: s.codec_name ?? 'unknown',
    channels: s.channels ?? 0,
    sampleRate: Number(s.sample_rate) || 0,
    title: tag(s.tags, 'title') ?? tag(s.tags, 'handler_name')
  }))

  const chapters: Chapter[] = (probe.chapters ?? []).map((c) => ({
    start: Number(c.start_time) || 0,
    end: Number(c.end_time) || 0,
    title: tag(c.tags, 'title') ?? ''
  }))

  const fmtName = probe.format?.format_name ?? ''
  const container = fmtName.includes('matroska') ? 'mkv' : fmtName.includes('flv') ? 'flv' : fmtName.includes('mov') ? 'mp4/mov' : fmtName.split(',')[0] || 'unknown'

  return {
    kind: video ? 'video' : 'audio',
    container,
    durationSec,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: frac(video?.avg_frame_rate) || frac(video?.r_frame_rate) || 0,
    videoCodec: video?.codec_name,
    videoProfile: video?.profile,
    pixelFormat: video?.pix_fmt,
    bitrate: Number(probe.format?.bit_rate) || undefined,
    sizeBytes: Number(probe.format?.size) || 0,
    audioStreams,
    obs: detectObs(probe, fileName, headBytes),
    chapters
  }
}

export const SUPPORTED_EXTENSIONS = ['mp4', 'mov', 'mkv', 'flv', 'm4v', 'webm', 'ts']

export function isSupportedMedia(fileName: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(fileName.toLowerCase().split('.').pop() ?? '')
}

/** Çoklu ses track'li kayıtlarda varsayılan eşleme: Track 1 = karışım; 2 = oyun; 3 = mikrofon (OBS konvansiyonu) */
export function defaultAudioMap(streams: AudioStreamInfo[]): MediaAsset['audioMap'] {
  if (streams.length >= 3) return { mix: 0, game: 1, voice: 2 }
  return { mix: 0 }
}
