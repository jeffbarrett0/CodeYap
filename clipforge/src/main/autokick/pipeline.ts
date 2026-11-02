import { access, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { initialStages, transcriptionReadiness, type AutoKickRequest, type AutoKickResult, type AutoKickStage, type AutoKickStageState } from '../../shared/autokick'
import { cmd } from '../../shared/timeline/commands'
import { clipsForVideoWithAudio } from '../../shared/timeline/create'
import { nearestAspect, timelineDuration } from '../../shared/timeline/model'
import { findGaps } from '../../shared/timeline/ops'
import { ffprobeJson } from '../ffmpeg'
import { mergeRanges, renderFastCut, snapToFrame, type Range } from './fastcut'
import { planSilenceCuts } from '../../shared/timeline/silence'
import { timelineWords } from '../../shared/timeline/transcript'

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
  const service = await makeService(env)
  const settings = service.settings.value
  // 0) ön kontrol: whisper/ffmpeg hazır mı? Uzun işe başlamadan, anlaşılır mesajla (içe aktarmadan ÖNCE) ───
  const info = await service.info()
  if (!info.ffmpeg.ok || !info.ffprobe.ok) throw new Error(`ffmpeg/ffprobe çalışmıyor (${info.ffmpeg.error ?? info.ffprobe.error ?? 'bulunamadı'}). Uygulamayı yeniden kurun ya da Ayarlar'dan yolunu gösterin.`)
  const ready = transcriptionReadiness(settings, info)
  if (!ready.ok) throw new Error(`Transkripsiyon başlatılamaz: ${ready.problems.join(' ')}`)
  await mkdir(p.dir, { recursive: true })
  /** Kuyruktaki bir görevi bekler; iptalde görevi durdurur */
  const run = async (id: string, label: string, onProgress: (f: number, message?: string) => void) => {
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
    stage('import', { detail: 'Kayıt inceleniyor ve hazırlanıyor…' })
    for (const id of ids) await run(id, 'İçe aktarma', (f) => stage('import', { progress: f, detail: `Kayıt içe aktarılıyor %${Math.round(f * 100)}` }))
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
  const lang = req.language ?? settings.language
  try {
    // model yoksa kendiliğinden indirilir (kullanıcı ayrıca bir şey yapmaz)
    if (ready.needsModelDownload) {
      stage('transcribe', { detail: `Whisper "${ready.needsModelDownload}" modeli indiriliyor (yalnızca ilk sefer)…` })
      const mid = service.downloadModel(ready.needsModelDownload)
      await run(mid, 'Model indirme', (f, m) => stage('transcribe', { progress: f, detail: `Whisper modeli indiriliyor ${m ?? ''}`.trim() }))
      stage('transcribe', { progress: 0 })
    }
    // konuşma hangi ses track'inde? (çok track'li OBS kayıtları)
    let track = req.track
    const existing = await service.transcriptGet(asset.id)
    if (track === undefined && existing) track = existing.audioTrack // önceki çalıştırmadan: aynı track
    if (track === undefined && asset.audioStreams.length > 1) {
      stage('transcribe', { detail: `Konuşmanın hangi ses track'inde olduğu denetleniyor (${asset.audioStreams.length} track)…` })
      const d = await service.detectSpeechTrack(asset.id, lang, req.model, hooks.signal)
      track = d.track
      stage('transcribe', { detail: `Konuşma Track ${track + 1}'de bulundu (kelime sayıları: ${d.words.join(' / ')})` })
    }
    track ??= asset.transcriptionTrack ?? 0
    const tid = await service.transcriptStart({ assetId: asset.id, track, language: lang, model: req.model })
    await run(tid, 'Transkripsiyon', (f, m) => stage('transcribe', { progress: f, detail: m ? `Track ${track! + 1} · ${m}` : undefined }))
    const tr = await service.transcriptGet(asset.id)
    if (!tr || tr.words.length === 0) {
      throw new Error(`Whisper çalıştı ama konuşma bulunamadı (Track ${track + 1}, dil: ${lang}, model: ${req.model ?? settings.whisperModel}). Kayıtta konuşma yoksa ya da yanlış track/dil seçiliyse olur; Ayarlar'dan dili ve modeli kontrol edin.`)
    }
  } catch (e) {
    check()
    throw new Error(`Transkripsiyon aşamasında hata: ${e instanceof Error ? e.message : String(e)}`)
  }
  const transcript = (await service.transcriptGet(asset.id))!
  s.transcripts[asset.id] = transcript
  stage('transcribe', { status: 'done', progress: 1, detail: `${transcript.words.length.toLocaleString('tr')} kelime · ${transcript.segments.length} cümle` })

  // 3) sessizleri kes ───────────────────────────────────
  check()
  const fps = asset.fps > 0 ? asset.fps : 30
  if (state.silence) stage('silence', { status: 'done', progress: 1, detail: `Önceki çalıştırmadan: ${state.silence.cuts} kesim` })
  else {
    stage('silence', { status: 'running', progress: 0 })
    const before = timelineDuration(s.timeline)
    const words = timelineWords(s.timeline, s.transcripts)
    const sil = req.silence ?? { minGapSec: settings.silenceMinGapSec, keepSec: settings.silenceKeepSec, cutFillers: settings.cutFillers }
    const plan = planSilenceCuts(words, before, sil)
    // kesim sınırları kare ızgarasına oturur: görüntü ve ses aynı uzunlukta kalır (kayma olmaz)
    const cuts = mergeRanges(plan.cuts.map(([x, y]) => [snapToFrame(x, fps), snapToFrame(y, fps)] as Range).filter(([x, y]) => y - x >= 1 / fps))
    if (cuts.length > 0) s.apply(cmd.cutRanges(cuts))
    state.silence = { cuts: cuts.length, removedSec: before - timelineDuration(s.timeline), before, after: timelineDuration(s.timeline), fillers: plan.fillerCount }
    await save()
    stage('silence', { status: 'done', progress: 1, detail: `${cuts.length} kesim · ${Math.round((state.silence.removedSec / 60) * 10) / 10} dk kısaldı` })
  }

  // 4) boşlukları kapat ──────────────────────────────────
  check()
  stage('gaps', { status: 'running', progress: 0 })
  const gapsBefore = findGaps(s.timeline).length
  if (gapsBefore > 0) s.apply(cmd.closeGaps())
  const left = findGaps(s.timeline)
  if (left.length > 0) throw new Error(`Boşluklar kapatılamadı (${left.length} adet kaldı, ilki ${left[0][0].toFixed(1)} sn).`)
  state.silence.after = timelineDuration(s.timeline)
  await save()
  stage('gaps', { status: 'done', progress: 1, detail: gapsBefore ? `${gapsBefore} boşluk kapatıldı` : 'Boşluk yok (kesimler kendiliğinden bitişik)' })

  // 5) tam video ─────────────────────────────────────────
  check()
  let haveFull = false
  try {
    await access(p.full)
    haveFull = !!state.full
  } catch {
    haveFull = false
  }
  // tutulan aralıklar: Video 1'deki klipler (kaynak zamanı), kayıt tek kaynaktır
  const kept = mergeRanges(
    s.timeline.tracks
      .find((t) => t.id === 'V1')!
      .clips.filter((c) => c.assetId === asset.id)
      .map((c) => [c.srcIn, c.srcOut] as Range)
  )
  const expected = kept.reduce((n, [x, y]) => n + (y - x), 0)
  if (expected <= 0) throw new Error('Kesimden sonra video kalmadı (tüm kayıt sessiz algılandı).')
  if (Math.abs(expected - timelineDuration(s.timeline)) > 0.5) throw new Error('Çizelge süresi tutarsız (beklenen ve gerçek süre farklı); işlem durduruldu.')
  if (haveFull) stage('full', { status: 'done', progress: 1, detail: 'Önceki çalıştırmadan' })
  else {
    stage('full', { status: 'running', progress: 0 })
    // yer kontrolü: çıktı için en az kaynağın %80'i kadar boş alan
    try {
      const fsStat = await statfs(p.dir)
      const free = fsStat.bavail * fsStat.bsize
      const need = Math.max(2e9, (await stat(p.video)).size * 0.8)
      if (free < need) throw new Error(`Diskte yeterli boş yer yok: ${(free / 1e9).toFixed(1)} GB boş, yaklaşık ${(need / 1e9).toFixed(1)} GB gerekli. Çıkış klasörünü başka bir sürücüye alın.`)
    } catch (e) {
      if (e instanceof Error && /Diskte/.test(e.message)) throw e
    }
    const o = (req.quality ?? 'fast') === 'high' ? { crf: 14, encoderPreset: 'slow', maxrateKbps: 150000, audioKbps: 320 } : { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192 }
    const tmpOut = `${p.full}.part.mp4`
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    hooks.signal.addEventListener('abort', onAbort, { once: true })
    try {
      await renderFastCut(asset, kept, o, service.tools.ffmpeg, tmpOut, { signal: abort.signal, onProgress: (f) => stage('full', { progress: f }) })
    } catch (e) {
      await rm(tmpOut, { force: true })
      check()
      throw e
    } finally {
      hooks.signal.removeEventListener('abort', onAbort)
    }
    // doğrulama: süre, görüntü ve ses var mı
    const probe = await ffprobeJson(service.tools.ffprobe, tmpOut)
    const vs = probe.streams?.find((x) => x.codec_type === 'video')
    const as = probe.streams?.find((x) => x.codec_type === 'audio')
    const fmtDur = Number(probe.format?.duration)
    const dur = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fmtDur)
    const vdur = dur(vs?.duration)
    const adur = dur(as?.duration)
    // görüntü ve ses, beklenen süreyle ve BİRBİRİYLE eşleşmeli (kayma = kesimlerde birikmiş hata)
    if (!vs || !as || !(Math.abs(vdur - expected) <= 0.5) || !(Math.abs(adur - expected) <= 0.5) || !(Math.abs(vdur - adur) <= 0.25)) {
      await rm(tmpOut, { force: true })
      throw new Error(`Çıktı doğrulanamadı: beklenen ${expected.toFixed(1)} sn; görüntü ${vdur.toFixed(1)} sn, ses ${as ? `${adur.toFixed(1)} sn` : 'YOK'}. Kaynak dosya değiştirilmedi; tekrar deneyin.`)
    }
    await rename(tmpOut, p.full)
    state.full = true
    await save()
    stage('full', { status: 'done', progress: 1, detail: p.full })
  }

  const st = state.silence
  return {
    verified: true,
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
    const status: import('../../shared/autokick').AutoKickStatus = { id, request: req, videoName: basename(req.videoPath), status: 'running', stages: initialStages(), startedAt: Date.now() }
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
