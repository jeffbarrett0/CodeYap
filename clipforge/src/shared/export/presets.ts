import type { ExportOptions } from '../types'

export interface ExportPreset {
  id: string
  name: string
  description: string
  options: Omit<ExportOptions, 'presetId'>
}

/**
 * Tüm şablonlar MAKSİMUM KALİTE hedefler: x264 CRF 14 (görsel olarak kayıpsıza yakın), "slow" ön ayarı, yüksek bitrate üst sınırı,
 * kaynağın kare hızı (≤60), 320 kbps AAC ve yüksek kaliteli (Lanczos) ölçekleme. Karşılığında dosyalar büyük, kodlama yavaştır.
 * 4K şablonları, kaynak 1080p'den yüksek değilse yalnızca yeniden ölçekler (ek ayrıntı üretmez); yine de platformlar 4K'yı daha az sıkıştırır.
 */
const MAX = { crf: 14, encoderPreset: 'slow' as const, audioBitrateKbps: 320, fps: 0, normalizeAudio: true }

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'shorts',
    name: 'TikTok / Reels / Shorts — maksimum kalite',
    description: '9:16 · 1080×1920 · kaynak kare hızı (≤60) · en fazla 60 sn',
    options: { ...MAX, aspect: '9:16', width: 1080, height: 1920, videoBitrateKbps: 150000, maxDurationSec: 60 }
  },
  {
    id: 'shorts4k',
    name: 'Dikey 4K — maksimum kalite',
    description: '9:16 · 2160×3840 · kaynak kare hızı · en fazla 60 sn (büyük dosya)',
    options: { ...MAX, aspect: '9:16', width: 2160, height: 3840, videoBitrateKbps: 240000, maxDurationSec: 60 }
  },
  {
    id: 'youtube',
    name: 'YouTube 16:9 — maksimum kalite',
    description: '16:9 · 1920×1080 · kaynak kare hızı (≤60)',
    options: { ...MAX, aspect: '16:9', width: 1920, height: 1080, videoBitrateKbps: 150000 }
  },
  {
    id: 'youtube4k',
    name: 'YouTube 4K — maksimum kalite',
    description: '16:9 · 3840×2160 · kaynak kare hızı (büyük dosya)',
    options: { ...MAX, aspect: '16:9', width: 3840, height: 2160, videoBitrateKbps: 240000 }
  },
  {
    id: 'square',
    name: 'Kare (1:1) — maksimum kalite',
    description: '1:1 · 1080×1080 · kaynak kare hızı (≤60)',
    options: { ...MAX, aspect: '1:1', width: 1080, height: 1080, videoBitrateKbps: 150000 }
  }
]

/** fps=0 ise kaynağın kare hızı (kullanılan videoların en yükseği, 24–60 arası, tam sayıya yuvarlanır); kaynak yoksa 30 */
export function resolveExportFps(fps: number, sourceFps: number[]): number {
  if (fps > 0) return fps
  const best = Math.max(0, ...sourceFps.filter((f) => f > 0))
  return best > 0 ? Math.min(60, Math.max(24, Math.round(best))) : 30
}

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
