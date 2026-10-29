import { toast } from 'sonner'
import { create } from 'zustand'
import { newId } from '@/lib/ids'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import type { Clip, Outcome, Player, TagType } from '@/types'
import { createClips, useClips } from './clips'
import { player, usePlayback } from './playback'
import type { Grid } from './zones'
import { zoneCenter } from './zones'

interface TaggingState {
  teamId: string | null
  playerId: string | null
  jersey: number | null
  /** "auto" resolves to the tag's default outcome. */
  outcome: 'auto' | Outcome
  zone: string | null
  grid: Grid
  /** videoId + matchId the next clip attaches to. */
  matchId: string | null
  videoId: string | null
  /** Briefly set to the tag id just pressed, for button flash feedback. */
  flashTagId: string | null
  setTeam: (id: string | null, players: Player[]) => void
  setPlayer: (id: string | null, players: Player[]) => void
  setJersey: (n: number | null) => void
  setOutcome: (o: 'auto' | Outcome) => void
  setZone: (z: string | null) => void
  setGrid: (g: Grid) => void
  init: (matchId: string, videoId: string | null, homeTeamId: string) => void
}

export const useTagging = create<TaggingState>((set, get) => ({
  teamId: null,
  playerId: null,
  jersey: null,
  outcome: 'auto',
  zone: null,
  grid: '3x3',
  matchId: null,
  videoId: null,
  flashTagId: null,
  setTeam: (teamId, players) => {
    const p = players.find((x) => x.id === get().playerId)
    set(p && p.teamId !== teamId ? { teamId, playerId: null, jersey: null } : { teamId })
  },
  setPlayer: (playerId, players) => {
    const p = players.find((x) => x.id === playerId)
    set(p ? { playerId, teamId: p.teamId ?? get().teamId, jersey: p.jersey } : { playerId: null })
  },
  setJersey: (jersey) => set({ jersey }),
  setOutcome: (outcome) => set({ outcome }),
  setZone: (zone) => set({ zone }),
  setGrid: (grid) => set({ grid, zone: null }),
  init: (matchId, videoId, homeTeamId) =>
    set((s) => ({ matchId, videoId, teamId: s.matchId === matchId && s.teamId ? s.teamId : homeTeamId })),
}))

/**
 * Create a clip for `tag` at the current playhead using the sticky tagging
 * context (team / player / jersey / outcome / zone) and the pre/post roll.
 */
export function tagMoment(tag: TagType): Clip | null {
  const ctx = useTagging.getState()
  const { duration } = usePlayback.getState()
  if (!ctx.matchId || duration <= 0) {
    toast.error('Video is not ready yet')
    return null
  }
  const { preRoll, postRoll } = useApp.getState()
  const t = player.currentTime
  let start = Math.max(0, t - preRoll)
  const end = Math.min(duration, Math.max(t + postRoll, start + 1))
  if (end - start < 1) start = Math.max(0, end - 1)
  const at = zoneCenter(ctx.zone)
  const now = new Date().toISOString()
  const clip: Clip = {
    id: newId('c'),
    matchId: ctx.matchId,
    videoId: ctx.videoId,
    tagTypeId: tag.id,
    startSec: +start.toFixed(3),
    endSec: +end.toFixed(3),
    timeSec: +t.toFixed(3),
    playerId: ctx.playerId,
    teamId: ctx.teamId,
    jersey: ctx.jersey,
    outcome: ctx.outcome === 'auto' ? tag.defaultOutcome : ctx.outcome,
    zone: ctx.zone,
    x: at?.x ?? null,
    y: at?.y ?? null,
    endX: null,
    endY: null,
    notes: '',
    labels: [],
    createdById: null,
    createdAt: now,
    updatedAt: now,
  }
  void createClips([clip], `Tag “${tag.name}”`)
  useClips.getState().select([clip.id])
  useTagging.setState({ flashTagId: tag.id })
  setTimeout(() => useTagging.getState().flashTagId === tag.id && useTagging.setState({ flashTagId: null }), 220)
  return clip
}

export const allPlayers = () => useData.getState().players
