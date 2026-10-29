import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Check, Download, ListFilter, Minus, Tags, Trash2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { Checkbox, Dot, EmptyState } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatClock } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useExports } from '@/store/exports'
import { AddToPlaylistMenu } from '../playlists/AddToPlaylistMenu'
import { useLookups } from '@/store/hooks'
import type { Clip, Outcome } from '@/types'
import { deleteClips, patchClips, patchMany, useClips } from './clips'
import { FilterBar } from './FilterBar'
import { activeFilterCount, useFilters } from './filters'
import { useHistory } from './history'
import { player } from './playback'
import { useVisibleClips } from './visible'

type SortKey = 'time' | 'tag' | 'player' | 'team' | 'outcome' | 'notes' | 'labels'
const ROW_H = 28
const GRID = '28px 64px minmax(130px,1.2fr) minmax(110px,1fr) 56px 84px minmax(160px,2fr) minmax(90px,1fr)'
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'time', label: 'Time' }, { key: 'tag', label: 'Tag' }, { key: 'player', label: 'Player' }, { key: 'team', label: 'Team' },
  { key: 'outcome', label: 'Outcome' }, { key: 'notes', label: 'Notes' }, { key: 'labels', label: 'Labels' },
]
const OUTCOME_ORDER: Record<Outcome, number> = { success: 0, neutral: 1, fail: 2 }

function OutcomePill({ outcome }: { outcome: Outcome }) {
  const Icon = outcome === 'success' ? Check : outcome === 'fail' ? X : Minus
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', outcome === 'success' && 'text-success', outcome === 'fail' && 'text-danger', outcome === 'neutral' && 'text-muted')}>
      <Icon className="h-3 w-3" aria-hidden /> <span className="capitalize">{outcome}</span>
    </span>
  )
}

interface RowData {
  clip: Clip
  tag: string
  category: string
  color: string
  player: string
  team: string
  teamColor: string | undefined
}

const Row = memo(function Row({ d, selected, active, onClick, onDoubleClick, onToggle, top }: {
  d: RowData; selected: boolean; active: boolean; top: number
  onClick: (e: React.MouseEvent, id: string) => void; onDoubleClick: (c: Clip) => void; onToggle: (id: string, e: React.MouseEvent) => void
}) {
  const { clip } = d
  return (
    <div
      role="row"
      aria-selected={selected}
      data-clip-id={clip.id}
      onClick={(e) => onClick(e, clip.id)}
      onDoubleClick={() => onDoubleClick(clip)}
      className={cn('absolute left-0 right-0 grid cursor-default items-center gap-x-2 border-b border-border/60 px-2 text-xs', selected ? 'bg-accent/10' : 'hover:bg-raised/50', active && 'shadow-[inset_2px_0_0_hsl(var(--accent))]')}
      style={{ gridTemplateColumns: GRID, height: ROW_H, transform: `translateY(${top}px)` }}
    >
      <span role="cell"><Checkbox checked={selected} onChange={(_, e) => onToggle(clip.id, e)} label={`Select clip at ${formatClock(clip.timeSec)}`} /></span>
      <span role="cell" className="timecode text-muted">{formatClock(clip.timeSec)}</span>
      <span role="cell" className="flex min-w-0 items-center gap-1.5"><Dot color={d.color} /><span className="truncate font-medium">{d.tag}</span><span className="hidden truncate text-2xs text-muted 2xl:inline">{d.category}</span></span>
      <span role="cell" className="truncate">{d.player || <span className="text-muted">—</span>}{clip.jersey != null && d.player ? <span className="ml-1 text-2xs text-muted">#{clip.jersey}</span> : null}</span>
      <span role="cell" className="flex items-center gap-1">{d.team ? (<><Dot color={d.teamColor ?? '#888'} /><span className="text-muted">{d.team}</span></>) : <span className="text-muted">—</span>}</span>
      <span role="cell"><OutcomePill outcome={clip.outcome} /></span>
      <span role="cell" className="truncate text-muted" title={clip.notes}>{clip.notes}</span>
      <span role="cell" className="flex min-w-0 gap-1 overflow-hidden">{clip.labels.map((l) => <span key={l} className="truncate rounded-sm bg-raised px-1 text-2xs text-muted">{l}</span>)}</span>
    </div>
  )
})

export function ClipTable({ canWrite, onPlayClip }: { canWrite: boolean; onPlayClip: (c: Clip) => void }) {
  const total = useClips((s) => s.clips.length)
  const status = useClips((s) => s.status)
  const selectedIds = useClips((s) => s.selectedIds)
  const activeId = useClips((s) => s.activeId)
  const { list } = useVisibleClips()
  const filters = useFilters((s) => s.filters)
  const clearFilters = useFilters((s) => s.clear)
  const { categoryOfTag, tagById, playerById, teamById } = useLookups()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'time', dir: 1 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const rows = useMemo<RowData[]>(() => {
    const data = list.map<RowData>((clip) => {
      const cat = categoryOfTag.get(clip.tagTypeId)
      const team = clip.teamId ? teamById.get(clip.teamId) : undefined
      return { clip, tag: tagById.get(clip.tagTypeId)?.name ?? '?', category: cat?.name ?? '', color: cat?.color ?? '#888', player: clip.playerId ? (playerById.get(clip.playerId)?.name ?? '') : '', team: team?.shortName ?? '', teamColor: team?.color }
    })
    const catOrder = new Map(useData.getState().categories.map((c, i) => [c.name, i]))
    const cmp: Record<SortKey, (a: RowData, b: RowData) => number> = {
      time: (a, b) => a.clip.timeSec - b.clip.timeSec,
      tag: (a, b) => (catOrder.get(a.category) ?? 0) - (catOrder.get(b.category) ?? 0) || a.tag.localeCompare(b.tag),
      player: (a, b) => (a.player || '￿').localeCompare(b.player || '￿'),
      team: (a, b) => a.team.localeCompare(b.team),
      outcome: (a, b) => OUTCOME_ORDER[a.clip.outcome] - OUTCOME_ORDER[b.clip.outcome],
      notes: (a, b) => a.clip.notes.localeCompare(b.clip.notes),
      labels: (a, b) => a.clip.labels.join().localeCompare(b.clip.labels.join()),
    }
    return data.sort((a, b) => sort.dir * cmp[sort.key](a, b) || a.clip.timeSec - b.clip.timeSec)
  }, [list, sort, categoryOfTag, tagById, playerById, teamById])

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 14 })

  // Keep the active row in view when selection changes from the timeline / hotkeys.
  const activeIndex = useMemo(() => rows.findIndex((r) => r.clip.id === activeId), [rows, activeId])
  useEffect(() => {
    if (activeIndex < 0) return
    virt.scrollToIndex(activeIndex, { align: 'auto' })
    // The panel can still be laying out when a deep link selects a clip: try once more after it settles.
    const t = window.setTimeout(() => virt.scrollToIndex(activeIndex, { align: 'auto' }), 350)
    return () => window.clearTimeout(t)
  }, [activeIndex, virt])

  // When the table is resized (panels settling, divider dragged) keep the active row in view.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (activeIndex >= 0) virt.scrollToIndex(activeIndex, { align: 'auto' }) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeIndex, virt])

  const select = useClips.getState().select
  const onRowClick = useCallback((e: React.MouseEvent, id: string) => {
    const ids = rows.map((r) => r.clip.id)
    if (e.shiftKey && anchor.current) {
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) return select(ids.slice(Math.min(a, b), Math.max(a, b) + 1), id)
    }
    if (e.metaKey || e.ctrlKey) {
      useClips.getState().toggle(id)
    } else {
      select([id])
      const c = rows.find((r) => r.clip.id === id)?.clip
      if (c) {
        player.skip(0)
        player.seek(c.startSec)
      }
    }
    anchor.current = id
  }, [rows, select])
  const onToggle = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current) onRowClick(e, id)
    else (useClips.getState().toggle(id), (anchor.current = id))
  }, [onRowClick])

  const move = (delta: number) => {
    if (rows.length === 0) return
    const i = Math.min(rows.length - 1, Math.max(0, (activeIndex < 0 ? (delta > 0 ? -1 : rows.length) : activeIndex) + delta))
    const c = rows[i]!.clip
    select([c.id])
    anchor.current = c.id
    player.skip(0)
    player.seek(c.startSec)
  }

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.clip.id))
  const someChecked = rows.some((r) => selected.has(r.clip.id))
  const filtersOn = activeFilterCount(filters) > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <div className="min-w-0 flex-1"><FilterBar /></div>
        <span className="timecode shrink-0 text-2xs text-muted" aria-live="polite">{rows.length}{filtersOn ? ` of ${total}` : ''} clips</span>
      </div>
      {selectedIds.length > 0 && <BulkBar ids={selectedIds} canWrite={canWrite} />}

      {status === 'loading' ? (
        <div className="space-y-1 p-2" role="status" aria-label="Loading clips">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-raised" />)}</div>
      ) : status === 'error' ? (
        <EmptyState icon={ListFilter} title="Couldn’t load clips" description="Check that the server is running and try reloading the page." className="flex-1" />
      ) : total === 0 ? (
        <EmptyState icon={Tags} title="No clips yet" description="Press a tag hotkey (or click a tag) while the video plays to create a clip. Press ? to see every shortcut." className="flex-1" />
      ) : rows.length === 0 ? (
        <EmptyState icon={ListFilter} title="No clips match these filters" action={<Button onClick={clearFilters}>Clear filters</Button>} className="flex-1" />
      ) : (
        <div
          ref={scrollRef}
          role="table"
          aria-label="Clips"
          aria-rowcount={rows.length}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), move(1))
            else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1))
            else if (e.key === 'Enter' && activeId) { const c = rows.find((r) => r.clip.id === activeId)?.clip; if (c) onPlayClip(c) }
          }}
        >
          <div role="row" className="sticky top-0 z-10 grid items-center gap-x-2 border-b border-border bg-surface px-2" style={{ gridTemplateColumns: GRID, height: 26 }}>
            <span role="columnheader"><Checkbox checked={allChecked} indeterminate={!allChecked && someChecked} label="Select all clips" onChange={(next) => select(next ? rows.map((r) => r.clip.id) : [])} /></span>
            {COLUMNS.map((c) => (
              <button key={c.key} type="button" role="columnheader" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))} className="label flex items-center gap-1 text-left hover:text-foreground">
                {c.label}
                {sort.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
              </button>
            ))}
          </div>
          <div className="relative" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((v) => {
              const d = rows[v.index]!
              return <Row key={d.clip.id} d={d} top={v.start} selected={selected.has(d.clip.id)} active={d.clip.id === activeId} onClick={onRowClick} onDoubleClick={onPlayClip} onToggle={onToggle} />
            })}
          </div>
        </div>
      )}
      {!canWrite && total > 0 && <p className="shrink-0 border-t border-border px-3 py-1 text-2xs text-muted">Read-only access — clips can be browsed and played but not edited.</p>}
    </div>
  )
}

function BulkBar({ ids, canWrite }: { ids: string[]; canWrite: boolean }) {
  const categories = useData((s) => s.categories)
  const teams = useData((s) => s.teams)
  const players = useData((s) => s.players)
  const clips = useClips((s) => s.clips)
  const [label, setLabel] = useState('')
  const sel = useMemo(() => clips.filter((c) => ids.includes(c.id)), [clips, ids])
  const { tagById } = useLookups()

  const remove = async () => {
    await deleteClips(ids)
    toast(`Deleted ${ids.length} clip${ids.length > 1 ? 's' : ''}`, { action: { label: 'Undo', onClick: () => void useHistory.getState().undo() } })
  }
  const addLabel = () => {
    const l = label.trim().toLowerCase().replace(/\s+/g, '-')
    if (!l) return
    void patchClips(sel.map((c) => ({ id: c.id, patch: { labels: [...new Set([...c.labels, l])] } })), 'Add label')
    setLabel('')
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-accent/5 px-2 py-1" role="toolbar" aria-label="Bulk actions">
      <span className="mr-1 text-xs font-semibold">{ids.length} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="secondary" size="xs" disabled={!canWrite}>Change tag</Button></DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 overflow-y-auto">
          {categories.map((c, i) => (
            <div key={c.id}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center gap-1.5"><Dot color={c.color} /> {c.name}</DropdownMenuLabel>
              {c.tagTypes.map((t) => <DropdownMenuItem key={t.id} onSelect={() => void patchMany(ids, { tagTypeId: t.id }, 'Change tag')}>{t.name}</DropdownMenuItem>)}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {(['success', 'fail', 'neutral'] as Outcome[]).map((o) => (
        <Button key={o} variant="secondary" size="xs" disabled={!canWrite} onClick={() => void patchMany(ids, { outcome: o }, `Set outcome: ${o}`)} aria-label={`Set outcome to ${o}`}>{o === 'success' ? '✓' : o === 'fail' ? '✗' : '–'} {o}</Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="secondary" size="xs" disabled={!canWrite}>Team / player</Button></DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel>Team</DropdownMenuLabel>
          {teams.map((t) => <DropdownMenuItem key={t.id} onSelect={() => void patchMany(ids, { teamId: t.id }, 'Set team')}><Dot color={t.color} /> {t.name}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Player</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void patchMany(ids, { playerId: null }, 'Clear player')}>No player</DropdownMenuItem>
          {players.map((p) => <DropdownMenuItem key={p.id} onSelect={() => void patchMany(ids, { playerId: p.id, jersey: p.jersey, teamId: p.teamId }, 'Set player')}>{p.jersey != null && `#${p.jersey} `}{p.name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger asChild><Button variant="secondary" size="xs" disabled={!canWrite}>Add label</Button></PopoverTrigger>
        <PopoverContent className="w-48">
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addLabel() }} placeholder="Label, Enter" aria-label="Label to add" className="h-7 text-xs" />
        </PopoverContent>
      </Popover>
      <AddToPlaylistMenu clipIds={ids} disabled={!canWrite} />
      <Button variant="secondary" size="xs" disabled={!canWrite || ids.length > 10} title={ids.length > 10 ? 'Export up to 10 clips at once — or add them to a playlist and export that' : 'Export each selected clip as its own MP4'} onClick={() => { for (const c of sel) void useExports.getState().start('clip', c.id, tagById.get(c.tagTypeId)?.name ?? 'Clip') }}><Download className="h-3 w-3" /> Export MP4</Button>
      <Button variant="danger" size="xs" disabled={!canWrite} onClick={() => void remove()}><Trash2 className="h-3 w-3" /> Delete</Button>
      <Button variant="ghost" size="xs" className="ml-auto" onClick={() => useClips.getState().select([])}>Clear selection</Button>
    </div>
  )
}
