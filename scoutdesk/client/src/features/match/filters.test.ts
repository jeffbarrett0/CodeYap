import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, matchesFilters, type FilterContext } from './filters'
import type { Clip } from '@/types'

const ctx: FilterContext = {
  categoryOfTag: (id) => ({ id: id === 't1' ? 'cat-a' : 'cat-b' }),
  tagName: (id) => (id === 't1' ? 'Shot' : 'Tackle'),
  playerName: (id) => (id === 'p1' ? 'Marcus Hale' : ''),
}
const clip = (o: Partial<Clip>): Clip => ({
  id: 'c', matchId: 'm', videoId: null, tagTypeId: 't1', startSec: 0, endSec: 5, timeSec: 2, playerId: 'p1', teamId: 'tm1', jersey: 9,
  outcome: 'success', zone: '3x3:6', x: null, y: null, endX: null, endY: null, notes: 'Low drive', labels: ['goal'], createdById: null, createdAt: '', updatedAt: '', ...o,
})

describe('matchesFilters', () => {
  it('passes everything with empty filters', () => expect(matchesFilters(clip({}), EMPTY_FILTERS, ctx)).toBe(true))
  it('combines filters with AND, values within one filter with OR', () => {
    const f = { ...EMPTY_FILTERS, categoryIds: ['cat-a'], outcomes: ['success' as const, 'fail' as const] }
    expect(matchesFilters(clip({}), f, ctx)).toBe(true)
    expect(matchesFilters(clip({ outcome: 'neutral' }), f, ctx)).toBe(false)
    expect(matchesFilters(clip({ tagTypeId: 't2' }), f, ctx)).toBe(false)
  })
  it('treats missing player/zone as "none"', () => {
    expect(matchesFilters(clip({ playerId: null }), { ...EMPTY_FILTERS, playerIds: ['none'] }, ctx)).toBe(true)
    expect(matchesFilters(clip({}), { ...EMPTY_FILTERS, playerIds: ['none'] }, ctx)).toBe(false)
    expect(matchesFilters(clip({ zone: null }), { ...EMPTY_FILTERS, zones: ['none'] }, ctx)).toBe(true)
  })
  it('searches tag, player, notes and labels; every word must hit', () => {
    expect(matchesFilters(clip({}), { ...EMPTY_FILTERS, text: 'hale drive' }, ctx)).toBe(true)
    expect(matchesFilters(clip({}), { ...EMPTY_FILTERS, text: 'goal shot' }, ctx)).toBe(true)
    expect(matchesFilters(clip({}), { ...EMPTY_FILTERS, text: 'hale header' }, ctx)).toBe(false)
  })
  it('matches any selected label', () => {
    expect(matchesFilters(clip({}), { ...EMPTY_FILTERS, labels: ['set-piece', 'goal'] }, ctx)).toBe(true)
    expect(matchesFilters(clip({ labels: [] }), { ...EMPTY_FILTERS, labels: ['goal'] }, ctx)).toBe(false)
  })
})
