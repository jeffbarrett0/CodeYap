import { useMemo } from 'react'
import { useApp } from './app'
import { buildLookups, useData } from './data'

/** Memoised id→entity maps over the reference data. */
export function useLookups() {
  const teams = useData((s) => s.teams)
  const players = useData((s) => s.players)
  const matches = useData((s) => s.matches)
  const categories = useData((s) => s.categories)
  return useMemo(() => buildLookups({ teams, players, matches, categories }), [teams, players, matches, categories])
}

/** Role-derived capabilities for the signed-in demo user. Server enforces the same rules. */
export function useCan() {
  const userId = useApp((s) => s.userId)
  const role = useData((s) => s.users.find((u) => u.id === userId)?.role)
  return { role, canWrite: role === 'admin' || role === 'analyst', isAdmin: role === 'admin' }
}
