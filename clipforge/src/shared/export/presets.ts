import type { ExportOptions } from '../types'

export interface ExportPreset {
  id: string
  name: string
  description: string
  options: Omit<ExportOptions, 'presetId'>
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'shorts',
    name: 'TikTok / Reels / Shorts',
    description: '9:16 · 1080×1920 · 30 fps · en fazla 60 sn',
    options: { aspect: '9:16', width: 1080, height: 1920, fps: 30, videoBitrateKbps: 8000, audioBitrateKbps: 160, crf: 0, maxDurationSec: 60, normalizeAudio: true }
  },
  {
    id: 'youtube',
    name: 'YouTube (16:9)',
    description: '16:9 · 1920×1080 · 30 fps',
    options: { aspect: '16:9', width: 1920, height: 1080, fps: 30, videoBitrateKbps: 12000, audioBitrateKbps: 192, crf: 0, normalizeAudio: true }
  },
  {
    id: 'youtube60',
    name: 'YouTube (16:9, 60 fps)',
    description: '16:9 · 1920×1080 · 60 fps',
    options: { aspect: '16:9', width: 1920, height: 1080, fps: 60, videoBitrateKbps: 18000, audioBitrateKbps: 192, crf: 0, normalizeAudio: true }
  },
  {
    id: 'square',
    name: 'Kare (1:1)',
    description: '1:1 · 1080×1080 · 30 fps',
    options: { aspect: '1:1', width: 1080, height: 1080, fps: 30, videoBitrateKbps: 6000, audioBitrateKbps: 160, crf: 0, normalizeAudio: true }
  }
]

export function presetById(id: string): ExportPreset {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[0]
}

export function optionsFromPreset(id: string, overrides: Partial<ExportOptions> = {}): ExportOptions {
  const p = presetById(id)
  return { ...p.options, ...overrides, presetId: p.id }
}

/** Dışa aktarma öncesi gösterilen kısa hatırlatma (hukuki tavsiye değildir). */
export const COPYRIGHT_NOTICE =
  'Hatırlatma: Klibinizdeki müzik, oyun görüntüleri/sesleri ve başkalarına ait diğer içerikler telif hakkına tabi olabilir. ' +
  'Platformlar (TikTok, Instagram, YouTube) bu içeriği sessize alabilir, kaldırabilir veya hesabınıza yaptırım uygulayabilir. ' +
  'Bu bir hatırlatmadır, hukuki tavsiye değildir; yayımlamadan önce ilgili lisans ve platform kurallarını kontrol edin.'

export function exportWarnings(durationSec: number, o: ExportOptions): string[] {
  const w: string[] = []
  if (o.maxDurationSec && durationSec > o.maxDurationSec + 1e-6) {
    w.push(`Klip ${durationSec.toFixed(1)} sn; seçili şablonun sınırı ${o.maxDurationSec} sn. Platform yüklemeyi reddedebilir ya da keser.`)
  }
  if (durationSec <= 0) w.push('Zaman çizelgesi boş: dışa aktarılacak klip yok.')
  return w
}
