import { ArrowDown, ArrowUp, Keyboard, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Kbd } from '@/components/ui/misc'
import { api } from '@/lib/api'
import { comboFromEvent, formatHotkey } from '@/lib/hotkeys'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import type { Category, Outcome, TagType } from '@/types'

/** Keys the player/timeline already use — never offered to tags. */
const RESERVED = new Set(['space', 'left', 'right', 'up', 'down', '[', ']', 'f', 'm', 'd', 'i', 'o', '?', '/', '#', 'delete', 'backspace', 'enter', 'escape', 'home', 'end', ',', '.', '=', '-', '+', 'shift+f', 'tab'])

/** Only single keys or shift+letter are valid tag hotkeys (Alt/Ctrl combos belong to outcome + edit shortcuts). */
export function validateHotkey(combo: string): string | null {
  if (RESERVED.has(combo)) return `“${formatHotkey(combo)}” is reserved for playback and editing`
  if (combo.includes('mod+') || combo.includes('alt+')) return 'Ctrl/⌘ and Alt combinations are reserved'
  if (!/^([a-z0-9]|shift\+[a-z])$/.test(combo)) return 'Use a letter, a digit, or Shift + letter'
  return null
}

const refresh = async () => useData.setState({ categories: await api.taxonomy() })
const run = async (fn: () => Promise<unknown>) => {
  try { await fn(); await refresh() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save') }
}

function HotkeyField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [capturing, setCapturing] = useState(false)
  return (
    <button
      type="button"
      aria-label={capturing ? 'Press a key…' : value ? `Hotkey ${formatHotkey(value)}. Click to change` : 'Set hotkey'}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={(e) => {
        if (!capturing) return
        e.preventDefault(); e.stopPropagation()
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
        const combo = comboFromEvent(e.nativeEvent)
        if (combo === 'escape') return setCapturing(false)
        if (combo === 'backspace' || combo === 'delete') { onChange(null); return setCapturing(false) }
        const err = validateHotkey(combo)
        if (err) return void toast.error(err)
        onChange(combo)
        setCapturing(false)
      }}
      className={cn('flex h-8 w-24 items-center justify-center gap-1 rounded border text-xs', capturing ? 'border-accent text-accent' : 'border-border hover:border-muted/60')}
    >
      {capturing ? 'Press key…' : value ? <Kbd>{formatHotkey(value)}</Kbd> : <><Keyboard className="h-3 w-3 text-muted" /> none</>}
    </button>
  )
}

function TagRow({ tag, index, count, siblings }: { tag: TagType; index: number; count: number; siblings: TagType[] }) {
  const [name, setName] = useState(tag.name)
  const swap = (d: -1 | 1) => {
    const other = siblings[index + d]
    if (!other) return
    void run(async () => { await api.patchTagType(tag.id, { sortOrder: other.sortOrder }); await api.patchTagType(other.id, { sortOrder: tag.sortOrder }) })
  }
  return (
    <li className="flex items-center gap-2">
      <Input aria-label={`Tag name (${tag.name})`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== tag.name ? void run(() => api.patchTagType(tag.id, { name: name.trim() })) : setName(tag.name)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="h-8 flex-1" />
      <HotkeyField value={tag.hotkey} onChange={(h) => void run(() => api.patchTagType(tag.id, { hotkey: h }))} />
      <Select aria-label={`Default outcome for ${tag.name}`} value={tag.defaultOutcome} onChange={(e) => void run(() => api.patchTagType(tag.id, { defaultOutcome: e.target.value as Outcome }))} className="h-8 w-28 text-xs">
        <option value="neutral">Neutral</option><option value="success">Success</option><option value="fail">Fail</option>
      </Select>
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${tag.name} up`} disabled={index === 0} onClick={() => swap(-1)}><ArrowUp className="h-3 w-3" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${tag.name} down`} disabled={index === count - 1} onClick={() => swap(1)}><ArrowDown className="h-3 w-3" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete tag ${tag.name}`} onClick={() => confirm(`Delete the tag “${tag.name}”?`) && void run(() => api.deleteTagType(tag.id))}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
    </li>
  )
}

function CategoryCard({ cat, index, all }: { cat: Category; index: number; all: Category[] }) {
  const [name, setName] = useState(cat.name)
  const [newTag, setNewTag] = useState('')
  const swap = (d: -1 | 1) => {
    const other = all[index + d]
    if (!other) return
    void run(async () => { await api.patchCategory(cat.id, { sortOrder: other.sortOrder }); await api.patchCategory(other.id, { sortOrder: cat.sortOrder }) })
  }
  const addTag = () => {
    const n = newTag.trim()
    if (!n) return
    void run(() => api.createTagType({ categoryId: cat.id, name: n, sortOrder: (cat.tagTypes.at(-1)?.sortOrder ?? -1) + 1 })).then(() => setNewTag(''))
  }
  return (
    <section className="panel" aria-label={`Category ${cat.name}`}>
      <header className="flex items-center gap-2 border-b border-border p-2">
        <input type="color" aria-label={`Colour for ${cat.name}`} value={cat.color} onChange={(e) => void run(() => api.patchCategory(cat.id, { color: e.target.value }))} className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5" />
        <Input aria-label={`Category name (${cat.name})`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== cat.name ? void run(() => api.patchCategory(cat.id, { name: name.trim() })) : setName(cat.name)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="h-8 flex-1 font-semibold" />
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${cat.name} up`} disabled={index === 0} onClick={() => swap(-1)}><ArrowUp className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${cat.name} down`} disabled={index === all.length - 1} onClick={() => swap(1)}><ArrowDown className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete category ${cat.name}`} onClick={() => confirm(`Delete the category “${cat.name}” and its ${cat.tagTypes.length} tags?`) && void run(() => api.deleteCategory(cat.id))}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
      </header>
      <ul className="space-y-1.5 p-2">
        {cat.tagTypes.map((t, i) => <TagRow key={t.id} tag={t} index={i} count={cat.tagTypes.length} siblings={cat.tagTypes} />)}
        <li className="flex gap-2 pt-1">
          <Input aria-label={`New tag in ${cat.name}`} value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="Add a tag…" className="h-8 flex-1" />
          <Button size="sm" disabled={!newTag.trim()} onClick={addTag}><Plus className="h-3.5 w-3.5" /> Add tag</Button>
        </li>
      </ul>
    </section>
  )
}

/** Admin-only editor for the tagging taxonomy: categories (lanes), tags, hotkeys and default outcomes. */
export function TaxonomyEditor({ canEdit }: { canEdit: boolean }) {
  const categories = useData((s) => s.categories)
  const [name, setName] = useState('')
  const PALETTE = ['#f43f5e', '#38bdf8', '#a78bfa', '#fbbf24', '#2dd4bf', '#fb923c', '#4ade80', '#f472b6']
  if (!canEdit) return <p className="text-xs text-muted">Only admins can edit the taxonomy. Switch to the admin user from the avatar menu.</p>
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Each category is a timeline lane. Hotkeys: a letter, a digit, or Shift + letter — keys used by the player and timeline are rejected, and duplicates are refused by the server. Press Backspace while capturing to clear a hotkey.</p>
      {categories.map((c, i) => <CategoryCard key={c.id} cat={c} index={i} all={categories} />)}
      <div className="flex gap-2">
        <Input aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category (e.g. Pressing triggers)" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && name.trim() && void run(() => api.createCategory({ name: name.trim(), color: PALETTE[categories.length % PALETTE.length]!, sortOrder: (categories.at(-1)?.sortOrder ?? -1) + 1 })).then(() => setName(''))} />
        <Button disabled={!name.trim()} onClick={() => void run(() => api.createCategory({ name: name.trim(), color: PALETTE[categories.length % PALETTE.length]!, sortOrder: (categories.at(-1)?.sortOrder ?? -1) + 1 })).then(() => setName(''))}><Plus className="h-3.5 w-3.5" /> Add category</Button>
      </div>
    </div>
  )
}
