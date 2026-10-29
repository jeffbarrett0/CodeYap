import { describe, expect, it } from 'vitest'
import type { Player } from '@/types'
import { FORMATIONS, assignPlayers, formationSlots } from './formations'

const pl = (id: string, jersey: number, positions: string[]): Player => ({ id, name: id, photoUrl: null, jersey, positions, foot: null, heightCm: null, age: null, nationality: null, notes: '', teamId: 't' })

describe('formations', () => {
  it('always yields 11 slots with one keeper, for every supported formation', () => {
    for (const f of FORMATIONS) {
      const s = formationSlots(f)
      expect(s, f).toHaveLength(11)
      expect(s.filter((x) => x.role === 'GK')).toHaveLength(1)
      expect(s.every((x) => x.x >= 0 && x.x <= 100 && x.y >= 0 && x.y <= 100)).toBe(true)
    }
  })
  it('falls back on garbage input', () => expect(formationSlots('nonsense')).toHaveLength(11))
  it('places players by position first, then fills by jersey', () => {
    const slots = formationSlots('4-4-2')
    const roster = [pl('keeper', 1, ['GK']), pl('striker', 9, ['ST']), pl('mid', 8, ['CM']), pl('other', 30, ['LB'])]
    const out = assignPlayers(slots, roster)
    expect(out[0]?.id).toBe('keeper')
    expect(out.find((p, i) => p?.id === 'striker' && slots[i]!.role === 'ST')).toBeTruthy()
    expect(out.filter(Boolean)).toHaveLength(4)
    expect(new Set(out.filter(Boolean).map((p) => p!.id)).size).toBe(4)
  })
})
