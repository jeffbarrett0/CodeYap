import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { transcriptionReadiness } from '../../shared/autokick'
import { findPlace, type World } from '../../shared/graphics/geo'
import { contentProblem, normalizeScenes, planStory } from '../../shared/story/plan'
import { initialStoryStages, type StoryPlan, type StoryRequest, type StoryResult, type StoryStage, type StoryStageState, type StoryStatus } from '../../shared/story/types'
import { cmd } from '../../shared/timeline/commands'
import { clipForTrack } from '../../shared/timeline/create'
import { aspectSize, clipEnd } from '../../shared/timeline/model'
import { loadWorld } from '../graphics/render'
import { llmConfigured } from '../ideas/llm'
import { aiStoryScenes } from './ai'
import { renderBackdrop, renderStoryScene } from './render'

export class StoryCancelled extends Error {
  constructor() {
    super('Anlatım işi iptal edildi.')
  }
}

export interface StoryHooks {
  onStage(id: StoryStage, patch: Partial<StoryStageState>): void
  signal: AbortSignal
}

export const STORY_MEDIA_RE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|mp4|mov|mkv|webm|m4v)$/i

export function storyPaths(mediaPath: string, outDir?: string) {
  const media = resolve(mediaPath)
  const name = basename(media, extname(media))
  const dir = resolve(outDir ?? join(dirname(media), 'Anlatım', name))
  return { media, name, dir, project: join(dir, `${name}.clipforge`), plan: join(dir, 'story-plan.json'), scenes: join(dir, 'sahneler') }
}

const FPS = 30
const frameSnap = (t: number) => Math.round(t * FPS) / FPS

/**
 * Anlatım → Görsel hattı.
 *  plan : sesi içe aktar → transkribe et → sahne planı çıkar (yapay zekâ ayarlıysa o, yoksa kurallar) → `story-plan.json`
 *  build: (düzenlenmiş) planı çiz → anlatım sesi + sahneler tek projede (Ses katmanı + Video 1)
 * Kendi AppService örneğini kullanır: arayüzde açık projeyi etkilemez. Kaynak dosyaya dokunulmaz.
 */
export async function runStory(req: StoryRequest, env: { userDataDir?: string; resourcesDir?: string }, hooks: StoryHooks): Promise<StoryResult> {
  const p = storyPaths(req.mediaPath, req.outDir)
  if (!STORY_MEDIA_RE.test(p.media)) throw new Error('Desteklenen bir ses ya da video seçin (MP3, WAV, M4A, MP4, MOV, MKV…).')
  try {
    await access(p.media)
  } catch {
    throw new Error(`Dosya bulunamadı: ${p.media}`)
  }
  const stage = hooks.onStage
  const check = () => {
    if (hooks.signal.aborted) throw new StoryCancelled()
  }
  const service = await makeService(env)
  const settings = service.settings.value
  const info = await service.info()
  if (!info.ffmpeg.ok || !info.ffprobe.ok) throw new Error(`ffmpeg/ffprobe çalışmıyor (${info.ffmpeg.error ?? info.ffprobe.error ?? 'bulunamadı'}).`)
  await mkdir(p.dir, { recursive: true })
  const run = async (id: string, label: string, onProgress: (f: number, m?: string) => void) => {
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

  // 1) içe aktar ─────────────────────────────────────────
  check()
  let asset = s.project.assets.find((a) => a.path === p.media)
  if (asset) stage('import', { status: 'done', progress: 1, detail: 'Önceki çalıştırmadan' })
  else {
    stage('import', { status: 'running', progress: 0 })
    const ids = service.importMedia([p.media])
    for (const id of ids) await run(id, 'İçe aktarma', (f) => stage('import', { progress: f }))
    asset = [...service.assets.values()].find((a) => a.path === p.media)
    if (!asset) throw new Error('Dosya içe aktarılamadı.')
    if (asset.audioStreams.length === 0) throw new Error('Bu dosyada ses yok; anlatım metni çıkarılamaz.')
    s.project = { ...s.project, assets: [...s.project.assets, asset] }
    await s.save()
    stage('import', { status: 'done', progress: 1, detail: `${Math.round(asset.durationSec)} sn` })
  }

  // 2) transkripsiyon ────────────────────────────────────
  check()
  let transcript = await service.transcriptGet(asset.id)
  if (transcript && transcript.words.length > 0) stage('transcribe', { status: 'done', progress: 1, detail: 'Önceki çalıştırmadan' })
  else {
    if (req.action === 'build') throw new Error('Önce anlatımın planı çıkarılmalı (transkript yok).')
    const ready = transcriptionReadiness(settings, info)
    if (!ready.ok) throw new Error(`Transkripsiyon başlatılamaz: ${ready.problems.join(' ')}`)
    stage('transcribe', { status: 'running', progress: 0 })
    if (ready.needsModelDownload) {
      stage('transcribe', { detail: `Whisper "${ready.needsModelDownload}" modeli indiriliyor (yalnızca ilk sefer)…` })
      await run(service.downloadModel(ready.needsModelDownload), 'Model indirme', (f) => stage('transcribe', { progress: f }))
    }
    const lang = req.language ?? settings.language
    const tid = await service.transcriptStart({ assetId: asset.id, track: asset.transcriptionTrack ?? 0, language: lang })
    await run(tid, 'Transkripsiyon', (f, m) => stage('transcribe', { progress: f, detail: m }))
    transcript = await service.transcriptGet(asset.id)
    if (!transcript || transcript.words.length === 0) throw new Error('Whisper çalıştı ama konuşma bulunamadı. Dili/modeli Ayarlar’dan kontrol edin.')
    stage('transcribe', { status: 'done', progress: 1, detail: `${transcript.words.length.toLocaleString('tr')} kelime` })
  }
  s.transcripts[asset.id] = transcript
  const words = transcript.words
  const world: World | undefined = await loadWorld(service.deps.resourcesDir).catch(() => undefined)

  // 3) plan ──────────────────────────────────────────────
  check()
  let plan: StoryPlan
  if (req.action === 'build') {
    plan = req.plan ?? (JSON.parse(await readFile(p.plan, 'utf8')) as StoryPlan)
    stage('plan', { status: 'done', progress: 1, detail: `${plan.scenes.filter((x) => x.enabled).length} sahne` })
  } else {
    stage('plan', { status: 'running', progress: 0 })
    const base = req.blank ? { ...planStory(words), scenes: [], warnings: ['Boş plan: sahneleri `story-plan.json` içine yazın (bkz. `story schema`).'] } : planStory(words, { theme: req.theme, isPlace: world ? (w) => (findPlace(world, w)?.name ?? undefined) : undefined })
    plan = base
    if (req.useAi) {
      const problem = llmConfigured(settings)
      if (problem) plan = { ...base, warnings: [...base.warnings, `Yapay zekâ kullanılamadı: ${problem} Kurallı plan gösteriliyor.`] }
      else {
        const r = await aiStoryScenes(words, settings, hooks.signal)
        if (r.scenes.length > 0) plan = { ...base, planner: 'ai', scenes: r.scenes, warnings: r.error ? [`Yapay zekâ kısmen yanıt verdi: ${r.error}`] : [] }
        else plan = { ...base, warnings: [...base.warnings, `Yapay zekâ sahne çıkaramadı (${r.error ?? 'boş yanıt'}). Kurallı plan gösteriliyor.`] }
      }
    }
    await writeFile(p.plan, JSON.stringify(plan, null, 2), 'utf8')
    stage('plan', { status: 'done', progress: 1, detail: `${plan.scenes.length} sahne (${plan.planner === 'ai' ? 'yapay zekâ' : 'kurallı taslak'})` })
    stage('render', { status: 'skipped' })
    stage('project', { status: 'skipped' })
    await s.save()
    return { outDir: p.dir, projectPath: p.project, planPath: p.plan, plan }
  }

  // 4) sahneleri çiz ─────────────────────────────────────
  check()
  const total = plan.totalSec > 0 ? plan.totalSec : asset.durationSec
  const scenes = normalizeScenes(plan.scenes, total).map((x) => ({ ...x, start: frameSnap(x.start), end: frameSnap(x.end) })).filter((x) => x.end - x.start >= 1 / FPS)
  if (scenes.length === 0) throw new Error('Çizilecek sahne yok: planda açık (işaretli) sahne bulunmuyor.')
  for (const sc of scenes) {
    const problem = contentProblem(sc.content)
    if (problem) throw new Error(`Sahne ${sc.id} (${sc.content.type}, ${sc.start.toFixed(1)} sn): ${problem}`)
  }
  const aspect = req.aspect ?? '16:9'
  const size = { ...aspectSize(aspect), fps: FPS }
  stage('render', { status: 'running', progress: 0 })
  const bg = join(p.scenes, `zemin-${size.width}x${size.height}.png`)
  await renderBackdrop(plan.theme, size, service.tools.ffmpeg, bg)
  const files: string[] = []
  for (const [i, sc] of scenes.entries()) {
    check()
    const file = join(p.scenes, `sahne-${String(i + 1).padStart(2, '0')}-${sc.content.type}.mp4`)
    try {
      await renderStoryScene(sc.content, plan.theme, size, sc.end - sc.start, service.tools.ffmpeg, file, { world, backdrop: bg, baseDir: p.dir, signal: hooks.signal })
    } catch (e) {
      check()
      throw new Error(`${i + 1}. sahne (${sc.content.type}, ${sc.start.toFixed(1)} sn) çizilemedi: ${e instanceof Error ? e.message : String(e)}`)
    }
    files.push(file)
    stage('render', { progress: (i + 1) / scenes.length, detail: `${i + 1}/${scenes.length} sahne` })
  }
  stage('render', { status: 'done', progress: 1, detail: `${scenes.length} sahne` })

  // 5) proje ─────────────────────────────────────────────
  check()
  stage('project', { status: 'running', progress: 0 })
  const ids = service.importMedia(files)
  for (const id of ids) await run(id, 'Sahne içe aktarma', () => undefined)
  const byPath = new Map([...service.assets.values()].map((a) => [a.path, a]))
  const known = new Set(s.project.assets.map((a) => a.id))
  const sceneAssets = files.map((f) => byPath.get(f))
  if (sceneAssets.some((a) => !a)) throw new Error('Sahne dosyaları projeye eklenemedi.')
  s.project = { ...s.project, assets: [...s.project.assets, ...sceneAssets.filter((a) => a && !known.has(a.id)).map((a) => a!)] }
  // önceki yapıyı temizle: bu hattın V1 sahneleri ve anlatım sesi yeniden kurulur
  const old = s.timeline.tracks.flatMap((t) => t.clips.filter((c) => (t.id === 'V1' && c.label?.startsWith('Sahne ')) || c.assetId === asset!.id).map((c) => c.id))
  if (old.length) s.apply(cmd.removeMany(old, true, 'Önceki sahneleri temizle'))
  const v1 = s.timeline.tracks.find((t) => t.id === 'V1')!
  const voice = s.timeline.tracks.find((t) => t.kind === 'audio' && t.role === 'voice') ?? s.timeline.tracks.find((t) => t.kind === 'audio')
  if (!voice) throw new Error('Projede ses katmanı yok.')
  const items: { trackId: string; clip: ReturnType<typeof clipForTrack> extends infer R ? (R extends { clip: infer C } ? C : never) : never }[] = []
  const narr = clipForTrack(asset, voice, { at: 0 })
  if ('error' in narr) throw new Error(narr.error)
  items.push({ trackId: voice.id, clip: narr.clip })
  for (const [i, sc] of scenes.entries()) {
    const a = sceneAssets[i]!
    const c = clipForTrack(a, v1, { at: sc.start })
    if ('error' in c) throw new Error(c.error)
    items.push({ trackId: v1.id, clip: { ...c.clip, label: `Sahne ${i + 1} · ${sc.content.type}` } })
  }
  s.apply(cmd.aspect(aspect), cmd.addClips(items, 'Anlatım sahneleri'))
  await s.save()
  const end = s.timeline.tracks.flatMap((t) => t.clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
  stage('project', { status: 'done', progress: 1, detail: `${Math.round(end)} sn` })
  return { outDir: p.dir, projectPath: p.project, planPath: p.plan, plan, rendered: { scenes: scenes.length, totalSec: end } }
}

/** Birden çok işi sırayla çalıştırır (CPU'yu tek iş kullanır) */
export class StoryManager {
  private jobs = new Map<string, { status: StoryStatus; ctrl: AbortController }>()
  private seq = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly env: { userDataDir?: string; resourcesDir?: string },
    private readonly emit: (s: StoryStatus) => void
  ) {}

  list(): StoryStatus[] {
    return [...this.jobs.values()].map((j) => structuredClone(j.status))
  }

  start(req: StoryRequest): string {
    const id = `story-${++this.seq}`
    const status: StoryStatus = { id, request: req, name: basename(req.mediaPath), status: 'running', stages: initialStoryStages(), startedAt: Date.now() }
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
        status.result = await runStory(req, this.env, {
          signal: ctrl.signal,
          onStage: (sid, patch) => {
            const st = status.stages.find((x) => x.id === sid)
            if (st) Object.assign(st, patch)
            push()
          }
        })
        status.status = 'done'
      } catch (e) {
        const cancelled = e instanceof StoryCancelled || ctrl.signal.aborted
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
