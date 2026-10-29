import { ArrowDown, ArrowUp, Download, Film, GripVertical, PanelRightClose, PanelRightOpen, Plus, Share2, Trash2, Waves, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/misc'
import { Tip } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useHotkeys } from '@/lib/hotkeys'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useCan, useLookups } from '@/store/hooks'
import { useExports } from '@/store/exports'
import type { Clip, Playlist, PlaylistDraftItem } from '@/types'
import { ShareDialog } from '../share/ShareDialog'
import { ClipBrowser } from './ClipBrowser'
import { PlaylistPlayer, type PlayItem } from './PlaylistPlayer'
import { usePlaylists } from './usePlaylists'
import { DRAG_MIME, clipAutoTitle, clipLength, formatTotal } from './util'

let keySeq = 0
const mkKey = () => `pi${++keySeq}`

export function PlaylistBuilder({ id }: { id: string }) {
  const { canWrite } = useCan()
  const { tagById, playerById, matchById, teamById } = useLookups()
  const navigate = useNavigate()
  const refreshList = usePlaylists((s) => s.refresh)
  const startExport = useExports((s) => s.start)
  const [pl, setPl] = useState<Playlist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<PlaylistDraftItem[]>([])
  const [clipById, setClipById] = useState<Map<string, Clip>>(new Map())
  const [index, setIndex] = useState(0)
  const [library, setLibrary] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [dropAt, setDropAt] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const latest = useRef(items)
  latest.current = items

  const apply = useCallback((p: Playlist) => {
    setPl(p)
    setLibrary(p.items.length === 0)
    setClipById((m) => { const n = new Map(m); for (const i of p.items) n.set(i.clip.id, i.clip); return n })
    setItems(p.items.map((i) => ({ key: mkKey(), clipId: i.clip.id, title: i.title, transition: i.transition })))
  }, [])

  useEffect(() => {
    api.playlist(id).then(apply).catch((e) => setError(e instanceof Error ? e.message : 'Could not load playlist'))
  }, [id, apply])

  const flush = useCallback(async () => {
    setSaving('saving')
    try {
      const p = await api.putPlaylistItems(id, latest.current.map((i) => ({ clipId: i.clipId, title: i.title, transition: i.transition })))
      setPl(p)
      setClipById((m) => { const n = new Map(m); for (const i of p.items) n.set(i.clip.id, i.clip); return n })
      setSaving('saved')
      void refreshList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save playlist')
      setSaving('idle')
    }
  }, [id, refreshList])

  /** Apply an edit locally, then save (debounced so rapid drags/edits send once). */
  const edit = useCallback((next: PlaylistDraftItem[]) => {
    setItems(next)
    latest.current = next
    setSaving('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), 350)
  }, [flush])
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); void flush() } }, [flush])

  // Clips added from the library may not be in the cache yet → fetch them for display.
  const ensureClips = useCallback(async (ids: string[]) => {
    const missing = ids.filter((c) => !clipById.has(c))
    if (!missing.length) return
    const all: Clip[] = await fetch('/api/clips').then((r) => r.json())
    setClipById((m) => { const n = new Map(m); for (const c of all) n.set(c.id, c); return n })
  }, [clipById])

  const addClips = useCallback(async (ids: string[], at?: number) => {
    await ensureClips(ids)
    const add = ids.map((clipId) => ({ key: mkKey(), clipId, title: null, transition: 'cut' as const }))
    const pos = at ?? latest.current.length
    edit([...latest.current.slice(0, pos), ...add, ...latest.current.slice(pos)])
  }, [edit, ensureClips])

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return
    const next = [...items]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m!)
    edit(next)
    setIndex((i) => (i === from ? to : i))
  }

  const playItems = useMemo<PlayItem[]>(() => items.flatMap((it) => {
    const c = clipById.get(it.clipId)
    if (!c) return []
    const m = matchById.get(c.matchId)
    return [{ id: it.key, title: it.title || clipAutoTitle(c, tagById, playerById), subtitle: m ? `${teamById.get(m.homeTeamId)?.shortName} v ${teamById.get(m.awayTeamId)?.shortName} · ${formatClock(c.timeSec)}` : undefined, videoId: c.videoId, start: c.startSec, end: c.endSec, transition: it.transition }]
  }), [items, clipById, matchById, tagById, playerById, teamById])
  const safeIndex = Math.min(index, Math.max(0, playItems.length - 1))

  useHotkeys([
    { combo: 'space', description: 'Play / pause playlist', group: 'Playlist', handler: () => window.dispatchEvent(new Event('scoutdesk:playlist-toggle')) },
    { combo: '.', description: 'Next clip in playlist', group: 'Playlist', handler: () => setIndex((i) => Math.min(items.length - 1, i + 1)) },
    { combo: ',', description: 'Previous clip in playlist', group: 'Playlist', handler: () => setIndex((i) => Math.max(0, i - 1)) },
  ])

  if (error) return <EmptyState icon={Film} title="Playlist not found" description={error} className="h-full" action={<Button onClick={() => navigate('/playlists')}>Back to playlists</Button>} />
  if (!pl) return <div className="flex h-full items-center justify-center"><Spinner /></div>
  const total = items.reduce((a, i) => a + clipLength(clipById.get(i.clipId) ?? { startSec: 0, endSec: 0 }), 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <input
          aria-label="Playlist title" defaultValue={pl.title} disabled={!canWrite}
          onBlur={(e) => { const t = e.target.value.trim(); if (t && t !== pl.title) void api.patchPlaylist(id, { title: t }).then((p) => { setPl({ ...pl, title: p.title }); void refreshList() }); else e.target.value = pl.title }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
          className="min-w-0 max-w-sm flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold hover:border-border focus:border-accent focus:outline-none"
        />
        <span className="timecode text-xs text-muted">{items.length} clip{items.length === 1 ? '' : 's'} · {formatTotal(total)}</span>
        <span className="text-2xs text-muted" role="status">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" disabled={!canWrite || items.length === 0} onClick={async () => { await flush(); void startExport('playlist', id, pl.title) }}><Download className="h-3.5 w-3.5" /> Export MP4</Button>
          <Button size="sm" disabled={!canWrite} onClick={() => setSharing(true)}><Share2 className="h-3.5 w-3.5" /> Share</Button>
          <Button size="sm" variant="danger" disabled={!canWrite} onClick={async () => { if (!confirm(`Delete “${pl.title}”? The clips themselves are kept.`)) return; await api.deletePlaylist(id); await refreshList(); navigate('/playlists') }} aria-label="Delete playlist"><Trash2 className="h-3.5 w-3.5" /></Button>
          <Tip label={library ? 'Hide clip library' : 'Show clip library'}><Button size="icon" variant="ghost" aria-label="Toggle clip library" aria-pressed={library} onClick={() => setLibrary((l) => !l)}>{library ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button></Tip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Playlist items" className="flex w-[320px] shrink-0 flex-col border-r border-border"
          onDragOver={(e) => { if (!canWrite) return; e.preventDefault() }}
          onDrop={(e) => {
            e.preventDefault()
            const at = dropAt ?? items.length
            setDropAt(null)
            const raw = e.dataTransfer.getData(DRAG_MIME)
            if (raw) void addClips(JSON.parse(raw) as string[], at)
            else if (dragFrom.current != null) { move(dragFrom.current, at > dragFrom.current ? at - 1 : at); dragFrom.current = null }
          }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null) }}
        >
          {items.length === 0 ? (
            <EmptyState icon={Plus} title="Drag clips here" description="Drag rows from the clip library, or use the + buttons. You can also add clips from any match’s clip list." className="flex-1" />
          ) : (
            <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {items.map((it, i) => {
                const c = clipById.get(it.clipId)
                const active = i === safeIndex
                return (
                  <li key={it.key}>
                    {i > 0 && (
                      <div className="flex items-center justify-center py-0.5">
                        <button type="button" disabled={!canWrite} onClick={() => edit(items.map((x, j) => (j === i ? { ...x, transition: x.transition === 'cut' ? 'fade' : 'cut' } : x)))} aria-label={`Transition into clip ${i + 1}: ${it.transition}. Click to toggle`} className={cn('flex items-center gap-1 rounded-full border px-2 py-px text-2xs transition-colors', it.transition === 'fade' ? 'border-accent/50 text-accent' : 'border-transparent text-muted hover:border-border')}>
                          <Waves className="h-2.5 w-2.5" /> {it.transition === 'fade' ? 'Fade' : 'Cut'}
                        </button>
                      </div>
                    )}
                    {dropAt === i && <div className="mx-1 h-0.5 rounded bg-accent" aria-hidden />}
                    <div
                      draggable={canWrite}
                      onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                      onDragEnd={() => { dragFrom.current = null; setDropAt(null) }}
                      onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1) }}
                      onClick={() => setIndex(i)}
                      className={cn('group flex cursor-pointer items-center gap-1.5 rounded border px-1.5 py-1.5 text-xs', active ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-raised/60')}
                      aria-current={active}
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted" aria-hidden />
                      <span className="timecode w-5 text-right text-2xs text-muted">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <input
                          aria-label={`Title for clip ${i + 1}`} disabled={!canWrite} placeholder={c ? clipAutoTitle(c, tagById, playerById) : 'Clip'} defaultValue={it.title ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => { const t = e.target.value.trim() || null; if (t !== it.title) edit(items.map((x, j) => (j === i ? { ...x, title: t } : x))) }}
                          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-xs font-medium placeholder:text-foreground hover:bg-background focus:bg-background focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <p className="truncate px-1 text-2xs text-muted">{c ? `${matchById.get(c.matchId) ? `${teamById.get(matchById.get(c.matchId)!.homeTeamId)?.shortName} v ${teamById.get(matchById.get(c.matchId)!.awayTeamId)?.shortName} · ` : ''}${formatClock(c.timeSec)} · ${clipLength(c).toFixed(0)}s` : 'Loading…'}</p>
                      </div>
                      <div className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <Button variant="ghost" size="icon-sm" aria-label={`Move clip ${i + 1} up`} disabled={!canWrite || i === 0} onClick={(e) => (e.stopPropagation(), move(i, i - 1))}><ArrowUp className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Move clip ${i + 1} down`} disabled={!canWrite || i === items.length - 1} onClick={(e) => (e.stopPropagation(), move(i, i + 1))}><ArrowDown className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove clip ${i + 1}`} disabled={!canWrite} onClick={(e) => (e.stopPropagation(), edit(items.filter((_, j) => j !== i)))}><X className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  </li>
                )
              })}
              {dropAt === items.length && <div className="mx-1 mt-1 h-0.5 rounded bg-accent" aria-hidden />}
            </ol>
          )}
        </section>

        <div className="min-w-0 flex-1">
          <PlaylistPlayer className="h-full" items={playItems} videos={pl.videos} index={safeIndex} onIndexChange={setIndex} />
        </div>

        {library && (
          <aside className="w-[340px] shrink-0 border-l border-border" aria-label="Clip library panel">
            <div className="flex h-8 items-center border-b border-border px-3"><span className="label">Clip library</span></div>
            <div className="h-[calc(100%-2rem)]"><ClipBrowser canWrite={canWrite} onAdd={(ids) => void addClips(ids)} /></div>
          </aside>
        )}
      </div>
      {sharing && <ShareDialog kind="playlist" refId={id} label={pl.title} onClose={() => setSharing(false)} />}
    </div>
  )
}
