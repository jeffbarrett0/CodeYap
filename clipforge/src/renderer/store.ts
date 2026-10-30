import { create } from 'zustand'
import type { AppInfo } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { suggestClip, nearestBoundary, type ClipWarning } from '@shared/clip/boundaries'
import { History } from '@shared/timeline/history'
import { cmd, type TimelineCommand } from '@shared/timeline/commands'
import { captionsForTimeline } from '@shared/timeline/captions'
import { planSilenceCuts } from '@shared/timeline/silence'
import { timelineWords } from '@shared/timeline/transcript'
import { clipForTrack, clipItemsForSource, clipsForVideoWithAudio, retargetItems } from '@shared/timeline/create'
import { removeClipsOfAsset } from '@shared/timeline/ops'
import { clipEnd, createDefaultTimeline, findClip, groupMembers, nearestAspect, newId, timelineDuration } from '@shared/timeline/model'
import { optionsFromPreset, exportWarnings } from '@shared/export/presets'
import { EXPORT_PRESETS } from '@shared/export/presets'
import { PROJECT_VERSION } from '@shared/types'
import { BUILTIN_TEMPLATES, templateFromTimeline } from '@shared/timeline/templates'
import type { ChatLog, ClipCandidate, ExportOptions, LayoutTemplate, NormRect, MediaAsset, Project, SearchResult, Settings, TaskInfo, Timeline, Transcript } from '@shared/types'
import { requireApi } from './api'

/** Sağ panel sekmeleri: düzenleme (klip, katmanlar, ses, altyazı) ve bulma/kaynak (kaynak, arama, transkript, öneriler) */
export type RightTab = 'inspector' | 'layout' | 'audio' | 'captions' | 'source' | 'search' | 'transcript'
export type Dialog = null | 'settings' | 'export' | 'clip' | 'help'

export interface Toast {
  id: string
  kind: 'error' | 'info' | 'success'
  text: string
}

export interface ClipDraft {
  assetId: string
  start: number
  end: number
  query?: string
  resultId?: string
  matchTime?: number
  candidateId?: string
  hitStart: number
  hitEnd: number
  firstWord: number
  lastWord: number
  warnings: ClipWarning[]
  /** Hedef süre (0 = pre/post-roll modu) */
  targetSec: number
  preRoll: number
  postRoll: number
  title: string
}

const newProject = (): Project => ({
  version: PROJECT_VERSION,
  id: newId('proj'),
  name: 'Adsız proje',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  assets: [],
  timeline: createDefaultTimeline(),
  chatLogs: [],
  candidates: [],
  markers: {},
  searchHistory: [],
  transcriptRefs: {},
  exportJobs: []
})

interface IndependentClipReq {
  assetId: string
  start: number
  end: number
  query?: string
  resultId?: string
  matchTime?: number
  label: string
}

/**
 * Bağımsız klip projesi akışı. ANA PROJE DEĞİŞMEZ: kaydedilmemiş değişiklik varsa önce kullanıcı onayıyla kaydedilir
 * (yoksa çalışma alanı değişince kaybolurdu), ardından yeni proje dosyası üretilir, açılır, klip eklenir ve kaydedilir.
 */
async function createIndependent(get: () => State, set: (p: Partial<State>) => void, req: IndependentClipReq): Promise<void> {
  const s0 = get()
  if (s0.dirty || !s0.projectPath) {
    if (!window.confirm('Yeni klip ayrı bir projede açılacak. Ana proje önce kaydedilsin mi? (Ana proje olduğu gibi kalır; "Ana projeye dön" ile geri dönebilirsiniz.)')) return
    await get().saveProject(!s0.projectPath)
    if (get().dirty || !get().projectPath) return get().toast('info', 'Ana proje kaydedilmediği için yeni klip projesi oluşturulmadı.')
  }
  const mainPath = get().projectPath!
  try {
    const { path } = await requireApi().invoke('project:createClip', get().project, req.assetId, req.label)
    if (!(await get().openProject(path))) return
    set({ parentProjectPath: mainPath })
    set({
      clipDraft: { assetId: req.assetId, query: req.query, resultId: req.resultId, matchTime: req.matchTime, start: req.start, end: req.end, hitStart: req.start, hitEnd: req.end, firstWord: 0, lastWord: 0, preRoll: 0, postRoll: 0, targetSec: 0, title: req.label, warnings: [] } as ClipDraft
    })
    get().commitDraft()
    await get().saveProject()
    set({ rightTab: 'inspector' })
    get().toast('success', `Yeni bağımsız proje açıldı: "${req.label}" (${(req.end - req.start).toFixed(1)} sn). Ana proje değişmedi.`)
  } catch (e) {
    get().toast('error', errText(e))
  }
}

/** Geri al / yinele geçmişi (komut deseni); store yalnızca sürüm sayacını tutar. */
const history = new History<Timeline>(createDefaultTimeline())
/** StrictMode efektleri iki kez çalıştırsa da olay abonelikleri bir kez kurulur */
let initialized = false

interface State {
  ready: boolean
  settings: Settings
  appInfo: AppInfo | null
  project: Project
  projectPath: string | null
  dirty: boolean
  historyVersion: number

  rightTab: RightTab
  dialog: Dialog
  viewMode: 'source' | 'timeline'
  selectedAssetId: string | null
  selection: string[]
  playhead: number
  sourceTime: number
  playing: boolean
  zoom: number

  selectedLayerId: string | null
  selectedCaptionId: string | null
  /** Birden çok altyazı seçiliyken (katman bazlı "tümünü seç") */
  selectedCaptionIds: string[]
  /** Bağımsız klip projesi açıksa, çıkış yapılan ana projenin dosya yolu */
  parentProjectPath: string | null
  /** "Yeni projede klip" için seçili süre (sn) */
  newClipSec: number
  /** Etkin zaman çizelgesi katmanı (iz kimliği ya da 'CC'): Ctrl+A yalnızca bunu seçer */
  activeLane: string | null
  /** Kırpma modunda düzenlenen klip */
  cropClipId: string | null
  userTemplates: LayoutTemplate[]
  transcripts: Record<string, Transcript>
  tasks: Record<string, TaskInfo>
  toasts: Toast[]

  query: string
  results: SearchResult[]
  searching: boolean
  searchedAssetId: string | null
  selectedResults: string[]
  chatError: string | null
  suggesting: boolean
  clipDraft: ClipDraft | null
  lastExport: string | null

  // eylemler
  init(): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  dismissToast(id: string): void
  /** Kütüphanede bir dosyaya tıklama: seçer, kaynak oynatıcıda açar ve oynatmayı başlatır */
  playAsset(id: string): void
  /** Her artışta kaynak oynatıcı oynatmayı başlatır */
  playRequest: number
  setRightTab(t: RightTab): void
  openDialog(d: Dialog): void
  setViewMode(m: 'source' | 'timeline'): void
  updateSettings(patch: Partial<Settings>): Promise<void>

  importPaths(paths: string[]): Promise<void>
  pickAndImport(): Promise<void>
  selectAsset(id: string | null): void
  patchAsset(id: string, patch: Partial<MediaAsset>): void
  startTranscription(assetId: string, force?: boolean): Promise<void>

  runSearch(query: string): Promise<void>
  toggleResult(id: string): void
  openDraftFromResult(r: SearchResult): void
  openDraftFromCandidate(c: ClipCandidate): void
  patchDraft(p: Partial<ClipDraft>): void
  recomputeDraft(p?: Partial<ClipDraft>): void
  snapDraft(edge: 'start' | 'end'): void
  commitDraft(): void
  createClipsFromResults(ids: string[]): void
  /** Medya kütüphanesinden bir dosyayı doğrudan bir ize ekler (sürükle-bırak ya da düğme) */
  addAssetToTrack(assetId: string, trackId: string, opts?: { at?: number; srcIn?: number; duration?: number; audioStream?: number; withAudio?: boolean }): void

  importChat(path?: string): Promise<void>
  runSuggest(sceneDetection: boolean): Promise<void>
  setCandidateStatus(id: string, status: ClipCandidate['status']): void
  adjustCandidate(id: string, patch: Partial<Pick<ClipCandidate, 'start' | 'end'>>): void

  exec(c: TimelineCommand): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  select(ids: string[]): void
  splitAtPlayhead(): void
  /** Seçili klibi siler. Varsayılan: YALNIZCA seçili klip; `withLinked` (Shift+Delete) bağlı görüntü/ses klipleriyle birlikte */
  deleteSelection(withLinked?: boolean): void
  deleteCaption(id: string): void
  /** Altyazıları toplu siler (tek geri alma adımı); ids verilmezse hepsi */
  deleteCaptions(ids?: string[]): void
  /** Zaman çizelgesindeki klipleri toplu seçer (izId verilirse yalnızca o iz; kilitli izler hariç) */
  selectAllClips(trackId?: string): void
  /** Bir izdeki (ya da hepsindeki) tüm klipleri siler; kilitli izler atlanır */
  clearClips(trackId?: string): void
  /** Kütüphaneden birden çok dosyayı tek onayla kaldırır (diskteki dosyalara dokunmaz) */
  removeAssets(ids: string[]): void
  clearResults(): void
  setNewClipSec(sec: number): void
  /** Arama sonucunun etrafından `sec` sn'lik (cümle sınırlarına yapışan) klibi YENİ, bağımsız bir projede açar; ana proje değişmez */
  createClipProjectFromResult(r: SearchResult, sec?: number): Promise<void>
  /** Hazır aralıktan (taslak) bağımsız klip projesi */
  createClipProjectFromDraft(): Promise<void>
  returnToParent(): Promise<void>
  setActiveLane(id: string | null): void
  /** Yalnızca bu katmandaki öğeleri seçer ('CC' = altyazılar) */
  selectLane(laneId: string): void
  /** Yalnızca bu katmandaki öğeleri siler (tek geri alma adımı; diğer katmanlar etkilenmez) */
  deleteLane(laneId: string): void
  /** Dosyayı kütüphaneden kaldırır (diskteki dosyaya dokunmaz); zaman çizelgesinde kullanılıyorsa onay ister */
  removeAsset(id: string): void
  generateCaptions(): void
  setPlayhead(t: number): void
  setSourceTime(t: number): void
  setPlaying(p: boolean): void
  setZoom(z: number): void

  newProject(): Promise<void>
  openProject(path?: string | null): Promise<boolean>
  saveProject(saveAs?: boolean): Promise<void>
  startExport(opts: { options: ExportOptions; name: string; mode: 'all' | 'each' | 'selection' }): Promise<void>
  cancelTask(id: string): void

  selectLayer(id: string | null): void
  startCrop(clipId: string): void
  endCrop(): void
  /** Klibin kırpmasını ayarlar (kaynak karesine göre 0..1); undefined = kırpmayı kaldır */
  setCrop(clipId: string, crop: NormRect | undefined, coalesce?: boolean): void
  /** Altyazı seç: Altyazı sekmesini açar; `seek` ile oynatma başlığı altyazının başına gider (önizlemede görünür olsun) */
  selectCaption(id: string | null, seek?: boolean): void
  loadTemplates(): Promise<void>
  applyLayoutTemplate(tpl: LayoutTemplate): void
  saveLayoutTemplate(name: string): Promise<void>
  deleteLayoutTemplate(id: string): Promise<void>
  /** Katmanı (iz) kare içinde gösterir/gizler */
  toggleLayerVisible(trackId: string): void
  /** Zaman damgasına atla: zaman çizelgesi modunda oynatma başlığı, kaynak modunda kaynak oynatıcı */
  jumpTo(sec: number): void
  /** Transkriptten kesme: çizelge zamanında [a, b) aralığını tüm izlerden siler (ripple: sonrası kayar) */
  cutTimelineRange(a: number, b: number, ripple: boolean): void
  openDraftFromRange(assetId: string, start: number, end: number, firstWord: number, lastWord: number): void
  joinSelected(): void
  closeGaps(): void
  /** Tek tıkla: konuşma olmayan sessizlikleri ve ııı/eee gibi dolgu seslerini zaman çizelgesinden keser */
  cutSilence(): void
  /** Transkripti elle düzelt (tek kelime / tüm geçişler; sözlüğe ekle) */
  fixTranscriptWord(assetId: string, index: number, text: string, all: boolean): Promise<void>
  applyVocabulary(assetId: string): Promise<void>
  /** Klip eklendikten sonra: kullanıcının eklediği boş metin katmanlarını doldurur */
  afterClipsAdded(trackIds?: string[]): void
  /**
   * İlk video eklenmeden ÖNCE çağrılır: oran otomatikse ve zaman çizelgesinde henüz görüntü yoksa, oranı eklenecek videonun
   * gerçek boyutuna göre ayarlar. Oran elle seçilmişse ya da zaman çizelgesinde zaten görüntü varsa dokunmaz.
   */
  autoAspectFor(asset: MediaAsset | undefined): void
  /** Oranı videonun boyutuna göre yeniden hesaplanır hâle getirir (zaman çizelgesindeki ilk videoya bakar) */
  enableAutoAspect(): void
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const useStore = create<State>()((set, get) => {
  const api = () => requireApi()
  const mutateProject = (f: (p: Project) => Project) => set((s) => ({ project: f(s.project), dirty: true }))
  const setTimeline = (tl: Timeline) => set((s) => ({ project: { ...s.project, timeline: tl }, dirty: true, historyVersion: s.historyVersion + 1 }))

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    appInfo: null,
    project: newProject(),
    projectPath: null,
    dirty: false,
    historyVersion: 0,
    playRequest: 0,
    rightTab: 'layout',
    dialog: null,
    viewMode: 'source',
    selectedAssetId: null,
    selection: [],
    playhead: 0,
    sourceTime: 0,
    playing: false,
    zoom: 40,
    selectedLayerId: null,
    selectedCaptionId: null,
    selectedCaptionIds: [],
    parentProjectPath: null,
    newClipSec: 20,
    activeLane: null,
    cropClipId: null,
    userTemplates: [],
    transcripts: {},
    tasks: {},
    toasts: [],
    query: '',
    results: [],
    searching: false,
    searchedAssetId: null,
    selectedResults: [],
    chatError: null,
    suggesting: false,
    clipDraft: null,
    lastExport: null,

    async init() {
      if (initialized) return
      initialized = true
      const a = api()
      const [settings, appInfo, tasks] = await Promise.all([a.invoke('settings:get'), a.invoke('app:info'), a.invoke('task:list')])
      set({ settings, appInfo, tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), ready: true })
      void get().loadTemplates()
      a.on('task:update', (t) => {
        set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }))
        if (t.status === 'failed') get().toast('error', `${t.title}: ${t.error ?? 'Bilinmeyen hata'}`)
      })
      a.on('asset:added', (asset) => {
        mutateProject((p) => ({ ...p, assets: [...p.assets.filter((x) => x.id !== asset.id), asset] }))
        // Otomatik seçme/oynatma YOK: orta alan, kullanıcı kütüphanede bir dosyaya tıklayana kadar boş kalır
        void a.invoke('media:markers', asset.id).then((m) => mutateProject((p) => ({ ...p, markers: { ...p.markers, [asset.id]: m } })))
      })
      a.on('asset:updated', (asset) => mutateProject((p) => ({ ...p, assets: p.assets.map((x) => (x.id === asset.id ? { ...x, proxyPath: asset.proxyPath, proxyHeight: asset.proxyHeight, audioStreams: asset.audioStreams } : x)) })))
      a.on('transcript:ready', ({ assetId, transcript, reused }) => {
        set((s) => ({ transcripts: { ...s.transcripts, [assetId]: transcript } }))
        get().toast('success', reused ? 'Kayıtlı transkript yüklendi (yeniden işlenmedi).' : `Transkripsiyon tamamlandı: ${transcript.words.length} kelime.`)
      })
      a.on('suggest:ready', ({ assetId, candidates }) => {
        mutateProject((p) => ({ ...p, candidates: [...p.candidates.filter((c) => c.assetId !== assetId), ...candidates] }))
        set({ suggesting: false })
        get().toast('info', candidates.length ? `${candidates.length} aday bulundu.` : 'Belirgin bir tepki anı bulunamadı.')
      })
      a.on('export:done', ({ outputPath, warnings }) => {
        set({ lastExport: outputPath })
        for (const w of warnings ?? []) get().toast('info', w)
      })
      a.on('menu:command', (c) => {
        const g = get()
        if (c === 'import') void g.pickAndImport()
        else if (c === 'open') void g.openProject()
        else if (c === 'save') void g.saveProject(false)
        else if (c === 'saveAs') void g.saveProject(true)
        else if (c === 'export') g.openDialog('export')
      })
    },

    toast(kind, text) {
      const id = newId('toast')
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
      if (kind !== 'error') setTimeout(() => get().dismissToast(id), 5000)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    playAsset: (id) => set((s) => ({ selectedAssetId: id, rightTab: 'source', viewMode: 'source', sourceTime: 0, playRequest: s.playRequest + 1 })),
    setRightTab: (rightTab) => set({ rightTab }),
    openDialog: (dialog) => set({ dialog }),
    setViewMode: (viewMode) => set({ viewMode }),
    async updateSettings(patch) {
      try {
        set({ settings: await api().invoke('settings:set', patch) })
      } catch (e) {
        get().toast('error', errText(e))
      }
    },

    // ───── medya ─────
    async importPaths(paths) {
      if (paths.length === 0) return
      try {
        await api().invoke('media:import', paths)
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    async pickAndImport() {
      try {
        await get().importPaths(await api().invoke('dialog:openMedia'))
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    selectAsset: (id) => set({ selectedAssetId: id }),
    patchAsset: (id, patch) => mutateProject((p) => ({ ...p, assets: p.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    async startTranscription(assetId, force = false) {
      const { settings, project } = get()
      const asset = project.assets.find((a) => a.id === assetId)
      if (!asset) return
      try {
        await api().invoke('transcript:start', { assetId, track: asset.transcriptionTrack, language: settings.language, model: settings.whisperModel, force })
      } catch (e) {
        get().toast('error', errText(e))
      }
    },

    // ───── arama ─────
    async runSearch(query) {
      const q = query.trim()
      const { selectedAssetId, settings } = get()
      set({ query })
      if (!q) return set({ results: [], selectedResults: [] })
      if (!selectedAssetId) return get().toast('info', 'Önce bir kayıt içe aktarın ve seçin.')
      set({ searching: true })
      try {
        let tr = get().transcripts[selectedAssetId]
        if (!tr) {
          tr = (await api().invoke('transcript:get', selectedAssetId)) as Transcript
          if (tr) set((s) => ({ transcripts: { ...s.transcripts, [selectedAssetId]: tr } }))
        }
        if (!tr) {
          set({ searching: false, results: [] })
          return get().toast('info', 'Bu kayıt için transkript yok. Medya sekmesinden "Transkripsiyonu başlat"a basın.')
        }
        const results = await api().invoke('search:run', { assetId: selectedAssetId, query: q, semantic: settings.semanticSearch })
        mutateProject((p) => ({ ...p, searchHistory: [q, ...p.searchHistory.filter((h) => h !== q)].slice(0, 10) }))
        set({ results, searchedAssetId: selectedAssetId, selectedResults: [], searching: false })
      } catch (e) {
        set({ searching: false, results: [] })
        get().toast('error', errText(e))
      }
    },
    toggleResult: (id) => set((s) => ({ selectedResults: s.selectedResults.includes(id) ? s.selectedResults.filter((x) => x !== id) : [...s.selectedResults, id] })),

    openDraftFromResult(r) {
      const { searchedAssetId, query, settings } = get()
      if (!searchedAssetId) return
      set({ clipDraft: null })
      get().recomputeDraft({
        assetId: searchedAssetId,
        query,
        resultId: r.id,
        matchTime: r.start,
        hitStart: r.start,
        hitEnd: r.end,
        firstWord: r.firstWord,
        lastWord: r.lastWord,
        preRoll: settings.preRollSec,
        postRoll: settings.postRollSec,
        targetSec: settings.targetDurationSec,
        title: `"${query}" · ${r.sentence.slice(0, 60)}`
      })
      set({ viewMode: 'source' })
    },
    openDraftFromCandidate(c) {
      const { settings, transcripts } = get()
      const tr = transcripts[c.assetId]
      const fw = tr ? Math.max(0, tr.words.findIndex((w) => w.start >= c.peak)) : 0
      set({ clipDraft: null })
      get().recomputeDraft({
        assetId: c.assetId,
        candidateId: c.id,
        matchTime: c.peak,
        hitStart: c.start,
        hitEnd: c.end,
        firstWord: fw,
        lastWord: fw,
        preRoll: 0,
        postRoll: 0,
        targetSec: 0,
        title: c.reasons[0]?.label ?? 'Öneri'
      })
      // adayın kendi sınırlarını kullan
      get().patchDraft({ start: c.start, end: c.end })
      set({ viewMode: 'source' })
    },
    recomputeDraft(p = {}) {
      const s = get()
      const base = { ...(s.clipDraft ?? ({} as ClipDraft)), ...p } as ClipDraft
      const asset = s.project.assets.find((a) => a.id === base.assetId)
      if (!asset) return
      const segments = s.transcripts[base.assetId]?.segments ?? []
      const sug = suggestClip(segments, { start: base.hitStart, end: base.hitEnd, firstWord: base.firstWord, lastWord: base.lastWord }, {
        preRollSec: base.preRoll,
        postRollSec: base.postRoll,
        targetDurationSec: base.targetSec || undefined,
        maxDurationSec: s.settings.exportDefaults.maxDurationSec ?? 60,
        assetDurationSec: asset.durationSec
      })
      set({ clipDraft: { ...base, start: sug.start, end: sug.end, warnings: sug.warnings } })
      set({ sourceTime: sug.start })
    },
    patchDraft(p) {
      const s = get()
      if (!s.clipDraft) return
      const asset = s.project.assets.find((a) => a.id === s.clipDraft!.assetId)
      const next = { ...s.clipDraft, ...p }
      next.start = Math.max(0, Math.min(next.start, next.end - 0.5))
      if (asset) next.end = Math.min(asset.durationSec, Math.max(next.end, next.start + 0.5))
      const warnings: ClipWarning[] = []
      const max = s.settings.exportDefaults.maxDurationSec ?? 60
      if (next.end - next.start > max) warnings.push({ code: 'exceeds_max', message: `Klip ${(next.end - next.start).toFixed(1)} sn; platform sınırı ${max} sn.` })
      if (next.targetSec && next.end - next.start > next.targetSec + 0.5) warnings.push({ code: 'exceeds_max', message: `Klip hedef süreyi (${next.targetSec} sn) aşıyor.` })
      set({ clipDraft: { ...next, warnings } })
    },
    snapDraft(edge) {
      const s = get()
      const d = s.clipDraft
      if (!d) return
      const asset = s.project.assets.find((a) => a.id === d.assetId)
      const segs = s.transcripts[d.assetId]?.segments ?? []
      const pad = { padStartSec: 0.12, padEndSec: 0.3, assetDurationSec: asset?.durationSec ?? Infinity }
      get().patchDraft(edge === 'start' ? { start: nearestBoundary(segs, d.start, 'start', pad) } : { end: nearestBoundary(segs, d.end, 'end', pad) })
    },
    commitDraft() {
      const s = get()
      const d = s.clipDraft
      if (!d) return
      const asset = s.project.assets.find((a) => a.id === d.assetId)
      if (!asset) return
      const items = clipItemsForSource(asset, { start: d.start, end: d.end }, timelineDuration(s.project.timeline), { query: d.query, resultId: d.resultId, matchTime: d.matchTime, candidateId: d.candidateId }, (id) => s.project.assets.find((a) => a.id === id))
      const at = timelineDuration(s.project.timeline)
      const placed = retargetItems(s.project.timeline, items)
      const firstVideo = placed.find((i) => s.project.timeline.tracks.find((t) => t.id === i.trackId)?.kind === 'video')
      get().autoAspectFor(firstVideo ? s.project.assets.find((a) => a.id === firstVideo.clip.assetId) : undefined)
      get().exec(cmd.addClips(placed.map((i) => ({ ...i, clip: { ...i.clip, start: at + (i.clip.start - items[0].clip.start) } }))))
      get().afterClipsAdded(placed.map((i) => i.trackId))
      if (d.candidateId) get().setCandidateStatus(d.candidateId, 'accepted')
      set({ clipDraft: null, dialog: null, selection: placed.slice(0, 1).map((i) => i.clip.id), viewMode: 'timeline', rightTab: 'inspector' })
      get().setPlayhead(at)
      if (!placed.some((i) => get().project.timeline.tracks.find((t) => t.id === i.trackId)?.kind === 'video') && items.some((i) => i.clip.audioStream === undefined)) get().toast('info', 'Görüntü eklenmedi: zaman çizelgesinde video katmanı yok. Katmanlar → "+ Video" ile ekleyebilirsiniz.')
      get().toast('success', `Klip zaman çizelgesine eklendi (${(d.end - d.start).toFixed(1)} sn).`)
    },
    addAssetToTrack(assetId, trackId, opts = {}) {
      const s = get()
      const asset = s.project.assets.find((a) => a.id === assetId)
      const track = s.project.timeline.tracks.find((t) => t.id === trackId)
      if (!asset || !track) return
      const at = opts.at ?? s.playhead
      if (track.kind === 'video') get().autoAspectFor(asset)
      let firstId: string
      let withSound = false
      if (track.kind === 'video') {
        // Video katmanına eklenen videonun SESİ de (bağlı klip olarak) ses izine eklenir
        const r = clipsForVideoWithAudio(asset, track, s.project.timeline.tracks, { at, srcIn: opts.srcIn, duration: opts.duration, withAudio: opts.withAudio })
        if ('error' in r) return get().toast('error', r.error)
        get().exec(cmd.addClips(r.items, 'Dosya ekle'))
        firstId = r.items[0].clip.id
        withSound = r.items.length > 1
        if (asset.audioStreams.length === 0) get().toast('info', 'Bu videoda ses yok.')
      } else {
        const r = clipForTrack(asset, track, { at, srcIn: opts.srcIn, duration: opts.duration, audioStream: opts.audioStream })
        if ('error' in r) return get().toast('error', r.error)
        get().exec(cmd.addClip(trackId, r.clip))
        firstId = r.clip.id
      }
      // Kullanıcı bilerek ekledi: kapalı katman görünür olsun
      if (track.placement && !track.placement.visible) get().exec(cmd.placement(trackId, { visible: true }, false))
      get().exec(cmd.fillText())
      set({ selection: [firstId] })
      get().toast('success', `"${asset.name}" → ${track.name}${withSound ? ' (sesiyle birlikte)' : ''}`)
    },
    createClipsFromResults(ids) {
      const s = get()
      const asset = s.project.assets.find((a) => a.id === s.searchedAssetId)
      if (!asset) return
      const segs = s.transcripts[asset.id]?.segments ?? []
      const byId = (id: string) => s.project.assets.find((a) => a.id === id)
      let at = timelineDuration(s.project.timeline)
      const items = []
      let warned = 0
      for (const r of s.results.filter((x) => ids.includes(x.id))) {
        const sug = suggestClip(segs, r, { preRollSec: s.settings.preRollSec, postRollSec: s.settings.postRollSec, targetDurationSec: s.settings.targetDurationSec || undefined, maxDurationSec: s.settings.exportDefaults.maxDurationSec ?? 60, assetDurationSec: asset.durationSec })
        if (sug.warnings.length) warned++
        const its = clipItemsForSource(asset, sug, at, { query: s.query, resultId: r.id, matchTime: r.start }, byId)
        items.push(...its)
        at += sug.duration
      }
      if (items.length === 0) return
      const placed = retargetItems(s.project.timeline, items)
      const firstVideo = placed.find((i) => s.project.timeline.tracks.find((t) => t.id === i.trackId)?.kind === 'video')
      get().autoAspectFor(firstVideo ? s.project.assets.find((a) => a.id === firstVideo.clip.assetId) : undefined)
      get().exec(cmd.addClips(placed, 'Toplu klip oluştur'))
      get().afterClipsAdded(placed.map((i) => i.trackId))
      set({ selectedResults: [], viewMode: 'timeline' })
      get().toast(warned ? 'info' : 'success', `${ids.length} klip eklendi${warned ? ` (${warned} klipte uyarı var: süre/sınır kontrolü önerilir)` : ''}.`)
    },

    // ───── sohbet / öneri ─────
    async importChat(path) {
      const { selectedAssetId } = get()
      if (!selectedAssetId) return get().toast('info', 'Önce bir kayıt seçin.')
      try {
        const p = path ?? (await api().invoke('dialog:openFile', { title: 'Sohbet dökümü', extensions: ['csv', 'json', 'txt', 'tsv'] }))
        if (!p) return
        const { chat, warnings } = await api().invoke('chat:import', { path: p, assetId: selectedAssetId })
        mutateProject((pr) => ({ ...pr, chatLogs: [...pr.chatLogs.filter((c) => c.assetId !== selectedAssetId), chat] }))
        set({ chatError: null })
        get().toast('success', `${chat.messages.length} sohbet mesajı içe aktarıldı.${warnings.length ? ' ' + warnings[0] : ''}`)
      } catch (e) {
        set({ chatError: errText(e) })
      }
    },
    async runSuggest(sceneDetection) {
      const { selectedAssetId, project, settings } = get()
      if (!selectedAssetId) return get().toast('info', 'Önce bir kayıt seçin.')
      const chat: ChatLog | undefined = project.chatLogs.find((c) => c.assetId === selectedAssetId)
      set({ suggesting: true })
      try {
        await api().invoke('suggest:start', { assetId: selectedAssetId, chat, keywords: settings.suggestKeywords, sceneDetection })
      } catch (e) {
        set({ suggesting: false })
        get().toast('error', errText(e))
      }
    },
    setCandidateStatus: (id, status) => mutateProject((p) => ({ ...p, candidates: p.candidates.map((c) => (c.id === id ? { ...c, status } : c)) })),
    adjustCandidate: (id, patch) => mutateProject((p) => ({ ...p, candidates: p.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

    // ───── zaman çizelgesi ─────
    exec(c) {
      setTimeline(history.execute(c))
    },
    undo() {
      if (history.canUndo) setTimeline(history.undo())
    },
    redo() {
      if (history.canRedo) setTimeline(history.redo())
    },
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    // Klip seçilince "Klip" sekmesine yalnızca düzenleme sekmelerindeyken geçilir; arama/transkript/kaynak sekmesindeki çalışma bölünmez
    select: (ids) => set((st) => ({ selection: ids, selectedCaptionId: ids.length ? null : st.selectedCaptionId, selectedCaptionIds: ids.length ? [] : st.selectedCaptionIds, rightTab: ids.length && !['source', 'search', 'transcript'].includes(st.rightTab) ? 'inspector' : st.rightTab })),
    splitAtPlayhead() {
      const { project, selection, playhead } = get()
      const tl = project.timeline
      // Seçili klip yoksa oynatma başlığının altındaki tüm klipler bölünür
      const targets = selection.length
        ? selection
        : tl.tracks.flatMap((t) => t.clips.filter((c) => playhead > c.start && playhead < clipEnd(c)).map((c) => c.id))
      const done = new Set<string>()
      for (const id of targets) {
        const f = findClip(get().project.timeline, id)
        if (!f || done.has(id)) continue
        groupMembers(get().project.timeline, id).forEach((m) => done.add(m.id))
        get().exec(cmd.split(id, playhead))
      }
    },
    deleteSelection(withLinked = false) {
      const { selection } = get()
      if (selection.length === 0) return
      get().exec(selection.length === 1 ? cmd.remove(selection[0], false, !withLinked) : cmd.removeMany(selection, !withLinked))
      set({ selection: [] })
    },
    deleteCaptions(ids) {
      const caps = get().project.timeline.captions
      const keep = ids ? caps.filter((c) => !ids.includes(c.id)) : []
      if (keep.length === caps.length) return
      get().exec(cmd.captions(keep))
      set({ selectedCaptionId: null, selectedCaptionIds: [] })
      get().toast('info', `${caps.length - keep.length} altyazı silindi. Geri almak için Ctrl+Z.`)
    },
    selectAllClips(trackId) {
      const tl = get().project.timeline
      const ids = tl.tracks.filter((t) => !t.locked && (!trackId || t.id === trackId)).flatMap((t) => t.clips.map((c) => c.id))
      set({ selection: ids })
    },
    clearClips(trackId) {
      const tl = get().project.timeline
      const tracks = tl.tracks.filter((t) => !t.locked && (!trackId || t.id === trackId))
      const ids = tracks.flatMap((t) => t.clips.map((c) => c.id))
      if (ids.length === 0) return get().toast('info', 'Silinecek klip yok.')
      if (!window.confirm(`${ids.length} klip silinecek${trackId ? '' : ' (tüm katmanlar)'}. Ctrl+Z ile geri alınabilir. Devam edilsin mi?`)) return
      get().exec(cmd.removeMany(ids, true, 'Klipleri temizle'))
      set({ selection: [] })
    },
    removeAssets(ids) {
      const s = get()
      const list = s.project.assets.filter((a) => ids.includes(a.id))
      if (list.length === 0) return
      const used = s.project.timeline.tracks.reduce((n, t) => n + t.clips.filter((c) => ids.includes(c.assetId)).length, 0)
      const msg = used > 0 ? `${list.length} dosya kütüphaneden kaldırılacak; zaman çizelgesinde kullanılan ${used} klip de silinir ve işlem geri alınamaz. Devam edilsin mi?` : `${list.length} dosya kütüphaneden kaldırılacak (diskteki dosyalara dokunulmaz). Devam edilsin mi?`
      if (!window.confirm(msg)) return
      let tl = s.project.timeline
      if (used > 0) {
        for (const id of ids) tl = removeClipsOfAsset(tl, id)
        history.clear(tl)
      }
      const transcripts = { ...s.transcripts }
      for (const id of ids) delete transcripts[id]
      set({
        project: {
          ...s.project,
          timeline: tl,
          assets: s.project.assets.filter((a) => !ids.includes(a.id)).map((a) => ({ ...a, webcamAssetId: a.webcamAssetId && ids.includes(a.webcamAssetId) ? undefined : a.webcamAssetId, sources: a.sources ? Object.fromEntries(Object.entries(a.sources).filter(([, v]) => !ids.includes(v as string))) : a.sources }))
        },
        dirty: true,
        transcripts,
        selectedAssetId: s.selectedAssetId && ids.includes(s.selectedAssetId) ? null : s.selectedAssetId,
        selection: used > 0 ? [] : s.selection,
        historyVersion: s.historyVersion + 1,
        playing: false
      })
      get().toast('info', `${list.length} dosya kütüphaneden kaldırıldı (diskteki dosyalar silinmedi).`)
    },
    setActiveLane: (id) => set({ activeLane: id }),
    selectLane(laneId) {
      const tl = get().project.timeline
      if (laneId === 'CC') {
        if (tl.captions.length === 0) return get().toast('info', 'Altyazı katmanı boş.')
        return set({ activeLane: 'CC', selection: [], selectedCaptionId: null, selectedCaptionIds: tl.captions.map((c) => c.id) })
      }
      const t = tl.tracks.find((x) => x.id === laneId)
      if (!t) return
      if (t.locked) return get().toast('info', `"${t.name}" katmanı kilitli.`)
      if (t.clips.length === 0) return get().toast('info', `"${t.name}" katmanı boş.`)
      set({ activeLane: laneId, selection: t.clips.map((c) => c.id), selectedCaptionId: null, selectedCaptionIds: [] })
    },
    deleteLane(laneId) {
      const tl = get().project.timeline
      if (laneId === 'CC') {
        const n = tl.captions.length
        if (n === 0) return get().toast('info', 'Altyazı katmanı boş.')
        get().exec(cmd.captions([]))
        set({ selectedCaptionId: null, selectedCaptionIds: [] })
        return get().toast('info', `Altyazı katmanındaki ${n} öğe silindi. Geri almak için Ctrl+Z.`)
      }
      const t = tl.tracks.find((x) => x.id === laneId)
      if (!t) return
      if (t.locked) return get().toast('info', `"${t.name}" katmanı kilitli.`)
      if (t.clips.length === 0) return get().toast('info', `"${t.name}" katmanı boş.`)
      const n = t.clips.length
      get().exec(cmd.removeMany(t.clips.map((c) => c.id), true, `${t.name}: hepsini sil`))
      set({ selection: [] })
      get().toast('info', `"${t.name}" katmanındaki ${n} öğe silindi (diğer katmanlar etkilenmedi). Geri almak için Ctrl+Z.`)
    },
    setNewClipSec: (sec) => set({ newClipSec: Math.min(300, Math.max(3, Math.round(sec) || 20)) }),
    async createClipProjectFromResult(r, sec) {
      const s = get()
      const asset = s.project.assets.find((a) => a.id === s.searchedAssetId)
      if (!asset) return
      const target = sec ?? s.newClipSec
      const sug = suggestClip(s.transcripts[asset.id]?.segments ?? [], r, { preRollSec: 0, postRollSec: 0, targetDurationSec: target, maxDurationSec: Math.max(target, s.settings.exportDefaults.maxDurationSec ?? 60), assetDurationSec: asset.durationSec })
      await createIndependent(get, set, { assetId: asset.id, start: sug.start, end: sug.end, query: s.query, resultId: r.id, matchTime: r.start, label: `${s.query || 'Klip'} · ${target} sn` })
    },
    async createClipProjectFromDraft() {
      const s = get()
      const d = s.clipDraft
      if (!d) return
      await createIndependent(get, set, { assetId: d.assetId, start: d.start, end: d.end, query: d.query, resultId: d.resultId, matchTime: d.matchTime, label: `${d.query || d.title || 'Klip'} · ${Math.round(d.end - d.start)} sn` })
    },
    async returnToParent() {
      const s = get()
      if (!s.parentProjectPath) return
      if (s.dirty) await get().saveProject()
      if (get().dirty) return
      await get().openProject(s.parentProjectPath)
    },
    clearResults() {
      set({ results: [], selectedResults: [] })
    },
    deleteCaption(id) {
      get().exec(cmd.captions(get().project.timeline.captions.filter((c) => c.id !== id)))
      set({ selectedCaptionId: null })
    },
    removeAsset(id) {
      const s = get()
      const asset = s.project.assets.find((a) => a.id === id)
      if (!asset) return
      const used = s.project.timeline.tracks.reduce((n, t) => n + t.clips.filter((c) => c.assetId === id).length, 0)
      if (used > 0 && !window.confirm(`"${asset.name}" zaman çizelgesinde ${used} klipte kullanılıyor.\nKütüphaneden kaldırırsanız bu klipler de silinir ve işlem geri alınamaz. Devam edilsin mi?`)) return
      let tl = s.project.timeline
      if (used > 0) {
        tl = removeClipsOfAsset(tl, id)
        history.clear(tl) // kütüphane değişikliği geri alınamaz: tutarsız duruma dönülmesin
      }
      const transcripts = { ...s.transcripts }
      delete transcripts[id]
      set({
        project: {
          ...s.project,
          timeline: tl,
          assets: s.project.assets.filter((a) => a.id !== id).map((a) => ({ ...a, webcamAssetId: a.webcamAssetId === id ? undefined : a.webcamAssetId, sources: a.sources && Object.values(a.sources).includes(id) ? Object.fromEntries(Object.entries(a.sources).filter(([, v]) => v !== id)) : a.sources }))
        },
        dirty: true,
        transcripts,
        selectedAssetId: s.selectedAssetId === id ? null : s.selectedAssetId,
        selection: used > 0 ? [] : s.selection,
        historyVersion: s.historyVersion + 1,
        playing: false
      })
      get().toast('info', `"${asset.name}" kütüphaneden kaldırıldı (diskteki dosya silinmedi).`)
    },
    generateCaptions() {
      const s = get()
      const words = Object.fromEntries(Object.entries(s.transcripts).map(([id, t]) => [id, t.words]))
      const caps = captionsForTimeline(s.project.timeline, words, { maxCharsPerLine: s.project.timeline.captionStyle.maxCharsPerLine })
      if (caps.length === 0) {
        const hasClips = s.project.timeline.tracks.some((t) => (t.kind === 'video' || t.kind === 'audio') && t.clips.length > 0)
        return get().toast('info', hasClips ? 'Altyazı üretilemedi: zaman çizelgesindeki kliplerin kaynağı henüz transkribe edilmemiş. Medya sekmesinden "Transkripsiyonu başlat"a basın.' : 'Altyazı üretilemedi: zaman çizelgesi boş.')
      }
      get().exec(cmd.captions(caps))
      if (!s.project.timeline.captionStyle.enabled) get().exec(cmd.captionStyle({ enabled: true }, false)) // üretilen altyazı görünür olsun
      get().toast('success', `${caps.length} altyazı satırı üretildi.`)
    },
    setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
    setSourceTime: (t) => set({ sourceTime: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    setZoom: (zoom) => set({ zoom: Math.min(400, Math.max(4, zoom)) }),

    // ───── proje ─────
    async newProject() {
      await api().invoke('project:new')
      history.clear(createDefaultTimeline())
      set({ project: newProject(), projectPath: null, parentProjectPath: null, dirty: false, transcripts: {}, results: [], selection: [], selectedAssetId: null, playhead: 0, historyVersion: 0, clipDraft: null })
    },
    async openProject(path) {
      try {
        const r = await api().invoke('project:open', path ?? null)
        if (!r) return false
        history.clear(r.project.timeline)
        const transcripts: Record<string, Transcript> = {}
        for (const a of r.project.assets) {
          const t = await api().invoke('transcript:get', a.id)
          if (t) transcripts[a.id] = t
        }
        set({ project: r.project, projectPath: r.path, parentProjectPath: null, dirty: false, transcripts, selection: [], selectedAssetId: null, playhead: 0, historyVersion: 0, results: [], clipDraft: null, activeLane: null, selectedCaptionId: null, selectedCaptionIds: [] })
        const missing = r.project.assets.filter((a) => a.missing)
        get().toast(missing.length ? 'error' : 'success', missing.length ? `Bulunamayan medya: ${missing.map((m) => m.name).join(', ')}` : 'Proje açıldı.')
        return true
      } catch (e) {
        get().toast('error', errText(e))
        return false
      }
    },
    async saveProject(saveAs = false) {
      const { project, projectPath } = get()
      try {
        const r = await api().invoke('project:save', project, saveAs ? null : projectPath)
        if (r) {
          set({ projectPath: r.path, dirty: false })
          get().toast('success', 'Proje kaydedildi.')
        }
      } catch (e) {
        get().toast('error', errText(e))
      }
    },

    // ───── dışa aktarma ─────
    async startExport({ options, name, mode }) {
      const { project } = get()
      // Çıkış oranı şablondan gelir; düzen kuralları aynı orana göre çözülsün
      const tl = project.timeline.aspect === options.aspect ? project.timeline : { ...project.timeline, aspect: options.aspect }
      const total = timelineDuration(tl)
      const warnings = exportWarnings(total, options)
      if (total <= 0) return get().toast('error', warnings[0] ?? 'Zaman çizelgesi boş.')
      try {
        const base = (name || 'klip').replace(/[\\/:*?"<>|]/g, '_')
        const first = await api().invoke('export:dialogOutput', `${base}.mp4`)
        if (!first) return
        const ranges: { name: string; start: number; end: number; path: string }[] = []
        if (mode === 'each') {
          const screen = tl.tracks.filter((t) => t.role === 'screen').flatMap((t) => t.clips).sort((a, b) => a.start - b.start)
          screen.forEach((c, i) => ranges.push({ name: `${base} ${i + 1}`, start: c.start, end: clipEnd(c), path: first.replace(/\.mp4$/i, '') + `_${String(i + 1).padStart(2, '0')}.mp4` }))
        } else if (mode === 'selection' && get().selection.length) {
          const f = findClip(tl, get().selection[0])
          if (f) ranges.push({ name: base, start: f.clip.start, end: clipEnd(f.clip), path: first })
        }
        if (ranges.length === 0) ranges.push({ name: base, start: 0, end: total, path: first })
        for (const r of ranges) {
          await api().invoke('export:start', { name: r.name, timeline: tl, assets: project.assets, options, range: { start: r.start, end: r.end }, outputPath: r.path })
        }
        set({ dialog: null })
        get().toast('info', `${ranges.length} dışa aktarma kuyruğa eklendi.`)
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    cancelTask: (id) => void api().invoke('task:cancel', id),

    selectCaption(id, seek = false) {
      // Tek seçim kuralı: altyazı seçilince klip/katman seçimi temizlenir (Delete yalnızca seçili TEK öğeyi siler)
      set({ selectedCaptionId: id, selectedCaptionIds: [], ...(id ? { selection: [], selectedLayerId: null, rightTab: 'captions' as RightTab } : {}) })
      const cap = id ? get().project.timeline.captions.find((c) => c.id === id) : undefined
      if (cap && seek) {
        set({ viewMode: 'timeline' })
        get().setPlayhead(cap.start + 0.01)
      }
    },
    startCrop(clipId) {
      set({ cropClipId: clipId, viewMode: 'timeline', playing: false, selectedCaptionId: null })
      // Kırpma klibin karesi üzerinde yapılır: başlık klibin dışındaysa klibin başına atla
      const f = findClip(get().project.timeline, clipId)
      const t = get().playhead
      if (f && (t < f.clip.start || t >= clipEnd(f.clip))) get().setPlayhead(f.clip.start + 0.01)
    },
    endCrop: () => set({ cropClipId: null }),
    setCrop(clipId, crop, coalesce = true) {
      const f = findClip(get().project.timeline, clipId)
      if (!f) return
      if (crop) {
        const c = { x: Math.min(0.95, Math.max(0, crop.x)), y: Math.min(0.95, Math.max(0, crop.y)), w: Math.max(0.05, Math.min(1, crop.w)), h: Math.max(0.05, Math.min(1, crop.h)) }
        c.w = Math.min(c.w, 1 - c.x)
        c.h = Math.min(c.h, 1 - c.y)
        get().exec(cmd.updateClip(clipId, { crop: c }, coalesce))
      } else get().exec(cmd.updateClip(clipId, { crop: undefined }, false))
    },
    selectLayer: (id) => set({ selectedLayerId: id, ...(id ? { selectedCaptionId: null, rightTab: 'layout' as RightTab } : {}) }),
    async loadTemplates() {
      try {
        set({ userTemplates: await api().invoke('templates:list') })
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    applyLayoutTemplate(tpl) {
      get().exec(cmd.applyTemplate(tpl))
      get().toast('success', `Şablon uygulandı: ${tpl.name}`)
    },
    async saveLayoutTemplate(name) {
      const id = `user-${newId('t')}`
      const tpl = templateFromTimeline(get().project.timeline, id, name.trim() || 'Şablonum')
      try {
        set({ userTemplates: await api().invoke('templates:save', tpl) })
        get().toast('success', `Şablon kaydedildi: ${tpl.name}`)
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    async deleteLayoutTemplate(id) {
      try {
        set({ userTemplates: await api().invoke('templates:delete', id) })
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    autoAspectFor(asset) {
      const tl = get().project.timeline
      if (!asset || asset.kind !== 'video' || tl.aspectAuto === false) return
      const hasVisual = tl.tracks.some((t) => (t.kind === 'video' || t.kind === 'image') && t.clips.length > 0)
      if (hasVisual) return
      const aspect = nearestAspect(asset.width, asset.height)
      if (aspect !== tl.aspect || tl.aspectAuto !== true) get().exec(cmd.aspectAuto(true, aspect))
    },
    enableAutoAspect() {
      const { project } = get()
      const first = project.timeline.tracks
        .filter((t) => t.kind === 'video')
        .flatMap((t) => t.clips)
        .sort((a, b) => a.start - b.start)[0]
      const asset = first ? project.assets.find((a) => a.id === first.assetId) : undefined
      get().exec(cmd.aspectAuto(true, asset && asset.kind === 'video' ? nearestAspect(asset.width, asset.height) : undefined))
      get().toast('info', asset ? `Oran videoya göre ayarlandı: ${get().project.timeline.aspect}` : 'Otomatik oran açık: ilk videoyu eklediğinizde oran ona göre ayarlanır.')
    },
    afterClipsAdded() {
      // Yalnızca (kullanıcının kendi eklediği) boş metin katmanları doldurulur; hiçbir katman kendiliğinden açılmaz/eklenmez
      get().exec(cmd.fillText())
    },
    jumpTo(sec) {
      if (get().viewMode === 'timeline') get().setPlayhead(sec)
      else get().setSourceTime(sec)
    },
    cutTimelineRange(a, b, ripple) {
      get().exec(cmd.cutRange(a, b, ripple))
      set({ selection: [] })
      get().toast('success', `${(b - a).toFixed(1)} sn kesildi${ripple ? '' : ' (boşluk bırakıldı)'}. Geri almak için Ctrl+Z.`)
    },
    openDraftFromRange(assetId, start, end, firstWord, lastWord) {
      const { settings } = get()
      set({ clipDraft: null })
      get().recomputeDraft({ assetId, hitStart: start, hitEnd: end, firstWord, lastWord, preRoll: settings.preRollSec, postRoll: settings.postRollSec, targetSec: settings.targetDurationSec, title: 'Transkript seçimi' })
      set({ viewMode: 'source' })
    },
    joinSelected() {
      const { selection, project } = get()
      if (selection.length === 0) return get().toast('info', 'Birleştirmek için önce bir klip seçin (hemen sonraki klibiyle birleşir).')
      const before = project.timeline
      get().exec(cmd.join(selection[0]))
      if (get().project.timeline === before) get().toast('info', 'Birleştirilemedi: iki klip yan yana, aynı kaynaktan ve kaynakta kesintisiz devam eden parçalar olmalı.')
    },
    async fixTranscriptWord(assetId, index, text, all) {
      try {
        const r = await api().invoke('transcript:fix', { assetId, index, text, all, remember: all })
        set((s) => ({ transcripts: { ...s.transcripts, [assetId]: r.transcript } }))
        if (all) void api().invoke('settings:get').then((settings) => set({ settings }))
        get().toast('success', `${r.replaced} kelime düzeltildi${all ? ' ve sözlüğe eklendi' : ''}.`)
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    async applyVocabulary(assetId) {
      try {
        const r = await api().invoke('transcript:vocab', assetId)
        set((s) => ({ transcripts: { ...s.transcripts, [assetId]: r.transcript } }))
        get().toast(r.corrections ? 'success' : 'info', r.corrections ? `Sözlükle ${r.corrections} kelime düzeltildi.` : 'Sözlükle düzeltilecek kelime bulunamadı.')
      } catch (e) {
        get().toast('error', errText(e))
      }
    },
    cutSilence() {
      const { project, transcripts, settings } = get()
      const tl = project.timeline
      const words = timelineWords(tl, transcripts)
      if (words.length === 0) return get().toast('info', 'Sessizlikleri kesmek için zaman çizelgesindeki içeriğin transkripti gerekir. Kaynak sekmesinden transkripsiyonu başlatın.')
      const total = tl.tracks.filter((t) => t.kind !== 'text').flatMap((t) => t.clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
      const plan = planSilenceCuts(words, total, { minGapSec: settings.silenceMinGapSec, keepSec: settings.silenceKeepSec, cutFillers: settings.cutFillers })
      if (plan.cuts.length === 0) return get().toast('info', 'Kesilecek sessizlik ya da dolgu sesi bulunamadı.')
      get().exec(cmd.cutRanges(plan.cuts))
      set({ selection: [] })
      get().toast('success', `${plan.cuts.length} kesim yapıldı, ${plan.removedSec.toFixed(1)} sn kısaldı${plan.fillerCount ? ` (${plan.fillerCount} dolgu sesi)` : ''}. Geri almak için Ctrl+Z.`)
    },
    closeGaps() {
      const before = get().project.timeline
      get().exec(cmd.closeGaps())
      get().toast(get().project.timeline === before ? 'info' : 'success', get().project.timeline === before ? 'Kapatılacak boşluk yok.' : 'Boşluklar kapatıldı.')
    },
    toggleLayerVisible(trackId) {
      const t = get().project.timeline.tracks.find((x) => x.id === trackId)
      if (t?.placement) get().exec(cmd.placement(trackId, { visible: !t.placement.visible }, false))
    }
  }
})

export const presetOptions = (id: string, overrides: Partial<ExportOptions> = {}) => optionsFromPreset(id, overrides)
export const PRESET_LIST = EXPORT_PRESETS
