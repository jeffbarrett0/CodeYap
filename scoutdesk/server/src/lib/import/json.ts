import { fmtFormation, mapHudlEvents, positionCode, teamFrom, type RawEvent, type RawLineup, type RawMatch } from './hudl.js'
import { sofaPlayers, type SofaEvent, type SofaLineups } from './sofascore.js'
import { ImportError, type ImportClip, type ImportPlayer, type ImportTeam, type MatchPreview } from './types.js'

export interface JsonFile { name: string; data: unknown }
export interface JsonImport {
  preview: MatchPreview
  /** StatsBomb / Hudl style events, mapped to clips later (lets the user choose options). */
  events: RawEvent[] | null
  /** Clips read directly from the simple format. */
  clips: ImportClip[] | null
  /** What was recognised in each file, for the UI. */
  recognised: { file: string; kind: string }[]
}

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

type Kind = 'sb-events' | 'sb-lineups' | 'sb-match' | 'sofa-event' | 'sofa-lineups' | 'simple'

function classify(data: unknown): Kind | null {
  if (Array.isArray(data)) {
    const first = obj(data[0])
    if (!first) return null
    if (first.type?.name && first.team?.name && 'period' in first) return 'sb-events'
    if (first.team_name && Array.isArray(first.lineup)) return 'sb-lineups'
    if (first.home_team && first.away_team) return 'sb-match'
    return null
  }
  const o = obj(data)
  if (!o) return null
  if (obj(o.event)?.homeTeam) return 'sofa-event'
  if (o.homeTeam && o.awayTeam && ('startTimestamp' in o || 'tournament' in o)) return 'sofa-event'
  if (obj(o.home) && obj(o.away) && (Array.isArray(o.home.players) && o.home.players[0]?.player) ) return 'sofa-lineups'
  if (o.home_team && o.away_team) return 'sb-match'
  if (o.home || o.away || o.homeTeam || o.awayTeam || o.events || o.date) return 'simple'
  return null
}

const KIND_LABEL: Record<Kind, string> = {
  'sb-events': 'Events (StatsBomb / Hudl)', 'sb-lineups': 'Lineups (StatsBomb / Hudl)', 'sb-match': 'Match info (StatsBomb / Hudl)',
  'sofa-event': 'Match info (SofaScore)', 'sofa-lineups': 'Lineups (SofaScore)', simple: 'ScoutDesk simple format',
}

// ── simple format ────────────────────────────────────────────────────────────

function simpleTeam(v: unknown, fallback: string): ImportTeam {
  if (typeof v === 'string') return { name: v.trim() || fallback, players: [] }
  const o = obj(v) ?? {}
  const players: ImportPlayer[] = (Array.isArray(o.players) ? o.players : [])
    .map((p: unknown) => (typeof p === 'string' ? { name: p } : obj(p)))
    .filter((p: Record<string, any> | null): p is Record<string, any> => !!p && !!str(p.name))
    .map((p: Record<string, any>, i: number): ImportPlayer => ({
      name: String(p.name).trim(), jersey: num(p.jersey ?? p.number ?? p.shirt), position: str(p.position ?? p.pos)?.toUpperCase() ?? null,
      starter: p.starter ?? p.starting ?? (p.substitute != null ? !p.substitute : i < 11), country: str(p.country ?? p.nationality),
    }))
  return { name: str(o.name) ?? fallback, country: str(o.country), formation: str(o.formation), players }
}

function simpleClips(list: unknown, home: string, away: string): ImportClip[] {
  if (!Array.isArray(list)) return []
  const out: ImportClip[] = []
  for (const raw of list) {
    const e = obj(raw)
    const tag = str(e?.tag ?? e?.type ?? e?.event)
    if (!e || !tag) continue
    const minute = num(e.minute) ?? 0
    const second = num(e.second) ?? 0
    const period = num(e.period) ?? (minute >= 45 && !(e.half === 1) ? 2 : 1)
    // `minute` is the match clock (e.g. 63 = 63rd minute): second-half times count from the 45th minute.
    const ts = e.timeSec != null ? Number(e.timeSec) : Math.max(0, minute * 60 + second - (period === 2 ? 45 * 60 : 0))
    const teamRaw = String(e.team ?? '').toLowerCase()
    const team: 'home' | 'away' = teamRaw === 'away' || (!!away && teamRaw === away.toLowerCase()) ? 'away' : teamRaw === 'home' || teamRaw === home.toLowerCase() ? 'home' : 'home'
    const outcome = ['success', 'fail', 'neutral'].includes(e.outcome) ? e.outcome : 'neutral'
    out.push({ tag, team, playerName: str(e.player), period: period > 2 ? 2 : period, ts, x: num(e.x), y: num(e.y), endX: num(e.endX), endY: num(e.endY), outcome, notes: str(e.notes ?? e.note) ?? '' })
  }
  return out
}

// ── main ─────────────────────────────────────────────────────────────────────

export function jsonPreview(files: JsonFile[], opts: { swap?: boolean } = {}): JsonImport {
  const recognised: JsonImport['recognised'] = []
  const by: Partial<Record<Kind, any>> = {}
  for (const f of files) {
    const k = classify(f.data)
    if (!k) throw new ImportError(`“${f.name}” isn’t a format I recognise. Supported: StatsBomb / Hudl open data (events, lineups, matches), SofaScore JSON (event, lineups) and the ScoutDesk simple format shown in the dialog.`)
    recognised.push({ file: f.name, kind: KIND_LABEL[k] })
    by[k] = by[k] ?? f.data
  }

  let date: string | null = null
  let competition = ''
  let venue: string | null = null
  let homeScore: number | null = null
  let awayScore: number | null = null
  let home: ImportTeam | null = null
  let away: ImportTeam | null = null
  let clips: ImportClip[] | null = null
  const events: RawEvent[] | null = by['sb-events'] ?? null

  const simple = obj(by.simple)
  if (simple) {
    date = str(simple.date)?.slice(0, 10) ?? null
    competition = str(simple.competition ?? simple.league) ?? ''
    venue = str(simple.venue ?? simple.stadium)
    homeScore = num(simple.homeScore ?? obj(simple.score)?.home)
    awayScore = num(simple.awayScore ?? obj(simple.score)?.away)
    home = simpleTeam(simple.home ?? simple.homeTeam, 'Home')
    away = simpleTeam(simple.away ?? simple.awayTeam, 'Away')
    const c = simpleClips(simple.events ?? simple.clips, home.name, away.name)
    if (c.length) clips = c
  }

  const sbm = by['sb-match']
  if (sbm) {
    const m: RawMatch = Array.isArray(sbm) ? sbm[0] : sbm
    if (Array.isArray(sbm) && sbm.length > 1) throw new ImportError(`That file lists ${sbm.length} matches. Keep only the match you want in the file (or use the Hudl browser) and try again.`)
    date = m.match_date ?? date
    competition = `${m.competition?.competition_name ?? ''} ${m.season?.season_name ?? ''}`.trim() || competition
    venue = m.stadium?.name ?? venue
    homeScore = m.home_score ?? homeScore
    awayScore = m.away_score ?? awayScore
    home = { name: m.home_team.home_team_name, country: m.home_team.country?.name ?? null, players: [] }
    away = { name: m.away_team.away_team_name, country: m.away_team.country?.name ?? null, players: [] }
  }

  const se = by['sofa-event'] as SofaEvent | Record<string, any> | undefined
  if (se) {
    const e = (se as SofaEvent).event ?? (se as SofaEvent['event'])
    date = e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString().slice(0, 10) : date
    competition = [e.tournament?.uniqueTournament?.name ?? e.tournament?.name, e.season?.name].filter(Boolean).join(' · ') || competition
    venue = e.venue?.stadium?.name ?? e.venue?.name ?? venue
    homeScore = e.homeScore?.current ?? homeScore
    awayScore = e.awayScore?.current ?? awayScore
    home = { name: e.homeTeam.name, country: e.homeTeam.country?.name ?? null, players: [] }
    away = { name: e.awayTeam.name, country: e.awayTeam.country?.name ?? null, players: [] }
  }

  // Lineups ---------------------------------------------------------------
  const sbl = by['sb-lineups'] as RawLineup[] | undefined
  const sfl = by['sofa-lineups'] as SofaLineups | undefined
  // Starting XI events carry the formation and the first eleven even without a lineups file.
  const startXI = new Map<string, RawEvent>()
  for (const e of events ?? []) if (e.type.name === 'Starting XI' && !startXI.has(e.team.name)) startXI.set(e.team.name, e)
  if (!home || !away) {
    const names = sbl?.map((l) => l.team_name) ?? [...startXI.keys()]
    if (names.length < 2 && !sfl) throw new ImportError('I could not find two teams in that data. Add a file with the match info (teams) as well.')
    home = home ?? { name: names[0] ?? 'Home', players: [] }
    away = away ?? { name: names[1] ?? 'Away', players: [] }
  }
  const fromStartXI = (name: string): ImportPlayer[] => {
    const lineup = (startXI.get(name) as unknown as { tactics?: { lineup?: { player: { name: string }; position: { name: string }; jersey_number: number }[] } } | undefined)?.tactics?.lineup ?? []
    return lineup.map((p) => ({ name: p.player.name, jersey: p.jersey_number ?? null, position: positionCode(p.position?.name), starter: true }))
  }
  const fill = (t: ImportTeam, side: 'home' | 'away'): ImportTeam => {
    if (t.players.length) return t
    const fm = fmtFormation(startXI.get(t.name)?.tactics?.formation) ?? t.formation ?? null
    const lu = sbl?.find((l) => l.team_name === t.name)
    if (lu) return { ...teamFrom(t.name, t.country ?? undefined, lu, fm), formation: fm }
    if (sfl?.[side]?.players?.length) return { ...t, formation: sfl[side]!.formation ?? fm, players: sofaPlayers(sfl[side]!.players) }
    const xi = fromStartXI(t.name)
    return { ...t, formation: fm, players: xi }
  }
  home = fill(home, 'home')
  away = fill(away, 'away')
  if (opts.swap) {
    ;[home, away] = [away, home]
    ;[homeScore, awayScore] = [awayScore, homeScore]
    if (clips) clips = clips.map((c) => ({ ...c, team: c.team === 'home' ? 'away' : 'home' }))
  }

  const missing: string[] = []
  if (!date) missing.push('date')
  if (!home.players.length || !away.players.length) missing.push('lineups')
  if (!events && !clips) missing.push('events')
  const total = files.map((f) => f.name).join(', ')
  return {
    preview: { source: 'file', sourceUrl: `file: ${total}`.slice(0, 300), date, competition, venue, homeScore, awayScore, home, away, missing },
    events,
    clips,
    recognised,
  }
}

export { mapHudlEvents }
