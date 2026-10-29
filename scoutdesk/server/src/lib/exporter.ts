import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { EXPORT_DIR, VIDEO_DIR } from '../config.js'
import { prisma } from '../db.js'

const run = promisify(execFile)

const FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf',
]
const font = () => FONTS.find((p) => fs.existsSync(p))
/** Escape a file path for an ffmpeg filter option (Windows drive colons and backslashes). */
const ffPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:')

export interface ExportOptions {
  /** Burn the clip title into the first seconds of each segment. */
  titles: boolean
}

interface Segment {
  input: string
  start: number
  duration: number
  title: string
  fadeIn: boolean
  fadeOut: boolean
}

/** Escape text for use inside a single-quoted drawtext value. */
const dt = (s: string) => s.replace(/[\\':%]/g, ' ').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '').trim().slice(0, 80)

async function hasAudio(file: string): Promise<boolean> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Encode one segment to a normalised 1280×720 / 25 fps / H.264+AAC file so segments can be concatenated losslessly. */
function encodeSegment(seg: Segment, audio: boolean, out: string, titles: boolean, onProgress: (sec: number) => void): Promise<void> {
  const vf = [
    'scale=1280:720:force_original_aspect_ratio=decrease', 'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black', 'setsar=1', 'fps=25', 'format=yuv420p',
  ]
  const f = font()
  if (titles && f && dt(seg.title)) {
    vf.push(`drawtext=fontfile='${ffPath(f)}':text='${dt(seg.title)}':fontcolor=white:fontsize=34:box=1:boxcolor=black@0.55:boxborderw=10:x=40:y=h-th-50:enable='lt(t,3.5)'`)
  }
  const fd = Math.min(0.5, seg.duration / 3)
  if (seg.fadeIn) vf.push(`fade=t=in:st=0:d=${fd}`)
  if (seg.fadeOut) vf.push(`fade=t=out:st=${Math.max(0, seg.duration - fd).toFixed(3)}:d=${fd}`)
  const af: string[] = []
  if (seg.fadeIn) af.push(`afade=t=in:st=0:d=${fd}`)
  if (seg.fadeOut) af.push(`afade=t=out:st=${Math.max(0, seg.duration - fd).toFixed(3)}:d=${fd}`)

  const args = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-ss', seg.start.toFixed(3), '-i', seg.input]
  if (!audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  args.push('-t', seg.duration.toFixed(3), '-vf', vf.join(','), '-map', '0:v:0', '-map', audio ? '0:a:0' : '1:a:0')
  if (af.length) args.push('-af', af.join(','))
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out)

  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stdout.on('data', (d: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(d.toString())
      if (m) onProgress(Number(m[1]) / 1e6)
    })
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `ffmpeg exited with ${code}`))))
  })
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'export'

async function segmentsFor(job: { kind: string; refId: string }): Promise<{ segs: Segment[]; name: string }> {
  const clipTitle = async (clip: { tagType: { name: string }; player: { name: string } | null; timeSec: number }) =>
    `${clip.tagType.name}${clip.player ? ` - ${clip.player.name}` : ''}`
  const toSeg = async (c: Awaited<ReturnType<typeof loadClip>>, title?: string | null): Promise<Segment> => {
    if (!c.video) throw new Error(`Clip ${c.id} has no video attached`)
    const input = path.join(VIDEO_DIR, path.basename(c.video.filePath))
    if (!fs.existsSync(input)) throw new Error(`Video file for clip ${c.id} is missing`)
    return { input, start: c.startSec, duration: Math.max(0.5, c.endSec - c.startSec), title: title || (await clipTitle(c)), fadeIn: false, fadeOut: false }
  }
  if (job.kind === 'clip') {
    const c = await loadClip(job.refId)
    return { segs: [await toSeg(c)], name: `${await clipTitle(c)}` }
  }
  const pl = await prisma.playlist.findUnique({ where: { id: job.refId }, include: { items: { orderBy: { position: 'asc' } } } })
  if (!pl) throw new Error('Playlist not found')
  if (pl.items.length === 0) throw new Error('Playlist is empty')
  const segs: Segment[] = []
  for (const it of pl.items) segs.push(await toSeg(await loadClip(it.clipId), it.title))
  // A "fade" transition into item i fades item i-1 out and item i in (dip through black).
  pl.items.forEach((it, i) => {
    if (i > 0 && it.transition === 'fade') {
      segs[i]!.fadeIn = true
      segs[i - 1]!.fadeOut = true
    }
  })
  return { segs, name: pl.title }
}

const loadClip = (id: string) =>
  prisma.clip.findUniqueOrThrow({ where: { id }, include: { video: true, tagType: true, player: true } })

async function runJob(id: string) {
  const job = await prisma.exportJob.findUnique({ where: { id } })
  if (!job || job.status !== 'queued') return
  await prisma.exportJob.update({ where: { id }, data: { status: 'running', progress: 0, error: null } })
  const tmp = path.join(EXPORT_DIR, `tmp-${id}`)
  try {
    const opts = job.options as unknown as ExportOptions
    const { segs, name } = await segmentsFor(job)
    fs.mkdirSync(tmp, { recursive: true })
    const total = segs.reduce((a, s) => a + s.duration, 0)
    let done = 0
    let lastWrite = 0
    const report = (sec: number) => {
      const now = Date.now()
      if (now - lastWrite < 400) return
      lastWrite = now
      void prisma.exportJob.update({ where: { id }, data: { progress: Math.min(0.99, (done + sec) / total) } }).catch(() => {})
    }
    const parts: string[] = []
    for (const [i, seg] of segs.entries()) {
      const out = path.join(tmp, `seg-${String(i).padStart(4, '0')}.mp4`)
      await encodeSegment(seg, await hasAudio(seg.input), out, opts.titles, report)
      done += seg.duration
      parts.push(out)
    }
    const final = path.join(EXPORT_DIR, `${id}.mp4`)
    if (parts.length === 1) fs.copyFileSync(parts[0]!, final)
    else {
      const list = path.join(tmp, 'list.txt')
      fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final])
    }
    await prisma.exportJob.update({
      where: { id },
      data: { status: 'done', progress: 1, filePath: `exports/${id}.mp4`, fileName: `${safeName(name)}.mp4`, sizeBytes: BigInt(fs.statSync(final).size), finishedAt: new Date() },
    })
  } catch (e) {
    await prisma.exportJob.update({ where: { id }, data: { status: 'failed', error: (e instanceof Error ? e.message : 'Export failed').slice(0, 500), finishedAt: new Date() } })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ── Queue (in-process, DB-backed so state survives restarts) ─────────────────

let working = false
let again = false

/** Process queued jobs one at a time. Safe to call repeatedly. */
export async function pumpExports(): Promise<void> {
  if (working) {
    again = true
    return
  }
  working = true
  try {
    do {
      again = false
      for (;;) {
        const next = await prisma.exportJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } })
        if (!next) break
        await runJob(next.id)
      }
    } while (again)
  } finally {
    working = false
  }
}

/** On boot: anything left "running" was interrupted — put it back in the queue. */
export async function resumeExports() {
  await prisma.exportJob.updateMany({ where: { status: 'running' }, data: { status: 'queued', progress: 0 } })
  void pumpExports()
}
