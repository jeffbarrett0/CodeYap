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
import type { IdeasResult } from './ideas'
import type { ChapterDensity, ChaptersResult } from './chapters'
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
  'chapters:generate': [[{ timeline: Timeline; useAi?: boolean; density?: ChapterDensity }], ChaptersResult]
  /** Metni dosyaya yazar (zaman damgaları .txt) */
  'file:writeText': [[string, string], void]
  /** Video önerileri: transkriptten ayrı video olabilecek konu bölümleri + başlık önerileri */
  'ideas:generate': [[{ assetId: string; max?: number; useAi?: boolean; auto?: boolean }], IdeasResult]
  /** Auto Kick: yayın kaydından otomatik tam video (+ ileride klipler); iş arka planda sürer */
  'autokick:start': [[AutoKickRequest], string]
  'autokick:cancel': [[string], void]
  'autokick:list': [[], AutoKickStatus[]]
  /** Auto Kick başlamadan transkripsiyon hazır mı (whisper programı, model, anahtar) */
  'autokick:check': [[], TranscriptionReadiness]
  /** Konu klibi: Auto Kick projesinin transkriptinde konuyu arar, aday klipleri önerir (projeyi değiştirmez) */
  'autokick:topic': [[{ projectPath: string; topic: string; maxSec?: number; minSec?: number }], TopicCandidate[]]
  /** Seçilen adaydan bağımsız klip projesi üretir (Auto Kick projesi değişmez) */
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
  'autoclips:find': [[{ projectPath: string; minSec?: number; maxSec?: number; max?: number }], { candidates: AutoClipCandidate[]; totalSec: number; projectPath: string; faceRegion?: NormRect }]
  /** Seçilen adaylardan bağımsız klip projeleri (9:16: yüz üstte, konuşulan görüntü altta) */
  'autoclips:make': [[{ projectPath: string; picks: { start: number; end: number; subject: string }[]; face?: NormRect; facePos?: 'top' | 'bottom'; faceShare?: number; faceZoom?: number; faceFocus?: { x: number; y: number }; screenZoom?: number }], { projectPath: string; durationSec: number; name: string }[]]
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
  mediaUrl(asset: MediaAsset, kind: 'video' | 'audio' | 'thumb' | 'image', audioIndex?: number): string | null
}

declare global {
  interface Window {
    clipforge?: ClipforgeApi
  }
}

/** Hata mesajlarını IPC sınırından taşımak için sarmalayıcı */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
