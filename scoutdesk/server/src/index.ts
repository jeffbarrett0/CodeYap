import { buildApp } from './app.js'
import { HOST, PORT } from './config.js'
import { resumeExports } from './lib/exporter.js'
import { ffmpegAvailable } from './lib/ffmpeg.js'

const app = await buildApp({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
await app.listen({ port: PORT, host: HOST })
void resumeExports()
if (!(await ffmpegAvailable())) {
  app.log.warn('ffmpeg/ffprobe not found on PATH — uploads will work but thumbnails, probing and clip export will not.')
}
