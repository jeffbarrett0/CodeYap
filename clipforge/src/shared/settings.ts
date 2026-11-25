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
  /** Hızlı transkripsiyon: whisper.cpp'de ışın araması yerine açgözlü çözümleme (belirgin hızlı, doğrulukta çok küçük fark) */
  whisperFast: true,
  /** Auto Kick (gözetimsiz) çalışırken tüm çekirdekleri kullan (daha hızlı; bilgisayar o sırada yavaşlar) */
  autoKickFullSpeed: true,
  silenceMinGapSec: 0.55,
  silenceKeepSec: 0.15,
  /** Sessizlik kesilirken GERÇEK ses seviyesine de bakılır: konuşma varsa kesilmez (kullanıcı şikâyeti: konuşmanın başı kesiliyordu). Kapatılırsa yalnızca transkript zamanları kullanılır. */
  silenceAudioGuard: true,
  /** Auto Kick tam videosunu EKRAN KARTIYLA (NVENC/Quick Sync/AMF) kodla: kat kat hızlı; çalışmazsa/hata verirse otomatik yazılım kodlamaya döner. */
  autoKickHwEncode: true,
  cutFillers: true,
  vocabulary: '',
  transcribeFillers: true,
  cpuMode: 'balanced',
  introCutEnabled: true,
  introReferencePath: '',
  introDurationSec: 164,
  autoClipsAfterKick: false, // KULLANICI KARARI: Auto Kick sonrası klipler otomatik üretilmez; dikey klipleri Auto Clips'ten kendisi çıkarır
  chainOffMigrated: true, // yeni kurulumda göç gerekmez; eski kayıt dosyasında bu alan yoktur → bir kez kapatılır
  autoClipsExport: true,
  autoClipsHorizontal: true,
  /** Auto yatay video: Auto Kick bitince (hazır liste verildiyse) listeye göre yatay kesitler kendiliğinden */
  autoHorizontalAfterKick: true,
  autoHorizontalCta: true,
  /** Dikey Auto Clips / YouTube dikey video klipleri: 2. sn'de ilk, sonra her 20 sn'de bir YouTube abone butonu */
  autoClipsCta: true,
  /** YouTube outro (kapanış) videosu: HER yatay videonun sonuna eklenir (YouTube yatay video, Auto yatay, yatay Klip çıkar). Boşsa eklenmez. */
  outroPath: '',
  /** Outro kutusu: kapatılırsa hiçbir yatay videoya outro eklenmez (dosya seçili olsa bile) */
  outroEnabled: true,
  autoClipsMax: 0, // 0 = sınırsız (bulabildiği kadar klip)
  autoClipsCaptions: false,
  autoClipsMaxHorizontal: 0, // 0 = sınırsız
  autoAdjustEnabled: true,
  autoAdjustContrast: 5,
  autoAdjustSharpen: 5,
  autoVoiceLevel: true,
  autoClipsOverlay: true,
  autoClipsOverlayPath: '',
  llmProvider: 'off',
  llmModel: '',
  anthropicApiKey: ''
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
  // TEK SEFERLİK: eski kayıtlı 'Auto Kick bitince klipleri üret' açık kalmasın (kullanıcı: 2–2,5 saatlik bekleme; dikey klipleri kendisi çıkarıyor)
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).chainOffMigrated !== true) out.autoClipsAfterKick = false
  out.chainOffMigrated = true
  const s = out as unknown as Settings
  s.fuzzyThreshold = Math.min(1, Math.max(0.5, s.fuzzyThreshold))
  s.preRollSec = Math.max(0, s.preRollSec)
  s.postRollSec = Math.max(0, s.postRollSec)
  s.windowSec = Math.max(1, s.windowSec)
  s.silenceMinGapSec = Math.min(10, Math.max(0.2, s.silenceMinGapSec))
  s.silenceKeepSec = Math.min(1, Math.max(0, s.silenceKeepSec))
  return s
}
