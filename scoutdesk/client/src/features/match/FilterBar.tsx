import { Bookmark, ChevronDown, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { CheckGlyph, Dot } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import { useClips } from './clips'
import { activeFilterCount, useFilterPresets, useFilters, type ClipFilters } from './filters'
import { zoneLabel } from './zones'

interface Option {
  value: string
  label: string
  color?: string
  group?: string
}

function MultiSelect({ label, options, selected, onChange, width = 'w-56' }: { label: string; options: Option[]; selected: string[]; onChange: (v: string[]) => void; width?: string }) {
  const [q, setQ] = useState('')
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
  let lastGroup: string | undefined
  return (
    <Popover onOpenChange={(o) => !o && setQ('')}>
      <PopoverTrigger asChild>
        <Button variant={selected.length ? 'outline' : 'ghost'} size="sm" className={cn('shrink-0 gap-1', selected.length > 0 && 'border-accent/60 text-foreground')} aria-label={`Filter by ${label}${selected.length ? `, ${selected.length} selected` : ''}`}>
          {label}
          {selected.length > 0 && <span className="timecode rounded-sm bg-accent px-1 text-2xs font-bold text-accent-foreground">{selected.length}</span>}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-1', width)}>
        {options.length > 8 && <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className="mb-1 h-7 text-xs" onKeyDown={(e) => e.stopPropagation()} />}
        <div className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable aria-label={label}>
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted">Nothing to filter on yet</p>}
          {shown.map((o) => {
            const header = o.group && o.group !== lastGroup ? (lastGroup = o.group) : null
            const on = selected.includes(o.value)
            return (
              <div key={o.value}>
                {header && <div className="label px-2 pb-0.5 pt-1.5">{header}</div>}
                <button type="button" role="option" aria-selected={on} onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-raised">
                  <CheckGlyph checked={on} />
                  {o.color && <Dot color={o.color} />}
                  <span className="truncate">{o.label}</span>
                </button>
              </div>
            )
          })}
        </div>
        {selected.length > 0 && <Button variant="ghost" size="xs" className="mt-1 w-full" onClick={() => onChange([])}>Clear {label.toLowerCase()}</Button>}
      </PopoverContent>
    </Popover>
  )
}

export function FilterBar() {
  const { filters, setFilters, replaceFilters, clear } = useFilters()
  const { presets, save, remove } = useFilterPresets()
  const clips = useClips((s) => s.clips)
  const categories = useData((s) => s.categories)
  const teams = useData((s) => s.teams)
  const { playerById } = useLookups()
  const count = activeFilterCount(filters)
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')

  const opts = useMemo(() => {
    const playerIds = [...new Set(clips.map((c) => c.playerId).filter(Boolean))] as string[]
    const zones = [...new Set(clips.map((c) => c.zone).filter(Boolean))] as string[]
    return {
      categories: categories.map((c) => ({ value: c.id, label: c.name, color: c.color })),
      tags: categories.flatMap((c) => c.tagTypes.map((t) => ({ value: t.id, label: t.name, color: c.color, group: c.name }))),
      players: [{ value: 'none', label: 'No player' }, ...playerIds.map((id) => ({ value: id, label: playerById.get(id)?.name ?? id }))],
      teams: teams.map((t) => ({ value: t.id, label: t.name, color: t.color })),
      outcomes: [{ value: 'success', label: 'Success' }, { value: 'fail', label: 'Fail' }, { value: 'neutral', label: 'Neutral' }],
      zones: [{ value: 'none', label: 'No zone' }, ...zones.sort().map((z) => ({ value: z, label: `${z.split(':')[0]} · ${zoneLabel(z)}` }))],
      labels: [...new Set(clips.flatMap((c) => c.labels))].sort().map((l) => ({ value: l, label: l })),
    }
  }, [clips, categories, teams, playerById])

  const set = <K extends keyof ClipFilters>(k: K) => (v: ClipFilters[K]) => setFilters({ [k]: v } as Partial<ClipFilters>)

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="search" aria-label="Filter clips">
      <div className="relative w-40 shrink-0">
        <Search aria-hidden className="pointer-events-none absolute left-2 top-[7px] h-3.5 w-3.5 text-muted" />
        <Input value={filters.text} onChange={(e) => setFilters({ text: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && (setFilters({ text: '' }), e.currentTarget.blur())} placeholder="Search clips…" aria-label="Search clips" className="h-7 pl-7 text-xs" />
      </div>
      <MultiSelect label="Category" options={opts.categories} selected={filters.categoryIds} onChange={set('categoryIds')} />
      <MultiSelect label="Tag" options={opts.tags} selected={filters.tagTypeIds} onChange={set('tagTypeIds')} />
      <MultiSelect label="Player" options={opts.players} selected={filters.playerIds} onChange={set('playerIds')} />
      <MultiSelect label="Team" options={opts.teams} selected={filters.teamIds} onChange={set('teamIds')} />
      <MultiSelect label="Outcome" options={opts.outcomes} selected={filters.outcomes} onChange={set('outcomes') as (v: string[]) => void} width="w-44" />
      <MultiSelect label="Zone" options={opts.zones} selected={filters.zones} onChange={set('zones')} />
      <MultiSelect label="Label" options={opts.labels} selected={filters.labels} onChange={set('labels')} width="w-48" />
      {count > 0 && <Button variant="ghost" size="sm" onClick={clear} className="gap-1 text-muted"><X className="h-3 w-3" /> Clear ({count})</Button>}

      <DropdownMenu onOpenChange={(o) => !o && setNaming(false)}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0 gap-1" aria-label="Filter presets" title="Filter presets"><Bookmark className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">Presets</span></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Saved filters</DropdownMenuLabel>
          {presets.length === 0 && <p className="px-2 pb-1 text-xs text-muted">No presets yet.</p>}
          {presets.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => replaceFilters(p.filters)} className="justify-between">
              <span className="truncate">{p.name}</span>
              <button type="button" aria-label={`Delete preset ${p.name}`} className="text-muted hover:text-danger" onClick={(e) => (e.stopPropagation(), remove(p.id))}><X className="h-3 w-3" /></button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {naming ? (
            <form className="flex gap-1 p-1" onSubmit={(e) => { e.preventDefault(); if (presetName.trim()) { save(presetName.trim(), filters); setPresetName(''); setNaming(false) } }}>
              <Input autoFocus value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Preset name" className="h-7 text-xs" aria-label="Preset name" />
              <Button type="submit" variant="primary" size="sm">Save</Button>
            </form>
          ) : (
            <DropdownMenuItem disabled={count === 0} onSelect={(e) => (e.preventDefault(), setNaming(true))}>Save current filters…</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
