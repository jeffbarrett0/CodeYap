import { access, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Session, makeService, waitTask } from '../../cli/session'
import { llmConfigured } from '../ideas/llm'
import { detectIntro, introReference } from './intro'
import { fmtElapsed, initialStages, transcriptionReadiness, type AutoKickRequest, type AutoKickResult, type AutoKickStage, type AutoKickStageState } from '../../shared/autokick'
import { cmd } from '../../shared/timeline/commands'
import { clipsForVideoWithAudio } from '../../shared/timeline/create'
import { nearestAspect, timelineDuration } from '../../shared/timeline/model'
import { findGaps } from '../../shared/timeline/ops'
import { cpuPolicy, ffprobeJson, setCpuMode } from '../ffmpeg'
import type { Settings } from '../../shared/types'
import { mergeRanges, renderFastCut, snapToFrame, type Range } from './fastcut'
import { cutReportText, planSilenceCuts } from '../../shared/timeline/silence'
import { detectVoicedRuns, mapVoicedToTimeline } from './voice'
import { appendOutro, resolveOutro } from '../outro'
import { detectHwEncoder, HW_LABEL, videoEncoderArgs, type HwEncoder } from './hwenc'
import { timelineWords } from '../../shared/timeline/transcript'
import { chapterClipRanges, formatChapters, mapChapterList, parseChapterList } from '../../shared/chapters'
import { autoAdjustFrom } from '../../shared/adjust'
import { appendRunLog } from '../runlog'
import { qaText } from '../../shared/qa'
import { qaVideo } from '../qa'

export interface AutoKickHooks {
  onStage(id: AutoKickStage, patch: Partial<AutoKickStageState>): void
  signal: AbortSignal
}

interface State {
  /** yayın başı videosu kesildiyse süresi (tekrar çalıştırmada yeniden kesilmesin) */
  intro?: { cutSec: number }
  silence?: { cuts: number; removedSec: number; before: number; after: number; fillers: number }
  full?: boolean
  /** YouTube outro (kapanış videosu) tam videonun sonuna eklendi: yeniden çalıştırmada İKİNCİ KEZ eklenmesin */
  outro?: boolean
  /** tam video hangi donanım kodlayıcıyla yazıldı (outro aynı kodlayıcıyla uydurulsun) */
  hw?: HwEncoder | null
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
  return { video, name, dir, project: join(dir, `${name}.clipforge`), full: join(dir, `${name} - full.mp4`), state: join(dir, 'autokick.json'), cutReport: join(dir, 'Kesim raporu.txt') }
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
  // gözetimsiz iş: tüm çekirdekler (bilgisayar o sırada yavaşlayabilir; Ayarlar'dan kapatılır). Bitince eski mod geri yüklenir.
  const prevCpu = cpuPolicy.mode
  if (settings.autoKickFullSpeed) setCpuMode('full')
  try {
    return await runAutoKickInner(req, p, hooks, service, settings, stage, check)
  } finally {
    setCpuMode(prevCpu)
  }
}

async function runAutoKickInner(req: AutoKickRequest, p: ReturnType<typeof autoKickPaths>, hooks: AutoKickHooks, service: Awaited<ReturnType<typeof makeService>>, settings: Settings, stage: AutoKickHooks['onStage'], check: () => void): Promise<AutoKickResult> {
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
    // yayın başı videosu (telifli şarkı): referans ekranla eşleşirse ilk bölüm kesilir (hata olursa kesilmez, iş sürer)
    let introNote = ''
    if (settings.introCutEnabled) {
      const ref = await introReference(settings.introReferencePath, service.deps.resourcesDir)
      if (ref) {
        stage('import', { detail: 'Yayın başı videosu aranıyor…' })
        const det = await detectIntro(service.tools.ffmpeg, p.video, ref, settings.introDurationSec)
        if (det.found) {
          s.apply(cmd.cutRange(0, Math.min(det.endSec, asset.durationSec), true))
          state.intro = { cutSec: Math.round(det.endSec) }
          introNote = ` · yayın başı videosu kesildi (${Math.floor(det.endSec / 60)}:${String(Math.round(det.endSec % 60)).padStart(2, '0')})`
        } else introNote = ` · yayın başı: ${det.reason}`
      }
    }
    await save()
    stage('import', { status: 'done', progress: 1, detail: `${Math.round(asset.durationSec / 60)} dk · ${asset.width}×${asset.height}${introNote}` })
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
    let words = timelineWords(s.timeline, s.transcripts)
    const sil = req.silence ?? { minGapSec: settings.silenceMinGapSec, keepSec: settings.silenceKeepSec, cutFillers: settings.cutFillers }
    // KONUŞMA KORUMASI: gerçek ses seviyesinden "ses var" aralıkları; sessizlik kesimleri bunlara giremez (analiz olmazsa temkinli paylarla devam)
    let voiced: [number, number][] | undefined
    let guardNote = ''
    if (settings.silenceAudioGuard !== false) {
      stage('silence', { detail: 'Gerçek ses seviyesi çözümleniyor (konuşmanın kesilmemesi için)…' })
      try {
        const tr = s.transcripts[asset.id]
        const va = await detectVoicedRuns(asset.path, tr?.audioTrack ?? asset.transcriptionTrack ?? 0, service.tools, { signal: hooks.signal, durationSec: asset.durationSec, onProgress: (f) => stage('silence', { progress: f * 0.85 }) })
        const keptClips = (s.timeline.tracks.find((t) => t.id === 'V1')?.clips ?? []).filter((c) => c.assetId === asset.id).map((c) => ({ srcIn: c.srcIn, srcOut: c.srcOut, start: c.start }))
        voiced = mapVoicedToTimeline(va.runs, keptClips)
        guardNote = va.continuous ? ' · ses sürekli (kesim az olabilir)' : ''
        if (!va.continuous && voiced.length) {
          // HAYALET KELİMELER: Whisper sessizliği "Altyazı…", "Teşekkürler" gibi sözlerle doldurabilir; bu sözler sessizliği "konuşma" gösterip kesimi engeller.
          // Çevresinde (±0,4 sn) hiç ses olmayan kelime sayılmaz.
          const near = (w: { start: number; end: number }) => voiced!.some(([a, b]) => b >= w.start - 0.4 && a <= w.end + 0.4)
          const real = words.filter(near)
          if (real.length < words.length && real.length > 0) {
            guardNote += ` · ${words.length - real.length} hayalet kelime (sessizlikte) yok sayıldı`
            words = real
          }
        }
      } catch (e) {
        check()
        guardNote = ` · ses analizi yapılamadı (${e instanceof Error ? e.message.slice(0, 80) : String(e)}): temkinli paylarla`
      }
    }
    const plan = planSilenceCuts(words, before, { ...sil, voiced })
    // kesim sınırları kare ızgarasına oturur: görüntü ve ses aynı uzunlukta kalır (kayma olmaz)
    const cuts = mergeRanges(plan.cuts.map(([x, y]) => [snapToFrame(x, fps), snapToFrame(y, fps)] as Range).filter(([x, y]) => y - x >= 1 / fps))
    // kesim raporu (kesimden ÖNCE: zamanlar kesim öncesi çizelge → orijinal kayıt zamanına çevrilir)
    try {
      const v1 = (s.timeline.tracks.find((t) => t.id === 'V1')?.clips ?? []).filter((c) => c.assetId === asset.id)
      const toSource = (t: number) => {
        const c = v1.find((x) => t >= x.start - 1e-6 && t < x.start + (x.srcOut - x.srcIn) + 1e-6)
        return c ? c.srcIn + (t - c.start) : t
      }
      await writeFile(p.cutReport, cutReportText({ cuts: cuts as [number, number][], words, toSource, guardNote: voiced ? `açık (gerçek ses seviyesine bakıldı${guardNote})` : undefined }) + '\n', 'utf8')
    } catch {
      /* rapor yazılamadı: iş yine sürer */
    }
    if (cuts.length > 0) s.apply(cmd.cutRanges(cuts))
    state.silence = { cuts: cuts.length, removedSec: before - timelineDuration(s.timeline), before, after: timelineDuration(s.timeline), fillers: plan.fillerCount }
    await save()
    stage('silence', { status: 'done', progress: 1, detail: `${cuts.length} kesim · ${Math.round((state.silence.removedSec / 60) * 10) / 10} dk kısaldı${voiced ? ' · konuşma korundu (ses seviyesine bakıldı)' : ''}${guardNote}` })
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
  else if (req.manual) stage('full', { status: 'skipped', progress: 1, detail: 'Bu iş için tam video gerekmez' })
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
    const o = { ...((req.quality ?? 'fast') === 'high' ? { crf: 14, encoderPreset: 'slow', maxrateKbps: 150000, audioKbps: 320 } : { crf: 20, encoderPreset: 'veryfast', maxrateKbps: 40000, audioKbps: 192 }), adjust: autoAdjustFrom(service.settings.value) }
    // DONANIM KODLAYICI: ekran kartı varsa tam video kat kat hızlı kodlanır; hata olursa yazılım kodlamaya döner
    const hwFound = settings.autoKickHwEncode !== false ? await detectHwEncoder(service.tools.ffmpeg) : null
    const tmpOut = `${p.full}.part.mp4`
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    hooks.signal.addEventListener('abort', onAbort, { once: true })
    let usedHw: HwEncoder | null = hwFound
    try {
      try {
        if (hwFound) stage('full', { detail: `Ekran kartıyla kodlanıyor (${HW_LABEL[hwFound]})` })
        await renderFastCut(asset, kept, { ...o, hw: hwFound }, service.tools.ffmpeg, tmpOut, { signal: abort.signal, onProgress: (f) => stage('full', { progress: f }) })
      } catch (e) {
        await rm(tmpOut, { force: true })
        check()
        if (!hwFound) throw e
        // ekran kartı kodlaması başarısız: yazılım kodlayıcıyla baştan (iş durmaz)
        usedHw = null
        void appendRunLog(p.dir, `Auto Kick: ekran kartı kodlaması başarısız (${e instanceof Error ? e.message.split('\n')[0].slice(0, 100) : String(e)}); yazılım kodlamaya geçildi`)
        stage('full', { progress: 0, detail: 'Ekran kartı kodlaması olmadı; işlemciyle kodlanıyor (daha yavaş)' })
        await renderFastCut(asset, kept, { ...o, hw: null }, service.tools.ffmpeg, tmpOut, { signal: abort.signal, onProgress: (f) => stage('full', { progress: f }) })
      }
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
    state.hw = usedHw
    await save()
    stage('full', { status: 'done', progress: 1, detail: p.full })
  }

  // YouTube OUTRO (kullanıcının kapanış videosu): tam yayın videosunun SONUNA. (Eskiden yalnızca yatay kesitlere ekleniyordu; asıl YouTube'a yüklenen bu video outro'suz kalıyordu.)
  // Zaman damgaları/kesit aralıkları etkilenmez (outro en sonda). Eklenemezse video outro'suz kalır ve nedeni günlüğe/sonuca yazılır.
  let outroNote: string | undefined
  if (!req.manual && !state.outro) {
    try {
      const outroPath = await resolveOutro(settings.outroPath, service.deps.userDataDir, service.deps.resourcesDir, settings.outroEnabled)
      if (outroPath) {
        stage('full', { detail: 'YouTube outro ekleniyor…' })
        const high = (req.quality ?? 'fast') === 'high'
        // outro, tam videoyla AYNI kodlayıcıyla uydurulur (parametre uyuşmazlığı olmasın)
        const r = await appendOutro(p.full, outroPath, service.tools, { signal: hooks.signal, enc: videoEncoderArgs({ crf: high ? 14 : 20, encoderPreset: high ? 'slow' : 'veryfast', maxrateKbps: high ? 150000 : 40000 }, state.hw) })
        if (r.ok) {
          state.outro = true
          await save()
          outroNote = `Outro eklendi (+${Math.round(r.outroSec ?? 0)} sn)`
        } else outroNote = r.error
        void appendRunLog(p.dir, `Auto Kick: ${outroNote}`)
        stage('full', { detail: `${p.full} · ${outroNote}` })
      }
    } catch (e) {
      check()
      outroNote = `Outro eklenemedi: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`
      void appendRunLog(p.dir, `Auto Kick: ${outroNote}`)
    }
  }

  // YouTube zaman damgaları (tam videonun yanına .txt); hata olursa iş yine başarılıdır
  let timestampsPath: string | undefined
  let timestampsText: string | undefined
  let chapterRanges: { start: number; end: number; title: string }[] | undefined
  try {
    if (req.manual) {
      // elle akış (YouTube dikey video): zaman damgası/kalite raporu yok
    } else if (req.chapterList?.trim()) {
      // kullanıcının hazır listesi (orijinal kayıt zamanı) → kesimli videonun zamanına çevrilir
      const mainId = s.project.assets[0]?.id
      const kept = s.timeline.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips).filter((c) => c.assetId === mainId).map((c) => ({ srcIn: c.srcIn, srcOut: c.srcOut, start: c.start }))
      const total = timelineDuration(s.timeline)
      const mapped = mapChapterList(parseChapterList(req.chapterList), kept, total)
      if (mapped.chapters.length > 0) {
        // yatay klip aralıkları: her bölüm bir sonrakinin başına kadar; "Giriş" ve 10 sn'den kısa olanlar klip olmaz
        chapterRanges = chapterClipRanges(mapped.chapters, total, req.chapterMinSec ?? 10)
        timestampsPath = p.full.replace(/\.mp4$/i, '') + ' - zaman damgaları.txt'
        timestampsText = formatChapters(mapped.chapters, total)
        await writeFile(timestampsPath, timestampsText + '\n', 'utf8')
        // YouTube'a yapıştırılacak dosya temiz kalsın: uyarılar (kesilen yere denk gelen bölümler) ayrı dosyaya
        if (mapped.warnings.length) await writeFile(p.full.replace(/\.mp4$/i, '') + ' - zaman damgaları uyarılar.txt', mapped.warnings.join('\n') + '\n', 'utf8')
      }
    } else {
      const ch = await service.chaptersGenerate({ timeline: s.timeline, useAi: llmConfigured(settings) === null })
      if (ch.chapters.length >= 3) {
        timestampsPath = p.full.replace(/\.mp4$/i, '') + ' - zaman damgaları.txt'
        timestampsText = ch.text
        await writeFile(timestampsPath, ch.text + '\n', 'utf8')
      }
    }
  } catch {
    timestampsPath = undefined
  }

  // çıkış kontrolü (ilk kare, siyah ekran, uzun sessizlik, ses şiddeti): tamamlanmış 2,5 saatlik videoyu BAŞTAN SONA üç kez taradığı için
  // artık işi BEKLETMEZ — iş "bitti" dedikten sonra arka planda çalışır, rapor hazır olunca tam videonun yanına yazılır (kullanıcı: "çok uzun sürüyor")
  const qaPath = p.full.replace(/\.mp4$/i, '') + ' - kalite raporu.txt'
  if (!req.manual) {
    void (async () => {
      try {
        const q = await qaVideo(p.full, service.tools)
        await writeFile(qaPath, qaText(q.items) + '\n', 'utf8')
        void appendRunLog(p.dir, `Kalite raporu hazır: ${qaPath}`)
      } catch {
        /* rapor üretilemedi: iş etkilenmez */
      }
    })()
  }

  const st = state.silence
  return {
    verified: true,
    outDir: p.dir,
    projectPath: p.project,
    fullVideoPath: p.full,
    timestampsPath,
    cutReportPath: await access(p.cutReport).then(() => p.cutReport, () => undefined),
    outroNote: outroNote ?? (state.outro ? 'Outro eklendi' : undefined),
    timestampsText,
    qaPath: req.manual ? undefined : qaPath,
    chapterRanges,
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
            if (st) {
              Object.assign(st, patch)
              if (patch.status === 'running' && !st.startedAt) st.startedAt = Date.now()
              if (patch.status && patch.status !== 'running' && patch.status !== 'pending') (st.startedAt ??= Date.now(), (st.endedAt = Date.now()))
            }
            if (patch.status) void appendRunLog(autoKickPaths(req.videoPath, req.outDir).dir, `[Auto Kick:${sid}] ${patch.status}${patch.detail ? ` — ${patch.detail}` : ''}`)
            push()
          }
        })
        status.status = 'done'
        // hangi aşama ne kadar sürdü (hız sorunlarını görmek için günlüğe de yazılır)
        const dur = status.stages.filter((x) => x.startedAt && x.endedAt && x.endedAt - x.startedAt >= 2000).map((x) => `${x.label}: ${fmtElapsed(x.endedAt! - x.startedAt!)}`)
        if (dur.length) void appendRunLog(status.result.outDir, `Aşama süreleri → ${dur.join(' · ')}`)
        void appendRunLog(status.result.outDir, `Auto Kick TAMAMLANDI. Tam video: ${status.result.fullVideoPath}${status.result.chapterRanges ? ` · liste alanı: ${status.result.chapterRanges.length}` : req.chapterList?.trim() ? ' · liste verildi ama çevrilen bölüm yok' : ''}`)
      } catch (e) {
        const cancelled = e instanceof AutoKickCancelled || ctrl.signal.aborted
        status.status = cancelled ? 'cancelled' : 'failed'
        if (!cancelled) status.error = e instanceof Error ? e.message : String(e)
        void appendRunLog(autoKickPaths(req.videoPath, req.outDir).dir, `Auto Kick ${cancelled ? 'İPTAL EDİLDİ' : 'HATA: ' + status.error}`)
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
