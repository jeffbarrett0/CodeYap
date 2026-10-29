import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveFfmpegPath, resolveFfprobePath } from '../../src/main/ffmpeg'

export const FFMPEG = resolveFfmpegPath()
export const FFPROBE = resolveFfprobePath()
export const tools = { ffmpeg: FFMPEG, ffprobe: FFPROBE }

export function ffmpegAvailable(): boolean {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' })
    execFileSync(FFPROBE, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** OBS tarzı kayıt: 1280×720 30fps H.264, 3 ses track'i (karışım/oyun/mikrofon), Türkçe + boşluklu yol */
export function makeObsLikeMkv(dir: string, seconds = 20): string {
  const sub = join(dir, 'Yayın Kayıtları çğış')
  mkdirSync(sub, { recursive: true })
  const out = join(sub, '2024-05-12 21-30-45.mkv')
  execFileSync(
    FFMPEG,
    [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=48000:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${seconds}`,
      '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '60',
      '-c:a', 'aac', '-b:a', '96k',
      '-metadata:s:a:0', 'title=Track 1', '-metadata:s:a:1', 'title=Track 2', '-metadata:s:a:2', 'title=Track 3',
      out
    ],
    { stdio: 'pipe' }
  )
  return out
}

export function makeBurstWav(dir: string): string {
  const out = join(dir, 'burst.wav')
  execFileSync(
    FFMPEG,
    ['-y', '-v', 'error', '-f', 'lavfi', '-i', "sine=frequency=300:sample_rate=16000:duration=20,volume='if(between(t,10,12),0.8,0.01)':eval=frame", out],
    { stdio: 'pipe' }
  )
  return out
}

export function probeVideo(file: string): { width: number; height: number; duration: number; audio: number } {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).toString())
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  return { width: v.width, height: v.height, duration: Number(j.format.duration), audio: j.streams.filter((s: { codec_type: string }) => s.codec_type === 'audio').length }
}
