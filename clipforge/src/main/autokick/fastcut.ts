import { limitThreads, runTool } from '../ffmpeg'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import type { MediaAsset } from '../../shared/types'

/**
 * Tek kaynaklı, çok sayıda kesim içeren uzun kayıtlar (2 saatlik yayın, yüzlerce kesim) için ölçeklenir dışa aktarma:
 * dosya YALNIZCA BİR KEZ açılır; tutulan aralıklar `select`/`aselect` ile seçilir. (Genel dışa aktarıcı her klip için ayrı
 * giriş ve `amix` girişi açar; binlerce klipte çalışmaz.) Kesim sınırları kare ızgarasına oturtulduğundan görüntü ve ses
 * aynı uzunlukta kalır → kayma olmaz.
 */

export type Range = [number, number]

/** Bitişik/örtüşen aralıkları birleştirir; sıralar */
export function mergeRanges(ranges: Range[], tol = 1e-4): Range[] {
  const out: Range[] = []
  for (const r of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + tol) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/** Zamanı kare ızgarasına yuvarlar */
export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps

/** select ifadesi: aralıklardan birinde mi (yarım-kare payıyla kayan nokta hatalarına karşı) */
export function selectExpr(ranges: Range[], fps: number): string {
  const eps = 0.25 / fps
  return ranges.map(([a, b]) => `gte(t,${(a - eps).toFixed(4)})*lt(t,${(b - eps).toFixed(4)})`).join('+')
}

/** Kare hızını tam kesir olarak verir (59.94 → 60000/1001); setpts ve -r aynı değeri kullanır */
export function fpsRational(fps: number): [number, number] {
  for (const [v, num, den] of [[23.976, 24000, 1001], [29.97, 30000, 1001], [59.94, 60000, 1001]] as const) if (Math.abs(fps - v) < 0.01) return [num, den]
  return [Math.round(fps * 1000) % 1000 === 0 ? Math.round(fps) : Math.round(fps * 1000), Math.round(fps * 1000) % 1000 === 0 ? 1 : 1000]
}

/**
 * Ses çerçeve boyutu (örnek): bir kare süresi (48000/fps örnek) bu boyuta tam bölünüyorsa her aralığın ses uzunluğu
 * TAM çıkar (aselect çerçeve sınırında keser). 60 fps → 160, 24 fps → 80; kesirli kare hızlarında en küçük boyut.
 */
export function audioFrameSamples(fps: number): number {
  const m = 48000 / fps
  if (Number.isInteger(Math.round(m * 1e6) / 1e6)) for (const n of [160, 80, 40, 20, 10]) if (m % n === 0) return n
  return 40
}

export interface FastCutOptions {
  crf: number
  encoderPreset: string
  maxrateKbps: number
  audioKbps: number
}

export function planFastCut(asset: Pick<MediaAsset, 'path' | 'fps' | 'audioStreams' | 'audioMap'>, ranges: Range[], o: FastCutOptions, outputPath: string): { args: string[]; filters: string; durationSec: number } {
  const fps = asset.fps > 0 ? asset.fps : 30
  const [fn, fd] = fpsRational(fps)
  const frameSamples = audioFrameSamples(fps)
  const kept = mergeRanges(ranges)
  const expr = selectExpr(kept, fps)
  const a = Math.min(asset.audioMap.mix ?? 0, asset.audioStreams.length - 1)
  const filters = [
    // kare hızı açıkça verilir (FRAME_RATE seçimden sonra bilinmez → 25 fps'e düşüp kareleri atardı)
    `[0:v:0]select='${expr}',setpts=N/((${fn}/${fd})*TB),fps=${fn}/${fd}[v]`,
    // ses çerçevesi, kare süresine tam bölünür: her kesimde ses tam kare kadar uzunlukta kalır (kayma olmaz)
    `[0:a:${a}]aformat=sample_rates=48000:channel_layouts=stereo,asetnsamples=n=${frameSamples}:p=0,aselect='${expr}',asetpts=N/SR/TB[a]`
  ].join(';\n')
  const duration = kept.reduce((n, [s, e]) => n + (e - s), 0)
  const src = asset.path.startsWith('-') ? `./${asset.path}` : asset.path
  const cap = Math.max(1000, o.maxrateKbps)
  const args = [
    '-hide_banner', '-nostats', '-progress', 'pipe:1', '-y',
    '-i', src,
    '-filter_complex_script', 'filters.txt',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', o.encoderPreset, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', String(o.crf), '-maxrate', `${cap}k`, '-bufsize', `${cap * 2}k`,
    '-c:a', 'aac', '-b:a', `${o.audioKbps}k`, '-ar', '48000',
    '-r', `${fn}/${fd}`,
    '-movflags', '+faststart',
    outputPath
  ]
  return { args, filters, durationSec: duration }
}

export async function renderFastCut(asset: MediaAsset, ranges: Range[], o: FastCutOptions, ffmpeg: string, outputPath: string, opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {}): Promise<number> {
  const plan = planFastCut(asset, ranges, o, outputPath)
  const dir = await mkdtemp(join(tmpdir(), 'cf-fastcut-'))
  try {
    await writeFile(join(dir, 'filters.txt'), plan.filters, 'utf8')
    await mkdir(dirname(outputPath), { recursive: true })
    await runTool(ffmpeg, limitThreads(plan.args), { cwd: dir, signal: opts.signal, durationSec: plan.durationSec, onProgress: opts.onProgress })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return plan.durationSec
}
