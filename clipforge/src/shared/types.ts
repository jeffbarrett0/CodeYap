/**
 * ClipForge veri modelleri.
 *
 * Kurallar:
 *  - Tüm zamanlar SANİYE cinsindendir (float).
 *  - Hepsi düz JSON olarak serileştirilebilir (class / Map / Date yok).
 *  - Bu dosya hem main, hem preload, hem renderer tarafından kullanılır; node/electron import etmez.
 */

export type ID = string

// ───────────────────────────── Medya ─────────────────────────────

export type ObsEncoder = 'nvenc' | 'x264' | 'amf' | 'qsv' | 'apple' | 'software' | 'unknown'

export interface AudioStreamInfo {
  /** Sesler arasındaki sıra (0 = ilk ses akışı = OBS "Track 1"). ffmpeg: 0:a:<index> */
  index: number
  /** Dosyadaki mutlak akış numarası */
  streamIndex: number
  codec: string
  channels: number
  sampleRate: number
  title?: string
  /** Önizleme için üretilen düşük bitrate'li ses kopyası (proje köküne göreli) */
  proxyPath?: string
}

export interface ObsInfo {
  isObs: boolean
  /** ör. "30.1.2" (yalnızca etiketten okunabilirse) */
  version?: string
  encoder: ObsEncoder
  /** Algılamanın dayanağı (kullanıcıya gösterilir) */
  evidence: string[]
}

export interface Chapter {
  start: number
  end: number
  title: string
}

export interface MediaAsset {
  id: ID
  name: string
  /** Mutlak yol (çalışma zamanı). Kayıtta `relativePath` kullanılır. */
  path: string
  /** Proje dosyasına göre göreli yol (kaydedilirken doldurulur) */
  relativePath?: string
  kind: 'video' | 'audio' | 'image'
  container: string
  durationSec: number
  width: number
  height: number
  fps: number
  videoCodec?: string
  videoProfile?: string
  pixelFormat?: string
  bitrate?: number
  sizeBytes: number
  audioStreams: AudioStreamInfo[]
  obs: ObsInfo
  chapters: Chapter[]
  /** Proje veri klasörüne göreli */
  thumbnailPath?: string
  proxyPath?: string
  proxyHeight?: number
  /** Ayrı webcam dosyası ise ve senkron ofseti biliniyorsa: webcam_zamanı = ekran_zamanı + syncOffsetSec */
  syncOffsetSec?: number
  /** Kayıtta ekran ve kamera tek dosyada ise kamera bölgesi (0..1 normalize) */
  webcamRegion?: NormRect
  /** Ayrı kamera dosyası kullanılıyorsa ona işaret eder (eski alan; `sources.cam` tercih edilir) */
  webcamAssetId?: ID
  /** Bu dosyanın rolü (ayrı içe aktarılan parçalar için varsayılan iz seçimini belirler) */
  role?: 'screen' | 'game' | 'voice' | 'cam' | 'image'
  /**
   * Aynı yayının ayrı dosyaları: bu dosyadan (ör. konuşma kaydı) klip çıkarılınca diğerleri de AYNI zaman aralığında
   * (her dosyanın `syncOffsetSec` ofsetiyle: kaynak zamanı = bu dosyanın zamanı + ofset) klibe eklenir.
   */
  sources?: { screen?: ID; game?: ID; voice?: ID; cam?: ID }
  /** Transkripsiyon için seçilen ses track'i (varsayılan 0 = Track 1) */
  transcriptionTrack: number
  /** Oyun ve konuşma sesi için ayrı ses akışı eşlemesi (yoksa karışım kullanılır) */
  audioMap: { mix: number; game?: number; voice?: number }
  importedAt: string
  /** Proje açılırken dosya bulunamadıysa true */
  missing?: boolean
}

export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

// ───────────────────────────── Transkript ─────────────────────────────

export interface TranscriptWord {
  text: string
  start: number
  end: number
  /** 0..1 (sağlayıcı güveni). Düşükse arayüzde "emin değil" diye işaretlenir. */
  confidence?: number
  /** Sözlükle ya da elle düzeltildiyse özgün (yanlış) yazım */
  corrected?: string
}

/** Cümle düzeyinde bölüt; kelime dizisindeki [firstWord, lastWord] aralığına işaret eder. */
export interface Segment {
  id: number
  start: number
  end: number
  text: string
  firstWord: number
  lastWord: number
}

export interface Transcript {
  id: ID
  assetId: ID
  language: string
  model: string
  provider: TranscriptionProviderKind
  audioTrack: number
  createdAt: string
  durationSec: number
  /** Üretimde kullanılan ipucu (özel sözlük + dolgu); değişirse transkript yeniden üretilir */
  prompt?: string
  words: TranscriptWord[]
  segments: Segment[]
}

export type TranscriptionProviderKind = 'whisper-cpp' | 'faster-whisper' | 'openai-api' | 'mock'

// ───────────────────────────── Arama ─────────────────────────────

export type MatchKind = 'exact' | 'fuzzy' | 'window' | 'semantic'

export interface SearchResult {
  id: string
  /** Eşleşmenin ilk ve son kelime zamanı */
  start: number
  end: number
  /** Eşleşen cümlenin sınırları */
  sentenceStart: number
  sentenceEnd: number
  sentence: string
  before: string[]
  after: string[]
  /** 0..1 */
  score: number
  kind: MatchKind
  /** Bu sonuca birleştirilen eşleşme sayısı */
  matchCount: number
  /** Eşleşen transkript kelimeleri (vurgulama için) */
  matchedWords: { index: number; text: string; similarity: number }[]
  /** Eşleşmenin ilk ve son kelime indeksi */
  firstWord: number
  lastWord: number
  /** Eksik sorgu terimleri (kısmi eşleşme ise) */
  missingTerms?: string[]
}

export interface SearchOptions {
  /** 0..1; bulanık eşleşme için gereken minimum benzerlik */
  fuzzyThreshold: number
  fuzzy: boolean
  /** Çok kelimeli sorguda kelimelerin birlikte aranacağı pencere (sn) */
  windowSec: number
  /** Aynı konuşma bölümündeki eşleşmeleri birleştirme aralığı (sn) */
  mergeGapSec: number
  /** Bağlam cümle sayısı (önce/sonra) */
  contextSentences: number
  /** Tüm terimler bulunamazsa kısmi sonuçlara izin ver */
  allowPartial: boolean
  maxResults: number
}

// ───────────────────────────── Zaman çizelgesi ─────────────────────────────

export type TrackKind = 'video' | 'audio' | 'caption' | 'image' | 'text'
export type TrackRole = 'screen' | 'webcam' | 'game' | 'voice' | 'mix' | 'caption' | 'image' | 'text'

/** Bir görsel katmanın (video / görsel / metin izi) çıkış karesindeki yeri. rect: 0..1 normalize. */
export interface Placement {
  rect: NormRect
  /** cover: dikdörtgeni doldurur (kırpar); contain: oranı korur, ortalar */
  fit: 'cover' | 'contain'
  visible: boolean
  /** 0..1 */
  opacity: number
}

export type TextAnimation = 'none' | 'fade' | 'pulse' | 'slide-up'

/** Metin klibinin içeriği ve biçimi (altyazı gibi ASS ile yakılır). fontSize: kısa kenar 1080 px'e göre. */
export interface TextSpec {
  text: string
  fontFamily: string
  fontSize: number
  color: string
  outlineColor: string
  outlineWidth: number
  bold: boolean
  italic?: boolean
  animation: TextAnimation
}

export interface ClipOrigin {
  assetId: ID
  sourceStart: number
  sourceEnd: number
  query?: string
  resultId?: string
  matchTime?: number
  candidateId?: ID
}

export interface Clip {
  id: ID
  trackId: ID
  assetId: ID
  /** Zaman çizelgesindeki başlangıç */
  start: number
  /** Kaynak dosyadaki giriş/çıkış */
  srcIn: number
  srcOut: number
  /** Ses akışı sırası (ses kliplerinde zorunlu, video kliplerinde ses kullanılacaksa) */
  audioStream?: number
  volume: number
  label: string
  /** Metin klibi (assetId boş) */
  text?: TextSpec
  /** Aynı gruptaki kliplerin (ör. görüntü + ses) taşıma/bölme/silme/kırpma işlemleri birlikte uygulanır */
  groupId?: ID
  /** Kaynak kayıtla bağlantı (kaynak zaman damgası meta verisi) */
  origin?: ClipOrigin
  /** Kamera overlay'i için normalize konum/boyut (çıkış karesine göre) */
  overlay?: NormRect
  /** Kamera klibinin kaynak karesinden kırpılacak bölge (tek dosyalık kayıtlar) */
  crop?: NormRect
}

export interface Track {
  id: ID
  name: string
  kind: TrackKind
  role: TrackRole
  clips: Clip[]
  muted: boolean
  locked: boolean
  /** Ses seviyesi çarpanı (0..2) */
  volume: number
  /** Görsel izler (video/görsel/metin) için kare içindeki yer; yoksa eski sürüm düzeni kullanılır */
  placement?: Placement
  /** Metin izi: izin boş kaldığı yerlerde zaman çizelgesi uzunluğunca otomatik oluşturulacak varsayılan metin */
  textDefault?: TextSpec
}

export interface Caption {
  id: ID
  start: number
  end: number
  text: string
  /** Bu altyazının merkezi (0..1, kareye göre). Yoksa stildeki varsayılan konum kullanılır. */
  pos?: { x: number; y: number }
}

export interface CaptionStyle {
  enabled: boolean
  fontFamily: string
  fontSize: number
  color: string
  outlineColor: string
  outlineWidth: number
  bold: boolean
  /** 0 = alt, 0.5 = orta, 1 = üst (normalize dikey konum) */
  positionY: number
  uppercase: boolean
  maxCharsPerLine: number
}

export type AspectRatio = '9:16' | '1:1' | '16:9'
export type LayoutPreset =
  | 'fill'
  | 'game-center-cam-bottom'
  | 'game-center-cam-top'
  | 'cam-overlay-corner'

export interface Timeline {
  fps: number
  aspect: AspectRatio
  /** true: oran, ilk video eklenince videonun gerçek boyutuna göre kendiliğinden ayarlanır; oran elle seçilirse false olur */
  aspectAuto?: boolean
  layout: LayoutPreset
  tracks: Track[]
  captions: Caption[]
  captionStyle: CaptionStyle
  /** Kamera overlay varsayılanı (yalnızca katman konumu olmayan eski projeler için) */
  webcamOverlay: NormRect
  /** Kare arka plan rengi (#RRGGBB) */
  background?: string
}

/** Kaydedilebilir sahne/kare düzeni: katmanların konumları + metin katmanlarının varsayılan metni. */
export interface LayoutTemplate {
  id: ID
  name: string
  builtin?: boolean
  aspect: AspectRatio
  background: string
  /** Üstten alta (ilk = en üstteki katman) */
  layers: { id: ID; name: string; kind: Exclude<TrackKind, 'audio' | 'caption'>; role: TrackRole; placement: Placement; textDefault?: TextSpec }[]
}

// ───────────────────────────── Sohbet / öneri ─────────────────────────────

export interface ChatMessage {
  /** Kayıt başından itibaren saniye */
  t: number
  user: string
  text: string
}

export interface ChatLog {
  id: ID
  assetId?: ID
  sourceName: string
  importedAt: string
  /** Mutlak zaman damgalarını göreli saniyeye çevirirken kullanılan ofset */
  offsetSec: number
  messages: ChatMessage[]
}

export interface ChatColumnMapping {
  time?: string
  user?: string
  message?: string
  /** Mutlak (ISO / epoch) zaman damgası için yayın başlangıcı (ISO) */
  streamStart?: string
}

export type SignalKind = 'audio' | 'chat' | 'keyword' | 'scene' | 'marker'

export interface SignalReason {
  signal: SignalKind
  /** 0..1 bu sinyalin skora katkısı (ağırlıksız normalize değer) */
  strength: number
  label: string
}

export interface ClipCandidate {
  id: ID
  assetId: ID
  start: number
  end: number
  peak: number
  score: number
  reasons: SignalReason[]
  status: 'pending' | 'accepted' | 'rejected'
}

export interface Marker {
  time: number
  label: string
  source: 'chapter' | 'sidecar'
}

// ───────────────────────────── Dışa aktarma ─────────────────────────────

export type ExportStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ExportOptions {
  presetId: string
  aspect: AspectRatio
  width: number
  height: number
  /** 0 = kaynağın kare hızı (en fazla 60) */
  fps: number
  /** crf açıkken üst sınır (maxrate), crf=0 iken hedef bitrate */
  videoBitrateKbps: number
  audioBitrateKbps: number
  /** 0..51; bitrate yerine kalite hedefi — DÜŞÜK = daha yüksek kalite (0 = yalnızca bitrate kullan) */
  crf: number
  /** x264 kodlama hızı/verimi: yavaş = aynı boyutta daha yüksek kalite (varsayılan: slow) */
  encoderPreset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | 'slower'
  maxDurationSec?: number
  normalizeAudio: boolean
}

export interface ExportJob {
  id: ID
  name: string
  status: ExportStatus
  progress: number
  options: ExportOptions
  outputPath: string
  error?: string
  /** Hangi aralık: tüm timeline ya da belirli klip */
  range: { start: number; end: number }
  createdAt: string
}

// ───────────────────────────── Ayarlar ─────────────────────────────

export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium'

export interface Settings {
  language: string
  whisperModel: WhisperModelSize
  provider: TranscriptionProviderKind
  whisperCppPath: string
  whisperModelDir: string
  fasterWhisperPython: string
  openaiApiKey: string
  openaiBaseUrl: string
  ffmpegPath: string
  ffprobePath: string
  fuzzyThreshold: number
  fuzzyEnabled: boolean
  windowSec: number
  preRollSec: number
  postRollSec: number
  targetDurationSec: number
  semanticSearch: boolean
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
  chatColumns: ChatColumnMapping
  exportDefaults: Partial<ExportOptions> & { presetId: string }
  suggestKeywords: string[]
  proxyHeight: number
  /** Sessizlik kesme: bu süreden uzun kelime arası boşluklar (sn) */
  silenceMinGapSec: number
  /** Kesimden sonra her iki yanda bırakılan pay (sn) */
  silenceKeepSec: number
  /** ııı / eee gibi dolgu seslerini de kes */
  cutFillers: boolean
  /** Özel sözlük: isimler, yöresel kelimeler, terimler (satır ya da virgülle ayrılmış) */
  vocabulary: string
  /** ııı / eee gibi dolgu seslerini de yazıya dökmesi için whisper'a ipucu ver */
  transcribeFillers: boolean
}

// ───────────────────────────── Proje ─────────────────────────────

export const PROJECT_VERSION = 2

export interface Project {
  version: number
  id: ID
  name: string
  createdAt: string
  updatedAt: string
  assets: MediaAsset[]
  timeline: Timeline
  chatLogs: ChatLog[]
  candidates: ClipCandidate[]
  markers: Record<ID, Marker[]>
  searchHistory: string[]
  /** Transkriptler büyük olduğundan yan dosyalarda tutulur: assetId → proje veri klasörüne göreli yol */
  transcriptRefs: Record<ID, string>
  exportJobs: ExportJob[]
}

// ───────────────────────────── Görevler ─────────────────────────────

export type TaskKind = 'import' | 'proxy' | 'transcribe' | 'analyze' | 'export' | 'model-download'
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskInfo {
  id: ID
  kind: TaskKind
  title: string
  status: TaskStatus
  progress: number
  message?: string
  error?: string
  createdAt: number
  finishedAt?: number
}
