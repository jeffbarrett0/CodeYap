import { create } from 'zustand'
import type { AppInfo } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { suggestClip, nearestBoundary, type ClipWarning } from '@shared/clip/boundaries'
import { History } from '@shared/timeline/history'
import { cmd, type TimelineCommand } from '@shared/timeline/commands'
import { captionsForTimeline } from '@shared/timeline/captions'
import { clipItemsForSource } from '@shared/timeline/create'
import { clipEnd, createDefaultTimeline, findClip, groupMembers, newId, timelineDuration } from '@shared/timeline/model'
import { optionsFromPreset, exportWarnings } from '@shared/export/presets'
import { EXPORT_PRESETS } from '@shared/export/presets'
import { PROJECT_VERSION } from '@shared/types'
import type { ChatLog, ClipCandidate, ExportOptions, MediaAsset, Project, SearchResult, Settings, TaskInfo, Timeline, Transcript } from '@shared/types'
import { requireApi } from './api'

export type LeftTab = 'media' | 'search' | 'suggest'
export type RightTab = 'inspector' | 'layout' | 'audio' | 'captions'
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

  leftTab: LeftTab
  rightTab: RightTab
  dialog: Dialog
  viewMode: 'source' | 'timeline'
  selectedAssetId: string | null
  selection: string[]
  playhead: number
  sourceTime: number
  playing: boolean
  zoom: number

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
  setLeftTab(t: LeftTab): void
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
  deleteSelection(): void
  generateCaptions(): void
  setPlayhead(t: number): void
  setSourceTime(t: number): void
  setPlaying(p: boolean): void
  setZoom(z: number): void

  newProject(): Promise<void>
  openProject(): Promise<void>
  saveProject(saveAs?: boolean): Promise<void>
  startExport(opts: { options: ExportOptions; name: string; mode: 'all' | 'each' | 'selection' }): Promise<void>
  cancelTask(id: string): void
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
    leftTab: 'media',
    rightTab: 'layout',
    dialog: null,
    viewMode: 'source',
    selectedAssetId: null,
    selection: [],
    playhead: 0,
    sourceTime: 0,
    playing: false,
    zoom: 40,
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
      a.on('task:update', (t) => {
        set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }))
        if (t.status === 'failed') get().toast('error', `${t.title}: ${t.error ?? 'Bilinmeyen hata'}`)
      })
      a.on('asset:added', (asset) => {
        mutateProject((p) => ({ ...p, assets: [...p.assets.filter((x) => x.id !== asset.id), asset] }))
        set((s) => ({ selectedAssetId: s.selectedAssetId ?? asset.id }))
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
    setLeftTab: (leftTab) => set({ leftTab }),
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
        set({ leftTab: 'media' })
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
      const cam = asset.webcamAssetId ? s.project.assets.find((a) => a.id === asset.webcamAssetId) : undefined
      const items = clipItemsForSource(asset, { start: d.start, end: d.end }, timelineDuration(s.project.timeline), { query: d.query, resultId: d.resultId, matchTime: d.matchTime, candidateId: d.candidateId }, cam)
      const at = timelineDuration(s.project.timeline)
      get().exec(cmd.addClips(items.map((i) => ({ ...i, clip: { ...i.clip, start: at + (i.clip.start - items[0].clip.start) } }))))
      if (d.candidateId) get().setCandidateStatus(d.candidateId, 'accepted')
      set({ clipDraft: null, dialog: null, selection: items.slice(0, 1).map((i) => i.clip.id), viewMode: 'timeline', rightTab: 'inspector' })
      get().setPlayhead(at)
      get().toast('success', `Klip zaman çizelgesine eklendi (${(d.end - d.start).toFixed(1)} sn).`)
    },
    createClipsFromResults(ids) {
      const s = get()
      const asset = s.project.assets.find((a) => a.id === s.searchedAssetId)
      if (!asset) return
      const segs = s.transcripts[asset.id]?.segments ?? []
      const cam = asset.webcamAssetId ? s.project.assets.find((a) => a.id === asset.webcamAssetId) : undefined
      let at = timelineDuration(s.project.timeline)
      const items = []
      let warned = 0
      for (const r of s.results.filter((x) => ids.includes(x.id))) {
        const sug = suggestClip(segs, r, { preRollSec: s.settings.preRollSec, postRollSec: s.settings.postRollSec, targetDurationSec: s.settings.targetDurationSec || undefined, maxDurationSec: s.settings.exportDefaults.maxDurationSec ?? 60, assetDurationSec: asset.durationSec })
        if (sug.warnings.length) warned++
        const its = clipItemsForSource(asset, sug, at, { query: s.query, resultId: r.id, matchTime: r.start }, cam)
        items.push(...its)
        at += sug.duration
      }
      if (items.length === 0) return
      get().exec(cmd.addClips(items, 'Toplu klip oluştur'))
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
    select: (ids) => set({ selection: ids, rightTab: ids.length ? 'inspector' : get().rightTab }),
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
    deleteSelection() {
      const { selection } = get()
      const done = new Set<string>()
      for (const id of selection) {
        if (done.has(id)) continue
        groupMembers(get().project.timeline, id).forEach((m) => done.add(m.id))
        get().exec(cmd.remove(id))
      }
      set({ selection: [] })
    },
    generateCaptions() {
      const s = get()
      const words = Object.fromEntries(Object.entries(s.transcripts).map(([id, t]) => [id, t.words]))
      const caps = captionsForTimeline(s.project.timeline, words, { maxCharsPerLine: s.project.timeline.captionStyle.maxCharsPerLine })
      if (caps.length === 0) return get().toast('info', 'Altyazı üretilemedi: zaman çizelgesindeki kayıtların transkripti yok.')
      get().exec(cmd.captions(caps))
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
      set({ project: newProject(), projectPath: null, dirty: false, transcripts: {}, results: [], selection: [], selectedAssetId: null, playhead: 0, historyVersion: 0, clipDraft: null })
    },
    async openProject() {
      try {
        const r = await api().invoke('project:open', null)
        if (!r) return
        history.clear(r.project.timeline)
        const transcripts: Record<string, Transcript> = {}
        for (const a of r.project.assets) {
          const t = await api().invoke('transcript:get', a.id)
          if (t) transcripts[a.id] = t
        }
        set({ project: r.project, projectPath: r.path, dirty: false, transcripts, selection: [], selectedAssetId: r.project.assets[0]?.id ?? null, playhead: 0, historyVersion: 0, results: [] })
        const missing = r.project.assets.filter((a) => a.missing)
        get().toast(missing.length ? 'error' : 'success', missing.length ? `Bulunamayan medya: ${missing.map((m) => m.name).join(', ')}` : 'Proje açıldı.')
      } catch (e) {
        get().toast('error', errText(e))
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
    cancelTask: (id) => void api().invoke('task:cancel', id)
  }
})

export const presetOptions = (id: string, overrides: Partial<ExportOptions> = {}) => optionsFromPreset(id, overrides)
export const PRESET_LIST = EXPORT_PRESETS
