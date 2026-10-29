export interface ImportPlayer {
  name: string
  jersey: number | null
  /** Short position code (GK, CB, CM, ST …) when known. */
  position: string | null
  starter: boolean
  country?: string | null
}

export interface ImportTeam {
  name: string
  country?: string | null
  formation?: string | null
  players: ImportPlayer[]
}

export interface MatchPreview {
  source: 'hudl' | 'sofascore' | 'generic'
  sourceUrl: string
  /** YYYY-MM-DD, or null when the page didn't say. */
  date: string | null
  competition: string
  venue: string | null
  homeScore: number | null
  awayScore: number | null
  home: ImportTeam
  away: ImportTeam
  /** Fields the source did not provide — the UI asks the user to fill these in. */
  missing: string[]
}

/** One tagged moment derived from a source event feed. */
export interface ImportClip {
  tag: string
  team: 'home' | 'away'
  playerName: string | null
  period: number
  /** Seconds since the start of `period`. */
  ts: number
  x: number | null
  y: number | null
  endX: number | null
  endY: number | null
  outcome: 'success' | 'fail' | 'neutral'
  notes: string
}

export interface EventsInfo {
  available: boolean
  summary: { tag: string; count: number }[]
  pressureCount: number
  outsideTwoHalves: number
}

export class ImportError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}
