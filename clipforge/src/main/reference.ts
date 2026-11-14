import { mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { newId } from '../shared/timeline/model'
import { findSplitLineFrames, type ReferenceEntry } from '../shared/reference'
import { ffprobeJson, runFfmpeg } from './ffmpeg'
import { detectScenes } from './media/audio'
import type { MediaTools } from './media/import'

const dirOf = (userDataDir: string) => join(userDataDir, 'references')
const indexFile = (userDataDir: string) => join(dirOf(userDataDir), 'index.json')

export async function listReferences(userDataDir: string): Promise<ReferenceEntry[]> {
  try {
    const list = JSON.parse(await readFile(indexFile(userDataDir), 'utf8')) as ReferenceEntry[]
    return Array.isArray(list) ? list.sort((a, b) => b.addedAt - a.addedAt) : []
  } catch {
    return []
  }
}

async function saveAll(userDataDir: string, list: ReferenceEntry[]) {
  await mkdir(dirOf(userDataDir), { recursive: true })
  await writeFile(indexFile(userDataDir), JSON.stringify(list, null, 1), 'utf8')
}

/** Kare başına satır farkları: küçük gri kareler örnekler, komşu satırların ortalama mutlak farkını verir */
async function rowDiffs(tools: MediaTools, file: string, durationSec: number, w: number, h: number, tmp: string): Promise<number[][]> {
  const cols = 90
  const rows = Math.max(40, Math.min(240, Math.round((cols * h) / w / 2) * 2))
  const n = 24
  const fps = Math.max(0.05, n / Math.max(1, durationSec))
  await runFfmpeg(tools.ffmpeg, ['-y', '-v', 'error', '-i', file, '-an', '-vf', `fps=${fps.toFixed(4)},scale=${cols}:${rows}:flags=area,format=gray`, '-frames:v', String(n), '-f', 'rawvideo', tmp])
  const buf = await readFile(tmp)
  const frame = cols * rows
  const frames = Math.floor(buf.length / frame)
  if (frames === 0) return []
  const perFrame: number[][] = []
  for (let f = 0; f < frames; f++) {
    const d = new Array<number>(rows - 1).fill(0)
    for (let r = 0; r < rows - 1; r++) {
      let s = 0
      for (let c = 0; c < cols; c++) s += Math.abs(buf[f * frame + r * cols + c] - buf[f * frame + (r + 1) * cols + c])
      d[r] = s / cols
    }
    perFrame.push(d)
  }
  return perFrame
}

/** Videoyu referans olarak ekler: ölçümler (süre, boyut, plan değişimi, bölme çizgisi) + kare tabloları (Claude Code bunlara bakar) */
export async function addReference(userDataDir: string, tools: MediaTools, file: string, opts: { signal?: AbortSignal } = {}): Promise<ReferenceEntry> {
  if (!existsSync(file)) throw new Error('Dosya bulunamadı.')
  if ((await stat(file)).isDirectory()) throw new Error('Bir video dosyası seçin.')
  const probe = (await ffprobeJson(tools.ffprobe, file, opts.signal)) as { streams?: any[]; format?: { duration?: string } }
  const v = (probe.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video')
  if (!v) throw new Error('Bu dosyada görüntü yok; bir video seçin.')
  const durationSec = Number(probe.format?.duration) || Number(v.duration) || 0
  if (durationSec <= 0) throw new Error('Video süresi okunamadı.')
  const [num, den] = String(v.r_frame_rate ?? '30/1').split('/').map(Number)
  const id = newId()
  const dir = join(dirOf(userDataDir), id)
  await mkdir(dir, { recursive: true })
  try {
    const cuts = await detectScenes(file, durationSec, tools, { threshold: 0.3, signal: opts.signal })
    // kare tabloları: her tabloda 30 kare (6×5); uzun videolarda en çok 3 tablo
    const perSheet = 30
    const sheetCount = Math.min(3, Math.max(1, Math.ceil(durationSec / 90)))
    const per = durationSec / (sheetCount * perSheet)
    const sheets: string[] = []
    for (let i = 0; i < sheetCount; i++) {
      const out = `sheet_${i + 1}.jpg`
      const start = i * perSheet * per
      await runFfmpeg(tools.ffmpeg, ['-y', '-v', 'error', '-ss', start.toFixed(2), '-t', (perSheet * per).toFixed(2), '-i', file, '-an', '-vf', `fps=${(1 / per).toFixed(5)},scale=240:-2,tile=6x5:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', join(dir, out)], { signal: opts.signal })
      if (existsSync(join(dir, out))) sheets.push(out)
    }
    let splitLine: number | null = null
    try {
      splitLine = findSplitLineFrames(await rowDiffs(tools, file, durationSec, v.width, v.height, join(dir, 'rows.raw')))
    } catch {
      /* bölme çizgisi ölçülemedi: önemli değil */
    } finally {
      await rm(join(dir, 'rows.raw'), { force: true })
    }
    const entry: ReferenceEntry = {
      id,
      name: basename(file, extname(file)).slice(0, 80),
      path: file,
      addedAt: Date.now(),
      durationSec: Math.round(durationSec * 10) / 10,
      width: v.width,
      height: v.height,
      fps: den ? Math.round((num / den) * 100) / 100 : 30,
      hasAudio: (probe.streams ?? []).some((s: { codec_type: string }) => s.codec_type === 'audio'),
      cuts: cuts.map((c) => Math.round(c * 10) / 10),
      avgShotSec: Math.round((durationSec / (cuts.length + 1)) * 10) / 10,
      splitLine,
      sheets,
      notes: '',
      status: 'analyzed'
    }
    await saveAll(userDataDir, [entry, ...(await listReferences(userDataDir))])
    return entry
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    throw e
  }
}

export async function removeReference(userDataDir: string, id: string): Promise<void> {
  await saveAll(userDataDir, (await listReferences(userDataDir)).filter((r) => r.id !== id))
  await rm(join(dirOf(userDataDir), id), { recursive: true, force: true })
}

export async function updateReference(userDataDir: string, id: string, patch: Partial<Pick<ReferenceEntry, 'notes' | 'status' | 'name'>>): Promise<ReferenceEntry> {
  const list = await listReferences(userDataDir)
  const i = list.findIndex((r) => r.id === id)
  if (i < 0) throw new Error('Referans bulunamadı.')
  list[i] = { ...list[i], ...patch }
  await saveAll(userDataDir, list)
  return list[i]
}

export const referenceDir = (userDataDir: string, id: string) => join(dirOf(userDataDir), id)

/** Kare tablolarını tarayıcıda göstermek için data URL olarak okur */
export async function referenceSheets(userDataDir: string, id: string): Promise<string[]> {
  const dir = referenceDir(userDataDir, id)
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^sheet_\d+\.jpg$/.test(f)).sort()
  return Promise.all(files.map(async (f) => `data:image/jpeg;base64,${(await readFile(join(dir, f))).toString('base64')}`))
}
