import { fetchSafe } from './net.js'
import { ImportError, type MatchPreview } from './types.js'

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]!)
      out.push(...(Array.isArray(v) ? v : [v]), ...((v as { '@graph'?: unknown[] })['@graph'] ?? []))
    } catch { /* ignore malformed blocks */ }
  }
  return out
}
const nm = (x: unknown): string | null => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' ? (x as { name: string }).name : null)

/**
 * Any other page: look for schema.org `SportsEvent` JSON-LD, then fall back to the page title ("A v B").
 * Only teams / date / competition / score can be recovered this way — lineups need a dedicated source.
 */
export async function genericPreview(url: string): Promise<MatchPreview> {
  const r = await fetchSafe(url)
  if (r.status === 403 || r.status === 429) throw new ImportError('That site blocked the request (automated access is often refused). Open the page in your browser, copy the teams/date, or try another source.', 502)
  if (r.status !== 200) throw new ImportError(`That page answered ${r.status}`, 502)
  const html = r.text
  const ev = jsonLdBlocks(html).find((b) => /SportsEvent/i.test(String((b as { '@type'?: unknown })['@type']))) as Record<string, unknown> | undefined
  let home = ev ? nm(ev.homeTeam) : null
  let away = ev ? nm(ev.awayTeam) : null
  if ((!home || !away) && Array.isArray(ev?.competitor)) {
    home = nm((ev!.competitor as unknown[])[0])
    away = nm((ev!.competitor as unknown[])[1])
  }
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const og = decode(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ?? '')
  if (!home || !away) {
    const t = /^(.{2,60}?)\s+(?:vs\.?|v|-|–|:)\s+(.{2,60}?)(?:\s+[|\-–·(]|\s+\d+\s*[:\-]\s*\d+|$)/i.exec(og || title)
    if (t) [home, away] = [t[1]!.trim(), t[2]!.trim()]
  }
  if (!home || !away) throw new ImportError('I couldn’t find the teams on that page. Try a SofaScore match link or the Hudl open data, or enter the match by hand.')
  const date = ((ev?.startDate as string | undefined) ?? /\b(\d{4}-\d{2}-\d{2})\b/.exec(`${title} ${html.slice(0, 20000)}`)?.[1] ?? null)?.slice(0, 10) ?? null
  const score = /\b(\d{1,2})\s*[:\-–]\s*(\d{1,2})\b/.exec(og || title)
  const missing = ['lineups']
  if (!date) missing.push('date')
  return {
    source: 'generic', sourceUrl: url, date,
    competition: nm(ev?.superEvent) ?? nm(ev?.organizer) ?? '',
    venue: nm(ev?.location),
    homeScore: score ? Number(score[1]) : null, awayScore: score ? Number(score[2]) : null,
    home: { name: home, players: [] }, away: { name: away, players: [] }, missing,
  }
}
