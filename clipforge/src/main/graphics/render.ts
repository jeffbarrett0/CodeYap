import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildChart, buildGlobe, buildMap, buildTitle, type SceneSpec } from '../../shared/graphics/scenes'
import type { World } from '../../shared/graphics/geo'
import { runTool } from '../ffmpeg'

export async function loadWorld(resourcesDir: string): Promise<World> {
  return JSON.parse(await readFile(join(resourcesDir, 'world.json'), 'utf8')) as World
}

export function sceneAss(spec: SceneSpec, world: World): string {
  switch (spec.type) {
    case 'globe':
      return buildGlobe(spec, world)
    case 'map':
      return buildMap(spec, world)
    case 'title':
      return buildTitle(spec)
    case 'chart':
      return buildChart(spec)
  }
}

/** Sahneyi tam kare, sesiz, H.264 MP4 olarak üretir (kütüphaneye normal video gibi eklenir). */
export async function renderScene(spec: SceneSpec, world: World, ffmpeg: string, outPath: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cf-gfx-'))
  try {
    await writeFile(join(dir, 'scene.ass'), sceneAss(spec, world), 'utf8')
    await mkdir(dirname(outPath), { recursive: true })
    const bg = spec.bg.replace('#', '0x')
    await runTool(
      ffmpeg,
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${bg}:s=${spec.width}x${spec.height}:r=${spec.fps}:d=${spec.durationSec}`, '-vf', 'ass=scene.ass', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(spec.fps), '-an', '-movflags', '+faststart', outPath],
      { cwd: dir, signal: opts.signal }
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
