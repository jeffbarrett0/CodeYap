import { ListPlus, Plus } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { api } from '@/lib/api'
import { usePlaylists } from './usePlaylists'

/** Append clips to an existing playlist (keeping its items) or start a new one. */
export function AddToPlaylistMenu({ clipIds, disabled, size = 'xs', label = 'Add to playlist' }: { clipIds: string[]; disabled?: boolean; size?: 'xs' | 'sm'; label?: string }) {
  const { list, refresh } = usePlaylists()
  useEffect(() => { void refresh().catch(() => {}) }, [refresh])

  const add = async (id: string, title: string) => {
    try {
      const pl = await api.playlist(id)
      await api.putPlaylistItems(id, [...pl.items.map((i) => ({ clipId: i.clip.id, title: i.title, transition: i.transition })), ...clipIds.map((clipId) => ({ clipId, title: null, transition: 'cut' as const }))])
      toast.success(`Added ${clipIds.length} clip${clipIds.length > 1 ? 's' : ''} to “${title}”`)
      void refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add to playlist') }
  }
  const create = async () => {
    const title = prompt('New playlist name', 'New playlist')?.trim()
    if (!title) return
    try {
      await api.createPlaylist(title, clipIds)
      toast.success(`Created “${title}” with ${clipIds.length} clip${clipIds.length > 1 ? 's' : ''}`)
      void refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create playlist') }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="secondary" size={size} disabled={disabled || clipIds.length === 0}><ListPlus className="h-3 w-3" /> {label}</Button></DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel>Playlists</DropdownMenuLabel>
        {list.length === 0 && <p className="px-2 pb-1 text-xs text-muted">No playlists yet.</p>}
        {list.map((p) => <DropdownMenuItem key={p.id} onSelect={() => void add(p.id, p.title)}><span className="flex-1 truncate">{p.title}</span><span className="timecode text-2xs text-muted">{p.itemCount}</span></DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void create()}><Plus className="h-3.5 w-3.5" /> New playlist…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
