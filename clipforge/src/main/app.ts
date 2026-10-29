import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseChatLog } from '../shared/chat/parse'
import { DEFAULT_SEARCH_OPTIONS } from '../shared/search/engine'
import { SearchService } from '../shared/search/service'
import { estimateOffsetSec } from '../shared/media/sync'
import { newId } from '../shared/timeline/model'
import { scoreCandidates, snapCandidate, DEFAULT_KEYWORDS } from '../shared/suggest/score'
import type { AppInfo, ChatImportRequest, ExportRequest, IpcEventName, IpcEvents, OpenedProject, SearchRequest, SuggestRequest, ToolStatus, TranscribeRequest } from '../shared/ipc'
import type { ChatLog, MediaAsset, Marker, Project, SearchResult, Transcript, WhisperModelSize } from '../shared/types'
import { runExport } from './export'
import { resolveFfmpegPath, resolveFfprobePath, ToolError, toolVersion } from './ffmpeg'
import { audioLevelSeries, detectScenes } from './media/audio'
import { importMedia, loadMarkers, type MediaTools } from './media/import'
import { makeProxy } from './media/proxy'
import { copyDataDir, dataDirFor, openProject, saveProject } from './project/io'
import { SettingsStore, TemplateStore } from './settings-store'
import { TaskQueue, userMessage } from './tasks'
import { createEmbeddingProvider } from './embeddings'
import { downloadModel, modelInstalled } from './transcribe/models'
import { loadTranscript, transcribeAsset } from './transcribe/pipeline'
import { createProvider, whisperModelFile } from './transcribe/providers'

export interface AppDeps {
  userDataDir: string
  resourcesDir: string
  version: string
  platform: string
  emit: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
}

/**
 * Uygulama servisi: tüm iş mantığı burada; Electron'a bağımlı değildir (diyaloglar ve pencereler ipc.ts'tedir),
 * bu yüzden birim/entegrasyon testlerinde doğrudan çalıştırılabilir.
 */
export class AppService {
  readonly settings: SettingsStore
  readonly templates: TemplateStore
  readonly queue = new TaskQueue()
  readonly assets = new Map<string, MediaAsset>()
  readonly search: SearchService
  dataDir: string
  projectPath: string | null = null

  constructor(readonly deps: AppDeps) {
    this.settings = new SettingsStore(join(deps.userDataDir, 'settings.json'))
    this.templates = new TemplateStore(join(deps.userDataDir, 'templates.json'))
    this.search = new SearchService(() => createEmbeddingProvider(this.settings.value))
    this.dataDir = join(deps.userDataDir, 'projects', `session-${Date.now().toString(36)}`)
    this.queue.onUpdate((t) => deps.emit('task:update', t))
  }

  async init(): Promise<void> {
    await this.settings.load()
    await this.templates.load()
    await mkdir(this.dataDir, { recursive: true })
  }

  get tools(): MediaTools {
    const s = this.settings.value
    return { ffmpeg: resolveFfmpegPath(s.ffmpegPath), ffprobe: resolveFfprobePath(s.ffprobePath) }
  }

  get modelDir(): string {
    return this.settings.value.whisperModelDir || join(this.deps.userDataDir, 'models')
  }

  private get whisperBin(): string {
    return this.settings.value.whisperCppPath || process.env.CLIPFORGE_WHISPER || 'whisper-cli'
  }

  private async status(bin: string): Promise<ToolStatus> {
    try {
      return { ok: true, path: bin, version: await toolVersion(bin) }
    } catch (e) {
      return { ok: false, path: bin, error: userMessage(e) }
    }
  }

  async info(): Promise<AppInfo> {
    const t = this.tools
    const [ffmpeg, ffprobe] = await Promise.all([this.status(t.ffmpeg), this.status(t.ffprobe)])
    const whisper = await toolVersion(this.whisperBin).then(
      (v): ToolStatus => ({ ok: true, path: this.whisperBin, version: v }),
      // whisper-cli -version yoktur; yürütülebiliyorsa (yardım çıktısı verip hata dönse de) bulunmuş sayılır
      (e): ToolStatus => (/bulunamadı/.test(userMessage(e)) ? { ok: false, path: this.whisperBin, error: 'Bulunamadı' } : { ok: true, path: this.whisperBin })
    )
    const models = await Promise.all((['tiny', 'base', 'small', 'medium'] as WhisperModelSize[]).map(async (size) => ({ size, installed: await modelInstalled(this.modelDir, size), path: whisperModelFile(this.modelDir, size) })))
    return { version: this.deps.version, platform: this.deps.platform, ffmpeg, ffprobe, whisperCpp: whisper, models, userDataDir: this.deps.userDataDir }
  }

  // ───── medya ─────

  importMedia(paths: string[]): string[] {
    return paths.map((file) => {
      const task = this.queue.add({
        kind: 'import',
        title: `İçe aktarılıyor: ${file.split(/[\\/]/).pop()}`,
        run: async (ctx) => {
          const asset = await importMedia(file, this.tools, this.dataDir, { signal: ctx.signal, progress: ctx.progress })
          this.assets.set(asset.id, asset)
          this.deps.emit('asset:added', asset)
          if (asset.kind !== 'image') this.queueProxy(asset)
        }
      })
      return task.id
    })
  }

  private queueProxy(asset: MediaAsset): void {
    this.queue.add({
      kind: 'proxy',
      title: `Önizleme kopyası: ${asset.name}`,
      run: async (ctx) => {
        const next = await makeProxy(asset, this.tools, this.dataDir, this.settings.value.proxyHeight, { signal: ctx.signal, progress: (f) => ctx.progress(f, `%${Math.round(f * 100)}`) })
        const cur = this.assets.get(asset.id) ?? asset
        const merged = { ...cur, proxyPath: next.proxyPath, proxyHeight: next.proxyHeight, audioStreams: cur.audioStreams.map((a, i) => ({ ...a, proxyPath: next.audioStreams[i]?.proxyPath })) }
        this.assets.set(asset.id, merged)
        this.deps.emit('asset:updated', merged)
      }
    })
  }

  async markers(assetId: string): Promise<Marker[]> {
    const a = this.assets.get(assetId)
    return a ? loadMarkers(a) : []
  }

  /** Kamera dosyası ekran kaydıyla aynı anda başladıysa ses zarflarının çapraz ilişkisinden ofseti bulur. */
  async syncOffset(screenId: string, camId: string): Promise<number> {
    const s = this.assets.get(screenId)
    const c = this.assets.get(camId)
    if (!s || !c) throw new ToolError('Senkron için iki medya da yüklü olmalı.')
    const env = async (a: MediaAsset) => (await audioLevelSeries(a, 0, this.tools, { binPerSec: 100, durationSec: Math.min(120, a.durationSec) })).map((db) => 10 ** (db / 20))
    const [ea, eb] = await Promise.all([env(s), env(c)])
    const r = estimateOffsetSec(ea, eb, 100, 15)
    if (r.confidence < 0.05) throw new ToolError('Ekran ve kamera sesleri arasında güvenilir bir eşleşme bulunamadı; ofseti elle girin.')
    return r.offsetSec
  }

  // ───── transkripsiyon ─────

  async transcriptStart(req: TranscribeRequest): Promise<string> {
    const asset = this.assets.get(req.assetId)
    if (!asset) throw new ToolError('Medya bulunamadı.')
    const s = this.settings.value
    const model = req.model ?? s.whisperModel
    if (s.provider === 'whisper-cpp' && !(await modelInstalled(this.modelDir, model))) {
      throw new ToolError(`Whisper "${model}" modeli kurulu değil. Ayarlar → Transkripsiyon bölümünden indirin (${whisperModelFile(this.modelDir, model)}).`)
    }
    const provider = createProvider(s, this.modelDir, join(this.deps.resourcesDir, 'faster_whisper_cli.py'), this.whisperBin)
    const task = this.queue.add({
      kind: 'transcribe',
      title: `Transkripsiyon: ${asset.name} (Track ${req.track + 1}, ${req.language})`,
      run: async (ctx) => {
        const { transcript, reused } = await transcribeAsset(asset, { track: req.track, language: req.language, model, force: req.force }, { tools: this.tools, provider, dataDir: this.dataDir, signal: ctx.signal, progress: ctx.progress })
        this.search.load(asset.id, transcript)
        this.deps.emit('transcript:ready', { assetId: asset.id, transcript, reused })
      }
    })
    return task.id
  }

  async transcriptGet(assetId: string): Promise<Transcript | null> {
    const cached = this.search.get(assetId)
    if (cached) return cached
    const t = await loadTranscript(this.dataDir, assetId)
    if (t) this.search.load(assetId, t)
    return t
  }

  async searchRun(req: SearchRequest): Promise<SearchResult[]> {
    if (!this.search.has(req.assetId)) {
      if (!(await this.transcriptGet(req.assetId))) throw new ToolError('Bu kayıt için henüz transkript yok. Önce "Transkripsiyonu başlat"a basın.')
    }
    const s = this.settings.value
    const options = { ...DEFAULT_SEARCH_OPTIONS, fuzzyThreshold: s.fuzzyThreshold, fuzzy: s.fuzzyEnabled, windowSec: s.windowSec, ...req.options }
    return this.search.search(req.assetId, req.query, options, !!req.semantic && s.semanticSearch)
  }

  // ───── sohbet / öneri ─────

  async chatImport(req: ChatImportRequest): Promise<{ chat: ChatLog; warnings: string[] }> {
    let buf: Buffer
    try {
      buf = await readFile(req.path)
    } catch {
      throw new ToolError('Sohbet dosyası okunamadı.')
    }
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
    const parsed = parseChatLog(text, req.path, { ...this.settings.value.chatColumns, ...req.mapping })
    const chat: ChatLog = {
      id: newId('chat'),
      assetId: req.assetId,
      sourceName: req.path.split(/[\\/]/).pop() ?? 'sohbet',
      importedAt: new Date().toISOString(),
      offsetSec: parsed.baseMs ?? 0,
      messages: parsed.messages
    }
    return { chat, warnings: parsed.warnings }
  }

  suggestStart(req: SuggestRequest): string {
    const asset = this.assets.get(req.assetId)
    if (!asset) throw new ToolError('Medya bulunamadı.')
    return this.queue.add({
      kind: 'analyze',
      title: `Otomatik öneri: ${asset.name}`,
      run: async (ctx) => {
        const hasAudio = asset.audioStreams.length > 0
        const audioDb = hasAudio ? await audioLevelSeries(asset, asset.transcriptionTrack, this.tools, { signal: ctx.signal, progress: (f) => ctx.progress(f * (req.sceneDetection ? 0.5 : 0.8), 'Ses analizi') }) : undefined
        let sceneCuts: number[] | undefined
        if (req.sceneDetection && asset.kind === 'video') {
          const file = asset.proxyPath ? join(this.dataDir, asset.proxyPath) : asset.path
          sceneCuts = await detectScenes(file, asset.durationSec, this.tools, { signal: ctx.signal, progress: (f) => ctx.progress(0.5 + f * 0.4, 'Sahne analizi') })
        }
        ctx.progress(0.92, 'Skorlanıyor')
        const transcript = await this.transcriptGet(asset.id)
        const markers = await loadMarkers(asset)
        const keywords = req.keywords?.length ? req.keywords : this.settings.value.suggestKeywords.length ? this.settings.value.suggestKeywords : DEFAULT_KEYWORDS
        const raw = scoreCandidates(asset.id, { durationSec: asset.durationSec, audioDb, chat: req.chat?.messages, words: transcript?.words, keywords, markers, sceneCuts })
        const candidates = transcript ? raw.map((c) => snapCandidate(transcript.segments, c, asset.durationSec)) : raw
        this.deps.emit('suggest:ready', { assetId: asset.id, candidates })
      }
    }).id
  }

  // ───── dışa aktarma ─────

  exportStart(req: ExportRequest): string {
    return this.queue.add({
      kind: 'export',
      title: `Dışa aktarma: ${req.name}`,
      run: async (ctx) => {
        const { outputPath, warnings } = await runExport(req, this.tools, { signal: ctx.signal, progress: ctx.progress })
        this.deps.emit('export:done', { taskId: ctx.id, outputPath, warnings })
      }
    }).id
  }

  downloadModel(size: WhisperModelSize): string {
    return this.queue.add({ kind: 'model-download', title: `Whisper modeli indiriliyor: ${size}`, run: (ctx) => downloadModel(this.modelDir, size, { signal: ctx.signal, progress: ctx.progress }) }).id
  }

  // ───── proje ─────

  newProject(): { dataDir: string } {
    this.assets.clear()
    this.projectPath = null
    this.dataDir = join(this.deps.userDataDir, 'projects', `session-${Date.now().toString(36)}`)
    this.search.clear()
    return { dataDir: this.dataDir }
  }

  async saveProject(project: Project, path: string): Promise<void> {
    const target = dataDirFor(path)
    if (target !== this.dataDir) {
      await copyDataDir(this.dataDir, target)
      this.dataDir = target
    }
    await mkdir(this.dataDir, { recursive: true })
    const ids = project.assets.filter((a) => this.search.has(a.id)).map((a) => a.id)
    await saveProject(project, path, ids)
    this.projectPath = path
  }

  async openProject(path: string): Promise<OpenedProject> {
    const project = await openProject(path)
    this.assets.clear()
    this.search.clear()
    this.projectPath = path
    this.dataDir = dataDirFor(path)
    for (const a of project.assets) this.assets.set(a.id, a)
    // Transkriptleri yan dosyalardan yükle: yeniden transkripsiyon gerekmez
    for (const a of project.assets) await this.transcriptGet(a.id)
    return { project, path }
  }

  /** cf-media:// isteği için dosya yolu çözümü (yalnızca kayıtlı medya ve türetilmiş dosyaları) */
  resolveMediaPath(assetId: string, kind: string, index = 0): string | null {
    const a = this.assets.get(assetId)
    if (!a) return null
    if (kind === 'image') return a.kind === 'image' ? a.path : null
    if (kind === 'thumb') return a.thumbnailPath ? join(this.dataDir, a.thumbnailPath) : null
    if (kind === 'audio') {
      const p = a.audioStreams[index]?.proxyPath
      return p ? join(this.dataDir, p) : null
    }
    if (a.proxyPath) return join(this.dataDir, a.proxyPath)
    return a.kind === 'video' && /\.(mp4|webm|mov)$/i.test(a.path) ? a.path : null
  }
}
