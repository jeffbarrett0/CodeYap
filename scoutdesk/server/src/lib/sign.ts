import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { STORAGE_DIR, STREAM_URL_TTL } from '../config.js'

let secret: Buffer | null = null

function getSecret(): Buffer {
  if (secret) return secret
  if (process.env.SCOUTDESK_SECRET) {
    secret = Buffer.from(process.env.SCOUTDESK_SECRET)
    return secret
  }
  const file = path.join(STORAGE_DIR, '.secret')
  try {
    secret = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')
  } catch {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
    secret = crypto.randomBytes(32)
    fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 })
  }
  return secret
}

function mac(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

/** `?exp=…&sig=…` query string granting read access to one resource for a while. */
export function signResource(resource: string, ttlSec = STREAM_URL_TTL): string {
  // Expiry is rounded up to an hourly bucket so repeated API reads return the
  // *same* URL — otherwise every poll would change <video src> and reload it.
  const BUCKET = 3600
  const exp = (Math.floor(Date.now() / 1000 / BUCKET) + 1) * BUCKET + ttlSec
  return `exp=${exp}&sig=${mac(`${resource}.${exp}`)}`
}

export function verifyResource(resource: string, exp: unknown, sig: unknown): boolean {
  const e = Number(exp)
  if (!Number.isFinite(e) || typeof sig !== 'string') return false
  if (e < Date.now() / 1000) return false
  const expected = mac(`${resource}.${e}`)
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
