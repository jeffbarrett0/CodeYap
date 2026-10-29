import { fetchSafe } from './net.js'
import { ImportError, type ImportPlayer, type ImportTeam, type MatchPreview } from './types.js'

/**
 * SofaScore: reads the public JSON the website itself uses (api.sofascore.com). It is an undocumented
 * endpoint that SofaScore may block or change at any time — fine for private research, not guaranteed.
 */
export function parseSofaScoreId(url: string): number | null {
  const m = /#id:(\d+)/.exec(url) ?? /\/event\/(\d+)/.exec(url) ?? /[?&]id=(\d+)/.exec(url)
  return m ? Number(m[1]) : null
}

export interface SofaEvent {
  event: {
    homeTeam: { name: string; country?: { name?: string } }; awayTeam: { name: string; country?: { name?: string } }
    startTimestamp?: number; homeScore?: { current?: number }; awayScore?: { current?: number }
    tournament?: { name?: string; uniqueTournament?: { name?: string } }; season?: { name?: string }; venue?: { stadium?: { name?: string }; name?: string }
    roundInfo?: { round?: number; name?: string }
  }
}
export interface SofaLineups {
  home?: { formation?: string; players?: SofaPlayer[] }
  away?: { formation?: string; players?: SofaPlayer[] }
}
interface SofaPlayer { player: { name: string; position?: string; jerseyNumber?: string | number; country?: { name?: string } }; jerseyNumber?: string | number; position?: string; substitute?: boolean }

const POS: Record<string, string> = { G: 'GK', D: 'CB', M: 'CM', F: 'ST' }

async function api<T>(path: string): Promise<T> {
  const r = await fetchSafe(`https://api.sofascore.com/api/v1${path}`, { referer: 'https://www.sofascore.com/', origin: 'https://www.sofascore.com' })
  if (r.status === 403 || r.status === 429) throw new ImportError('SofaScore blocked the request (it often does for automated access). Try again later, use another source, or enter the match by hand.', 502)
  if (r.status === 404) throw new ImportError('SofaScore has no match with that id', 404)
  if (r.status !== 200) throw new ImportError(`SofaScore answered ${r.status}`, 502)
  try {
    return JSON.parse(r.text) as T
  } catch {
    throw new ImportError('SofaScore returned something unexpected (it may be showing a bot check)', 502)
  }
}

export const sofaPlayers = (list: SofaPlayer[] | undefined): ImportPlayer[] =>
  (list ?? [])
    // Unused substitutes have no minutes; SofaScore marks used ones through `statistics`, which we don't fetch — keep starters + bench.
    .map((p) => ({
      name: p.player.name,
      jersey: Number(p.jerseyNumber ?? p.player.jerseyNumber) || null,
      position: POS[p.position ?? p.player.position ?? ''] ?? null,
      starter: !p.substitute,
      country: p.player.country?.name ?? null,
    }))
    .sort((a, b) => Number(b.starter) - Number(a.starter) || (a.jersey ?? 99) - (b.jersey ?? 99))

export async function sofaScorePreview(id: number, sourceUrl: string): Promise<MatchPreview> {
  const [ev, lineups] = await Promise.all([api<SofaEvent>(`/event/${id}`), api<SofaLineups>(`/event/${id}/lineups`).catch(() => ({}) as SofaLineups)])
  const e = ev.event
  const comp = [e.tournament?.uniqueTournament?.name ?? e.tournament?.name, e.season?.name, e.roundInfo?.round ? `Round ${e.roundInfo.round}` : e.roundInfo?.name].filter(Boolean).join(' · ')
  const missing: string[] = []
  if (!lineups.home?.players?.length) missing.push('lineups')
  return {
    source: 'sofascore',
    sourceUrl,
    date: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString().slice(0, 10) : null,
    competition: comp,
    venue: e.venue?.stadium?.name ?? e.venue?.name ?? null,
    homeScore: e.homeScore?.current ?? null,
    awayScore: e.awayScore?.current ?? null,
    home: { name: e.homeTeam.name, country: e.homeTeam.country?.name ?? null, formation: lineups.home?.formation ?? null, players: sofaPlayers(lineups.home?.players) },
    away: { name: e.awayTeam.name, country: e.awayTeam.country?.name ?? null, formation: lineups.away?.formation ?? null, players: sofaPlayers(lineups.away?.players) },
    missing,
  }
}
