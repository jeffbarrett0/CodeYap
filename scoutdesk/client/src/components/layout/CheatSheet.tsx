import { useMemo } from 'react'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/misc'
import { formatHotkey, useHotkeyCatalog, useHotkeys } from '@/lib/hotkeys'
import { useUi } from '@/store/ui'

/** Live view of every registered binding, grouped. Opens with "?". */
export function CheatSheet() {
  const open = useUi((s) => s.cheatSheetOpen)
  const setOpen = useUi((s) => s.setCheatSheetOpen)
  const catalog = useHotkeyCatalog((s) => s.catalog)

  useHotkeys([{ combo: '?', description: 'Show keyboard shortcuts', group: 'Global', handler: () => setOpen(!open), allowInInput: false }])

  const groups = useMemo(() => {
    const map = new Map<string, Map<string, { combos: string[]; description: string }>>()
    for (const entries of Object.values(catalog)) {
      for (const e of entries) {
        if (e.hidden) continue
        const g = map.get(e.group) ?? new Map()
        const cur = g.get(e.description) ?? { combos: [], description: e.description }
        if (!cur.combos.includes(e.combo)) cur.combos.push(e.combo)
        g.set(e.description, cur)
        map.set(e.group, g)
      }
    }
    // Tagging shortcuts can be dozens — keep their own group last, everything else alphabetical-ish.
    return [...map.entries()].sort(([a], [b]) => (a === 'Global' ? -1 : b === 'Global' ? 1 : a.localeCompare(b)))
  }, [catalog])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts" description="Everything is keyboard-first. Shortcuts are paused while you type in a field." className="max-w-3xl">
        <DialogBody>
          {groups.length === 0 && <p className="py-8 text-center text-xs text-muted">No shortcuts registered on this screen.</p>}
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {groups.map(([group, items]) => (
              <section key={group} aria-label={group}>
                <h3 className="label mb-1.5">{group}</h3>
                <ul className="space-y-1">
                  {[...items.values()].map((it) => (
                    <li key={it.description} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-foreground/90">{it.description}</span>
                      <span className="flex shrink-0 gap-1">
                        {it.combos.map((c) => (
                          <Kbd key={c}>{formatHotkey(c)}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
