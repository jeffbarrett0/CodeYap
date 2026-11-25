import type { ReferenceEntry } from './reference'
import type { CtaManifest } from './cta'
import type { TrailerRequest, TrailerResult } from './trailer'
/**
 * Main ↔ renderer arasındaki tipli IPC sözleşmesi.
 *
 *  - `IpcInvoke`: istek/yanıt kanalları (ipcRenderer.invoke ↔ ipcMain.handle)
 *  - `IpcEvents`: main → renderer yayınları (webContents.send)
 *  - `ClipforgeApi`: renderer'ın gördüğü yüzey. Preload bunu IPC üzerinden, tarayıcı modu ise sahte (mock)
 *    bir uygulama ile sağlar; böylece arayüz iki ortamda da aynı kodla çalışır.
 */
import type { AutoClipCandidate, AutoClipsRequest, AutoClipsStatus } from './autoclips'
import type { StoryPlan, StoryRequest, StoryStatus } from './story/types'
import type { AutoKickRequest, AutoKickStatus, TranscriptionReadiness } from './autokick'
import type { TopicCandidate } from './topic'
import type { YtCutRequest, YtCutResult } from './ytcut'
import type { IdeasResult } from './ideas'
import type { ChapterMode, ChaptersResult } from './chapters'
import type {
  ChatColumnMapping,
  ChatLog,
  ClipCandidate,
  ExportOptions,
  LayoutTemplate,
  MediaAsset,
  Marker,
  Project,
  NormRect,
  SearchOptions,
  SearchResult,
  Settings,
  TaskInfo,
  Timeline,
  Transcript,
  WhisperModelSize
} from './types'

export interface ToolStatus {
  ok: boolean
  path: string
  version?: string
  error?: string
}

export interface AppInfo {
  version: string
  platform: string
  ffmpeg: ToolStatus
  ffprobe: ToolStatus
  whisperCpp: ToolStatus
  models: { size: WhisperModelSize; installed: boolean; path: string }[]
  userDataDir: string
}

export interface TranscribeRequest {
  assetId: string
  /** Ses akışı sırası (0 = Track 1) */
  track: number
  language: string
  model?: WhisperModelSize
  /** Önbellekteki aynı parametreli transkripti yok say */
  force?: boolean
}

export interface SearchRequest {
  assetId: string
  query: string
  options?: Partial<SearchOptions>
  semantic?: boolean
}

export interface SuggestRequest {
  assetId: string
  chat?: ChatLog
  keywords?: string[]
  sceneDetection?: boolean
}

export interface ExportRequest {
  name: string
  /** Dışa aktarma bitince YouTube bölüm zamanlarını (.txt) videonun yanına da yaz */
  timestamps?: boolean
  timeline: Timeline
  assets: MediaAsset[]
  options: ExportOptions
  range: { start: number; end: number }
  outputPath: string
  /** HIZLI dışa aktarma (Auto Clips): hızlı ön ayar (veryfast, crf 18), ekran kartı varsa o, tüm çekirdekler; sosyal medya klipleri için yeterli kalite */
  fast?: boolean
}

export interface ChatImportRequest {
  path: string
  assetId?: string
  mapping?: ChatColumnMapping
}

export interface OpenedProject {
  project: Project
  path: string
}

/** Kanal adı → [argümanlar, sonuç] */
export interface IpcInvoke {
  'app:info': [[], AppInfo]
  'settings:get': [[], Settings]
  'settings:set': [[Partial<Settings>], Settings]
  'dialog:openMedia': [[], string[]]
  'dialog:openFile': [[{ title: string; extensions: string[]; groups?: { name: string; extensions: string[] }[] }], string | null]
  'dialog:saveFile': [[{ defaultName: string; extensions: string[] }], string | null]
  'project:save': [[Project, string | null], { path: string } | null]
  'project:open': [[string | null], OpenedProject | null]
  'project:new': [[], { dataDir: string }]
  /** Arama sonucundan bağımsız klip projesi dosyası üretir (ana proje değişmez) */
  'project:createClip': [[Project, string, string], { path: string }]
  'media:import': [[string[]], string[]]
  /** Klibin üzerinde gösterilecek ses dalgası: saniyede `binPerSec` değer (dB, -90..0); önbellekli */
  'media:waveform': [[{ assetId: string; audioStream: number }], { binPerSec: number; db: number[] }]
  /** Çağrı butonları (resources/cta): manifest + her butonun dosya yolu */
  'cta:list': [[], { manifest: CtaManifest | null; buttons: { id: string; label: string; path: string }[] }]
  /** Fragman: seçilen 10–60 sn'lik parçalardan hızlı kurgulu fragman projesi üretir (kaynak proje değişmez) */
  'trailer:build': [[TrailerRequest], TrailerResult]
  /** Referans videolar: ekle (analiz eder), listele, kare tabloları, not/durum, sil */
  'reference:list': [[], ReferenceEntry[]]
  'reference:add': [[string], ReferenceEntry]
  'reference:sheets': [[string], string[]]
  'reference:update': [[{ id: string; notes?: string; status?: 'analyzed' | 'adapted' }], ReferenceEntry]
  'reference:remove': [[string], void]
  /** Önizleme için arka plan sesi azaltılmış ses kopyası üretir (önbellekli); dönen değer = `variant` (seviye) */
  'audio:denoise': [[{ assetId: string; audioStream: number; level: 'light' | 'medium' | 'strong' }], string]
  'media:markers': [[string], Marker[]]
  'media:syncOffset': [[{ screenAssetId: string; camAssetId: string }], number]
  'transcript:start': [[TranscribeRequest], string]
  'transcript:get': [[string], Transcript | null]
  'transcript:fix': [[{ assetId: string; index: number; text: string; all: boolean; remember: boolean }], { transcript: Transcript; replaced: number }]
  'transcript:vocab': [[string], { transcript: Transcript; corrections: number }]
  'search:run': [[SearchRequest], SearchResult[]]
  'chat:import': [[ChatImportRequest], { chat: ChatLog; warnings: string[] }]
  'suggest:start': [[SuggestRequest], string]
  'export:start': [[ExportRequest], string]
  'export:dialogOutput': [[string], string | null]
  'task:cancel': [[string], void]
  /** Altyazı çevirisi: aynı sayıda satır, aynı sırada (zamanlamalar korunur) */
  'captions:translate': [[{ texts: string[]; to: string }], { texts: string[] }]
  /** YouTube bölüm zamanları (timestamp): düzenlenmiş çizelgenin konu bölümleri ve başlıkları */
  'chapters:generate': [[{ timeline: Timeline; useAi?: boolean; density?: ChapterMode }], ChaptersResult]
  /** Metni dosyaya yazar (zaman damgaları .txt) */
  'file:writeText': [[string, string], void]
  /** Video önerileri: transkriptten ayrı video olabilecek konu bölümleri + başlık önerileri */
  'ideas:generate': [[{ assetId: string; max?: number; useAi?: boolean; auto?: boolean }], IdeasResult]
  /** Auto Kick: yayın kaydından otomatik tam video (+ ileride klipler); iş arka planda sürer */
  /** YouTube yatay video: bütün yayından zaman damgalarının her birini ayrı MP4 olarak keser (görev kuyruğu; bitince 'ytcut:done') */
  'ytcut:start': [[YtCutRequest], string]
  /** Biten Auto Kick işi için hazır zaman damgası listesini (orijinal kayıt zamanı) kesimli videonun zamanına çevirir; `… - zaman damgaları.txt` yazar */
  'autokick:timestamps': [[{ projectPath: string; list: string }], { text: string; warnings: string[]; path: string }]
  'autokick:start': [[AutoKickRequest], string]
  'autokick:cancel': [[string], void]
  'autokick:list': [[], AutoKickStatus[]]
  /** Auto Kick başlamadan transkripsiyon hazır mı (whisper programı, model, anahtar) */
  'autokick:check': [[], TranscriptionReadiness]
  /** Konu klibi: Auto Kick projesinin transkriptinde konuyu arar, aday klipleri önerir (projeyi değiştirmez) */
  'autokick:topic': [[{ projectPath: string; topic: string; maxSec?: number; minSec?: number }], TopicCandidate[]]
  /** Seçilen adaydan bağımsız klip projesi üretir (Auto Kick projesi değişmez) */
  /** Yalnızca yüz klibi (Sport diyor Plus): konu aralığından ekransız yüz klibi projesi (+ isteğe bağlı MP4) */
  'faceclip:make': [[{ projectPath: string; subject: string; start: number; end: number; shape: 'vertical' | 'square' | 'horizontal'; captions?: boolean; exportVideo?: boolean }], { projectPath: string; durationSec: number; name: string; videoPath?: string }]
  'autokick:makeClip': [[{ projectPath: string; topic: string; start: number; end: number }], { projectPath: string; durationSec: number }]
  'task:list': [[], TaskInfo[]]
  'model:download': [[WhisperModelSize], string]
  'shell:reveal': [[string], void]
  'templates:list': [[], LayoutTemplate[]]
  'templates:save': [[LayoutTemplate], LayoutTemplate[]]
  'templates:delete': [[string], LayoutTemplate[]]
  /** Auto Clips otomatik zinciri: adayları bul → klip projelerini üret → (isteğe bağlı) MP4 dışa aktar; arka planda sürer */
  'autoclips:start': [[AutoClipsRequest], string]
  'autoclips:cancel': [[string], void]
  'autoclips:list': [[], AutoClipsStatus[]]
  /** Auto Clips: Auto Kick projesinin transkriptinden klip adayları (projeyi değiştirmez) */
  'autoclips:find': [[{ projectPath: string; minSec?: number; maxSec?: number; max?: number; horizontal?: boolean }], { candidates: AutoClipCandidate[]; totalSec: number; projectPath: string; faceRegion?: NormRect }]
  /** Seçilen adaylardan bağımsız klip projeleri (9:16: yüz üstte, konuşulan görüntü altta) */
  'autoclips:transcript': [[{ projectPath: string }], { lines: { start: number; end: number; text: string }[]; suggestions: { name: string; count: number; firstAt: number; talkSec: number }[]; totalSec: number; projectPath: string }]
  'autoclips:transcribe': [[{ projectPath: string }], { words: number; sentences: number; already: boolean }]
  'autoclips:fix': [[{ projectPath: string; from: string; to: string }], { replaced: number }]
  /** SportDeoPlus (yenilendi): MP4'ten yalnızca üst yüz alanı kalır (şerit + ekran silinir). Önizleme: orijinal kare (kesim çizgisi) + çıkacak görüntü */
  'facetrim:preview': [[{ videoPath: string; faceShare: number; stripCut: boolean; shape: import('./facetrim').FaceTrimShape; /** önizleme karesi (sn); boşsa videonun başı */ at?: number }], { original: string; result: string; srcW: number; srcH: number; outW: number; outH: number; durationSec: number; hasAudio: boolean }]
  /** MP4 olarak kaydet (görev kuyruğu; bitince 'facetrim:done') */
  'facetrim:start': [[{ videoPath: string; faceShare: number; stripCut: boolean; shape: import('./facetrim').FaceTrimShape; /** videoyu kes: başlangıç/bitiş (sn); boşsa tamamı */ start?: number; end?: number }], string]
  /** Zaten üretilmiş Auto Kick tam videosunun (`… - full.mp4`) sonuna YouTube outro ekler (yeniden işlemeden; görev kuyruğu; bitince 'outro:done') */
  'autokick:outro': [[{ fullVideoPath: string }], string]
  /** Kapanış (outro) klasörünün yolu (yoksa oluşturur): kullanıcı outro videosunu buraya bırakır */
  'outro:folder': [[], string]
  'clipfind:search': [[{ projectPath: string; query: string }], { candidates: import('./clipsearch').SceneCandidate[]; projectPath: string; totalSec: number }]
  'autoclips:search': [[{ projectPath: string; query: string; maxSec?: number }], { candidates: AutoClipCandidate[]; projectPath: string }]
  'autoclips:make': [[{ projectPath: string; picks: { start: number; end: number; subject: string }[]; face?: NormRect; facePos?: 'top' | 'bottom'; faceShare?: number; faceZoom?: number; faceFocus?: { x: number; y: number }; screenZoom?: number; horizontal?: boolean; captions?: boolean }], { projectPath: string; durationSec: number; name: string }[]]
  'dev:openDevTools': [[], void]
  /** Anlatım → Görsel: ses/video anlatımından hareketli sahneler (iş arka planda sürer) */
  'story:start': [[StoryRequest], string]
  'story:cancel': [[string], void]
  'story:list': [[], StoryStatus[]]
  /** Kayıtlı sahne planı (düzenlemek için) */
  'story:plan': [[string], StoryPlan | null]
}

export interface IpcEvents {
  'task:update': TaskInfo
  'autokick:update': AutoKickStatus
  'story:update': StoryStatus
  'autoclips:update': AutoClipsStatus
  'asset:added': MediaAsset
  'asset:updated': MediaAsset
  'transcript:ready': { assetId: string; transcript: Transcript; reused: boolean }
  'suggest:ready': { assetId: string; candidates: ClipCandidate[] }
  'ytcut:done': { taskId: string; result: YtCutResult }
  'outro:done': { taskId: string; fullVideoPath: string; ok: boolean; note: string }
  'facetrim:done': { taskId: string; outputPath: string; width: number; height: number; durationSec: number }
  'export:done': { taskId: string; outputPath: string; warnings?: string[]; timestampsPath?: string }
  'menu:command': 'open' | 'save' | 'saveAs' | 'import' | 'export'
}

export type IpcChannel = keyof IpcInvoke
export type IpcEventName = keyof IpcEvents

export type Unsubscribe = () => void

/** Renderer'ın kullandığı API (preload veya mock tarafından sağlanır). */
export interface ClipforgeApi {
  readonly isMock: boolean
  invoke<C extends IpcChannel>(channel: C, ...args: IpcInvoke[C][0]): Promise<IpcInvoke[C][1]>
  on<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): Unsubscribe
  /** Sürükle-bırak ile gelen dosyanın mutlak yolu (Electron: webUtils.getPathForFile) */
  pathForFile(file: File): string
  /** Önizleme medyası için URL (Electron: cf-media://, mock: statik dosya) */
  mediaUrl(asset: MediaAsset, kind: 'video' | 'audio' | 'thumb' | 'image', audioIndex?: number, variant?: string): string | null
}

declare global {
  interface Window {
    clipforge?: ClipforgeApi
  }
}

/** Hata mesajlarını IPC sınırından taşımak için sarmalayıcı */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
