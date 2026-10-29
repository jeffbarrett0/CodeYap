export type Role = 'admin' | 'analyst' | 'viewer'
export type Outcome = 'success' | 'fail' | 'neutral'
export type TagStatus = 'untagged' | 'in_progress' | 'complete'
export type VideoStatus = 'processing' | 'ready' | 'failed'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  color: string
}

export interface Team {
  id: string
  name: string
  shortName: string
  color: string
  isOwn: boolean
  country: string | null
  formation: string
  notes: string
}

export interface Player {
  id: string
  name: string
  photoUrl: string | null
  jersey: number | null
  positions: string[]
  foot: 'left' | 'right' | 'both' | null
  heightCm: number | null
  age: number | null
  nationality: string | null
  notes: string
  teamId: string | null
}

export interface Match {
  id: string
  date: string
  competition: string
  venue: string | null
  homeTeamId: string
  awayTeamId: string
  homeScore: number | null
  awayScore: number | null
  tagStatus: TagStatus
  lineups: { home: string[]; away: string[] }
  notes: string
  clipCount: number
  videoCount: number
}

export interface Video {
  id: string
  title: string
  originalName: string
  mimeType: string
  sizeBytes: number
  durationSec: number
  fps: number
  width: number
  height: number
  status: VideoStatus
  error: string | null
  angle: string
  syncOffset: number
  tags: string[]
  matchId: string | null
  createdAt: string
  streamUrl: string
  thumbnailUrl: string | null
}

export interface TagType {
  id: string
  categoryId: string
  name: string
  hotkey: string | null
  defaultOutcome: Outcome
  sortOrder: number
}

export interface Category {
  id: string
  name: string
  color: string
  sortOrder: number
  tagTypes: TagType[]
}

export interface Clip {
  id: string
  matchId: string
  videoId: string | null
  tagTypeId: string
  startSec: number
  endSec: number
  timeSec: number
  playerId: string | null
  teamId: string | null
  jersey: number | null
  outcome: Outcome
  zone: string | null
  x: number | null
  y: number | null
  endX: number | null
  endY: number | null
  notes: string
  labels: string[]
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export type ClipPatch = Partial<Omit<Clip, 'id' | 'matchId' | 'createdAt' | 'updatedAt' | 'createdById'>>

export interface PlaylistSummary {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  itemCount: number
  durationSec: number
}
export interface PlaylistItem {
  id: string
  position: number
  title: string | null
  transition: 'cut' | 'fade'
  clip: Clip
}
export interface Playlist {
  id: string
  title: string
  description: string
  durationSec: number
  items: PlaylistItem[]
  videos: Video[]
}
/** Editable item shape (clip id + overrides) sent to PUT /playlists/:id/items. */
export interface PlaylistDraftItem {
  key: string
  clipId: string
  title: string | null
  transition: 'cut' | 'fade'
}

export interface ExportJob {
  id: string
  kind: 'clip' | 'playlist'
  refId: string
  label: string
  status: 'queued' | 'running' | 'done' | 'failed'
  progress: number
  error: string | null
  fileName: string | null
  sizeBytes: number
  createdAt: string
  finishedAt: string | null
  downloadUrl: string | null
}

export interface ShareLink {
  id: string
  token: string
  kind: 'playlist' | 'match'
  refId: string
  label: string
  hasPassword: boolean
  expiresAt: string | null
  createdAt: string
  views: number
}

export interface CommentAuthor {
  id: string
  name: string
  color: string
  role: Role
}
export interface ClipComment {
  id: string
  clipId: string
  parentId: string | null
  author: CommentAuthor
  body: string
  createdAt: string
}

export interface Snapshot {
  id: string
  matchId: string | null
  videoId: string | null
  clipId: string | null
  playerId: string | null
  timeSec: number
  caption: string
  createdAt: string
  url: string
}

export interface DisplayClip {
  id: string
  matchId: string
  videoId: string | null
  startSec: number
  endSec: number
  timeSec: number
  tag: string
  category: string
  color: string
  player: string | null
  jersey: number | null
  team: string | null
  outcome: Outcome
  notes: string
  labels: string[]
  zone: string | null
  x: number | null
  y: number | null
  endX: number | null
  endY: number | null
}

export interface Stats {
  matches: number; clips: number; goals: number; shots: number; shotsOnTarget: number
  passesAttempted: number; passesCompleted: number; passAccuracy: number | null; keyPasses: number
  dribblesAttempted: number; dribblesWon: number; tackles: number; tacklesWon: number
  interceptions: number; blocks: number; duelsWon: number; duelsLost: number; duelsWonPct: number | null
  pressures: number; recoveries: number; errors: number; lostPossession: number; fouls: number; cards: number
}
export interface RadarAxis {
  key: string
  label: string
  raw: number
  value: number
  avg: number
}
export interface PlayerProfile {
  player: Player
  stats: Stats
  radar: { axes: RadarAxis[]; peers: 'position' | 'everyone' | 'none'; peerCount: number; group: string }
  clips: DisplayClip[]
  matches: { id: string; date: string; competition: string; homeTeamId: string; awayTeamId: string; homeScore: number | null; awayScore: number | null }[]
  definitions: Record<string, string>
}

export type SharePayload =
  | { kind: 'playlist'; label: string; title: string; description: string; expiresAt: string | null; videos: Video[]; items: { id: string; title: string | null; transition: 'cut' | 'fade'; clip: DisplayClip }[] }
  | { kind: 'match'; label: string; expiresAt: string | null; match: { id: string; date: string; competition: string; home: string; away: string; homeScore: number | null; awayScore: number | null }; videos: Video[]; clips: DisplayClip[] }

export interface ImportPlayer { name: string; jersey: number | null; position: string | null; starter: boolean; country?: string | null }
export interface ImportTeam { name: string; country?: string | null; formation?: string | null; players: ImportPlayer[] }
export interface MatchPreview {
  source: 'hudl' | 'sofascore' | 'generic'
  sourceUrl: string
  date: string | null
  competition: string
  venue: string | null
  homeScore: number | null
  awayScore: number | null
  home: ImportTeam
  away: ImportTeam
  missing: string[]
}
export interface EventsInfo { available: boolean; summary: { tag: string; count: number }[]; pressureCount: number; outsideTwoHalves: number }
export type ImportPreviewResponse = { kind: 'preview'; previewId: string; preview: MatchPreview; events: EventsInfo } | { kind: 'browse'; competitionId?: number; seasonId?: number }
export interface ImportResult { matchId: string; createdTeams: string[]; createdPlayers: number; matchedPlayers: number; clipsCreated: number; clipsSkipped: number; unknownTags: string[] }
export interface HudlCompetition { competitionId: number; seasonId: number; name: string; season: string; country: string; gender: string }
export interface HudlMatch { matchId: number; date: string; home: string; away: string; homeScore: number | null; awayScore: number | null; stage: string | null }
