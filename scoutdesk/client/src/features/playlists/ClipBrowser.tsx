import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Checkbox, Dot, EmptyState, Spinner } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { formatClock } from '@/lib/timecode'
import { cn, formatDate } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import type { Clip } from '@/types'
import { DRAG_MIME } from './util'

/** Cross-match clip search (match, date range, category, player, outcome, text) with draggable rows. */
export function ClipBrowser({ onAdd, canWrite }: { onAdd: (ids: string[]) => void; canWrite: boolean }) {
  const matches = useData((s) => s.matches)
  const categories = useData((s) => s.categories)
  const players = useData((s) => s.players)
  const { matchById, tagById, playerById, categoryOfTag, teamById } = useLookups()
  const [all, setAll] = useState<Clip[] | null>(null)
  const [f, setF] = useState({ q: '', matchId: '', categoryId: '', playerId: '', outcome: '', from: '', to: '' })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    fetch('/api/clips').then((r) => r.json()).then((c: Clip[]) => live && setAll(c)).catch(() => live && setAll([]))
    void api
    return () => { live = false }
  }, [])

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return (all ?? []).filter((c) => {
      if (f.matchId && c.matchId !== f.matchId) return false
      if (f.categoryId && categoryOfTag.get(c.tagTypeId)?.id !== f.categoryId) return false
      if (f.playerId && c.playerId !== f.playerId) return false
      if (f.outcome && c.outcome !== f.outcome) return false
      const d = matchById.get(c.matchId)?.date.slice(0, 10) ?? ''
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
      if (q && !`${tagById.get(c.tagTypeId)?.name} ${playerById.get(c.playerId ?? '')?.name ?? ''} ${c.notes} ${c.labels.join(' ')}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [all, f, matchById, tagById, playerById, categoryOfTag])

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 44, overscan: 10 })
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const allChecked = rows.length > 0 && rows.every((r) => sel.has(r.id))

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Clip library">
      <div className="space-y-1.5 border-b border-border p-2">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-[7px] h-3.5 w-3.5 text-muted" />
          <Input aria-label="Search clip library" placeholder="Search tag, player, notes…" value={f.q} onChange={(e) => set('q', e.target.value)} className="h-7 pl-7 text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Select aria-label="Match" value={f.matchId} onChange={(e) => set('matchId', e.target.value)} className="h-7 text-xs"><option value="">All matches</option>{matches.map((m) => <option key={m.id} value={m.id}>{teamById.get(m.homeTeamId)?.shortName} v {teamById.get(m.awayTeamId)?.shortName} · {formatDate(m.date)}</option>)}</Select>
          <Select aria-label="Category" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} className="h-7 text-xs"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select aria-label="Player" value={f.playerId} onChange={(e) => set('playerId', e.target.value)} className="h-7 text-xs"><option value="">All players</option>{players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select aria-label="Outcome" value={f.outcome} onChange={(e) => set('outcome', e.target.value)} className="h-7 text-xs"><option value="">Any outcome</option><option value="success">Success</option><option value="fail">Fail</option><option value="neutral">Neutral</option></Select>
          <Input aria-label="Match date from" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className="h-7 px-1.5 text-xs" />
          <Input aria-label="Match date to" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className="h-7 px-1.5 text-xs" />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-2xs text-muted"><Checkbox checked={allChecked} indeterminate={!allChecked && sel.size > 0} label="Select all results" onChange={(n) => setSel(n ? new Set(rows.map((r) => r.id)) : new Set())} /> {rows.length} clips</label>
          <Button size="xs" variant="primary" disabled={!canWrite || sel.size === 0} onClick={() => { onAdd([...sel]); setSel(new Set()) }}><Plus className="h-3 w-3" /> Add {sel.size || ''}</Button>
        </div>
      </div>
      {all === null ? <div className="flex flex-1 items-center justify-center"><Spinner /></div> : rows.length === 0 ? <EmptyState icon={Search} title="No clips match" className="flex-1" /> : (
        <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto" role="list">
          <div className="relative" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((v) => {
              const c = rows[v.index]!
              const cat = categoryOfTag.get(c.tagTypeId)
              const m = matchById.get(c.matchId)
              return (
                <div key={c.id} role="listitem" draggable={canWrite}
                  onDragStart={(e) => { const ids = sel.has(c.id) ? [...sel] : [c.id]; e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copy' }}
                  className={cn('absolute left-0 right-0 flex items-center gap-2 border-b border-border/60 px-2 text-xs hover:bg-raised/50', sel.has(c.id) && 'bg-accent/10', canWrite && 'cursor-grab active:cursor-grabbing')}
                  style={{ height: 44, transform: `translateY(${v.start}px)` }}>
                  <Checkbox checked={sel.has(c.id)} label={`Select clip ${tagById.get(c.tagTypeId)?.name} at ${formatClock(c.timeSec)}`} onChange={(n) => setSel((s) => { const x = new Set(s); n ? x.add(c.id) : x.delete(c.id); return x })} />
                  <Dot color={cat?.color ?? '#888'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{tagById.get(c.tagTypeId)?.name}{c.playerId ? <span className="font-normal text-muted"> · {playerById.get(c.playerId)?.name}</span> : null}</p>
                    <p className="truncate text-2xs text-muted">{m ? `${teamById.get(m.homeTeamId)?.shortName} v ${teamById.get(m.awayTeamId)?.shortName}` : ''} · <span className="timecode">{formatClock(c.timeSec)}</span></p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Add to playlist" disabled={!canWrite} onClick={() => onAdd([c.id])}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
