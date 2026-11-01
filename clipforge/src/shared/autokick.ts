import type { WhisperModelSize } from './types'

/** Auto Kick: yayın kaydı → transkript → sessizleri kırp → "full video" kaydet → (sonraki adım) otomatik klipler */
export type AutoKickStage = 'import' | 'transcribe' | 'silence' | 'full' | 'clips'
export type AutoKickStageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export const AUTOKICK_STAGES: { id: AutoKickStage; label: string }[] = [
  { id: 'import', label: 'Kaydı içe aktar' },
  { id: 'transcribe', label: 'Transkripsiyon' },
  { id: 'silence', label: 'Sessiz alanları kırp' },
  { id: 'full', label: 'Tam videoyu kaydet (full video)' },
  { id: 'clips', label: 'Otomatik klipler' }
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
  videoName: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  stages: AutoKickStageState[]
  error?: string
  result?: AutoKickResult
  startedAt: number
  finishedAt?: number
}

export const initialStages = (): AutoKickStageState[] => AUTOKICK_STAGES.map((s) => ({ ...s, status: 'pending', progress: 0 }))
