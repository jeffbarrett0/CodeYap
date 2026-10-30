import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'
}

/** `Range: bytes=a-b` / `a-` / `-n` → [start, end] (dahil); geçersizse null (416) */
export function parseRange(header: string | null, size: number): [number, number] | null | 'none' {
  if (!header) return 'none'
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'none' // çoklu/bozuk aralık: tüm dosya
  let start: number
  let end: number
  if (m[1] === '') {
    const n = Number(m[2])
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return null
  return [start, end]
}

/**
 * Yerel dosyayı HTTP Range desteğiyle sunar. net.fetch(file://) Range başlığını yok sayıp her atlamada tüm
 * dosyayı (24 dk'lık VOD'da GB'larca) 200 olarak gönderiyordu: ilk saniyeler çalar, sonra atlama/arabellek
 * bozulur ve ses cızırdardı.
 */
export async function serveFile(file: string, rangeHeader: string | null): Promise<Response> {
  const st = await stat(file)
  const size = st.size
  const base: Record<string, string> = {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  }
  const r = parseRange(rangeHeader, size)
  if (r === null) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
  const [start, end] = r === 'none' ? [0, size - 1] : r
  if (size === 0) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } })
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream
  const headers = { ...base, 'Content-Length': String(end - start + 1) }
  if (r === 'none') return new Response(body, { status: 200, headers })
  return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } })
}
