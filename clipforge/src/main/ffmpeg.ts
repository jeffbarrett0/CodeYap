import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { FfprobeJson } from '../shared/media/probe'
import { CancelledError } from './tasks'

export class ToolError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail = ''
  ) {
    super(userMessage)
    this.name = 'ToolError'
  }
}

/** FFmpeg/ffprobe stderr çıktısını kullanıcıya anlaşılır Türkçe mesaja çevirir. */
export function friendlyFfmpegMessage(stderr: string): string {
  const s = stderr
  const rules: [RegExp, string][] = [
    [/moov atom not found|Invalid data found when processing input|End of file/i, 'Dosya bozuk ya da eksik görünüyor (kayıt düzgün kapatılmamış olabilir). OBS\'te MKV olarak kaydedip Dosya → Kayıtları Remux Et ile MP4\'e çevirmeyi deneyin.'],
    [/No such file or directory|does not exist|Error opening input/i, 'Dosya bulunamadı ya da açılamıyor. Dosyanın taşınmadığından/silinmediğinden emin olun.'],
    [/Permission denied|Operation not permitted/i, 'Dosyaya erişim izni yok. Başka bir program kullanıyor olabilir ya da klasör izinlerini kontrol edin.'],
    [/No space left on device|ENOSPC/i, 'Diskte yeterli boş alan yok. Yer açıp tekrar deneyin.'],
    [/Decoder \(codec [^)]+\) not found|Unsupported codec|codec not currently supported|Unknown decoder/i, 'Bu kayıttaki video/ses codec\'i için çözücü bulunamadı. Daha kapsamlı bir FFmpeg derlemesi kullanın (Ayarlar → FFmpeg yolu).'],
    [/Unknown encoder|Encoder .* not found/i, 'Gerekli kodlayıcı (libx264/aac) bu FFmpeg derlemesinde yok. Ayarlar\'dan tam bir FFmpeg derlemesi seçin.'],
    [/Cannot allocate memory|Out of memory|std::bad_alloc/i, 'Bellek yetersiz. Başka programları kapatın ya da daha düşük çözünürlük/bitrate seçin.'],
    [/Stream map '.*' matches no streams|matches no streams/i, 'İstenen ses/görüntü akışı dosyada yok (ses track\'i seçimini kontrol edin).'],
    [/Invalid argument/i, 'FFmpeg geçersiz bir parametre aldı (zaman çizelgesi ayarlarını kontrol edin).'],
    [/Error (?:initializing|while) filter|Error reinitializing filters|Filter .* not (?:found|present)|No such filter/i, 'FFmpeg filtre grafiği kurulamadı. Altyazı için libass içeren bir FFmpeg gerekir; tam derleme kullanmayı deneyin.']
  ]
  for (const [re, msg] of rules) if (re.test(s)) return msg
  const last = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(frame|size|time|bitrate|speed|progress|out_time|total_size|fps|stream_|dup_frames|drop_frames)=/.test(l))
    .slice(-2)
    .join(' · ')
  return `FFmpeg hatası${last ? `: ${last.slice(0, 300)}` : ''}`
}

function bundled(pkg: string, pick: (m: unknown) => string | undefined): string | undefined {
  try {
    const req = createRequire(__filename)
    const p = pick(req(pkg))
    return p ? p.replace('app.asar' + (process.platform === 'win32' ? '\\' : '/'), 'app.asar.unpacked' + (process.platform === 'win32' ? '\\' : '/')) : undefined
  } catch {
    return undefined
  }
}

/** Öncelik: ayar → ortam değişkeni → pakete gömülü ikili → sistem PATH */
export function resolveFfmpegPath(setting = ''): string {
  return setting || process.env.CLIPFORGE_FFMPEG || bundled('ffmpeg-static', (m) => m as string) || 'ffmpeg'
}
export function resolveFfprobePath(setting = ''): string {
  return setting || process.env.CLIPFORGE_FFPROBE || bundled('ffprobe-static', (m) => (m as { path: string }).path) || 'ffprobe'
}

export interface RunOptions {
  cwd?: string
  signal?: AbortSignal
  /** Verilirse `-progress pipe:1` çıktısından ilerleme (0..1) hesaplanır */
  durationSec?: number
  onProgress?: (fraction: number) => void
  /** stdout'u belleğe topla (ffprobe vb.) */
  collectStdout?: boolean
  onStdout?: (chunk: Buffer) => void
  onStderrLine?: (line: string) => void
}

export interface RunResult {
  stdout: string
  stderr: string
}

/** Bir alt süreci iptal edilebilir biçimde çalıştırır; hata durumunda ToolError fırlatır. */
export function runTool(bin: string, args: string[], opts: RunOptions = {}, friendly = friendlyFfmpegMessage): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError())
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let carry = ''
    let errCarry = ''
    let settled = false

    const onAbort = () => {
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d: Buffer) => {
      opts.onStdout?.(d)
      if (opts.collectStdout) stdout += d.toString('utf8')
      if (opts.durationSec && opts.onProgress) {
        carry += d.toString('utf8')
        const lines = carry.split(/\r?\n/)
        carry = lines.pop() ?? ''
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
          if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.durationSec))
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stderr = (stderr + text).slice(-20000)
      if (opts.onStderrLine) {
        errCarry += text
        const lines = errCarry.split(/\r?\n/)
        errCarry = lines.pop() ?? ''
        lines.forEach(opts.onStderrLine)
      }
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      opts.signal?.removeEventListener('abort', onAbort)
      reject(
        e.code === 'ENOENT'
          ? new ToolError(`Çalıştırılabilir dosya bulunamadı: "${bin}". Ayarlar'dan yolunu belirtin ya da programı kurun.`, e.message)
          : new ToolError(`Program başlatılamadı: ${e.message}`, e.message)
      )
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) return reject(new CancelledError())
      if (code === 0) return resolve({ stdout, stderr })
      reject(new ToolError(friendly(stderr || `çıkış kodu ${code ?? signal}`), stderr.slice(-4000)))
    })
  })
}

export const runFfmpeg = (ffmpeg: string, args: string[], opts: RunOptions = {}) =>
  runTool(ffmpeg, ['-hide_banner', '-nostdin', ...args], opts)

export async function ffprobeJson(ffprobe: string, file: string, signal?: AbortSignal): Promise<FfprobeJson> {
  const { stdout } = await runTool(
    ffprobe,
    ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file],
    { collectStdout: true, signal }
  )
  try {
    return JSON.parse(stdout) as FfprobeJson
  } catch {
    throw new ToolError('Dosya çözümlenemedi: ffprobe geçerli bir çıktı vermedi.', stdout.slice(0, 500))
  }
}

export async function toolVersion(bin: string): Promise<string> {
  const { stdout } = await runTool(bin, ['-version'], { collectStdout: true })
  return stdout.split(/\r?\n/)[0] ?? ''
}
