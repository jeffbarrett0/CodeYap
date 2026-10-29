import { AlertTriangle, Film, Link2, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Badge, Dot, Spinner } from '@/components/ui/misc'
import { formatDuration } from '@/lib/timecode'
import { cn, formatBytes, formatDate } from '@/lib/utils'
import { useLookups } from '@/store/hooks'
import type { Video } from '@/types'

export interface VideoActions {
  rename: (v: Video) => void
  attach: (v: Video) => void
  remove: (v: Video) => void
  canWrite: boolean
  isAdmin: boolean
}

function useVideoMeta(v: Video) {
  const { matchById, teamById } = useLookups()
  const match = v.matchId ? matchById.get(v.matchId) : undefined
  return { match, home: match && teamById.get(match.homeTeamId), away: match && teamById.get(match.awayTeamId) }
}

function Status({ v }: { v: Video }) {
  if (v.status === 'processing')
    return (
      <Badge className="border-warning/40 bg-background/80 text-warning backdrop-blur" >
        <Spinner className="h-3 w-3 text-warning" /> Processing
      </Badge>
    )
  if (v.status === 'failed')
    return (
      <Badge className="border-danger/40 bg-background/80 text-danger backdrop-blur" >
        <AlertTriangle className="h-3 w-3" /> Failed
      </Badge>
    )
  return null
}

function Menu({ v, a }: { v: Video; a: VideoActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${v.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {v.matchId && (
          <DropdownMenuItem asChild>
            <Link to={`/match/${v.matchId}`}><Play className="h-3.5 w-3.5" /> Open analysis</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!a.canWrite} onSelect={() => a.rename(v)}><Pencil className="h-3.5 w-3.5" /> Rename…</DropdownMenuItem>
        <DropdownMenuItem disabled={!a.canWrite} onSelect={() => a.attach(v)}><Link2 className="h-3.5 w-3.5" /> {v.matchId ? 'Change match…' : 'Attach to match…'}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger disabled={!a.isAdmin} onSelect={() => a.remove(v)}><Trash2 className="h-3.5 w-3.5" /> Delete{!a.isAdmin && ' (admin)'}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MatchLine({ v }: { v: Video }) {
  const { match, home, away } = useVideoMeta(v)
  if (!match || !home || !away) return <span className="text-xs text-muted">Not attached to a match</span>
  return (
    <Link to={`/match/${match.id}`} className="flex min-w-0 items-center gap-1.5 text-xs hover:text-accent">
      <Dot color={home.color} />
      <span className="truncate">{home.shortName}</span>
      <span className="timecode text-muted">{match.homeScore ?? '–'}–{match.awayScore ?? '–'}</span>
      <Dot color={away.color} />
      <span className="truncate">{away.shortName}</span>
      <span className="truncate text-muted">· {formatDate(match.date)}</span>
    </Link>
  )
}

export function VideoCard({ v, a }: { v: Video; a: VideoActions }) {
  const open = v.matchId && v.status === 'ready' ? `/match/${v.matchId}` : undefined
  const thumb = (
    <div className="relative aspect-video overflow-hidden bg-background">
      {v.thumbnailUrl ? (
        <img src={v.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="flex h-full items-center justify-center text-muted"><Film className="h-8 w-8 opacity-40" /></div>
      )}
      <div className="absolute left-2 top-2"><Status v={v} /></div>
      {v.durationSec > 0 && <span className="timecode absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-2xs font-medium text-white">{formatDuration(v.durationSec)}</span>}
      {open && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-9 w-9 fill-white text-white" />
        </span>
      )}
    </div>
  )
  return (
    <article className="group panel overflow-hidden transition-colors hover:border-muted/50">
      {open ? <Link to={open} aria-label={`Open ${v.title}`}>{thumb}</Link> : thumb}
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-xs font-semibold leading-snug" title={v.title}>{v.title}</h3>
          <Menu v={v} a={a} />
        </div>
        <MatchLine v={v} />
        {v.status === 'failed' && <p className="text-2xs text-danger">{v.error ?? 'Processing failed'}</p>}
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted')}>
          <span>{v.angle}</span>
          {v.width > 0 && <span>· {v.width}×{v.height}</span>}
          {v.status === 'ready' && v.fps > 0 && <span className="timecode">· {+v.fps.toFixed(2)} fps</span>}
          <span>· {formatBytes(v.sizeBytes)}</span>
        </div>
        {v.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {v.tags.map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
        )}
      </div>
    </article>
  )
}

export function VideoRow({ v, a }: { v: Video; a: VideoActions }) {
  const open = v.matchId && v.status === 'ready' ? `/match/${v.matchId}` : undefined
  return (
    <div className="grid grid-cols-[72px_1fr_auto_auto_auto_32px] items-center gap-3 border-b border-border px-3 py-1.5 text-xs last:border-0 hover:bg-raised/40">
      <div className="aspect-video overflow-hidden rounded-sm bg-background">
        {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Film className="h-4 w-4 text-muted opacity-50" /></div>}
      </div>
      <div className="min-w-0">
        {open ? <Link to={open} className="block truncate font-medium hover:text-accent">{v.title}</Link> : <span className="block truncate font-medium">{v.title}</span>}
        <MatchLine v={v} />
      </div>
      <Status v={v} />
      <span className="timecode w-14 text-right text-muted">{formatDuration(v.durationSec)}</span>
      <span className="w-16 text-right text-muted">{formatBytes(v.sizeBytes)}</span>
      <Menu v={v} a={a} />
    </div>
  )
}
