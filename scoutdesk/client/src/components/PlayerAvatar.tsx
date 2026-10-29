import { cn, initials } from '@/lib/utils'
import type { Player } from '@/types'

export function PlayerAvatar({ player, size = 28, color, className }: { player: Pick<Player, 'name' | 'photoUrl'>; size?: number; color?: string; className?: string }) {
  return player.photoUrl ? (
    <img src={player.photoUrl} alt="" width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-muted', className)} style={{ width: size, height: size, fontSize: size * 0.38, boxShadow: color ? `inset 0 0 0 2px ${color}` : undefined }}>
      {initials(player.name)}
    </span>
  )
}
