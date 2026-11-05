import { basename, dirname, join } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { initialAutoClipsStages, type AutoClipResultItem, type AutoClipsRequest, type AutoClipsResult, type AutoClipsStage, type AutoClipsStageState, type AutoClipsStatus } from '../../shared/autoclips'
import { optionsFromPreset } from '../../shared/export/presets'
import { timelineDuration } from '../../shared/timeline/model'
import { autoClipCandidates, makeAutoClip } from './pipeline'

type Env = { userDataDir?: string; resourcesDir?: string }

export class AutoClipsCancelled extends Error {
  constructor() {
    super('Auto Clips iptal edildi.')
  }
}

export interface AutoClipsHooks {
  onStage(id: AutoClipsStage, patch: Partial<AutoClipsStageState>): void
  signal: AbortSignal
}

/** Bir klip projesini 9:16 MP4 olarak dışa aktarır (proje dosyasının yanına, aynı adla) */
export async function exportClipProject(projectPath: string, env: Env, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<string> {
  const service = await makeService(env)
  const s = await Session.open(projectPath, service)
  const total = timelineDuration(s.timeline)
  if (total <= 0) throw new Error('Klip boş.')
  const out = join(dirname(projectPath), `${basename(projectPath).replace(/\.clipforge$/i, '')}.mp4`)
  const options = optionsFromPreset('shorts')
  const id = service.exportStart({ name: 'autoclips', timeline: { ...s.timeline, aspect: options.aspect }, assets: s.project.assets, options, range: { start: 0, end: total }, outputPath: out })
  const onAbort = () => service.queue.cancel(id)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await waitTask(service, id, 'Klip dışa aktarma', (f) => onProgress?.(f))
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  return out
}

/**
 * GÖZETİMSİZ zincir: konuları bul → her biri için 9:16 klip projesi üret → (isteğe bağlı) MP4 dışa aktar.
 * Tek bir klipte hata olursa o klip "hatalı" işaretlenir, diğerleri sürer (8 saat başında olmasanız da iş yarım kalmaz).
 */
export async function runAutoClips(req: AutoClipsRequest, env: Env, hooks: AutoClipsHooks): Promise<AutoClipsResult> {
  const check = () => {
    if (hooks.signal.aborted) throw new AutoClipsCancelled()
  }
  const stage = hooks.onStage
  check()
  stage('find', { status: 'running', progress: 0 })
  const found = await autoClipCandidates(req.projectPath, { minSec: req.minSec, maxSec: req.maxSec, max: req.max }, env)
  if (found.candidates.length === 0) {
    stage('find', { status: 'done', progress: 1, detail: 'Klip olabilecek net bir konu bulunamadı' })
    stage('make', { status: 'skipped' })
    stage('export', { status: 'skipped' })
    return { dir: join(dirname(found.projectPath), `${basename(found.projectPath, '.clipforge')}-klipler`), clips: [] }
  }
  stage('find', { status: 'done', progress: 1, detail: `${found.candidates.length} konu bulundu` })

  const clips: AutoClipResultItem[] = found.candidates.map((c) => ({ id: c.id, subject: c.subject, headline: c.headline, start: c.start, end: c.end, durationSec: c.durationSec }))
  stage('make', { status: 'running', progress: 0 })
  for (const [i, c] of found.candidates.entries()) {
    check()
    try {
      const m = await makeAutoClip(req.projectPath, c, { face: req.face, facePos: req.facePos, faceShare: req.faceShare, screenZoom: req.screenZoom }, env)
      clips[i].projectPath = m.projectPath
    } catch (e) {
      check()
      clips[i].error = `Klip projesi üretilemedi: ${e instanceof Error ? e.message : String(e)}`
    }
    stage('make', { progress: (i + 1) / found.candidates.length, detail: `${i + 1}/${found.candidates.length} klip` })
  }
  stage('make', { status: 'done', progress: 1, detail: `${clips.filter((c) => c.projectPath).length} klip projesi` })

  if (req.exportVideos === false) stage('export', { status: 'skipped' })
  else {
    stage('export', { status: 'running', progress: 0 })
    const todo = clips.filter((c) => c.projectPath)
    for (const [i, c] of todo.entries()) {
      check()
      try {
        c.videoPath = await exportClipProject(c.projectPath!, env, hooks.signal, (f) => stage('export', { progress: (i + f) / todo.length, detail: `${i + 1}/${todo.length}: ${c.subject}` }))
      } catch (e) {
        check()
        c.error = `MP4 dışa aktarılamadı: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    stage('export', { status: 'done', progress: 1, detail: `${clips.filter((c) => c.videoPath).length} MP4` })
  }
  const first = clips.find((c) => c.projectPath)
  return { dir: first?.projectPath ? dirname(first.projectPath) : '', clips }
}

/** Auto Clips işlerini sırayla çalıştırır (CPU'yu tek iş kullanır; Auto Kick/Anlatım işleriyle aynı ilke) */
export class AutoClipsManager {
  private jobs = new Map<string, { status: AutoClipsStatus; ctrl: AbortController }>()
  private seq = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly env: Env,
    private readonly emit: (s: AutoClipsStatus) => void
  ) {}

  list(): AutoClipsStatus[] {
    return [...this.jobs.values()].map((j) => structuredClone(j.status))
  }

  start(req: AutoClipsRequest): string {
    const id = `autoclips-${++this.seq}`
    const status: AutoClipsStatus = { id, request: req, name: basename(req.projectPath).replace(/\.clipforge$/i, ''), status: 'running', stages: initialAutoClipsStages(), startedAt: Date.now() }
    const ctrl = new AbortController()
    this.jobs.set(id, { status, ctrl })
    const push = () => this.emit(structuredClone(status))
    push()
    this.chain = this.chain.then(async () => {
      if (ctrl.signal.aborted) {
        status.status = 'cancelled'
        status.finishedAt = Date.now()
        return push()
      }
      try {
        status.result = await runAutoClips(req, this.env, {
          signal: ctrl.signal,
          onStage: (sid, patch) => {
            const st = status.stages.find((x) => x.id === sid)
            if (st) Object.assign(st, patch)
            push()
          }
        })
        status.status = 'done'
      } catch (e) {
        const cancelled = e instanceof AutoClipsCancelled || ctrl.signal.aborted
        status.status = cancelled ? 'cancelled' : 'failed'
        if (!cancelled) status.error = e instanceof Error ? e.message : String(e)
        const running = status.stages.find((x) => x.status === 'running')
        if (running) running.status = cancelled ? 'pending' : 'failed'
      }
      status.finishedAt = Date.now()
      push()
    })
    return id
  }

  cancel(id: string): void {
    this.jobs.get(id)?.ctrl.abort()
  }
}

/**
 * ZİNCİR KANCASI: Auto Kick işi "done" olduğunda (tam video dışa aktarıldıktan sonra) Auto Clips'i başlatır. Her iş yalnızca BİR kez
 * (emit her güncellemede çağrılır). Ayar kapalıysa başlatmaz. Başlatılan işin kimliğini döndürür.
 */
export function chainAutoClips(
  s: { id: string; status: string; result?: { projectPath: string } },
  handled: Set<string>,
  settings: { autoClipsAfterKick: boolean; autoClipsMax: number; autoClipsExport: boolean },
  manager: { start(req: AutoClipsRequest): string }
): string | null {
  if (s.status !== 'done' || !s.result || handled.has(s.id)) return null
  handled.add(s.id)
  if (!settings.autoClipsAfterKick) return null
  return manager.start({ projectPath: s.result.projectPath, max: settings.autoClipsMax, exportVideos: settings.autoClipsExport })
}
