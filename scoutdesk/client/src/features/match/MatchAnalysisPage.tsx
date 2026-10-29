import { AlertTriangle, CalendarX, Film, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UploadDialog } from '@/features/library/UploadDialog'
import { useHotkeys, type Binding } from '@/lib/hotkeys'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useCan } from '@/store/hooks'
import type { Clip } from '@/types'
import { ClipInspector } from './ClipInspector'
import { ClipTable } from './ClipTable'
import { EventLog } from './EventLog'
import { PitchView } from './PitchView'
import { TaggingPanel } from './TaggingPanel'
import { Timeline } from './Timeline'
import { VideoPlayer } from './VideoPlayer'
import { deleteClips, patchClips, useClips } from './clips'
import { useAngles } from './angles'
import { useDrawing } from './drawing'
import { useFilters } from './filters'
import { useHistory } from './history'
import { player, usePlayback } from './playback'
import { useTagging } from './tagging'
import { useVisibleClips } from './visible'

function Handle({ dir }: { dir: 'h' | 'v' }) {
  return (
    <PanelResizeHandle
      className={cn('group relative shrink-0 bg-border transition-colors data-[resize-handle-state=drag]:bg-accent data-[resize-handle-state=hover]:bg-accent/60', dir === 'h' ? 'h-px w-full' : 'h-full w-px')}
    >
      <span className={cn('absolute z-20', dir === 'h' ? '-top-1 left-0 h-2 w-full cursor-row-resize' : '-left-1 top-0 h-full w-2 cursor-col-resize')} />
    </PanelResizeHandle>
  )
}

export function MatchAnalysisPage() {
  const { matchId = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const match = useData((s) => s.matches.find((m) => m.id === matchId))
  const allVideos = useData((s) => s.videos)
  const { canWrite } = useCan()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [rightTab, setRightTab] = useState('tag')
  const [bottomTab, setBottomTab] = useState('clips')

  const videos = useMemo(() => allVideos.filter((v) => v.matchId === matchId), [allVideos, matchId])
  const primaryId = useAngles((s) => s.primaryId)
  const secondaryId = useAngles((s) => s.secondaryId)
  const readyVideos = useMemo(() => videos.filter((v) => v.status === 'ready'), [videos])
  const video = useMemo(() => readyVideos.find((v) => v.id === primaryId) ?? readyVideos.find((v) => v.angle === 'Main') ?? readyVideos[0], [readyVideos, primaryId])
  const secondary = useMemo(() => (secondaryId && secondaryId !== video?.id ? readyVideos.find((v) => v.id === secondaryId) ?? null : null), [readyVideos, secondaryId, video?.id])
  const processing = videos.some((v) => v.status === 'processing')
  const failed = videos.length > 0 && videos.every((v) => v.status === 'failed')

  const clipStatus = useClips((s) => s.status)
  const clipTotal = useClips((s) => s.clips.length)
  const duration = usePlayback((s) => s.duration)
  const ready = usePlayback((s) => s.ready)
  const { ids: visibleIds, list: visibleList } = useVisibleClips()

  // Load clips for this match; reset transient state when leaving ────────────
  useEffect(() => {
    if (!matchId) return
    useHistory.getState().clear()
    useAngles.getState().reset()
    useDrawing.setState({ shapes: [], active: false })
    void useClips.getState().load(matchId)
    return () => {
      useClips.getState().reset()
      useFilters.getState().clear()
      useHistory.getState().clear()
    }
  }, [matchId])

  useEffect(() => {
    if (match) useTagging.getState().init(match.id, video?.id ?? null, match.homeTeamId)
  }, [match, video?.id])

  // Deep links: ?tag=<tagTypeId>  ?clip=<clipId>  ?t=<seconds> ──────────────
  const [linked, setLinked] = useState(false)
  useEffect(() => {
    if (linked || clipStatus !== 'ready' || !ready) return
    const tag = search.get('tag')
    const clipId = search.get('clip')
    const t = Number(search.get('t'))
    if (tag) useFilters.getState().setFilters({ tagTypeIds: [tag] })
    const clip = clipId ? useClips.getState().clips.find((c) => c.id === clipId) : undefined
    if (clip) {
      useClips.getState().select([clip.id])
      player.seek(clip.startSec)
    } else if (t > 0) player.seek(t)
    if (tag || clipId || t) setSearch({}, { replace: true })
    setLinked(true)
  }, [linked, clipStatus, ready, search, setSearch])

  const playClip = useCallback((c: Clip) => player.playRange(c.id, c.startSec, c.endSec), [])

  const jump = useCallback((dir: 1 | -1) => {
    const t = player.currentTime
    const list = visibleList
    const target = dir === 1 ? list.find((c) => c.timeSec > t + 0.05) : [...list].reverse().find((c) => c.timeSec < t - 0.05)
    if (!target) return
    useClips.getState().select([target.id])
    player.skip(0)
    player.seek(target.startSec)
  }, [visibleList])

  // Hotkeys ──────────────────────────────────────────────────────────────────
  const drawing = useDrawing((s) => s.active)
  const bindings: Binding[] = [
    { combo: 'space', description: 'Play / pause', group: 'Playback', handler: () => player.toggle() },
    { combo: 'left', description: 'Previous frame', group: 'Playback', repeat: true, handler: () => player.stepFrames(-1) },
    { combo: 'right', description: 'Next frame', group: 'Playback', repeat: true, handler: () => player.stepFrames(1) },
    { combo: 'shift+left', description: 'Back 5 seconds', group: 'Playback', repeat: true, handler: () => player.skip(-5) },
    { combo: 'shift+right', description: 'Forward 5 seconds', group: 'Playback', repeat: true, handler: () => player.skip(5) },
    { combo: 'alt+left', description: 'Back 10 seconds', group: 'Playback', repeat: true, handler: () => player.skip(-10) },
    { combo: 'alt+right', description: 'Forward 10 seconds', group: 'Playback', repeat: true, handler: () => player.skip(10) },
    { combo: '[', description: 'Slower', group: 'Playback', handler: () => player.stepRate(-1) },
    { combo: ']', description: 'Faster', group: 'Playback', handler: () => player.stepRate(1) },
    { combo: 'home', description: 'Go to start', group: 'Playback', handler: () => player.seek(0) },
    { combo: 'end', description: 'Go to end', group: 'Playback', handler: () => player.seek(duration) },
    { combo: ',', description: 'Previous tagged event', group: 'Playback', handler: () => jump(-1) },
    { combo: '.', description: 'Next tagged event', group: 'Playback', handler: () => jump(1) },
    { combo: 'm', description: 'Mute', group: 'Playback', handler: () => player.toggleMute() },
    { combo: 'f', description: 'Fullscreen', group: 'Playback', handler: () => window.dispatchEvent(new Event('scoutdesk:toggle-fullscreen')) },
    { combo: 'd', description: 'Draw on the paused frame', group: 'Playback', handler: () => useDrawing.getState().setActive(!useDrawing.getState().active) },

    { combo: 'mod+z', description: 'Undo', group: 'Editing', enabled: canWrite && !drawing, handler: () => void useHistory.getState().undo() },
    { combo: 'mod+shift+z', description: 'Redo', group: 'Editing', enabled: canWrite, handler: () => void useHistory.getState().redo() },
    { combo: 'mod+y', description: 'Redo', group: 'Editing', hidden: true, enabled: canWrite, handler: () => void useHistory.getState().redo() },
    { combo: 'mod+z', description: 'Undo last drawing', group: 'Drawing', enabled: drawing, handler: () => useDrawing.getState().undoLast(Math.floor(player.currentTime * usePlayback.getState().fps + 1e-4)) },
    { combo: 'delete', description: 'Delete selected clips', group: 'Editing', enabled: canWrite, handler: () => void deleteSelected() },
    { combo: 'backspace', description: 'Delete selected clips', group: 'Editing', hidden: true, enabled: canWrite, handler: () => void deleteSelected() },
    { combo: 'i', description: 'Set clip start to playhead', group: 'Editing', enabled: canWrite, handler: () => adjustActive('startSec') },
    { combo: 'o', description: 'Set clip end to playhead', group: 'Editing', enabled: canWrite, handler: () => adjustActive('endSec') },
    { combo: 'enter', description: 'Open clip inspector', group: 'Editing', handler: () => useClips.getState().activeId && setRightTab('clip') },
    { combo: 'mod+a', description: 'Select all visible clips', group: 'Editing', handler: () => useClips.getState().select(visibleList.map((c) => c.id)) },
    { combo: 'escape', description: 'Stop clip / close drawing / clear selection', group: 'Editing', handler: escape },
  ]
  useHotkeys(bindings)

  function deleteSelected() {
    const ids = useClips.getState().selectedIds
    if (!ids.length) return
    void deleteClips(ids)
    toast(`Deleted ${ids.length} clip${ids.length > 1 ? 's' : ''}`, { action: { label: 'Undo', onClick: () => void useHistory.getState().undo() } })
  }
  function adjustActive(field: 'startSec' | 'endSec') {
    const { activeId, clips } = useClips.getState()
    const c = clips.find((x) => x.id === activeId)
    if (!c) return toast('Select a clip first')
    const t = Math.round(player.currentTime * usePlayback.getState().fps) / usePlayback.getState().fps
    if (field === 'startSec' && t >= c.endSec - 0.5) return toast.error('Start must be before the end')
    if (field === 'endSec' && t <= c.startSec + 0.5) return toast.error('End must be after the start')
    void patchClips([{ id: c.id, patch: { [field]: t } }], field === 'startSec' ? 'Set clip start' : 'Set clip end')
  }
  function escape() {
    if (usePlayback.getState().clipRange) {
      player.pause()
      usePlayback.setState({ clipRange: null })
    } else if (useDrawing.getState().active) useDrawing.getState().setActive(false)
    else useClips.getState().select([])
  }

  // Empty / blocked states ───────────────────────────────────────────────────
  if (!match) {
    return <EmptyState className="h-full" icon={CalendarX} title="Match not found" description="It may have been deleted." action={<Button asChild variant="primary"><Link to="/matches">Back to matches</Link></Button>} />
  }
  if (!video) {
    return (
      <>
        {processing ? (
          <EmptyState className="h-full" icon={Film} title="Video is processing" description="Generating metadata and thumbnail. This page will open automatically when it’s ready." action={<Spinner className="h-5 w-5" />} />
        ) : failed ? (
          <EmptyState className="h-full" icon={AlertTriangle} title="Video processing failed" description={videos[0]?.error ?? 'The file could not be read. Try re-uploading it as MP4 (H.264).'} action={canWrite ? <Button variant="primary" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> Upload another file</Button> : undefined} />
        ) : (
          <EmptyState className="h-full" icon={Film} title="No video attached to this match" description="Upload match footage to start tagging, or attach an existing video from the Library." action={canWrite ? <Button variant="primary" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> Upload video</Button> : <Button asChild><Link to="/library">Go to Library</Link></Button>} />
        )}
        <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} defaultMatchId={matchId} />
      </>
    )
  }

  return (
    <PanelGroup direction="horizontal" autoSaveId="sd-analysis-h" className="h-full">
      <Panel id="pnl-main" defaultSize={74} minSize={45} order={1}>
        <PanelGroup direction="vertical" autoSaveId="sd-analysis-v">
          <Panel id="pnl-video" defaultSize={42} minSize={22} order={1}><VideoPlayer video={video} secondary={secondary} angles={readyVideos} /></Panel>
          <Handle dir="h" />
          <Panel id="pnl-timeline" defaultSize={27} minSize={14} order={2}><Timeline visibleIds={visibleIds} canEdit={canWrite} /></Panel>
          <Handle dir="h" />
          <Panel id="pnl-bottom" defaultSize={31} minSize={10} order={3}>
            <Tabs value={bottomTab} onValueChange={setBottomTab} className="flex h-full flex-col bg-surface">
              <TabsList>
                <TabsTrigger value="clips">Clips <span className="timecode text-2xs text-muted">{clipTotal}</span></TabsTrigger>
                <TabsTrigger value="log">Event log</TabsTrigger>
                <TabsTrigger value="pitch">Pitch</TabsTrigger>
              </TabsList>
              <TabsContent value="clips" forceMount><ClipTable canWrite={canWrite} onPlayClip={playClip} /></TabsContent>
              <TabsContent value="log"><EventLog /></TabsContent>
              <TabsContent value="pitch"><PitchView canWrite={canWrite} /></TabsContent>
            </Tabs>
          </Panel>
        </PanelGroup>
      </Panel>
      <Handle dir="v" />
      <Panel id="pnl-side" defaultSize={26} minSize={20} maxSize={42} order={2}>
        <Tabs value={rightTab} onValueChange={setRightTab} className="flex h-full flex-col bg-surface">
          <TabsList>
            <TabsTrigger value="tag">Tagging</TabsTrigger>
            <TabsTrigger value="clip">Clip</TabsTrigger>
          </TabsList>
          <TabsContent value="tag" forceMount><TaggingPanel match={match} canWrite={canWrite} /></TabsContent>
          <TabsContent value="clip" forceMount><ClipInspector canWrite={canWrite} onPlayClip={playClip} /></TabsContent>
        </Tabs>
      </Panel>
    </PanelGroup>
  )
}
