import dns from 'node:dns/promises'
import net from 'node:net'
import { ImportError } from './types.js'

const privateV4 = (ip: string) => {
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}
const privateAddr = (ip: string) => {
  if (net.isIPv4(ip)) return privateV4(ip)
  const l = ip.toLowerCase()
  if (l.startsWith('::ffff:')) return privateV4(l.slice(7))
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')
}

/** The importer fetches user-supplied URLs server-side, so refuse anything that resolves to a private network. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ImportError('That doesn’t look like a valid link')
  }
  if (url.protocol !== 'https:') throw new ImportError('Only https links can be imported')
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new ImportError('That address is not allowed')
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true }).catch(() => [])
  if (addrs.length === 0) throw new ImportError(`Couldn’t reach ${url.hostname}`, 502)
  if (addrs.some((a) => privateAddr(a.address))) throw new ImportError('That address is not allowed')
  return url
}

export const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'application/json, text/html;q=0.9, */*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
}

/** fetch with SSRF checks on every redirect hop, a timeout and a size cap. */
export async function fetchSafe(raw: string, headers: Record<string, string> = {}, maxBytes = 60 * 1024 * 1024): Promise<{ status: number; text: string; url: string }> {
  let url = await assertPublicUrl(raw)
  for (let hop = 0; hop < 4; hop++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, redirect: 'manual', signal: AbortSignal.timeout(25_000) })
    } catch (e) {
      throw new ImportError(`Couldn’t reach ${url.hostname}: ${e instanceof Error ? e.message : 'network error'}`, 502)
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location')!, url).toString())
      continue
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new ImportError('That page is too large to import')
    return { status: res.status, text: buf.toString('utf8'), url: url.toString() }
  }
  throw new ImportError('Too many redirects', 502)
}
