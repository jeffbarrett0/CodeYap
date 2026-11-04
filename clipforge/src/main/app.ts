import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseChatLog } from '../shared/chat/parse'
import { DEFAULT_SEARCH_OPTIONS } from '../shared/search/engine'
import { SearchService } from '../shared/search/service'
import { estimateOffsetSec } from '../shared/media/sync'
import { newId } from '../shared/timeline/model'
import { scoreCandidates, snapCandidate, DEFAULT_KEYWORDS } from '../shared/suggest/score'
import type { AppInfo, ChatImportRequest, ExportRequest, IpcEventName, IpcEvents, OpenedProject, SearchRequest, SuggestRequest, ToolStatus, TranscribeRequest } from '../shared/ipc'
import type { ChatLog, MediaAsset, Marker, Project, SearchResult, Timeline, Transcript, WhisperModelSize } from '../shared/types'
import { runExport } from './export'
import { resolveFfmpegPath, resolveFfprobePath, setCpuMode, ToolError, toolVersion } from './ffmpeg'
import { audioLevelSeries, detectScenes, extractWavChunk } from './media/audio'
import { importMedia, loadMarkers, type MediaTools } from './media/import'
import { makeProxy } from './media/proxy'
import { access } from 'node:fs/promises'
import { copyDataDir, dataDirFor, openProject, saveProject, seedDataDir } from './project/io'
import { assetsNeededFor, buildClipProject, safeFileName } from '../shared/project/clipProject'
import { SettingsStore, TemplateStore } from './settings-store'
import { TaskQueue, userMessage } from './tasks'
import { createEmbeddingProvider } from './embeddings'
import { downloadModel, modelInstalled } from './transcribe/models'
import { loadTranscript, saveTranscript, transcribeAsset } from './transcribe/pipeline'
import { applyVocabulary, buildPrompt, fixWord, parseVocabulary, withWords } from '../shared/transcript/vocabulary'
import { createProvider, whisperModelFile } from './transcribe/providers'
import { findVideoIdeas, type IdeasResult } from '../shared/ideas'
import { chapterWarnings, findChapters, formatChapters, type ChaptersResult } from '../shared/chapters'
import { timelineWords } from '../shared/timeline/transcript'
import { aiChapterTitles, enhanceIdeas, llmConfigured, translateLines } from './ideas/llm'

export interface AppDeps {
  userDataDir: string
  resourcesDir: string
  version: string
  platform: string
  emit: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
  /** Komut satırı: önizleme kopyaları (proxy) arka planda üretilmez */
  headless?: boolean
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
    setCpuMode(this.settings.value.cpuMode)
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
          if (asset.kind !== 'image' && !this.deps.headless) this.queueProxy(asset)
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

  /**
   * Çok ses track'li kayıtlarda (OBS: oyun / mikrofon / karışım) KONUŞMANIN hangi track'te olduğunu bulur: her track'ten
   * ~60 sn'lik örnek (kaydın %30'u ve gerekirse %60'ı) kısa transkribe edilir, en çok kelime çıkan track seçilir.
   * Tek track varsa soru yoktur. Hiçbirinden kelime çıkmazsa dosyanın varsayılan track'i döner.
   */
  async detectSpeechTrack(assetId: string, language: string, model?: WhisperModelSize, signal?: AbortSignal): Promise<{ track: number; words: number[] }> {
    const asset = this.assets.get(assetId)
    if (!asset) throw new ToolError('Medya bulunamadı.')
    const n = asset.audioStreams.length
    const fallback = Math.min(asset.transcriptionTrack ?? 0, Math.max(0, n - 1))
    if (n <= 1) return { track: 0, words: [] }
    const s = this.settings.value
    const m = model ?? s.whisperModel
    const provider = createProvider(s, this.modelDir, join(this.deps.resourcesDir, 'faster_whisper_cli.py'), this.whisperBin)
    const len = Math.min(60, asset.durationSec)
    const work = join(this.dataDir, 'tmp', `probe-${asset.id}`)
    await mkdir(work, { recursive: true })
    const words = new Array<number>(n).fill(0)
    try {
      for (const frac of [0.3, 0.6]) {
        const start = Math.max(0, (asset.durationSec - len) * frac)
        for (let t = 0; t < n; t++) {
          if (signal?.aborted) throw new ToolError('İptal edildi.')
          const wav = join(work, `p_${t}.wav`)
          await extractWavChunk(asset, t, start, len, wav, this.tools, signal)
          const w = await provider.transcribeChunk({ wavPath: wav, offsetSec: start, language, model: m, signal, workDir: work })
          words[t] += w.length
        }
        if (Math.max(...words) >= 8) break
      }
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined)
    }
    const best = Math.max(...words)
    return { track: best > 0 ? words.indexOf(best) : fallback, words }
  }

  /**
   * Video önerileri: transkriptten ayrı video olabilecek konu bölümlerini bulur; `useAi` ve sağlayıcı ayarlıysa
   * başlıkları yapay zekâ yazar (hata olursa taslak başlıklar kalır ve nedeni döner).
   */
  async ideasGenerate(req: { assetId: string; max?: number; useAi?: boolean }): Promise<IdeasResult> {
    const asset = this.assets.get(req.assetId)
    if (!asset) throw new ToolError('Medya bulunamadı.')
    const t = await this.transcriptGet(req.assetId)
    if (!t || t.words.length === 0) throw new ToolError('Önce bu kaydın transkripsiyonunu yapın (Kaynak sekmesi → Transkripsiyonu başlat).')
    let ideas = findVideoIdeas(t.words, req.max ? { max: req.max } : {})
    const s = this.settings.value
    const ai: IdeasResult['ai'] = { requested: !!req.useAi, used: false, provider: s.llmProvider }
    if (req.useAi && ideas.length > 0) {
      const problem = llmConfigured(s)
      if (problem) ai.error = problem
      else {
        const r = await enhanceIdeas(ideas, (i) => t.words.slice(i.firstWord, i.lastWord + 1).map((w) => w.text.trim()).join(' '), s)
        ideas = r.ideas
        ai.used = r.failed < ideas.length
        if (r.error) ai.error = r.failed === ideas.length ? r.error : `${r.failed} öneride başlık yazılamadı (taslak başlık kaldı): ${r.error}`
      }
    }
    return { ideas, totalSec: t.durationSec || asset.durationSec, ai }
  }

  /** Altyazı satırlarını çevirir (yapay zekâ sağlayıcısı Ayarlar → Yapay zekâ'nde seçilir); aynı sayıda metin döner */
  async translateTexts(req: { texts: string[]; to: string }): Promise<{ texts: string[] }> {
    if (req.texts.length === 0) return { texts: [] }
    const name = req.to === 'en' ? 'English' : req.to
    return { texts: await translateLines(req.texts, this.settings.value, name) }
  }

  /**
   * YouTube bölüm zamanları: verilen çizelgenin (düzenlenmiş video: kesimler, boşluk kapatma sonrası) transkriptinden
   * ardışık konu bölümleri ve başlıkları. Zamanlar çizelge zamanıdır = dışa aktarılan videonun zamanı.
   */
  async chaptersGenerate(req: { timeline: Timeline; useAi?: boolean }): Promise<ChaptersResult> {
    const ids = [...new Set(req.timeline.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))]
    const transcripts: Record<string, Transcript | undefined> = {}
    for (const id of ids) transcripts[id] = (await this.transcriptGet(id)) ?? undefined
    const words = timelineWords(req.timeline, transcripts)
    if (words.length === 0) throw new ToolError('Zaman çizelgesindeki içeriğin transkripti yok: önce kayıtları transkribe edin.')
    const totalSec = words[words.length - 1].end
    let chapters = findChapters(words)
    const ai: ChaptersResult['ai'] = { requested: !!req.useAi, used: false }
    if (req.useAi && chapters.length > 0) {
      const problem = llmConfigured(this.settings.value)
      if (problem) ai.error = problem
      else {
        const texts = chapters.map((c) => words.filter((w) => w.start >= c.start - 0.01 && w.end <= c.end + 0.5).map((w) => w.text.trim()).join(' '))
        const r = await aiChapterTitles(texts, chapters.map((c) => Math.max(1, Math.round((c.end - c.start) / 60))), this.settings.value)
        chapters = chapters.map((c, i) => (r.titles[i] ? { ...c, title: r.titles[i]!, titleSource: 'ai' as const } : c))
        ai.used = r.failed < chapters.length
        if (r.error) ai.error = r.failed === chapters.length ? r.error : `${r.failed} bölümde yapay zekâ başlığı yazılamadı (taslak başlık kaldı): ${r.error}`
      }
    }
    return { chapters, totalSec, text: formatChapters(chapters), warnings: chapterWarnings(chapters), ai }
  }

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
        const { transcript, reused } = await transcribeAsset(asset, { track: req.track, language: req.language, model, force: req.force, prompt: buildPrompt(s.vocabulary, s.transcribeFillers), vocabulary: parseVocabulary(s.vocabulary) }, { tools: this.tools, provider, dataDir: this.dataDir, signal: ctx.signal, progress: ctx.progress })
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

  /** Elle düzeltme: tek kelime ya da tüm geçişler; `remember` ile sözlüğe eklenir. Transkript diske yazılır, arama indeksi yenilenir. */
  async transcriptFix(req: { assetId: string; index: number; text: string; all: boolean; remember: boolean }): Promise<{ transcript: Transcript; replaced: number }> {
    const t = await this.transcriptGet(req.assetId)
    if (!t) throw new ToolError('Transkript bulunamadı.')
    if (!req.text.trim()) throw new ToolError('Düzeltme metni boş olamaz.')
    const r = fixWord(t, req.index, req.text, req.all)
    await saveTranscript(this.dataDir, r.transcript)
    this.search.load(req.assetId, r.transcript)
    if (req.remember) {
      const terms = parseVocabulary(this.settings.value.vocabulary)
      if (!terms.some((x) => x.toLocaleLowerCase('tr-TR') === req.text.trim().toLocaleLowerCase('tr-TR'))) {
        await this.settings.update({ vocabulary: [...terms, req.text.trim()].join('\n') })
      }
    }
    return r
  }

  /** Mevcut transkripte (yeniden üretmeden) güncel özel sözlüğü uygular */
  async transcriptApplyVocabulary(assetId: string): Promise<{ transcript: Transcript; corrections: number }> {
    const t = await this.transcriptGet(assetId)
    if (!t) throw new ToolError('Transkript bulunamadı.')
    const r = applyVocabulary(t.words, parseVocabulary(this.settings.value.vocabulary))
    const next = r.corrections.length ? withWords(t, r.words) : t
    if (r.corrections.length) {
      await saveTranscript(this.dataDir, next)
      this.search.load(assetId, next)
    }
    return { transcript: next, corrections: r.corrections.length }
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
        // YouTube bölüm zamanları: dışa aktarılan videonun yanına .txt (yalnızca tam video; hata dışa aktarmayı bozmaz)
        let timestampsPath: string | undefined
        if (req.timestamps && req.range.start <= 0.01) {
          try {
            const r = await this.chaptersGenerate({ timeline: req.timeline, useAi: llmConfigured(this.settings.value) === null })
            if (r.chapters.length >= 3) {
              timestampsPath = outputPath.replace(/\.mp4$/i, '') + ' - zaman damgaları.txt'
              await writeFile(timestampsPath, r.text + '\n', 'utf8')
            } else warnings.push('Zaman damgaları yazılmadı: ' + (r.warnings[0] ?? 'yeterli bölüm bulunamadı.'))
          } catch (e) {
            warnings.push('Zaman damgaları yazılamadı: ' + (e instanceof Error ? e.message : String(e)))
          }
        }
        this.deps.emit('export:done', { taskId: ctx.id, outputPath, warnings, timestampsPath })
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

  /**
   * Arama sonucundan bağımsız klip projesi: ana proje dosyasına/klasörüne dokunulmaz. Yeni proje dosyası
   * `<ana proje>-klipler/` altına (kayıtsız oturumda kullanıcı verisi altındaki `clips/`) yazılır; ilgili medya
   * aynı dosyalara işaret eder (kopyalanmaz), proxy/küçük resim/transkript sabit bağla taşınır.
   */
  async createClipProject(source: Project, assetId: string, name: string): Promise<{ path: string }> {
    const project = buildClipProject(source, assetId, name)
    if (!project) throw new ToolError('Klip için kaynak medya bulunamadı.')
    const folder = this.projectPath ? join(dirname(this.projectPath), `${basename(this.projectPath).replace(/\.clipforge$/i, '')}-klipler`) : join(this.deps.userDataDir, 'clips')
    await mkdir(folder, { recursive: true })
    const base = safeFileName(name)
    let path = join(folder, `${base}.clipforge`)
    for (let i = 2; await access(path).then(() => true, () => false); i++) path = join(folder, `${base} (${i}).clipforge`)
    const rel: string[] = []
    for (const a of assetsNeededFor(source, assetId)) {
      if (a.thumbnailPath) rel.push(a.thumbnailPath)
      if (a.proxyPath) rel.push(a.proxyPath)
      for (const s of a.audioStreams) if (s.proxyPath) rel.push(s.proxyPath)
      rel.push(`transcripts/${a.id}.json`)
    }
    await seedDataDir(this.dataDir, dataDirFor(path), rel)
    const ids = project.assets.map((a) => a.id)
    await saveProject(project, path, ids)
    return { path }
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
      if (p) return join(this.dataDir, p)
      // Ses önizleme kopyası henüz hazır değilken: tarayıcının doğrudan çalabildiği dosyalarda ilk ses akışı özgün dosyadan çalınır
      return index === 0 && /\.(mp4|m4v|mov|webm|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(a.path) ? a.path : null
    }
    if (a.proxyPath) return join(this.dataDir, a.proxyPath)
    return a.kind === 'video' && /\.(mp4|webm|mov)$/i.test(a.path) ? a.path : null
  }
}
