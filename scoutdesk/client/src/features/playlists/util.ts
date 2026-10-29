import { formatClock } from '@/lib/timecode'
import type { Clip, Player, TagType } from '@/types'

export const clipAutoTitle = (c: Clip, tagById: Map<string, TagType>, playerById: Map<string, Player>) =>
  `${tagById.get(c.tagTypeId)?.name ?? 'Clip'}${c.playerId ? ` · ${playerById.get(c.playerId)?.name ?? ''}` : ''}`

export const clipLength = (c: Pick<Clip, 'startSec' | 'endSec'>) => Math.max(0, c.endSec - c.startSec)

export const formatTotal = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : `${formatClock(sec)}`)
export const DRAG_MIME = 'application/x-scoutdesk-clips'
