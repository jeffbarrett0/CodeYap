import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  language: 'tr',
  whisperModel: 'small',
  provider: 'whisper-cpp',
  whisperCppPath: '',
  whisperModelDir: '',
  fasterWhisperPython: 'python3',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  ffmpegPath: '',
  ffprobePath: '',
  fuzzyThreshold: 0.8,
  fuzzyEnabled: true,
  windowSec: 10,
  preRollSec: 5,
  postRollSec: 10,
  targetDurationSec: 0,
  semanticSearch: false,
  embeddingBaseUrl: 'https://api.openai.com/v1',
  embeddingApiKey: '',
  embeddingModel: 'text-embedding-3-small',
  chatColumns: {},
  exportDefaults: { presetId: 'shorts' },
  suggestKeywords: [],
  proxyHeight: 540,
  silenceMinGapSec: 0.7,
  silenceKeepSec: 0.15,
  cutFillers: true,
  vocabulary: '',
  transcribeFillers: true
}

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium'] as const

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'auto', name: 'Otomatik algıla' }
]

/** Bilinmeyen / eksik alanları varsayılanla tamamlar; tür uyumsuzlarını atar. */
export function normalizeSettings(raw: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!(k in DEFAULT_SETTINGS)) continue
      const d = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]
      if (typeof v === typeof d && (Array.isArray(v) === Array.isArray(d))) out[k] = v
    }
  }
  const s = out as unknown as Settings
  s.fuzzyThreshold = Math.min(1, Math.max(0.5, s.fuzzyThreshold))
  s.preRollSec = Math.max(0, s.preRollSec)
  s.postRollSec = Math.max(0, s.postRollSec)
  s.windowSec = Math.max(1, s.windowSec)
  s.silenceMinGapSec = Math.min(10, Math.max(0.2, s.silenceMinGapSec))
  s.silenceKeepSec = Math.min(1, Math.max(0, s.silenceKeepSec))
  return s
}
