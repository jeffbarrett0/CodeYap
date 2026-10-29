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
