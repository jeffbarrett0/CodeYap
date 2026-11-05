import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { findIntro, INTRO_H, INTRO_W, type IntroDetection } from '../../shared/intro'
import { runTool } from '../ffmpeg'

/** Referans görüntü (png/jpg) → INTRO_W×INTRO_H gri kare */
async function readGray(ffmpeg: string, args: string[]): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  await runTool(ffmpeg, ['-v', 'error', ...args, '-an', '-sn', '-pix_fmt', 'gray', '-s', `${INTRO_W}x${INTRO_H}`, '-f', 'rawvideo', 'pipe:1'], { onStdout: (c) => chunks.push(c) })
  return new Uint8Array(Buffer.concat(chunks))
}

/** Kullanılacak referans: ayardaki yol, yoksa uygulamayla gelen varsayılan; hiçbiri yoksa null */
export async function introReference(settingPath: string | undefined, resourcesDir: string): Promise<string | null> {
  for (const p of [settingPath?.trim(), join(resourcesDir, 'intro', 'yayin-basliyor.png')]) {
    if (!p) continue
    try {
      await access(p)
      return p
    } catch {
      /* sıradaki */
    }
  }
  return null
}

/**
 * Videonun ilk (durationSec + 60) saniyesini saniyede bir örnekleyip referansla karşılaştırır. Hata olursa asla kesmez
 * (found:false, nedeni yazılı): yayın başı tespiti işi durdurmamalı.
 */
export async function detectIntro(ffmpeg: string, videoPath: string, refPath: string, durationSec = 164): Promise<IntroDetection> {
  try {
    const ref = await readGray(ffmpeg, ['-i', refPath, '-frames:v', '1'])
    if (ref.length !== INTRO_W * INTRO_H) throw new Error('Referans görüntü okunamadı.')
    const window = Math.ceil(durationSec + 60)
    const all = await readGray(ffmpeg, ['-t', String(window), '-i', videoPath, '-vf', 'fps=1'])
    const size = INTRO_W * INTRO_H
    const frames: Uint8Array[] = []
    for (let o = 0; o + size <= all.length; o += size) frames.push(all.subarray(o, o + size))
    return findIntro(frames, ref, { durationSec })
  } catch (e) {
    return { found: false, endSec: 0, matched: 0, reason: `Yayın başı tespiti yapılamadı (${e instanceof Error ? e.message : String(e)}): kesilmedi.` }
  }
}
