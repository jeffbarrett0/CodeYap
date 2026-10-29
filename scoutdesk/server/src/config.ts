import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const SERVER_ROOT = path.resolve(here, '..')
export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(SERVER_ROOT, 'storage')
export const VIDEO_DIR = path.join(STORAGE_DIR, 'videos')
export const THUMB_DIR = path.join(STORAGE_DIR, 'thumbs')
export const SNAPSHOT_DIR = path.join(STORAGE_DIR, 'snapshots')
export const EXPORT_DIR = path.join(STORAGE_DIR, 'exports')
export const CLIENT_DIST = path.resolve(SERVER_ROOT, '../client/dist')
export const PORT = Number(process.env.PORT ?? 4000)
export const HOST = process.env.HOST ?? '0.0.0.0'
/** Max accepted upload, in bytes (default 20 GB — full-match footage is big). */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 ** 3)
/** Signed stream URLs stay valid this long (seconds). */
export const STREAM_URL_TTL = Number(process.env.STREAM_URL_TTL ?? 24 * 3600)
