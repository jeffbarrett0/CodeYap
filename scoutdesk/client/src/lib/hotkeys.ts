import { useEffect, useId, useRef } from 'react'
import { create } from 'zustand'

export interface Binding {
  /** e.g. "space", "left", "shift+left", "mod+z", "s", "shift+x", "alt+1", "?" */
  combo: string
  handler: (e: KeyboardEvent) => void
  description: string
  group: string
  /** Fire on OS key-repeat (frame stepping wants this). */
  repeat?: boolean
  /** Fire even while focus is in an input. */
  allowInInput?: boolean
  enabled?: boolean
  /** Hide from the cheat sheet (e.g. alias bindings). */
  hidden?: boolean
}

const NAMED: Record<string, string> = {
  ' ': 'space', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', esc: 'escape',
}

/** Canonical combo string for a keyboard event: modifiers in ctrl/alt/shift order + key. */
export function comboFromEvent(e: KeyboardEvent): string {
  let key = e.key.toLowerCase()
  key = NAMED[key] ?? key
  // Option/Alt rewrites e.key on macOS (Alt+1 → "¡"); fall back to the physical key.
  if (e.altKey) {
    if (e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase()
    else if (e.code.startsWith('Digit')) key = e.code.slice(5)
  }
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('mod')
  if (e.altKey) mods.push('alt')
  // Shift is only meaningful on letters and named keys; for symbols ("?", "!") it's baked into the key.
  if (e.shiftKey && (key.length > 1 || /[a-z]/.test(key))) mods.push('shift')
  return [...mods, key].join('+')
}

export function normalizeCombo(combo: string): string {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()!
  const mods = ['mod', 'alt', 'shift'].filter((m) => parts.includes(m) || (m === 'mod' && (parts.includes('ctrl') || parts.includes('meta'))))
  return [...mods, NAMED[key] ?? key].join('+')
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const KEY_LABEL: Record<string, string> = {
  left: '←', right: '→', up: '↑', down: '↓', space: 'Space', escape: 'Esc', enter: 'Enter', backspace: '⌫', delete: 'Del',
}

export function formatHotkey(combo: string): string {
  return normalizeCombo(combo)
    .split('+')
    .map((p) => {
      if (p === 'mod') return isMac ? '⌘' : 'Ctrl'
      if (p === 'alt') return isMac ? '⌥' : 'Alt'
      if (p === 'shift') return '⇧'
      return KEY_LABEL[p] ?? p.toUpperCase()
    })
    .join(isMac ? '' : '+')
    .replace(/\+⇧/g, '+⇧')
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// ── Registry ────────────────────────────────────────────────────────────────

type Getter = () => Binding[]
const owners = new Map<string, Getter>()

export interface CatalogEntry {
  combo: string
  description: string
  group: string
  hidden?: boolean
}
interface CatalogState {
  catalog: Record<string, CatalogEntry[]>
  setCatalog: (id: string, entries: CatalogEntry[] | null) => void
}
export const useHotkeyCatalog = create<CatalogState>((set) => ({
  catalog: {},
  setCatalog: (id, entries) =>
    set((s) => {
      const next = { ...s.catalog }
      if (entries) next[id] = entries
      else delete next[id]
      return { catalog: next }
    }),
}))

/**
 * Register keyboard bindings for the lifetime of a component. Handlers can close
 * over fresh state on every render; only the *shape* (combo/description) is
 * tracked for re-registration, so this is cheap to call with inline lambdas.
 */
export function useHotkeys(bindings: Binding[]) {
  const id = useId()
  const ref = useRef(bindings)
  ref.current = bindings
  const signature = bindings.map((b) => `${b.combo}|${b.description}|${b.group}|${b.enabled === false ? 0 : 1}`).join('\n')

  useEffect(() => {
    owners.set(id, () => ref.current)
    useHotkeyCatalog.getState().setCatalog(
      id,
      ref.current.filter((b) => b.enabled !== false).map((b) => ({ combo: b.combo, description: b.description, group: b.group, hidden: b.hidden })),
    )
    return () => {
      owners.delete(id)
      useHotkeyCatalog.getState().setCatalog(id, null)
    }
  }, [id, signature])
}

const INTERACTIVE = 'button, a[href], summary, [role="button"], [role="radio"], [role="checkbox"], [role="tab"], [role="menuitem"]'

/**
 * Single global listener, registered in the *capture* phase so shortcuts like
 * Space work even when focus rests on a button the mouse just clicked (the
 * button would otherwise swallow Space/Enter). We step aside when:
 *  - a dialog, popover or menu is open (they own the keyboard),
 *  - the user is typing in a field, or
 *  - Enter is pressed on a button/link (Enter keeps activating focused controls).
 * Space is deliberately *always* the transport toggle outside text fields — as in
 * every NLE/analysis tool — so a stray focused button can never eat it or, worse,
 * re-fire (e.g. re-create a tag) when the user means "play/pause".
 * Later-registered owners (deeper components) win ties.
 */
export function dispatchKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  const target = e.target
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]')) return
  const combo = comboFromEvent(e)
  const typing = isTypingTarget(target)
  if (combo === 'enter' && target instanceof HTMLElement && target.matches(INTERACTIVE)) return

  const lists = [...owners.values()].reverse()
  for (const get of lists) {
    for (const b of get()) {
      if (b.enabled === false || normalizeCombo(b.combo) !== combo) continue
      if (typing && !b.allowInInput) continue
      if (e.repeat && !b.repeat) continue
      e.preventDefault()
      e.stopPropagation()
      b.handler(e)
      return
    }
  }
}
