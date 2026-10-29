import { useMemo } from 'react'
import { useLookups } from '@/store/hooks'
import { useClips } from './clips'
import { matchesFilters, useFilters } from './filters'

/** Clips passing the active filters (time-ordered), plus an id set for O(1) membership checks. */
export function useVisibleClips() {
  const clips = useClips((s) => s.clips)
  const filters = useFilters((s) => s.filters)
  const { categoryOfTag, tagById, playerById } = useLookups()
  return useMemo(() => {
    const ctx = {
      categoryOfTag: (id: string) => categoryOfTag.get(id),
      tagName: (id: string) => tagById.get(id)?.name ?? '',
      playerName: (id: string | null) => (id ? (playerById.get(id)?.name ?? '') : ''),
    }
    const list = clips.filter((c) => matchesFilters(c, filters, ctx))
    return { list, ids: new Set(list.map((c) => c.id)) }
  }, [clips, filters, categoryOfTag, tagById, playerById])
}
