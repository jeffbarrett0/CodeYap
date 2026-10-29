// Tarayıcı modu (UI testleri) için küçük demo medya üretir: 120 sn görüntü + 3 ses track'i.
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'tests/fixtures/public/demo')
mkdirSync(out, { recursive: true })

const require = createRequire(import.meta.url)
let ffmpeg = process.env.CLIPFORGE_FFMPEG || 'ffmpeg'
try { ffmpeg = process.env.CLIPFORGE_FFMPEG || require('ffmpeg-static') || ffmpeg } catch {}

const run = (args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args], { stdio: 'inherit' })
if (!existsSync(join(out, 'sample.mp4'))) {
  run(['-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=30:duration=120', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34', '-pix_fmt', 'yuv420p', '-g', '30', '-movflags', '+faststart', join(out, 'sample.mp4')])
}
;[440, 880, 220].forEach((f, i) => {
  const file = join(out, `audio_${i}.m4a`)
  if (!existsSync(file)) run(['-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=32000:duration=120`, '-ac', '1', '-c:a', 'aac', '-b:a', '32k', file])
})
console.log('Demo medya hazır:', out)
