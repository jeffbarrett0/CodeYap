import type { Player } from '@/types'

export const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1'] as const

export interface Slot {
  role: string
  /** Pitch percent, own goal on the left. */
  x: number
  y: number
}

const DEF: Record<number, string[]> = { 3: ['CB', 'CB', 'CB'], 4: ['LB', 'CB', 'CB', 'RB'], 5: ['LWB', 'CB', 'CB', 'CB', 'RWB'] }
const ATT: Record<number, string[]> = { 1: ['ST'], 2: ['ST', 'ST'], 3: ['LW', 'ST', 'RW'] }
const MID: Record<number, string[]> = { 1: ['CM'], 2: ['CM', 'CM'], 3: ['CM', 'CM', 'CM'], 4: ['LM', 'CM', 'CM', 'RM'], 5: ['LM', 'CM', 'CM', 'CM', 'RM'] }

/** Slots for a formation string like "4-3-3" (plus the goalkeeper), laid out left → right. */
export function formationSlots(formation: string): Slot[] {
  const lines = formation.split('-').map(Number).filter((n) => n > 0)
  if (lines.length < 2) return formationSlots('4-4-2')
  const slots: Slot[] = [{ role: 'GK', x: 6, y: 50 }]
  lines.forEach((n, li) => {
    const x = 6 + ((li + 1) / lines.length) * 80 + (li === lines.length - 1 ? 4 : 0)
    const isDef = li === 0
    const isAtt = li === lines.length - 1
    let roles = isDef ? DEF[n] : isAtt ? ATT[n] : MID[n]
    if (!isDef && !isAtt && lines.length > 3 && li < lines.length - 2) roles = Array(n).fill('DM') // deeper midfield line
    if (!isDef && !isAtt && lines.length > 3 && li === lines.length - 2 && n === 3) roles = ['LW', 'AM', 'RW']
    roles ??= Array(n).fill('CM')
    for (let i = 0; i < n; i++) slots.push({ role: roles[i] ?? 'CM', x, y: n === 1 ? 50 : 12 + (i * 76) / (n - 1) })
  })
  return slots
}

const COMPAT: Record<string, string[]> = {
  GK: ['GK'], LB: ['LB', 'LWB'], LWB: ['LWB', 'LB', 'LM'], RB: ['RB', 'RWB'], RWB: ['RWB', 'RB', 'RM'], CB: ['CB'],
  DM: ['DM', 'CM'], CM: ['CM', 'DM', 'AM'], AM: ['AM', 'CM', 'CF'], LM: ['LM', 'LW', 'LWB'], RM: ['RM', 'RW', 'RWB'],
  LW: ['LW', 'LM'], RW: ['RW', 'RM'], ST: ['ST', 'CF'],
}

/** Greedy placement: best positional match first, then fill leftover slots with leftover players by jersey. */
export function assignPlayers(slots: Slot[], roster: Player[]): (Player | null)[] {
  const used = new Set<string>()
  const out: (Player | null)[] = slots.map(() => null)
  const sorted = [...roster].sort((a, b) => (a.jersey ?? 99) - (b.jersey ?? 99))
  slots.forEach((s, i) => {
    const prefs = COMPAT[s.role] ?? [s.role]
    for (const want of prefs) {
      const p = sorted.find((pl) => !used.has(pl.id) && pl.positions[0] === want) ?? sorted.find((pl) => !used.has(pl.id) && pl.positions.includes(want))
      if (p) {
        used.add(p.id)
        out[i] = p
        return
      }
    }
  })
  slots.forEach((_, i) => {
    if (out[i]) return
    const p = sorted.find((pl) => !used.has(pl.id))
    if (p) {
      used.add(p.id)
      out[i] = p
    }
  })
  return out
}
