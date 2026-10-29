import { fetchSafe } from './net.js'
import { ImportError, type ImportClip, type ImportPlayer, type ImportTeam, type MatchPreview } from './types.js'

/** Hudl / StatsBomb open data: https://github.com/hudl/open-data (free for non-commercial research use). */
const BASE = 'https://raw.githubusercontent.com/hudl/open-data/master/data'

const cache = new Map<string, { at: number; value: unknown }>()
async function getJson<T>(path: string): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value as T
  const r = await fetchSafe(`${BASE}${path}`)
  if (r.status === 404) throw new ImportError('That match isn’t in the Hudl open data', 404)
  if (r.status !== 200) throw new ImportError(`Hudl open data answered ${r.status}`, 502)
  const value = JSON.parse(r.text) as T
  cache.set(path, { at: Date.now(), value })
  if (cache.size > 40) cache.delete(cache.keys().next().value!)
  return value
}

interface RawCompetition { competition_id: number; season_id: number; competition_name: string; season_name: string; country_name: string; competition_gender: string; match_available: string | null }
export async function listCompetitions() {
  const all = await getJson<RawCompetition[]>('/competitions.json')
  return all
    .filter((c) => c.match_available)
    .map((c) => ({ competitionId: c.competition_id, seasonId: c.season_id, name: c.competition_name, season: c.season_name, country: c.country_name, gender: c.competition_gender }))
    .sort((a, b) => a.name.localeCompare(b.name) || b.season.localeCompare(a.season))
}

interface RawMatch {
  match_id: number; match_date: string; kick_off?: string
  competition: { competition_name: string }; season: { season_name: string }
  home_team: { home_team_name: string; country?: { name: string } }; away_team: { away_team_name: string; country?: { name: string } }
  home_score: number | null; away_score: number | null; stadium?: { name: string }; competition_stage?: { name: string }
}
export async function listMatches(competitionId: number, seasonId: number) {
  const ms = await getJson<RawMatch[]>(`/matches/${competitionId}/${seasonId}.json`)
  return ms
    .map((m) => ({ matchId: m.match_id, date: m.match_date, home: m.home_team.home_team_name, away: m.away_team.away_team_name, homeScore: m.home_score, awayScore: m.away_score, stage: m.competition_stage?.name ?? null }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** A match id alone doesn't say which competition file holds it, so scan them (cached after the first lookup). */
async function findMatch(matchId: number): Promise<RawMatch> {
  const comps = (await getJson<RawCompetition[]>('/competitions.json')).filter((c) => c.match_available)
  for (let i = 0; i < comps.length; i += 8) {
    const found = await Promise.all(
      comps.slice(i, i + 8).map(async (c) => (await getJson<RawMatch[]>(`/matches/${c.competition_id}/${c.season_id}.json`).catch(() => [])).find((m) => m.match_id === matchId)),
    )
    const hit = found.find(Boolean)
    if (hit) return hit
  }
  throw new ImportError(`Match ${matchId} isn’t in the Hudl open data`, 404)
}

/** StatsBomb positions → our short codes (GK, RB, LB, CB, RWB, LWB, DM, CM, AM, RM, LM, RW, LW, ST). */
export function positionCode(name: string | undefined): string | null {
  if (!name) return null
  const side = /^right/i.test(name) ? 'R' : /^left/i.test(name) ? 'L' : ''
  const central = !side || /center/i.test(name) // "Left Center Back" is a centre-back, not a left-back
  if (/goalkeeper/i.test(name)) return 'GK'
  if (/wing back/i.test(name)) return `${side || 'R'}WB`
  if (/back/i.test(name)) return central ? 'CB' : `${side}B`
  if (/defensive midfield/i.test(name)) return 'DM'
  if (/attacking midfield/i.test(name)) return 'AM'
  if (/midfield/i.test(name)) return central ? 'CM' : `${side}M`
  if (/wing/i.test(name)) return `${side || 'R'}W`
  if (/forward|striker/i.test(name)) return 'ST'
  return null
}

interface RawLineupPlayer { player_name: string; player_nickname: string | null; jersey_number: number | null; country?: { name: string }; positions: { position: string; start_reason: string }[] }
interface RawLineup { team_name: string; lineup: RawLineupPlayer[] }

function teamFrom(name: string, country: string | undefined, lineup: RawLineup | undefined, formation: string | null): ImportTeam {
  const players: ImportPlayer[] = (lineup?.lineup ?? [])
    .filter((p) => p.positions.length > 0) // squad members who never entered the pitch have no positions
    .map((p) => {
      const first = p.positions[0]!
      return { name: p.player_name, jersey: p.jersey_number, position: positionCode(first.position), starter: first.start_reason === 'Starting XI', country: p.country?.name ?? null }
    })
    .sort((a, b) => Number(b.starter) - Number(a.starter) || (a.jersey ?? 99) - (b.jersey ?? 99))
  return { name, country: country ?? null, formation, players }
}

export interface RawEvent {
  type: { name: string }; period: number; timestamp: string; minute: number; second: number
  team: { name: string }; player?: { name: string }; location?: [number, number]
  tactics?: { formation: number }
  pass?: { end_location?: [number, number]; outcome?: { name: string }; cross?: boolean; shot_assist?: boolean; goal_assist?: boolean; type?: { name: string }; height?: { name: string } }
  shot?: { end_location?: number[]; outcome: { name: string }; statsbomb_xg?: number; type?: { name: string }; body_part?: { name: string } }
  dribble?: { outcome: { name: string } }
  duel?: { type?: { name: string }; outcome?: { name: string } }
  interception?: { outcome?: { name: string } }
  ball_recovery?: { recovery_failure?: boolean }
  foul_committed?: { card?: { name: string } }
  bad_behaviour?: { card?: { name: string } }
  goalkeeper?: { type?: { name: string }; outcome?: { name: string } }
}

const fmtFormation = (n: number | undefined) => (n ? String(n).split('').join('-') : null)

export async function hudlPreview(matchId: number): Promise<{ preview: MatchPreview; events: RawEvent[] }> {
  const m = await findMatch(matchId)
  const [lineups, events] = await Promise.all([
    getJson<RawLineup[]>(`/lineups/${matchId}.json`).catch(() => [] as RawLineup[]),
    getJson<RawEvent[]>(`/events/${matchId}.json`).catch(() => [] as RawEvent[]),
  ])
  const homeName = m.home_team.home_team_name
  const awayName = m.away_team.away_team_name
  const formations = new Map<string, string | null>()
  for (const e of events) if (e.type.name === 'Starting XI' && !formations.has(e.team.name)) formations.set(e.team.name, fmtFormation(e.tactics?.formation))
  const comp = `${m.competition.competition_name}${m.competition_stage?.name && m.competition_stage.name !== 'Regular Season' ? ` · ${m.competition_stage.name}` : ''}`
  return {
    events,
    preview: {
      source: 'hudl',
      sourceUrl: `https://github.com/hudl/open-data/blob/master/data/events/${matchId}.json`,
      date: m.match_date,
      competition: `${comp} ${m.season.season_name}`.trim(),
      venue: m.stadium?.name ?? null,
      homeScore: m.home_score,
      awayScore: m.away_score,
      home: teamFrom(homeName, m.home_team.country?.name, lineups.find((l) => l.team_name === homeName), formations.get(homeName) ?? null),
      away: teamFrom(awayName, m.away_team.country?.name, lineups.find((l) => l.team_name === awayName), formations.get(awayName) ?? null),
      missing: [],
    },
  }
}

/** Accepts a bare id, a raw/blob GitHub URL to an events/lineups file, or a matches list (→ browse). */
export function parseHudlRef(url: string): { matchId: number } | { browse: { competitionId?: number; seasonId?: number } } | null {
  const u = url.trim()
  if (/^\d{3,9}$/.test(u)) return { matchId: Number(u) }
  if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com)\/(hudl|statsbomb)\/open-data/i.test(u)) return null
  const one = /\/data\/(?:events|lineups|three-sixty)\/(\d+)\.json/.exec(u)
  if (one) return { matchId: Number(one[1]) }
  const list = /\/data\/matches\/(\d+)\/(\d+)\.json/.exec(u)
  if (list) return { browse: { competitionId: Number(list[1]), seasonId: Number(list[2]) } }
  return { browse: {} }
}

// ── Events → clips ───────────────────────────────────────────────────────────

const sec = (ts: string) => {
  const [h, m, s] = ts.split(':').map(Number)
  return h! * 3600 + m! * 60 + s!
}
const px = (l?: number[]) => (l && l.length >= 2 ? { x: +((l[0]! / 120) * 100).toFixed(1), y: +((l[1]! / 80) * 100).toFixed(1) } : { x: null, y: null })

export function mapHudlEvents(events: RawEvent[], homeName: string, opts: { includePressures: boolean }): { clips: ImportClip[]; pressureCount: number; outsideTwoHalves: number } {
  const clips: ImportClip[] = []
  let pressureCount = 0
  let outside = 0
  for (const e of events) {
    const t = e.type.name
    const team: 'home' | 'away' = e.team.name === homeName ? 'home' : 'away'
    const base = (tag: string, outcome: ImportClip['outcome'], notes = '', end?: number[]): ImportClip => {
      const s = px(e.location)
      const en = px(end)
      return { tag, team, playerName: e.player?.name ?? null, period: e.period, ts: sec(e.timestamp), x: s.x, y: s.y, endX: end ? en.x : null, endY: end ? en.y : null, outcome, notes }
    }
    let c: ImportClip | null = null
    let extra: ImportClip | null = null
    if (t === 'Shot' && e.shot) {
      const o = e.shot.outcome.name
      const xg = e.shot.statsbomb_xg != null ? `xG ${e.shot.statsbomb_xg.toFixed(2)}` : ''
      const note = [xg, e.shot.body_part?.name, e.shot.type?.name !== 'Open Play' ? e.shot.type?.name : ''].filter(Boolean).join(' · ')
      if (e.shot.type?.name === 'Penalty') c = base('Penalty', o === 'Goal' ? 'success' : 'fail', note, e.shot.end_location)
      else if (o === 'Goal') c = base('Goal', 'success', note, e.shot.end_location)
      else if (o === 'Saved' || o === 'Saved to Post') c = base('Shot on target', 'neutral', note, e.shot.end_location)
      else c = base('Shot', 'neutral', note, e.shot.end_location)
    } else if (t === 'Pass' && e.pass) {
      const p = e.pass
      const ok = !p.outcome ? 'success' : 'fail'
      if (p.goal_assist || p.shot_assist) c = base('Key pass', 'success', p.goal_assist ? 'Assist' : 'Shot assist', p.end_location)
      else if (p.cross) c = base('Cross', ok, '', p.end_location)
      else if (p.type?.name === 'Corner') c = base('Corner', 'neutral', '', p.end_location)
      else if (p.type?.name === 'Free Kick') c = base('Free kick', 'neutral', '', p.end_location)
      else if (p.type?.name === 'Throw-in') c = base('Throw-in', 'neutral', '', p.end_location)
    } else if (t === 'Dribble' && e.dribble) c = base('Dribble', e.dribble.outcome.name === 'Complete' ? 'success' : 'fail')
    else if (t === 'Duel' && e.duel) {
      const d = e.duel.type?.name
      const won = /won|success/i.test(e.duel.outcome?.name ?? '')
      if (d === 'Tackle') c = base('Tackle', won ? 'success' : e.duel.outcome ? 'fail' : 'neutral')
      else if (d === 'Aerial Lost') c = base('Aerial duel', 'fail')
    } else if (t === 'Dribbled Past') c = base('Duel lost', 'fail')
    else if (t === 'Interception') c = base('Interception', /lost/i.test(e.interception?.outcome?.name ?? '') ? 'fail' : 'success')
    else if (t === 'Block') c = base('Block', 'success')
    else if (t === 'Ball Recovery') c = base('Recovery', e.ball_recovery?.recovery_failure ? 'fail' : 'success')
    else if (t === 'Pressure') {
      pressureCount++
      if (opts.includePressures) c = base('Pressing action', 'neutral')
    } else if (t === 'Foul Committed') {
      c = base('Foul', 'fail')
      if (e.foul_committed?.card) extra = base('Card', 'fail', e.foul_committed.card.name)
    } else if (t === 'Own Goal For') c = base('Goal', 'success', 'Own goal by the opposition')
    else if (t === 'Bad Behaviour' && e.bad_behaviour?.card) c = base('Card', 'fail', e.bad_behaviour.card.name)
    else if (t === 'Goal Keeper' && e.goalkeeper) {
      const g = e.goalkeeper.type?.name ?? ''
      if (/Shot Saved|Penalty Saved/.test(g)) c = base('Save', 'success')
      else if (/Collected|Smother/.test(g)) c = base('Claim', 'success')
    } else if (t === 'Miscontrol' || t === 'Dispossessed') c = base('Lost possession', 'fail')
    else if (t === 'Error') c = base('Error', 'fail')
    for (const x of [c, extra]) {
      if (!x) continue
      if (x.period > 2) outside++
      else clips.push(x)
    }
  }
  return { clips, pressureCount, outsideTwoHalves: outside }
}
