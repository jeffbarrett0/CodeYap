/**
 * ClipForge komut satırı: uygulamayla AYNI iş mantığını (içe aktarma, transkripsiyon, arama, kesme, altyazı, dışa aktarma)
 * arayüz olmadan çalıştırır. Amaç: bir yapay zekâ asistanının (ör. Claude Code) videoyu komutlarla editleyebilmesi.
 * Her komut tek bir JSON nesnesi yazar (stdout); ilerleme/uyarılar stderr'e gider. Proje dosyası uygulamayla birebir uyumludur.
 *
 *   node out/main/cli.js <komut> <proje.clipforge> [seçenekler]      (kısa: npm run cli -- <komut> ...)
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { nearestBoundary, suggestClip } from '../shared/clip/boundaries'
import { cmd } from '../shared/timeline/commands'
import { captionsForTimeline } from '../shared/timeline/captions'
import { CAPTION_PRESETS, presetById } from '../shared/timeline/captionStyles'
import { clipForTrack, clipItemsForSource, clipsForVideoWithAudio, retargetItems } from '../shared/timeline/create'
import { findPlace, key as geoKey, placesInText } from '../shared/graphics/geo'
import { DEFAULT_SCENE, type SceneSpec } from '../shared/graphics/scenes'
import { loadWorld, renderScene } from '../main/graphics/render'
import { autoClipCandidates, makeAutoClip } from '../main/autoclips/pipeline'
import { runAutoClips } from '../main/autoclips/run'
import { parseRect } from '../shared/autoclips'
import { cleanBrand, runStory } from '../main/story/pipeline'
import { renderBackdrop, renderFootballFrame, renderStoryScene } from '../main/story/render'
import { contentProblem, normalizeScenes } from '../shared/story/plan'
import { STORY_SCHEMA } from '../shared/story/schema'
import { loadKnowledge, saveDataset } from '../main/story/knowledge'
import { datasetWarnings, daysBetween, findPlayerRows, resolveSceneData, teamFacts, usedDatasets } from '../shared/story/data'
import { TEAMS, findTeam } from '../shared/story/teams'
import { runTool } from '../main/ffmpeg'
import type { StoryPlan } from '../shared/story/types'
import { runAutoKick } from '../main/autokick/pipeline'
import { chapterTimestamp, chapterWarnings, formatChapters } from '../shared/chapters'
import { makeTopicClip, topicCandidates } from '../main/autokick/clips'
import { aspectSize, clipEnd, nearestAspect, timelineDuration } from '../shared/timeline/model'
import { clipsAt, timelineToSource } from '../shared/timeline/ops'
import { buildSegments } from '../shared/transcript/sentences'
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
  auto-clips <AutoKick klasörü|proje> [--min-sec 20] [--max-sec 90] [--max 12] [--pick 1,3 | --all | --export] [--face x,y,w,h] [--face-pos top|bottom] [--face-share 0.415]
                                         transkriptten klip adayları (zaman aralığı + ne konuşulmuş) ÖNERİR; --pick/--all ile 9:16 klip projesi üretir (yüz üstte, konuşulan görüntü altta)
  topic-clips <proje|AutoKick klasörü> --topic "Osimhen" [--max-sec 60] [--min-sec 8] [--gap 25] [--pick 1,3 | --all]
                                         Auto Kick transkriptinde konuyu arar, aday klipleri ÖNERİR; --pick/--all ile bağımsız klip projesi üretir
  auto-kick <video> [--out klasör] [--clips [--max 10] [--no-export]] [--quality fast|high] [--lang tr] [--model small] [--min-gap 0.7]
                                         yayın kaydı → transkript → sessizleri kırp → tam video (<out>/<ad> - full.mp4 + proje); biten aşamalar yeniden çalıştırmada atlanır
  story data list|show <id>|search <ad>|add <dosya.json>   bilgi paketi: kaynaklı veri (gol krallığı, puan durumu…); sıralama/takım kartı sahneleri bunu kullanır
  story teams [ad]                       takım forma/renk veritabanı (Bayern → kırmızı, Galatasaray → sarı-kırmızı parçalı…); sahnelerde home/away.team ve content.team bunu kullanır
  story schema                           sahne türleri + örnek plan (Claude Code planı yazarken kullanır)
  story preview <plan.json> [--out klasör] [--scene id] [--at 0.7] [--aspect 16:9]   sahneleri PNG kareye çizer (medya/ses gerekmez) — yazdığınız planı gözle doğrulayın
  story plan <ses|video> [--out klasör] [--ai | --blank] [--lang tr]   anlatımı içe aktarır, transkribe eder, hareketli SAHNE PLANI çıkarır (story-plan.json; düzenlenebilir)
  story build <ses|video> [--out klasör] [--plan dosya.json] [--allow-stale] [--face pip|none] [--aspect 16:9|9:16|1:1]   planı çizer: anlatım sesi + sahneler tek projede
  new <proje> [--name ad]                boş proje oluşturur
  import <proje> <dosya...> [--add] [--layer V3]   medya ekler (--add: ilk videoyu --layer'a (varsayılan V1), 0. sn'den, sesiyle yerleştirir)
  show <proje>                           katmanlar, klipler, altyazılar, süre
  transcribe <proje> [--asset a] [--lang tr] [--model small] [--track 0] [--force]
  transcript <proje> [--asset a] [--from sn --to sn]   cümleler (kaynak zamanı)
  search <proje> "söz" [--asset a] [--limit 10]        sonuçlar (zaman, cümle, skor)
  add-clip <proje> (--start sn --end sn | --query "söz" [--pick 1] [--sec 25]) [--asset a]
                                         zaman çizelgesinin sonuna klip ekler (cümle sınırlarına yapışır)
  new-clip-project <proje> --query "söz" [--pick 1] [--sec 25] --out yeni.clipforge [--asset a]
                                         ana projeyi DEĞİŞTİRMEDEN bağımsız klip projesi üretir
  script <proje>                         KURGU SONRASI zaman çizelgesindeki cümleler (çizelge zamanı) + geçen yerler (grafik/b-roll önerisi için)
  overlay <proje> --file dosya|--asset a --at sn [--dur 3.5] [--layer V2] [--src-in sn]   b-roll (video/foto) yerleştirir; konuşma sesi devam eder
  broll-plan <proje> --folder klasör [--asset a] [--dur 3.5] [--layer V2] [--apply]       dosya adlarındaki kelimeleri konuşmada arar, yerleşim ÖNERİR (--apply: uygular)
  graphic <proje> --type globe|map|title|chart [--to "Türkiye"] [--from "Londra"] [--label ..] [--sub ..] [--text ..] [--data "A:10,B:20"] [--at sn] [--dur 4] [--layer V1] [--accent #FFE600] [--no-place]
                                         hareketli 2D harita / 3D küre / başlık / grafik üretir ve çizelgeye koyar (--no-place: yalnızca üret, --out dosya.mp4)
  ideas <proje> [--asset a] [--max 8] [--ai] [--auto | --write oneriler.json | --clear]   transkriptten ayrı video olabilecek konu bölümlerini bulur (anahtar kelimeler, süre, taslak başlık); --ai: ayarlı yapay zekâyla başlık yazdırır
  chapters <proje> [--ai | --titles basliklar.json] [--density low|medium|high] [--out zaman-damgalari.txt]   düzenlenmiş çizelgenin YouTube zaman damgaları (bölümler + başlıklar)
  silence <proje> [--min-gap 0.7] [--keep 0.15] [--no-fillers]   sessizlik ve ııı/eee kesimi
  cut <proje> --from sn --to sn [--no-ripple]                      çizelge aralığını keser
  captions <proje> [--style classic|boxed-highlight|premium-gold] [--max-chars 22] [--lang en]   transkriptten altyazı üretir (--lang en: İngilizce çeviri, yapay zekâ ayarı gerekir) (boxed-highlight: referans stil)
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

/** Katmana tek bir dosya koyar (çakışma varsa hata: üstüne yazmaz, kaydırmaz) */
function placeOnLayer(s: Session, asset: MediaAsset, layerId: string, at: number, opts: { duration?: number; srcIn?: number } = {}): { start: number; end: number } {
  const track = s.timeline.tracks.find((t) => t.id === layerId)
  if (!track) throw new Error(`Katman yok: ${layerId}`)
  if (track.locked) throw new Error(`"${track.name}" kilitli.`)
  const r = clipForTrack(asset, track, { at, srcIn: opts.srcIn, duration: opts.duration ?? (asset.kind === 'image' ? 3 : undefined) })
  if ('error' in r) throw new Error(r.error)
  const start = r.clip.start
  const end = start + (r.clip.srcOut - r.clip.srcIn)
  if (track.clips.some((c) => c.start < end - 1e-6 && start < clipEnd(c) - 1e-6)) throw new Error(`"${track.name}" katmanında ${start.toFixed(1)}–${end.toFixed(1)} sn dolu; başka katman (--layer) ya da zaman seçin.`)
  s.apply(cmd.addClip(track.id, { ...r.clip, label: asset.name }))
  return { start, end }
}

/** Dosyayı projeye ekler (zaten ekliyse mevcut varlığı döndürür) */
async function ensureAsset(s: Session, file: string): Promise<MediaAsset> {
  const abs = resolve(file)
  const have = s.project.assets.find((x) => x.path === abs)
  if (have) return have
  const known = new Set(s.project.assets.map((x) => x.id))
  const ids = s.service.importMedia([abs])
  for (const id of ids) await waitTask(s.service, id, `İçe aktarma ${basename(abs)}`)
  const added = [...s.service.assets.values()].find((x) => !known.has(x.id) && x.path === abs)
  if (!added) throw new Error(`İçe aktarılamadı: ${abs}`)
  s.project = { ...s.project, assets: [...s.project.assets, added] }
  return added
}

const MEDIA_EXT = /\.(mp4|mov|mkv|webm|m4v|jpe?g|png|webp)$/i

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
  if (command === 'topic-clips') {
    if (!projectArg) throw new Error('Auto Kick projesini ya da klasörünü verin: topic-clips <proje|klasör> --topic "Osimhen"')
    const topic = str(a.opt.topic)
    if (!topic) throw new Error('--topic "konu" verin.')
    const opts = { ...(a.opt['max-sec'] ? { maxSec: num(a.opt['max-sec'], 'max-sec') } : {}), ...(a.opt['min-sec'] ? { minSec: num(a.opt['min-sec'], 'min-sec') } : {}), ...(a.opt.gap ? { mergeGapSec: num(a.opt.gap, 'gap') } : {}), ...(a.opt.limit ? { limit: num(a.opt.limit, 'limit') } : {}) }
    const cands = await topicCandidates(projectArg, topic, opts)
    const wanted = new Set(String(a.opt.pick ?? '').split(',').map((x) => Number(x.trim())))
    const picks = a.opt.all ? cands : a.opt.pick ? cands.filter((_, i) => wanted.has(i + 1)) : []
    if (a.opt.pick && picks.length === 0) throw new Error(`Seçilen aday yok (1–${cands.length}).`)
    const made = []
    for (const c of picks) made.push({ pick: cands.indexOf(c) + 1, ...(await makeTopicClip(projectArg, topic, c.start, c.end)) })
    return out({
      topic,
      candidates: cands.map((c, i) => ({ pick: i + 1, start: r1(c.start), end: r1(c.end), durationSec: r1(c.durationSec), hits: c.hits, score: c.score, mentions: c.mentions.map((m) => `${r1(m.t)}: ${m.text}`), text: c.text })),
      created: made,
      hint: made.length ? 'Klip projeleri Auto Kick projesine dokunmadan oluşturuldu.' : cands.length ? 'Bunlar ÖNERİDİR. Seçmek için --pick N (virgülle birden çok) ya da --all ekleyin.' : 'Bu konuda transkriptte geçiş bulunamadı (yazılışı değiştirip deneyin).'
    })
  }
  if (command === 'auto-clips') {
    if (!projectArg) throw new Error('Auto Kick klasörü ya da projesi verin: auto-clips <klasör|proje> [--pick 1,3 | --all]')
    // gözetimsiz tam zincir: --export → tüm adaylardan klip projesi + MP4 (Auto Kick sonrası otomatik çalışanla aynı iş)
    if (a.opt.export) {
      const rect0 = str(a.opt.face) ? parseRect(str(a.opt.face)!) : null
      if (str(a.opt.face) && !rect0) throw new Error('--face "x,y,w,h" (0..1) verin.')
      const res = await runAutoClips({ projectPath: projectArg, minSec: num(a.opt['min-sec'], 'min-sec'), maxSec: num(a.opt['max-sec'], 'max-sec'), max: num(a.opt.max, 'max'), face: rect0 ?? undefined, facePos: str(a.opt['face-pos']) === 'bottom' ? 'bottom' : 'top', faceShare: num(a.opt['face-share'], 'face-share'), exportVideos: true }, {}, { signal: new AbortController().signal, onStage: (id, p) => p.status && log(`[auto-clips:${id}] ${p.status}${p.detail ? ` — ${p.detail}` : ''}`) })
      return out({ ok: true, dir: res.dir, count: res.clips.length, clips: res.clips.map((x) => ({ subject: x.subject, headline: x.headline, start: r1(x.start), end: r1(x.end), project: x.projectPath, video: x.videoPath, error: x.error })) })
    }
    const r = await autoClipCandidates(projectArg, { minSec: num(a.opt['min-sec'], 'min-sec'), maxSec: num(a.opt['max-sec'], 'max-sec'), max: num(a.opt.max, 'max') }, {})
    const picksArg = str(a.opt.pick)
    const picks = a.opt.all ? r.candidates : picksArg ? picksArg.split(',').map((x) => r.candidates[Number(x) - 1]).filter(Boolean) : []
    if (a.opt.pick && picks.length === 0) throw new Error(`Seçilen aday yok (1–${r.candidates.length}).`)
    const rect = str(a.opt.face) ? parseRect(str(a.opt.face)!) : null
    if (str(a.opt.face) && !rect) throw new Error('--face "x,y,w,h" (0..1, ör. 0.7,0.64,0.29,0.34) verin.')
    const made = []
    for (const p of picks) made.push({ id: p.id, ...(await makeAutoClip(projectArg, p, { face: rect ?? undefined, facePos: str(a.opt['face-pos']) === 'bottom' ? 'bottom' : 'top', faceShare: num(a.opt['face-share'], 'face-share') }, {})) })
    return out({
      project: r.projectPath,
      totalSec: r1(r.totalSec),
      candidates: r.candidates.map((c, i) => ({ pick: i + 1, id: c.id, start: r1(c.start), end: r1(c.end), durationSec: r1(c.durationSec), subject: c.subject, headline: c.headline, summary: c.summary, score: c.score })),
      created: made,
      hint: made.length ? 'Klip projeleri (9:16: yüz üstte, konuşulan görüntü altta) Auto Kick projesine dokunmadan oluşturuldu.' : 'Bunlar ÖNERİDİR (zaman aralığı + ne konuşulduğu). Üretmek için --pick N (virgülle) ya da --all; yüz bölgesi için --face x,y,w,h (kaynak karede, 0..1).'
    })
  }
  if (command === 'auto-kick') {
    if (!projectArg) throw new Error('Yayın kaydı yolunu verin: auto-kick <video> [--out klasör]')
    const r = await runAutoKick(
      { videoPath: projectArg, outDir: str(a.opt.out), language: str(a.opt.lang), model: str(a.opt.model) as never, track: num(a.opt.track, 'track'), quality: a.opt.quality === 'high' ? 'high' : 'fast', silence: a.opt['min-gap'] || a.opt.keep || a.opt['no-fillers'] ? { minGapSec: num(a.opt['min-gap'], 'min-gap') ?? 0.7, keepSec: num(a.opt.keep, 'keep') ?? 0.15, cutFillers: !a.opt['no-fillers'] } : undefined },
      {},
      { signal: new AbortController().signal, onStage: (id, p) => p.status && log(`[${id}] ${p.status}${p.detail ? ` — ${p.detail}` : ''}`) }
    )
    // gözetimsiz zincir: --clips ile tam video çıktıktan sonra Auto Clips da çalışır (klip projeleri + MP4)
    if (a.opt.clips) {
      const clips = await runAutoClips({ projectPath: r.projectPath, max: num(a.opt.max, 'max') ?? 10, exportVideos: !a.opt['no-export'] }, {}, { signal: new AbortController().signal, onStage: (id, p) => p.status && log(`[auto-clips:${id}] ${p.status}${p.detail ? ` — ${p.detail}` : ''}`) })
      return out({ ok: true, ...r, clips: { dir: clips.dir, count: clips.clips.length, items: clips.clips.map((x) => ({ subject: x.subject, start: r1(x.start), end: r1(x.end), project: x.projectPath, video: x.videoPath, error: x.error })) } })
    }
    return out({ ok: true, ...r, note: 'Klipler için: auto-clips <klasör> ya da auto-kick ... --clips (bitince klipleri de üretir).' })
  }
  if (command === 'story') {
    const sub = projectArg
    const media = rest[0]
    if (sub === 'schema') return out(STORY_SCHEMA)
    if (sub === 'data') {
      const service = await makeService()
      const kn = await loadKnowledge(service.deps)
      const op = media
      const arg = rest[1]
      const today = new Date().toISOString().slice(0, 10)
      if (!op || op === 'list') return out({ ok: true, userDir: kn.userDir, today, datasets: kn.datasets.map((d) => ({ id: d.id, title: d.title, season: d.season, metric: d.metric, asOf: d.asOf, final: d.final, complete: d.complete, rows: d.rows.length, verified: d.verified, warnings: datasetWarnings(d, today) })), loadWarnings: kn.warnings, hint: 'Veri kümesi ekle/güncelle: `story data add dosya.json` (kaynak zorunlu). Eksik/bayat veriyi web\'den araştırıp ekleyin; doğrulanmayanı uydurmayın.' })
      if (op === 'show') {
        const d = kn.datasets.find((x) => x.id === arg)
        if (!d) throw new Error(`Veri kümesi yok: ${arg ?? '(id verin)'}. \`story data list\` ile bakın.`)
        return out({ ok: true, ...d, warnings: datasetWarnings(d, today) })
      }
      if (op === 'search') {
        if (!arg) throw new Error('Kullanım: story data search "Osimhen" (oyuncu/takım adı)')
        const rows = findPlayerRows(kn.datasets, arg).map(({ dataset, row }) => ({ dataset: dataset.id, season: dataset.season, metric: dataset.metric, asOf: dataset.asOf, rank: row.rank, name: row.name, team: row.team, value: row.value, status: row.status }))
        return out({ ok: true, query: arg, matches: rows, teamFacts: teamFacts(kn.datasets, arg), found: rows.length > 0, hint: rows.length ? undefined : 'Bilgi paketinde yok: web\'den araştırıp `story data add` ile ekleyin.' })
      }
      if (op === 'add') {
        if (!arg) throw new Error('Kullanım: story data add dosya.json (tek veri kümesi ya da dizi)')
        const raw = JSON.parse(await readFile(resolve(arg), 'utf8')) as unknown
        const saved = []
        for (const d of Array.isArray(raw) ? raw : [raw]) saved.push(await saveDataset(service.deps, d))
        return out({ ok: true, saved: saved.map((d) => d.id), userDir: kn.userDir })
      }
      throw new Error('Kullanım: story data list | show <id> | search <ad> | add <dosya.json>')
    }
    if (sub === 'teams') {
      const q = media
      const list = q ? TEAMS.filter((t) => findTeam(q)?.id === t.id || t.aliases.some((x) => x.toLowerCase().includes(q.toLowerCase()))) : TEAMS
      if (q && list.length === 0) return out({ ok: true, found: 0, hint: `"${q}" veritabanında yok. Formasını web'den doğrulayıp sahnede elle verin: home/away { "name", "color", "color2", "shorts", "socks", "pattern": "solid|halves|stripes" }.`, available: TEAMS.map((t) => t.name) })
      return out({ ok: true, teams: list.map((t) => ({ name: t.name, aliases: t.aliases.slice(1), home: t.home, alt: t.alt, note: t.note })), hint: 'Formalar SEZONLUKtur; veritabanı genel renkleri verir. Anlatılan sezon/forma farklıysa web\'den doğrulayıp home/away alanlarıyla ez (color, color2, shorts, socks, pattern, alt:true).' })
    }
    if (sub === 'preview') {
      if (!media) throw new Error('Kullanım: story preview <plan.json> [--out klasör]')
      const plan = JSON.parse(await readFile(resolve(media), 'utf8')) as StoryPlan
      plan.theme = { ...plan.theme, brand: cleanBrand(plan.theme.brand) }
      const service = await makeService()
      const world = await loadWorld(service.deps.resourcesDir).catch(() => undefined)
      const asp = str(a.opt.aspect)
      const aspect = asp === '9:16' || asp === '1:1' ? asp : '16:9'
      const size = { ...aspectSize(aspect), fps: 30 }
      const dir = resolve(str(a.opt.out) ?? join(dirname(resolve(media)), 'onizleme'))
      await mkdir(dir, { recursive: true })
      const only = str(a.opt.scene)
      const frames: { id: string; type: string; file: string; atSec: number }[] = []
      const bg = join(dir, `zemin-${size.width}x${size.height}.png`)
      await renderBackdrop(plan.theme, size, service.tools.ffmpeg, bg)
      const kn = await loadKnowledge(service.deps)
      const todayStr = new Date().toISOString().slice(0, 10)
      const scenesN = normalizeScenes(plan.scenes, plan.totalSec).filter((x) => !only || x.id === only)
      const freshness = usedDatasets(scenesN.map((x) => x.content), kn.datasets).map((d) => ({ dataset: d.id, asOf: d.asOf, final: d.final, ageDays: daysBetween(d.asOf, todayStr), ok: d.final || daysBetween(d.asOf, todayStr) <= 1 }))
      for (const sc of scenesN) {
        try {
          sc.content = resolveSceneData(sc.content, kn.datasets)
        } catch (e) {
          throw new Error(`Sahne ${sc.id} (${sc.content.type}): ${e instanceof Error ? e.message : String(e)}`)
        }
        const dur = Math.max(1, sc.end - sc.start)
        const problem = contentProblem(sc.content)
        if (problem) throw new Error(`Sahne ${sc.id} (${sc.content.type}): ${problem}`)
        const at = Math.min(dur - 0.05, Math.max(0, dur * (num(a.opt.at, 'at') ?? 0.7)))
        const png = join(dir, `${sc.id}.png`)
        if (sc.content.type === 'football') {
          await renderFootballFrame(sc.content, plan.theme, size, dur, at, service.tools.ffmpeg, png)
          frames.push({ id: sc.id, type: 'football', file: png, atSec: r1(at) })
          continue
        }
        const mp4 = join(dir, `${sc.id}.mp4`)
        await renderStoryScene(sc.content, plan.theme, size, dur, service.tools.ffmpeg, mp4, { world, backdrop: bg, baseDir: dirname(resolve(media)) })
        await runTool(service.tools.ffmpeg, ['-y', '-v', 'error', '-ss', at.toFixed(2), '-i', mp4, '-frames:v', '1', png])
        await rm(mp4, { force: true })
        frames.push({ id: sc.id, type: sc.content.type, file: png, atSec: r1(at) })
      }
      if (only && frames.length === 0) throw new Error(`Sahne bulunamadı: ${only}`)
      return out({ ok: true, frames, freshness, freshnessHint: freshness.some((f) => !f.ok) ? 'Bazı veriler GÜNCEL DEĞİL: `story build` bunlarla çizmez. Web\'den güncel değeri alıp `story data add` ile yenileyin.' : undefined, hint: 'PNG kareleri açıp bakın (sahne süresinin %70\'inde); yazı taşıyor, çakışıyor ya da kart geç beliriyorsa planı düzeltip yeniden çizin.' })
    }
    if ((sub !== 'plan' && sub !== 'build') || !media) throw new Error('Kullanım: story schema | story teams [ad] | story data list|show|search|add | story preview <plan.json> | story plan|build <ses|video> [--out klasör]')
    let plan: StoryPlan | undefined
    if (str(a.opt.plan)) plan = JSON.parse(await readFile(resolve(str(a.opt.plan)!), 'utf8')) as StoryPlan
    const asp = str(a.opt.aspect)
    const r = await runStory(
      { mediaPath: media, outDir: str(a.opt.out), action: sub, plan, useAi: !!a.opt.ai, blank: !!a.opt.blank, allowStale: !!a.opt['allow-stale'], face: a.opt.face === 'none' ? 'none' : 'pip', language: str(a.opt.lang), aspect: asp === '9:16' || asp === '1:1' ? asp : '16:9' },
      {},
      { signal: new AbortController().signal, onStage: (id, p) => p.status && log(`[${id}] ${p.status}${p.detail ? ` — ${p.detail}` : ''}`) }
    )
    return out({
      ok: true,
      project: r.projectPath,
      plan: r.planPath,
      planner: r.plan.planner,
      warnings: r.plan.warnings,
      scenes: r.plan.scenes.map((x) => ({ id: x.id, start: r1(x.start), end: r1(x.end), enabled: x.enabled, type: x.content.type, reason: x.reason, content: x.content })),
      rendered: r.rendered,
      hint: sub === 'plan' ? 'Bu bir ÖNERİ planıdır. story-plan.json içindeki sahneleri düzenleyin (ya da kendiniz yazın: transcript okuyup type/at alanlarıyla), sonra `story build` çalıştırın. Çağrı/yönlendirme metni yazmayın; yalnızca konuşulanlara dayanın.' : 'Proje uygulamada açılıp elle düzenlenebilir.'
    })
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
        const track = s.timeline.tracks.find((t) => t.id === (str(a.opt.layer) ?? 'V1'))
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
    case 'script': {
      const world = await loadWorld(s.service.deps.resourcesDir)
      const words = timelineWords(s.timeline, s.transcripts)
      if (words.length === 0) throw new Error('Zaman çizelgesindeki içeriğin transkripti yok.')
      const segs = buildSegments(words.map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence ?? 1 })))
      return out({ durationSec: r1(timelineDuration(s.timeline)), sentences: segs.map((g) => ({ start: r1(g.start), end: r1(g.end), text: g.text, places: placesInText(world, g.text).map((p) => p.name) })) })
    }
    case 'overlay': {
      const layer = str(a.opt.layer) ?? 'V2'
      const at = num(a.opt.at, 'at')
      if (at === undefined) throw new Error('--at <sn> verin.')
      const file = str(a.opt.file)
      const asset = file ? await ensureAsset(s, file) : s.asset(str(a.opt.asset))
      const r = placeOnLayer(s, asset, layer, at, { duration: num(a.opt.dur, 'dur'), srcIn: num(a.opt['src-in'], 'src-in') })
      await s.save()
      return out({ ok: true, layer, asset: asset.name, start: r1(r.start), end: r1(r.end), note: 'Konuşma sesi (Ses katmanı) aynen devam eder.' })
    }
    case 'broll-plan': {
      const folder = str(a.opt.folder)
      if (!folder) throw new Error('--folder <klasör> verin.')
      const main = s.asset(str(a.opt.asset))
      const files = (await readdir(resolve(folder))).filter((f) => MEDIA_EXT.test(f)).sort()
      const dur = num(a.opt.dur, 'dur') ?? 3.5
      const layer = str(a.opt.layer) ?? 'V2'
      const clipsOfMain = s.timeline.tracks.filter((t) => t.kind === 'video' || t.kind === 'audio').flatMap((t) => t.clips).filter((c) => c.assetId === main.id).sort((x, y) => x.start - y.start)
      const toTimeline = (src: number) => {
        const c = clipsOfMain.find((x) => src >= x.srcIn && src < x.srcOut)
        return c ? c.start + (src - c.srcIn) : null
      }
      const plan: { file: string; query: string; at: number | null; sentence?: string; score?: number; note?: string }[] = []
      for (const f of files) {
        const query = geoKey(basename(f, extname(f)).replace(/[_\-.]+/g, ' ').replace(/\d+/g, ' ')).trim()
        if (!query) { plan.push({ file: f, query, at: null, note: 'Dosya adından aranacak kelime çıkmadı' }); continue }
        const res = await pickResults(s, main, query, 5)
        const hit = res.find((r) => toTimeline(r.start) !== null && r.score >= 0.7)
        if (!hit) { plan.push({ file: f, query, at: null, note: 'Konuşmada eşleşme yok (kurguda kesilmiş olabilir)' }); continue }
        plan.push({ file: f, query, at: r1(Math.max(0, (toTimeline(hit.start) as number) - 0.3)), sentence: hit.sentence, score: r1(hit.score) })
      }
      const placed: string[] = []
      if (a.opt.apply) {
        for (const p of plan) {
          if (p.at === null) continue
          try {
            const asset = await ensureAsset(s, join(resolve(folder), p.file))
            placeOnLayer(s, asset, layer, p.at, { duration: asset.kind === 'image' ? dur : Math.min(dur, asset.durationSec) })
            placed.push(p.file)
          } catch (e) {
            p.note = e instanceof Error ? e.message : String(e)
          }
        }
        await s.save()
      }
      return out({ applied: !!a.opt.apply, layer, plan, placed, hint: a.opt.apply ? undefined : 'Bunlar ÖNERİDİR; onaylarsanız aynı komutu --apply ile çalıştırın ya da tek tek `overlay` kullanın.' })
    }
    case 'graphic': {
      const type = str(a.opt.type)
      if (!type || !['globe', 'map', 'title', 'chart'].includes(type)) throw new Error('--type globe|map|title|chart verin.')
      const world = await loadWorld(s.service.deps.resourcesDir)
      const size = aspectSize(s.timeline.aspect)
      const base = { ...DEFAULT_SCENE, ...size, durationSec: num(a.opt.dur, 'dur') ?? 4, accent: str(a.opt.accent) ?? DEFAULT_SCENE.accent }
      const place = (v: string | undefined, name: string) => {
        if (!v) return undefined
        const p = findPlace(world, v)
        if (!p) throw new Error(`${name} yeri bulunamadı: "${v}". Ülke/ana şehir adı ya da "boylam,enlem" verin (ör. 28.98,41.01).`)
        return p
      }
      let spec: SceneSpec
      if (type === 'globe' || type === 'map') {
        const to = place(str(a.opt.to), '--to')
        if (!to) throw new Error('--to "yer" verin.')
        spec = { ...base, type, to, from: place(str(a.opt.from), '--from'), label: str(a.opt.label), sub: str(a.opt.sub) }
      } else if (type === 'title') {
        const text = str(a.opt.text)
        if (!text) throw new Error('--text "başlık" verin.')
        spec = { ...base, type, text, sub: str(a.opt.sub) }
      } else {
        const data = (str(a.opt.data) ?? '').split(',').map((x) => x.split(':')).filter((x) => x.length === 2 && Number.isFinite(Number(x[1]))).map(([label, v]) => ({ label: label.trim(), value: Number(v) }))
        if (data.length === 0) throw new Error('--data "Ad:değer,Ad:değer" verin.')
        spec = { ...base, type: 'chart', title: str(a.opt.title) ?? str(a.opt.label), data }
      }
      const n = s.service.assets.size + s.project.assets.length
      const outFile = str(a.opt.out) ? resolve(str(a.opt.out)!) : join(dirname(s.path), `${basename(s.path, '.clipforge')}-data`, 'graphics', `${type}-${Date.now().toString(36)}${n}.mp4`)
      await renderScene(spec, world, s.service.tools.ffmpeg, outFile)
      if (a.opt['no-place']) return out({ ok: true, file: outFile, durationSec: spec.durationSec, size: `${spec.width}x${spec.height}` })
      const asset = await ensureAsset(s, outFile)
      const layer = str(a.opt.layer) ?? 'V1'
      const at = num(a.opt.at, 'at') ?? timelineDuration(s.timeline)
      const r = placeOnLayer(s, asset, layer, at)
      await s.save()
      return out({ ok: true, type, file: outFile, layer, start: r1(r.start), end: r1(r.end), note: 'Grafik kapalı kalan görüntünün üstüne biner; konuşma sesi devam eder.' })
    }
    case 'ideas': {
      const asset = s.asset(str(a.opt.asset))
      // Claude Code transkripti okuyup kendi önerilerini yazdıysa: --write oneriler.json = [{ "start": sn, "end": sn, "headline": "Lemina hakkında konuşmuşsun", "summary": "…", "title"?, "hook"? }] (kaynak zamanı)
      if (str(a.opt.write)) {
        const items = JSON.parse(await readFile(resolve(str(a.opt.write)!), 'utf8')) as Parameters<typeof s.service.ideasSave>[1]
        const n = await s.service.ideasSave(asset.id, items)
        return out({ ok: true, saved: n, hint: 'Öneriler kaydedildi: uygulamada sağ panel → Öneriler bunları gösterir ("Klip yap" düğmesiyle). Kuralla bulunanlara dönmek için `ideas --clear`.' })
      }
      if (a.opt.clear) {
        await s.service.ideasClear(asset.id)
        return out({ ok: true, cleared: true })
      }
      const r = await s.service.ideasGenerate({ assetId: asset.id, max: num(a.opt.max, 'max'), useAi: !!a.opt.ai, auto: !!a.opt.auto })
      return out({
        asset: asset.name,
        totalSec: r1(r.totalSec),
        source: r.source,
        ai: r.ai,
        ideas: r.ideas.map((i) => ({ id: i.id, headline: i.headline, kind: i.kind, mentions: i.mentions, start: r1(i.start), end: r1(i.end), durationSec: r1(i.durationSec), score: i.score, keywords: i.keywords, titles: i.titles, titleSource: i.titleSource, hook: i.hook, summary: i.summary })),
        hint: 'Bunlar ÖNERİDİR. Başlıkları yazarken önce `transcript --from <başlangıç> --to <bitiş>` ile bölümün metnini okuyun; yalnızca konuşulanlara dayanın, çağrı/yönlendirme metni yazmayın.'
      })
    }
    case 'chapters': {
      // Claude Code transkripti okuyup kendi başlıklarını yazdıysa: --titles dosya.json = [{ "start": sn ya da "00:12:42", "title": "…" }]
      if (str(a.opt.titles)) {
        const raw = JSON.parse(await readFile(resolve(str(a.opt.titles)!), 'utf8')) as { start: number | string; title: string }[]
        const toSec = (v: number | string) => (typeof v === 'number' ? v : v.split(':').reduce((n, x) => n * 60 + Number(x), 0))
        const total = timelineDuration(s.timeline)
        const list = raw.map((x) => ({ start: toSec(x.start), title: String(x.title ?? '').trim() })).filter((x) => Number.isFinite(x.start) && x.title).sort((p, q) => p.start - q.start)
        const chs = list.map((x, i) => ({ start: x.start, end: list[i + 1]?.start ?? total, title: x.title, keywords: [] as string[], titleSource: 'ai' as const }))
        const text = formatChapters(chs)
        const outFile2 = str(a.opt.out)
        if (outFile2) {
          await mkdir(dirname(resolve(outFile2)), { recursive: true })
          await writeFile(resolve(outFile2), text + '\n', 'utf8')
        }
        return out({ ok: true, text, warnings: chapterWarnings(chs), written: outFile2 ? resolve(outFile2) : undefined, hint: 'Başlıklar sizin yazdığınız gibi biçimlendi; zamanlar çizelge zamanıdır.' })
      }
      const r = await s.service.chaptersGenerate({ timeline: s.timeline, useAi: !!a.opt.ai, density: (['low', 'medium', 'high'] as const).find((d) => d === str(a.opt.density)) })
      const outFile = str(a.opt.out)
      if (outFile) {
        await mkdir(dirname(resolve(outFile)), { recursive: true })
        await writeFile(resolve(outFile), r.text + '\n', 'utf8')
      }
      return out({ totalSec: r1(r.totalSec), chapters: r.chapters.map((c) => ({ time: chapterTimestamp(c.start), startSec: r1(c.start), durationSec: r1(c.end - c.start), title: c.title, keywords: c.keywords, titleSource: c.titleSource })), text: r.text, warnings: r.warnings, ai: r.ai, written: outFile ? resolve(outFile) : undefined, hint: 'Zamanlar projenin (düzenlenmiş) zaman çizelgesine göredir: dışa aktarılan videoyla aynıdır. Başlıkları kullanıcıya sun; istenirse düzelt.' })
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
      const lang = str(a.opt.lang)
      if (lang && lang !== 'orig') {
        const tr = await s.service.translateTexts({ texts: s.timeline.captions.map((c) => c.text), to: lang })
        s.apply(cmd.captionTranslations(lang, Object.fromEntries(s.timeline.captions.map((c, i) => [c.id, tr.texts[i]]))))
      }
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
