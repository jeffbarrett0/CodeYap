import { Film, LayoutGrid, List, Search, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/pages/Placeholder'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { useCan, useLookups } from '@/store/hooks'
import type { Video } from '@/types'
import { UploadDialog } from './UploadDialog'
import { VideoCard, VideoRow, type VideoActions } from './VideoCard'

type StatusFilter = 'all' | Video['status']
type Sort = 'newest' | 'title' | 'duration'

export function LibraryPage() {
  const { videos, status, upsertVideo, removeVideo, matches } = useData()
  const { matchById, teamById } = useLookups()
  const contextTeamId = useApp((s) => s.contextTeamId)
  const { canWrite, isAdmin } = useCan()

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [renaming, setRenaming] = useState<Video | null>(null)
  const [attaching, setAttaching] = useState<Video | null>(null)
  const [deleting, setDeleting] = useState<Video | null>(null)

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = videos.filter((v) => {
      if (statusFilter !== 'all' && v.status !== statusFilter) return false
      const m = v.matchId ? matchById.get(v.matchId) : undefined
      if (contextTeamId && !(m && (m.homeTeamId === contextTeamId || m.awayTeamId === contextTeamId))) return false
      if (!needle) return true
      const hay = [v.title, v.angle, ...v.tags, teamById.get(m?.homeTeamId ?? '')?.name, teamById.get(m?.awayTeamId ?? '')?.name, m?.competition].join(' ').toLowerCase()
      return hay.includes(needle)
    })
    return [...list].sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title) : sort === 'duration' ? b.durationSec - a.durationSec : +new Date(b.createdAt) - +new Date(a.createdAt),
    )
  }, [videos, q, statusFilter, sort, contextTeamId, matchById, teamById])

  const actions: VideoActions = { rename: setRenaming, attach: setAttaching, remove: setDeleting, canWrite, isAdmin }
  const processing = videos.filter((v) => v.status === 'processing').length

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Library"
        subtitle={`${videos.length} video${videos.length === 1 ? '' : 's'}${processing ? ` · ${processing} processing` : ''}`}
        actions={
          <Button variant="primary" size="sm" disabled={!canWrite} onClick={() => setUploadOpen(true)} title={canWrite ? undefined : 'Viewers cannot upload'}>
            <Upload className="h-3.5 w-3.5" /> Upload video
          </Button>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative w-64">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
          <Input aria-label="Filter videos" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, team, tag…" className="h-7 pl-8 text-xs" />
        </div>
        <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="h-7 w-32 text-xs">
          <option value="all">All statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-7 w-32 text-xs">
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
          <option value="duration">Longest first</option>
        </Select>
        <Segmented ariaLabel="View" className="ml-auto" value={view} onChange={setView} options={[
          { value: 'grid', label: <LayoutGrid className="h-3.5 w-3.5" />, title: 'Grid view' },
          { value: 'list', label: <List className="h-3.5 w-3.5" />, title: 'List view' },
        ]} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {status === 'loading' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[4/3]" />)}
          </div>
        ) : videos.length === 0 ? (
          <EmptyState
            icon={Film}
            title="No videos yet"
            description="Upload a match video to start tagging moments, building playlists and analysing players."
            action={canWrite ? <Button variant="primary" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> Upload your first video</Button> : undefined}
          />
        ) : visible.length === 0 ? (
          <EmptyState icon={Search} title="No videos match your filters" action={<Button onClick={() => (setQ(''), setStatusFilter('all'))}>Clear filters</Button>} />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {visible.map((v) => <VideoCard key={v.id} v={v} a={actions} />)}
          </div>
        ) : (
          <div className="panel overflow-hidden">{visible.map((v) => <VideoRow key={v.id} v={v} a={actions} />)}</div>
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      {renaming && <RenameDialog video={renaming} onClose={() => setRenaming(null)} onSaved={upsertVideo} />}

      {attaching && (
        <AttachDialog video={attaching} onClose={() => setAttaching(null)} onSaved={async (v) => {
          upsertVideo(v)
          await useData.getState().refreshMatches()
        }} matches={matches} />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent title="Delete video?" description="The file and thumbnail are removed from storage. Clips tagged on it are kept but lose their video link." className="max-w-md">
          <DialogBody><p className="text-xs">“{deleting?.title}”</p></DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => {
              if (!deleting) return
              try {
                await api.deleteVideo(deleting.id)
                removeVideo(deleting.id)
                void useData.getState().refreshMatches()
                toast.success('Video deleted')
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Delete failed')
              }
              setDeleting(null)
            }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RenameDialog({ video, onClose, onSaved }: { video: Video; onClose: () => void; onSaved: (v: Video) => void }) {
  const [title, setTitle] = useState(video.title)
  const save = async () => {
    try {
      onSaved(await api.patchVideo(video.id, { title: title.trim() || video.title }))
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rename failed')
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename video" className="max-w-md">
        <DialogBody>
          <Field label="Title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} /></Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AttachDialog({ video, matches, onClose, onSaved }: { video: Video; matches: ReturnType<typeof useData.getState>['matches']; onClose: () => void; onSaved: (v: Video) => Promise<void> }) {
  const { teamById } = useLookups()
  const [matchId, setMatchId] = useState(video.matchId ?? '')
  const save = async () => {
    try {
      await onSaved(await api.patchVideo(video.id, { matchId: matchId || null }))
      toast.success(matchId ? 'Attached to match' : 'Detached from match')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Attach to match" description={video.title} className="max-w-md">
        <DialogBody>
          <Field label="Match">
            <Select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">Unassigned</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>{teamById.get(m.homeTeamId)?.name} v {teamById.get(m.awayTeamId)?.name} · {formatDate(m.date)}</option>
              ))}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
