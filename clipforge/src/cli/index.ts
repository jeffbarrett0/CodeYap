/**
 * ClipForge komut satırı: uygulamayla AYNI iş mantığını (içe aktarma, transkripsiyon, arama, kesme, altyazı, dışa aktarma)
 * arayüz olmadan çalıştırır. Amaç: bir yapay zekâ asistanının (ör. Claude Code) videoyu komutlarla editleyebilmesi.
 * Her komut tek bir JSON nesnesi yazar (stdout); ilerleme/uyarılar stderr'e gider. Proje dosyası uygulamayla birebir uyumludur.
 *
 *   node out/main/cli.js <komut> <proje.clipforge> [seçenekler]      (kısa: npm run cli -- <komut> ...)
 */
import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { nearestBoundary, suggestClip } from '../shared/clip/boundaries'
import { cmd } from '../shared/timeline/commands'
import { captionsForTimeline } from '../shared/timeline/captions'
import { CAPTION_PRESETS, presetById } from '../shared/timeline/captionStyles'
import { clipItemsForSource, clipsForVideoWithAudio, retargetItems } from '../shared/timeline/create'
import { clipEnd, nearestAspect, timelineDuration } from '../shared/timeline/model'
import { clipsAt, timelineToSource } from '../shared/timeline/ops'
import { planSilenceCuts } from '../shared/timeline/silence'
import { timelineWords } from '../shared/timeline/transcript'
import { EXPORT_PRESETS, exportWarnings, optionsFromPreset } from '../shared/export/presets'
import type { MediaAsset } from '../shared/types'
import { log, makeService, Session, waitTask } from './session'

const run = promisify(execFile)

interface Args {
  pos: string[]
  opt: Record<string, string | true>
}

function parse(argv: string[]): Args {
  const pos: string[] = []
  const opt: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) (opt[key] = next, i++)
      else opt[key] = true
    } else pos.push(a)
  }
  return { pos, opt }
}

const num = (v: string | true | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined
  const n = Number(v)
  if (typeof v === 'boolean' || !Number.isFinite(n)) throw new Error(`--${name} sayı olmalı`)
  return n
}
const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined)

const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o, null, 2)}\n`)
const r1 = (n: number) => Math.round(n * 100) / 100

const HELP = `ClipForge CLI — videoyu komutlarla editleyin (her komut JSON döndürür)

  info                                   ffmpeg/ffprobe/whisper durumu
  new <proje> [--name ad]                boş proje oluşturur
  import <proje> <dosya...> [--add]      medya ekler (--add: ilk videoyu Video 1'e, 0. sn'den, sesiyle yerleştirir)
  show <proje>                           katmanlar, klipler, altyazılar, süre
  transcribe <proje> [--asset a] [--lang tr] [--model small] [--track 0] [--force]
  transcript <proje> [--asset a] [--from sn --to sn]   cümleler (kaynak zamanı)
  search <proje> "söz" [--asset a] [--limit 10]        sonuçlar (zaman, cümle, skor)
  add-clip <proje> (--start sn --end sn | --query "söz" [--pick 1] [--sec 25]) [--asset a]
                                         zaman çizelgesinin sonuna klip ekler (cümle sınırlarına yapışır)
  new-clip-project <proje> --query "söz" [--pick 1] [--sec 25] --out yeni.clipforge [--asset a]
                                         ana projeyi DEĞİŞTİRMEDEN bağımsız klip projesi üretir
  silence <proje> [--min-gap 0.7] [--keep 0.15] [--no-fillers]   sessizlik ve ııı/eee kesimi
  cut <proje> --from sn --to sn [--no-ripple]                      çizelge aralığını keser
  captions <proje> [--style classic|boxed-highlight] [--max-chars 22]   transkriptten altyazı üretir (boxed-highlight: referans stil)
  delete-lane <proje> <V1|V2|V3|I1|I2|A1|CC>                      o katmandaki her şeyi siler
  frame <proje> --at sn --out resim.jpg  çizelgedeki bir anın karesini kaydeder (görsel kontrol)
  export <proje> --out dosya.mp4 [--preset shorts|…]               dışa aktarır
  presets                                dışa aktarma şablonları

Her yazma işleminden önce <proje>.bak yedeği alınır. Zaman değerleri saniyedir.
`

async function pickResults(s: Session, asset: MediaAsset, query: string, limit = 10) {
  await s.service.transcriptGet(asset.id)
  const res = await s.service.searchRun({ assetId: asset.id, query })
  return res.slice(0, limit)
}

/** Aralığı zaman çizelgesinin sonuna ekler (arayüzdeki "klip oluştur" ile aynı yol) */
function commitClip(s: Session, asset: MediaAsset, start: number, end: number, origin: { query?: string; resultId?: string; matchTime?: number } = {}) {
  const tl = s.timeline
  const items = clipItemsForSource(asset, { start, end }, timelineDuration(tl), origin, (id) => s.project.assets.find((a) => a.id === id))
  const placed = retargetItems(tl, items)
  const hasVisual = tl.tracks.some((t) => (t.kind === 'video' || t.kind === 'image') && t.clips.length > 0)
  if (asset.kind === 'video' && tl.aspectAuto !== false && !hasVisual) s.apply(cmd.aspectAuto(true, nearestAspect(asset.width, asset.height)))
  const at = timelineDuration(s.timeline)
  s.apply(cmd.addClips(placed.map((i) => ({ ...i, clip: { ...i.clip, start: at + (i.clip.start - items[0].clip.start) } }))))
  s.apply(cmd.fillText())
  return placed.length
}

async function suggestFor(s: Session, asset: MediaAsset, a: Args) {
  const query = str(a.opt.query)
  const sec = num(a.opt.sec, 'sec') ?? 0
  if (query) {
    const results = await pickResults(s, asset, query, 50)
    const pick = (num(a.opt.pick, 'pick') ?? 1) - 1
    const r = results[pick]
    if (!r) throw new Error(`"${query}" için ${pick + 1}. sonuç yok (toplam ${results.length}).`)
    const sug = suggestClip(s.transcripts[asset.id]?.segments ?? [], r, { preRollSec: 0, postRollSec: 0, targetDurationSec: sec || undefined, maxDurationSec: Math.max(sec, 60), assetDurationSec: asset.durationSec })
    return { start: sug.start, end: sug.end, origin: { query, resultId: r.id, matchTime: r.start }, warnings: sug.warnings.map((w: { message: string }) => w.message), matched: r.sentence }
  }
  const start = num(a.opt.start, 'start')
  const end = num(a.opt.end, 'end')
  if (start === undefined || end === undefined || end <= start) throw new Error('--query ya da (--start ve --end) verin.')
  const segs = s.transcripts[asset.id]?.segments ?? []
  const snap = a.opt['no-snap'] ? { start, end } : { start: nearestBoundary(segs, start, 'start', { padStartSec: 0.12, padEndSec: 0.3, assetDurationSec: asset.durationSec }), end: nearestBoundary(segs, end, 'end', { padStartSec: 0.12, padEndSec: 0.3, assetDurationSec: asset.durationSec }) }
  return { ...snap, origin: {}, warnings: [] as string[], matched: undefined }
}

async function main(argv: string[]): Promise<unknown> {
  const a = parse(argv)
  const [command, projectArg, ...rest] = a.pos
  if (!command || command === 'help' || a.opt.help) return void process.stdout.write(HELP)

  if (command === 'presets') return out(EXPORT_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description })))
  if (command === 'info') {
    const svc = await makeService()
    return out(await svc.info())
  }
  if (!projectArg) throw new Error('Proje dosyası yolu gerekli. `help` komutuna bakın.')

  if (command === 'new') {
    const s = await Session.create(projectArg, str(a.opt.name) ?? 'Klip projesi')
    return out({ ok: true, project: s.path, tracks: s.timeline.tracks.map((t) => `${t.id}:${t.name}`) })
  }

  const s = await Session.open(projectArg)

  switch (command) {
    case 'import': {
      if (rest.length === 0) throw new Error('İçe aktarılacak dosya(lar)ı verin.')
      const files = rest.map((f) => resolve(f))
      const ids = s.service.importMedia(files)
      for (const [i, id] of ids.entries()) await waitTask(s.service, id, `İçe aktarma ${i + 1}/${ids.length}`)
      const known = new Set(s.project.assets.map((x) => x.id))
      const added = [...s.service.assets.values()].filter((x) => !known.has(x.id))
      s.project = { ...s.project, assets: [...s.project.assets, ...added] }
      if (a.opt.add) {
        const v = added.find((x) => x.kind === 'video')
        const track = s.timeline.tracks.find((t) => t.id === 'V1')
        if (v && track) {
          const r = clipsForVideoWithAudio(v, track, s.timeline.tracks, { at: 0 })
          if ('error' in r) throw new Error(r.error)
          if (s.timeline.aspectAuto !== false && !s.timeline.tracks.some((t) => t.clips.length && (t.kind === 'video' || t.kind === 'image'))) s.apply(cmd.aspectAuto(true, nearestAspect(v.width, v.height)))
          s.apply(cmd.addClips(r.items, 'Dosya ekle'))
        }
      }
      await s.save()
      return out({ ok: true, added: added.map((x) => ({ id: x.id, name: x.name, kind: x.kind, durationSec: r1(x.durationSec), size: `${x.width}x${x.height}`, fps: x.fps, audioStreams: x.audioStreams.length })), placed: !!a.opt.add })
    }
    case 'show': {
      const tl = s.timeline
      return out({
        project: s.project.name,
        aspect: tl.aspect,
        durationSec: r1(timelineDuration(tl)),
        assets: s.project.assets.map((x) => ({ id: x.id, name: x.name, kind: x.kind, durationSec: r1(x.durationSec), transcript: !!s.transcripts[x.id] })),
        tracks: tl.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, locked: t.locked, clips: t.clips.map((c) => ({ id: c.id, start: r1(c.start), end: r1(clipEnd(c)), srcIn: r1(c.srcIn), srcOut: r1(c.srcOut), label: c.label })) })),
        captions: tl.captions.length,
        captionSample: tl.captions.slice(0, 5).map((c) => ({ start: r1(c.start), end: r1(c.end), text: c.text }))
      })
    }
    case 'transcribe': {
      const asset = s.asset(str(a.opt.asset))
      const id = await s.service.transcriptStart({ assetId: asset.id, track: num(a.opt.track, 'track') ?? asset.transcriptionTrack ?? 0, language: str(a.opt.lang) ?? s.service.settings.value.language, model: str(a.opt.model) as never, force: !!a.opt.force })
      await waitTask(s.service, id, 'Transkripsiyon')
      const t = await s.service.transcriptGet(asset.id)
      if (t) s.transcripts[asset.id] = t
      await s.save()
      return out({ ok: true, asset: asset.name, words: t?.words.length ?? 0, sentences: t?.segments.length ?? 0, language: t?.language, model: t?.model })
    }
    case 'transcript': {
      const asset = s.asset(str(a.opt.asset))
      const t = s.transcripts[asset.id]
      if (!t) throw new Error('Transkript yok. Önce `transcribe` çalıştırın.')
      const from = num(a.opt.from, 'from') ?? 0
      const to = num(a.opt.to, 'to') ?? Infinity
      return out({ asset: asset.name, segments: t.segments.filter((g) => g.end > from && g.start < to).map((g) => ({ start: r1(g.start), end: r1(g.end), text: g.text })) })
    }
    case 'search': {
      const q = rest[0]
      if (!q) throw new Error('Aranacak sözü verin: search <proje> "söz"')
      const asset = s.asset(str(a.opt.asset))
      const res = await pickResults(s, asset, q, num(a.opt.limit, 'limit') ?? 10)
      return out({ asset: asset.name, query: q, results: res.map((r, i) => ({ pick: i + 1, start: r1(r.start), end: r1(r.end), score: r1(r.score), kind: r.kind, sentence: r.sentence })) })
    }
    case 'add-clip': {
      const asset = s.asset(str(a.opt.asset))
      const g = await suggestFor(s, asset, a)
      const n = commitClip(s, asset, g.start, g.end, g.origin)
      await s.save()
      return out({ ok: true, clips: n, source: { start: r1(g.start), end: r1(g.end), durationSec: r1(g.end - g.start) }, matched: g.matched, warnings: g.warnings, timelineSec: r1(timelineDuration(s.timeline)) })
    }
    case 'new-clip-project': {
      const outPath = str(a.opt.out)
      if (!outPath) throw new Error('--out <yeni.clipforge> gerekli.')
      const asset = s.asset(str(a.opt.asset))
      const g = await suggestFor(s, asset, a)
      const created = await s.service.createClipProject(s.project, asset.id, str(a.opt.name) ?? `${str(a.opt.query) ?? 'Klip'} · ${Math.round(g.end - g.start)} sn`)
      // yeni projeyi (kendi servis örneğiyle) açıp klibi ekle; ana proje dosyasına dokunulmaz
      const c = await Session.open(created.path)
      const ca = c.project.assets.find((x) => x.id === asset.id) ?? c.project.assets[0]
      commitClip(c, ca, g.start, g.end, g.origin)
      await c.save()
      let finalPath = created.path
      if (resolve(outPath) !== created.path) {
        await mkdir(dirname(resolve(outPath)), { recursive: true })
        await c.service.saveProject(c.project, resolve(outPath))
        finalPath = resolve(outPath)
        // ara dosya (ana projenin yanındaki -klipler klasörü) kalmasın
        await rm(created.path, { force: true })
        await rm(`${created.path}-data`, { recursive: true, force: true })
      }
      return out({ ok: true, project: finalPath, source: { start: r1(g.start), end: r1(g.end), durationSec: r1(g.end - g.start) }, matched: g.matched, warnings: g.warnings, note: 'Ana proje değişmedi.' })
    }
    case 'silence': {
      const words = timelineWords(s.timeline, s.transcripts)
      if (words.length === 0) throw new Error('Zaman çizelgesindeki içeriğin transkripti yok. `transcribe` çalıştırın.')
      const total = s.timeline.tracks.filter((t) => t.kind !== 'text').flatMap((t) => t.clips).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
      const set = s.service.settings.value
      const plan = planSilenceCuts(words, total, { minGapSec: num(a.opt['min-gap'], 'min-gap') ?? set.silenceMinGapSec, keepSec: num(a.opt.keep, 'keep') ?? set.silenceKeepSec, cutFillers: a.opt['no-fillers'] ? false : set.cutFillers })
      if (plan.cuts.length === 0) return out({ ok: true, cuts: 0, message: 'Kesilecek sessizlik/dolgu sesi bulunamadı.' })
      s.apply(cmd.cutRanges(plan.cuts))
      await s.save()
      return out({ ok: true, cuts: plan.cuts.length, removedSec: r1(plan.removedSec), fillers: plan.fillerCount, newDurationSec: r1(timelineDuration(s.timeline)) })
    }
    case 'cut': {
      const from = num(a.opt.from, 'from')
      const to = num(a.opt.to, 'to')
      if (from === undefined || to === undefined || to <= from) throw new Error('--from ve --to verin (to > from).')
      s.apply(cmd.cutRange(from, to, !a.opt['no-ripple']))
      await s.save()
      return out({ ok: true, removedSec: r1(to - from), newDurationSec: r1(timelineDuration(s.timeline)) })
    }
    case 'captions': {
      const styleId = str(a.opt.style)
      if (styleId) {
        const p = presetById(styleId)
        if (p.id !== styleId) throw new Error(`Bilinmeyen stil: ${styleId}. Seçenekler: ${CAPTION_PRESETS.map((x) => x.id).join(', ')}`)
        const st = { ...s.timeline.captionStyle, ...p.style, enabled: true, positionY: s.timeline.captionStyle.positionY }
        if (p.id === 'classic') (delete st.box, delete st.highlight)
        s.apply(cmd.captionPreset(st))
      }
      const words = Object.fromEntries(Object.entries(s.transcripts).map(([id, t]) => [id, t.words]))
      const caps = captionsForTimeline(s.timeline, words, { maxCharsPerLine: num(a.opt['max-chars'], 'max-chars') ?? s.timeline.captionStyle.maxCharsPerLine })
      if (caps.length === 0) throw new Error('Altyazı üretilemedi: zaman çizelgesi boş ya da kliplerin transkripti yok.')
      s.apply(cmd.captions(caps), cmd.captionStyle({ enabled: true }, false))
      const style = s.timeline.captionStyle.box?.enabled ? 'boxed-highlight' : 'classic'
      await s.save()
      return out({ ok: true, style, captions: caps.length, sample: caps.slice(0, 5).map((c) => ({ start: r1(c.start), end: r1(c.end), text: c.text, highlight: c.hl })) })
    }
    case 'delete-lane': {
      const lane = rest[0]
      if (!lane) throw new Error('Katman verin: V1 V2 V3 I1 I2 A1 CC')
      let n = 0
      if (lane === 'CC') {
        n = s.timeline.captions.length
        s.apply(cmd.captions([]))
      } else {
        const t = s.timeline.tracks.find((x) => x.id === lane)
        if (!t) throw new Error(`Katman yok: ${lane}`)
        if (t.locked) throw new Error(`"${t.name}" kilitli.`)
        n = t.clips.length
        s.apply(cmd.removeMany(t.clips.map((c) => c.id), true, `${t.name}: hepsini sil`))
      }
      await s.save()
      return out({ ok: true, lane, deleted: n })
    }
    case 'frame': {
      const at = num(a.opt.at, 'at')
      const outImg = str(a.opt.out)
      if (at === undefined || !outImg) throw new Error('--at <sn> ve --out <resim.jpg> verin.')
      const c = clipsAt(s.timeline, at).find((x) => s.timeline.tracks.find((t) => t.id === x.trackId)?.kind === 'video')
      if (!c) throw new Error(`${at}. saniyede video klibi yok.`)
      const asset = s.project.assets.find((x) => x.id === c.assetId)!
      await mkdir(dirname(resolve(outImg)), { recursive: true })
      await run(s.service.tools.ffmpeg, ['-y', '-v', 'error', '-ss', String(timelineToSource(c, at)), '-i', asset.path, '-frames:v', '1', '-vf', 'scale=960:-2', resolve(outImg)])
      return out({ ok: true, image: resolve(outImg), timelineSec: at, sourceSec: r1(timelineToSource(c, at)) })
    }
    case 'export': {
      const outPath = str(a.opt.out)
      if (!outPath) throw new Error('--out <dosya.mp4> gerekli.')
      const total = timelineDuration(s.timeline)
      if (total <= 0) throw new Error('Zaman çizelgesi boş.')
      const options = optionsFromPreset(str(a.opt.preset) ?? (a.opt.aspect === '16:9' ? 'youtube' : s.service.settings.value.exportDefaults.presetId))
      const tl = s.timeline.aspect === options.aspect ? s.timeline : { ...s.timeline, aspect: options.aspect }
      await mkdir(dirname(resolve(outPath)), { recursive: true })
      const id = s.service.exportStart({ name: 'cli', timeline: tl, assets: s.project.assets, options, range: { start: 0, end: total }, outputPath: resolve(outPath) })
      await waitTask(s.service, id, 'Dışa aktarma')
      return out({ ok: true, output: resolve(outPath), durationSec: r1(total), preset: options.presetId, warnings: exportWarnings(total, options) })
    }
    default:
      throw new Error(`Bilinmeyen komut: ${command}. \`help\` ile listeyi görün.`)
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    process.stdout.write(`${JSON.stringify({ ok: false, error: msg }, null, 2)}\n`)
    log(`Hata: ${msg}`)
    process.exit(1)
  }
)
