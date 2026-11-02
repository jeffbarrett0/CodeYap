import type { WhisperModelSize } from './types'

/** Auto Kick: yayın kaydı → transkript → sessizleri kırp → "full video" kaydet → (sonraki adım) otomatik klipler */
export type AutoKickStage = 'import' | 'transcribe' | 'silence' | 'gaps' | 'full'
export type AutoKickStageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export const AUTOKICK_STAGES: { id: AutoKickStage; label: string }[] = [
  { id: 'import', label: 'Kaydı içe aktar' },
  { id: 'transcribe', label: 'Transkripsiyon' },
  { id: 'silence', label: 'Sessiz alanları kes' },
  { id: 'gaps', label: 'Boşlukları kapat' },
  { id: 'full', label: 'Tam videoyu kaydet (full video)' }
]

export interface AutoKickRequest {
  videoPath: string
  /** Çıkış klasörü; boşsa kaydın yanında `AutoKick/<kayıt adı>/` */
  outDir?: string
  language?: string
  model?: WhisperModelSize
  /** Hangi ses akışı konuşmayı içerir (0 = Track 1); boşsa dosyadaki transkripsiyon track'i */
  track?: number
  silence?: { minGapSec: number; keepSec: number; cutFillers: boolean }
  /** fast: uzun yayınlar için hızlı kodlama (varsayılan); high: şablonun maksimum kalite ayarı (çok daha yavaş) */
  quality?: 'fast' | 'high'
}

export interface AutoKickStageState {
  id: AutoKickStage
  label: string
  status: AutoKickStageStatus
  progress: number
  detail?: string
}

export interface AutoKickResult {
  /** Çıktı doğrulandı: süre beklenenle eşleşiyor, görüntü ve ses var, çizelgede boşluk kalmadı */
  verified: boolean
  outDir: string
  projectPath: string
  fullVideoPath: string
  durationBeforeSec: number
  durationAfterSec: number
  removedSec: number
  cuts: number
  fillers: number
  words: number
  sentences: number
}

export interface AutoKickStatus {
  id: string
  /** başlatılan istek (hata sonrası "yeniden dene" için) */
  request: AutoKickRequest
  videoName: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  stages: AutoKickStageState[]
  error?: string
  result?: AutoKickResult
  startedAt: number
  finishedAt?: number
}

export const initialStages = (): AutoKickStageState[] => AUTOKICK_STAGES.map((s) => ({ ...s, status: 'pending', progress: 0 }))

/** Transkripsiyonun çalışıp çalışmayacağı: Auto Kick başlamadan (ve pencerede) gösterilir; sorun varsa ne yapılacağı yazar */
export interface TranscriptionReadiness {
  ok: boolean
  provider: string
  model: string
  problems: string[]
  /** whisper.cpp modeli yok ama indirilebilir: Auto Kick kendisi indirir */
  needsModelDownload?: WhisperModelSize
}

export function transcriptionReadiness(
  s: { provider: string; whisperModel: WhisperModelSize; openaiApiKey?: string },
  info: { whisperCpp: { ok: boolean; path: string }; models: { size: WhisperModelSize; installed: boolean; path: string }[] }
): TranscriptionReadiness {
  const r: TranscriptionReadiness = { ok: true, provider: s.provider, model: s.whisperModel, problems: [] }
  if (s.provider === 'whisper-cpp') {
    if (!info.whisperCpp.ok) {
      r.problems.push(`whisper.cpp bulunamadı (${info.whisperCpp.path}). Ayarlar → Transkripsiyon bölümünde "whisper-cli.exe" dosyasının yolunu gösterin.`)
    }
    const m = info.models.find((x) => x.size === s.whisperModel)
    if (m && !m.installed) {
      r.needsModelDownload = s.whisperModel
      r.problems.push(`Whisper "${s.whisperModel}" modeli kurulu değil (${m.path}). Auto Kick başlayınca otomatik indirilir.`)
    }
    r.ok = info.whisperCpp.ok // model eksikliği otomatik giderilir; program eksikliği giderilemez
  } else if (s.provider === 'openai' && !s.openaiApiKey) {
    r.ok = false
    r.problems.push('OpenAI API anahtarı girilmemiş (Ayarlar → Transkripsiyon).')
  }
  return r
}
