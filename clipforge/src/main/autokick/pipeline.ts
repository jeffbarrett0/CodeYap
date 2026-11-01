import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { initialStages, type AutoKickRequest, type AutoKickResult, type AutoKickStage, type AutoKickStageState } from '../../shared/autokick'
import { optionsFromPreset } from '../../shared/export/presets'
import { cmd } from '../../shared/timeline/commands'
import { clipsForVideoWithAudio } from '../../shared/timeline/create'
import { clipEnd, nearestAspect, timelineDuration } from '../../shared/timeline/model'
import { planSilenceCuts } from '../../shared/timeline/silence'
import { timelineWords } from '../../shared/timeline/transcript'
import type { ExportOptions, MediaAsset } from '../../shared/types'

export interface AutoKickHooks {
  onStage(id: AutoKickStage, patch: Partial<AutoKickStageState>): void
  signal: AbortSignal
}

interface State {
  silence?: { cuts: number; removedSec: number; before: number; after: number; fillers: number }
  full?: boolean
}

export class AutoKickCancelled extends Error {
  constructor() {
    super('Auto Kick iptal edildi.')
  }
}

export const MEDIA_RE = /\.(mkv|mp4|mov|flv|m4v|webm)$/i

/** Çıkış yolları (Windows/macOS: boşluk ve Türkçe karakter güvenli) */
export function autoKickPaths(videoPath: string, outDir?: string) {
  const video = resolve(videoPath)
  const name = basename(video, extname(video))
  const dir = resolve(outDir ?? join(dirname(video), 'AutoKick', name))
  return { video, name, dir, project: join(dir, `${name}.clipforge`), full: join(dir, `${name} - full.mp4`), state: join(dir, 'autokick.json') }
}

/** Uzun yayınlar için hızlı, yine de yüksek kaliteli kodlama; kaynak 1800 px üstüyse 4K şablonu */
export function fullVideoOptions(asset: MediaAsset, quality: 'fast' | 'high' = 'fast'): ExportOptions {
  const aspect = nearestAspect(asset.width, asset.height)
  const preset = aspect === '9:16' ? 'shorts' : aspect === '1:1' ? 'square' : Math.max(asset.width, asset.height) >= 3000 ? 'youtube4k' : 'youtube'
  const o = optionsFromPreset(preset, { maxDurationSec: undefined })
  return quality === 'fast' ? { ...o, encoderPreset: 'veryfast', crf: 20, videoBitrateKbps: Math.min(o.videoBitrateKbps, 40000), audioBitrateKbps: 192 } : o
}

async function readState(path: string): Promise<State> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as State
  } catch {
    return {}
  }
}

/**
 * Auto Kick hattı: içe aktar → transkripsiyon → sessizleri kırp → tam videoyu kaydet. Her aşamadan sonra proje kaydedilir;
 * aynı kayıt yeniden çalıştırılırsa biten aşamalar atlanır (kesinti sonrası devam). Orijinal kayda asla dokunulmaz.
 * Kendi `AppService` örneğini kullanır: arayüzde açık projeyi etkilemez.
 */
export async function runAutoKick(req: AutoKickRequest, env: { userDataDir?: string; resourcesDir?: string }, hooks: AutoKickHooks): Promise<AutoKickResult> {
  const p = autoKickPaths(req.videoPath, req.outDir)
  if (!MEDIA_RE.test(p.video)) throw new Error('Desteklenen bir video seçin (MKV, MP4, MOV, FLV, M4V, WEBM).')
  try {
    await access(p.video)
  } catch {
    throw new Error(`Dosya bulunamadı: ${p.video}`)
  }
  const stage = hooks.onStage
  const check = () => {
    if (hooks.signal.aborted) throw new AutoKickCancelled()
  }
  await mkdir(p.dir, { recursive: true })
  const service = await makeService(env)
  const settings = service.settings.value
  /** Kuyruktaki bir görevi bekler; iptalde görevi durdurur */
  const run = async (id: string, label: string, onProgress: (f: number) => void) => {
    const onAbort = () => service.queue.cancel(id)
    hooks.signal.addEventListener('abort', onAbort, { once: true })
    try {
      await waitTask(service, id, label, onProgress)
    } catch (e) {
      check()
      throw e
    } finally {
      hooks.signal.removeEventListener('abort', onAbort)
    }
  }

  let exists = true
  try {
    await access(p.project)
  } catch {
    exists = false
  }
  const s = exists ? await Session.open(p.project, service) : await Session.create(p.project, p.name, service)
  const state = await readState(p.state)
  const save = async () => {
    await s.save()
    await writeFile(p.state, JSON.stringify(state, null, 2), 'utf8')
  }

  // 1) içe aktar ─────────────────────────────────────────
  check()
  let asset = s.project.assets.find((a) => a.path === p.video)
  if (asset) stage('import', { status: 'done', progress: 1, detail: 'Önceki çalıştırmadan' })
  else {
    stage('import', { status: 'running', progress: 0 })
    const ids = service.importMedia([p.video])
    for (const id of ids) await run(id, 'İçe aktarma', (f) => stage('import', { progress: f }))
    asset = [...service.assets.values()].find((a) => a.path === p.video)
    if (!asset) throw new Error('Kayıt içe aktarılamadı.')
    if (asset.kind !== 'video') throw new Error('Bu bir video değil.')
    s.project = { ...s.project, assets: [...s.project.assets, asset] }
    const track = s.timeline.tracks.find((t) => t.id === 'V1')!
    const r = clipsForVideoWithAudio(asset, track, s.timeline.tracks, { at: 0 })
    if ('error' in r) throw new Error(r.error)
    s.apply(cmd.aspectAuto(true, nearestAspect(asset.width, asset.height)), cmd.addClips(r.items, 'Kayıt ekle'))
    await save()
    stage('import', { status: 'done', progress: 1, detail: `${Math.round(asset.durationSec / 60)} dk · ${asset.width}×${asset.height}` })
  }
  if (asset.audioStreams.length === 0) throw new Error('Bu kayıtta ses yok; konuşma metni çıkarılamaz.')

  // 2) transkripsiyon ────────────────────────────────────
  check()
  stage('transcribe', { status: 'running', progress: 0 })
  const tid = await service.transcriptStart({ assetId: asset.id, track: req.track ?? asset.transcriptionTrack ?? 0, language: req.language ?? settings.language, model: req.model })
  await run(tid, 'Transkripsiyon', (f) => stage('transcribe', { progress: f }))
  const transcript = await service.transcriptGet(asset.id)
  if (!transcript || transcript.words.length === 0) throw new Error('Transkript boş çıktı (kayıtta konuşma yok ya da Whisper kurulumu sorunlu).')
  s.transcripts[asset.id] = transcript
  stage('transcribe', { status: 'done', progress: 1, detail: `${transcript.words.length.toLocaleString('tr')} kelime · ${transcript.segments.length} cümle` })

  // 3) sessizleri kırp ───────────────────────────────────
  check()
  if (state.silence) stage('silence', { status: 'done', progress: 1, detail: `Önceki çalıştırmadan: ${state.silence.cuts} kesim` })
  else {
    stage('silence', { status: 'running', progress: 0 })
    const before = timelineDuration(s.timeline)
    const words = timelineWords(s.timeline, s.transcripts)
    const sil = req.silence ?? { minGapSec: settings.silenceMinGapSec, keepSec: settings.silenceKeepSec, cutFillers: settings.cutFillers }
    const plan = planSilenceCuts(words, before, sil)
    if (plan.cuts.length > 0) s.apply(cmd.cutRanges(plan.cuts))
    state.silence = { cuts: plan.cuts.length, removedSec: plan.removedSec, before, after: timelineDuration(s.timeline), fillers: plan.fillerCount }
    await save()
    stage('silence', { status: 'done', progress: 1, detail: `${plan.cuts.length} kesim · ${Math.round(plan.removedSec / 60 * 10) / 10} dk kısaldı` })
  }

  // 4) tam video ─────────────────────────────────────────
  check()
  let haveFull = false
  try {
    await access(p.full)
    haveFull = !!state.full
  } catch {
    haveFull = false
  }
  if (haveFull) stage('full', { status: 'done', progress: 1, detail: 'Önceki çalıştırmadan' })
  else {
    stage('full', { status: 'running', progress: 0 })
    const options = fullVideoOptions(asset, req.quality ?? 'fast')
    const total = timelineDuration(s.timeline)
    const tl = s.timeline.aspect === options.aspect ? s.timeline : { ...s.timeline, aspect: options.aspect }
    const id = service.exportStart({ name: `${p.name} - full`, timeline: tl, assets: s.project.assets, options, range: { start: 0, end: total }, outputPath: p.full })
    await run(id, 'Tam video', (f) => stage('full', { progress: f }))
    state.full = true
    await save()
    stage('full', { status: 'done', progress: 1, detail: p.full })
  }

  // 5) otomatik klipler: sonraki adım ────────────────────
  stage('clips', { status: 'skipped', progress: 0, detail: 'Bir sonraki adımda eklenecek (klip kuralları belirlenince)' })

  const st = state.silence!
  return {
    outDir: p.dir,
    projectPath: p.project,
    fullVideoPath: p.full,
    durationBeforeSec: st.before,
    durationAfterSec: st.after,
    removedSec: st.removedSec,
    cuts: st.cuts,
    fillers: st.fillers,
    words: transcript.words.length,
    sentences: transcript.segments.length
  }
}

/** Birden çok işi yönetir (aynı anda en fazla bir tanesi çalışır: transkripsiyon/kodlama CPU'yu doldurur). */
export class AutoKickManager {
  private jobs = new Map<string, { status: import('../../shared/autokick').AutoKickStatus; ctrl: AbortController }>()
  private seq = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly env: { userDataDir?: string; resourcesDir?: string },
    private readonly emit: (s: import('../../shared/autokick').AutoKickStatus) => void
  ) {}

  list() {
    return [...this.jobs.values()].map((j) => structuredClone(j.status))
  }

  start(req: AutoKickRequest): string {
    const id = `autokick-${++this.seq}`
    const status: import('../../shared/autokick').AutoKickStatus = { id, videoName: basename(req.videoPath), status: 'running', stages: initialStages(), startedAt: Date.now() }
    const ctrl = new AbortController()
    this.jobs.set(id, { status, ctrl })
    const push = () => this.emit(structuredClone(status))
    push()
    // sıraya al: önceki iş bitene dek bekler
    this.chain = this.chain.then(async () => {
      if (ctrl.signal.aborted) {
        status.status = 'cancelled'
        status.finishedAt = Date.now()
        return push()
      }
      try {
        status.result = await runAutoKick(req, this.env, {
          signal: ctrl.signal,
          onStage: (sid, patch) => {
            const st = status.stages.find((x) => x.id === sid)
            if (st) Object.assign(st, patch)
            push()
          }
        })
        status.status = 'done'
      } catch (e) {
        const cancelled = e instanceof AutoKickCancelled || ctrl.signal.aborted
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
