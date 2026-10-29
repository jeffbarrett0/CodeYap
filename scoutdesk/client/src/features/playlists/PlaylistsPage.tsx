import { ListVideo, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/pages/Placeholder'
import { useCan } from '@/store/hooks'
import { PlaylistBuilder } from './PlaylistBuilder'
import { usePlaylists } from './usePlaylists'
import { formatTotal } from './util'

export function PlaylistsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { list, loaded, refresh } = usePlaylists()
  const { canWrite } = useCan()
  const [creating, setCreating] = useState(false)
  useEffect(() => { void refresh().catch(() => {}) }, [refresh, id])

  const create = async () => {
    const title = prompt('Playlist name', 'New playlist')?.trim()
    if (!title) return
    setCreating(true)
    try {
      const p = await api.createPlaylist(title)
      await refresh()
      navigate(`/playlists/${p.id}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create playlist') } finally { setCreating(false) }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Playlists" subtitle={loaded ? `${list.length} playlist${list.length === 1 ? '' : 's'}` : undefined} actions={<Button variant="primary" size="sm" disabled={!canWrite || creating} onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> New playlist</Button>} />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Playlists" className="w-64 shrink-0 overflow-y-auto border-r border-border p-2">
          {!loaded ? <div className="space-y-1">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : list.length === 0 ? <p className="p-3 text-center text-xs text-muted">No playlists yet.</p> : (
            <ul className="space-y-0.5">
              {list.map((p) => (
                <li key={p.id}>
                  <NavLink to={`/playlists/${p.id}`} className={({ isActive }) => cn('block rounded px-2.5 py-2 text-xs transition-colors hover:bg-raised/60', isActive && 'bg-raised')}>
                    <span className="block truncate font-medium">{p.title}</span>
                    <span className="timecode text-2xs text-muted">{p.itemCount} clip{p.itemCount === 1 ? '' : 's'} · {formatTotal(p.durationSec)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="min-w-0 flex-1">
          {id ? <PlaylistBuilder key={id} id={id} /> : <EmptyState icon={ListVideo} title={list.length ? 'Select a playlist' : 'Build your first playlist'} description="Collect clips from any match, order them, add titles and transitions, play them back-to-back, export an MP4 or share a read-only link." className="h-full" action={canWrite && list.length === 0 ? <Button variant="primary" onClick={() => void create()}>New playlist</Button> : undefined} />}
        </div>
      </div>
    </div>
  )
}
