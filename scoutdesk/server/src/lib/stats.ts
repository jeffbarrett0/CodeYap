import type { Clip, Player } from '@prisma/client'
import { prisma } from '../db.js'

export interface Stats {
  matches: number
  clips: number
  goals: number
  shots: number
  shotsOnTarget: number
  passesAttempted: number
  passesCompleted: number
  passAccuracy: number | null
  keyPasses: number
  dribblesAttempted: number
  dribblesWon: number
  tackles: number
  tacklesWon: number
  interceptions: number
  blocks: number
  duelsWon: number
  duelsLost: number
  duelsWonPct: number | null
  pressures: number
  recoveries: number
  errors: number
  lostPossession: number
  fouls: number
  cards: number
}

export const STAT_DEFINITIONS: Record<string, string> = {
  shots: 'Shot + Shot on target + Goal tags',
  shotsOnTarget: 'Shot on target + Goal tags',
  passes: 'Key pass, Cross, Combination play, Distribution and Pass tags; completed = outcome success',
  duels: 'Duel won/lost and Aerial duel (outcome success = won) — tackles are counted separately',
  dribbles: 'Dribble tags; won = outcome success',
}

type Row = Pick<Clip, 'tagTypeId' | 'matchId' | 'outcome' | 'playerId' | 'teamId'>
const PASS = new Set(['key pass', 'cross', 'combination play', 'distribution', 'pass'])
const SHOT = new Set(['shot', 'shot on target', 'goal'])
const ON_TARGET = new Set(['shot on target', 'goal'])

/** Compute the stat block from tags (matched by tag name, case-insensitive, so custom taxonomies keep working). */
export function computeStats(rows: Row[], tagName: (id: string) => string, extraMatches: Iterable<string> = []): Stats {
  const s: Stats = {
    matches: 0, clips: rows.length, goals: 0, shots: 0, shotsOnTarget: 0, passesAttempted: 0, passesCompleted: 0, passAccuracy: null, keyPasses: 0,
    dribblesAttempted: 0, dribblesWon: 0, tackles: 0, tacklesWon: 0, interceptions: 0, blocks: 0, duelsWon: 0, duelsLost: 0, duelsWonPct: null,
    pressures: 0, recoveries: 0, errors: 0, lostPossession: 0, fouls: 0, cards: 0,
  }
  const matches = new Set<string>(extraMatches)
  for (const r of rows) {
    matches.add(r.matchId)
    const n = tagName(r.tagTypeId).toLowerCase()
    const ok = r.outcome === 'success'
    const bad = r.outcome === 'fail'
    if (n === 'goal') s.goals++
    if (SHOT.has(n)) s.shots++
    if (ON_TARGET.has(n)) s.shotsOnTarget++
    if (PASS.has(n)) { s.passesAttempted++; if (ok) s.passesCompleted++ }
    if (n === 'key pass') s.keyPasses++
    if (n === 'dribble') { s.dribblesAttempted++; if (ok) s.dribblesWon++ }
    if (n === 'tackle') { s.tackles++; if (ok) s.tacklesWon++ }
    if (n === 'interception') s.interceptions++
    if (n === 'block') s.blocks++
    if (n === 'duel won') s.duelsWon++
    if (n === 'duel lost') s.duelsLost++
    if (n === 'aerial duel') { if (ok) s.duelsWon++; else if (bad) s.duelsLost++ }
    if (n === 'pressing action') s.pressures++
    if (n === 'recovery') s.recoveries++
    if (n === 'error') s.errors++
    if (n === 'lost possession') s.lostPossession++
    if (n === 'foul') s.fouls++
    if (n === 'card') s.cards++
  }
  s.matches = matches.size
  s.passAccuracy = s.passesAttempted ? Math.round((s.passesCompleted / s.passesAttempted) * 100) : null
  s.duelsWonPct = s.duelsWon + s.duelsLost ? Math.round((s.duelsWon / (s.duelsWon + s.duelsLost)) * 100) : null
  return s
}

// ── Radar ───────────────────────────────────────────────────────────────────

export interface Axis {
  key: string
  label: string
  /** Raw per-match value (or % for rate metrics). */
  raw: number
  /** 0–100, relative to the best player in the database. */
  value: number
  /** Peer average on the same 0–100 scale. */
  avg: number
}

const METRICS: { key: string; label: string; get: (s: Stats) => number; rate?: boolean; invert?: boolean }[] = [
  { key: 'shooting', label: 'Shooting', get: (s) => s.shots },
  { key: 'creation', label: 'Chance creation', get: (s) => s.keyPasses },
  { key: 'dribbling', label: 'Dribbling', get: (s) => s.dribblesWon },
  { key: 'passing', label: 'Pass accuracy', get: (s) => s.passAccuracy ?? 0, rate: true },
  { key: 'defending', label: 'Defending', get: (s) => s.tackles + s.interceptions + s.blocks },
  { key: 'duels', label: 'Duels won %', get: (s) => s.duelsWonPct ?? 0, rate: true },
  { key: 'recovery', label: 'Ball recovery', get: (s) => s.recoveries + s.pressures },
  { key: 'discipline', label: 'Discipline', get: (s) => s.errors + s.fouls + s.cards + s.lostPossession, invert: true },
]

export const positionGroup = (p: Pick<Player, 'positions'>): 'GK' | 'DEF' | 'MID' | 'FWD' => {
  const pos = (p.positions as string[])[0] ?? ''
  if (pos === 'GK') return 'GK'
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF'
  if (['DM', 'CM', 'AM', 'LM', 'RM'].includes(pos)) return 'MID'
  return 'FWD'
}

export interface Roster {
  player: Player
  stats: Stats
}

export async function allPlayerStats(): Promise<{ rows: Roster[]; tagName: (id: string) => string; tagCategory: Map<string, { name: string; color: string; tag: string }> }> {
  const [players, clips, tags] = await Promise.all([
    prisma.player.findMany(),
    prisma.clip.findMany({ where: { playerId: { not: null } }, select: { tagTypeId: true, matchId: true, outcome: true, playerId: true, teamId: true } }),
    prisma.tagType.findMany({ include: { category: true } }),
  ])
  const names = new Map(tags.map((t) => [t.id, t.name]))
  const tagName = (id: string) => names.get(id) ?? ''
  const by = new Map<string, Row[]>()
  for (const c of clips) by.set(c.playerId!, [...(by.get(c.playerId!) ?? []), c])
  const matches = await prisma.match.findMany({ select: { id: true, lineups: true } })
  const lineupMatches = new Map<string, string[]>()
  for (const m of matches) for (const id of [...((m.lineups as any)?.home ?? []), ...((m.lineups as any)?.away ?? [])] as string[]) lineupMatches.set(id, [...(lineupMatches.get(id) ?? []), m.id])
  return {
    rows: players.map((player) => ({ player, stats: computeStats(by.get(player.id) ?? [], tagName, lineupMatches.get(player.id) ?? []) })),
    tagName,
    tagCategory: new Map(tags.map((t) => [t.id, { name: t.category.name, color: t.category.color, tag: t.name }])),
  }
}

/**
 * Radar axes for `target` against everyone in the database. Counts are per match
 * and scaled to the best player (=100); rate metrics are already 0–100. The
 * "peer average" uses players in the same position group, falling back to all
 * other players when there are no peers — `peers` says which.
 */
export function radarFor(target: Roster, all: Roster[]): { axes: Axis[]; peers: 'position' | 'everyone' | 'none'; peerCount: number; group: string } {
  const per = (r: Roster, m: (typeof METRICS)[number]) => (m.rate ? m.get(r.stats) : m.get(r.stats) / Math.max(1, r.stats.matches))
  const group = positionGroup(target.player)
  const active = all.filter((r) => r.stats.clips > 0)
  let peers = active.filter((r) => r.player.id !== target.player.id && positionGroup(r.player) === group)
  let kind: 'position' | 'everyone' | 'none' = 'position'
  if (peers.length === 0) {
    peers = active.filter((r) => r.player.id !== target.player.id)
    kind = peers.length ? 'everyone' : 'none'
  }
  const axes = METRICS.map((m) => {
    const max = m.rate ? 100 : Math.max(1e-9, ...active.map((r) => per(r, m)), per(target, m))
    const scale = (v: number) => {
      const x = Math.min(100, (v / max) * 100)
      return Math.round(m.invert ? 100 - x : x)
    }
    const avgRaw = peers.length ? peers.reduce((a, r) => a + per(r, m), 0) / peers.length : 0
    return { key: m.key, label: m.label, raw: +per(target, m).toFixed(2), value: scale(per(target, m)), avg: peers.length ? scale(avgRaw) : 0 }
  })
  return { axes, peers: kind, peerCount: peers.length, group }
}
