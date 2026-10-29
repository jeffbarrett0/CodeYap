import fs from 'node:fs'
import path from 'node:path'
import { EXPORT_DIR, PHOTO_DIR, SNAPSHOT_DIR, STORAGE_DIR, THUMB_DIR, VIDEO_DIR } from '../config.js'

export function ensureStorage() {
  for (const dir of [STORAGE_DIR, PHOTO_DIR, VIDEO_DIR, THUMB_DIR, SNAPSHOT_DIR, EXPORT_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Resolve a storage-relative path, refusing anything that escapes the storage dir. */
export function resolveStoragePath(rel: string): string {
  const abs = path.resolve(STORAGE_DIR, rel)
  if (abs !== STORAGE_DIR && !abs.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error('Path escapes storage directory')
  }
  return abs
}
