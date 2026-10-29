import { cn } from '@/lib/utils'
import type { Stats } from '@/types'

export interface StatItem {
  key: string
  label: string
  value: string
  sub?: string
  /** Numeric value used for comparisons (higher = better unless `lowerIsBetter`). */
  n: number
  lowerIsBetter?: boolean
}

const pct = (v: number | null) => (v == null ? '–' : `${v}%`)

export function statItems(s: Stats): StatItem[] {
  return [
    { key: 'matches', label: 'Matches tagged', value: String(s.matches), n: s.matches },
    { key: 'goals', label: 'Goals', value: String(s.goals), sub: `${s.shots} shots · ${s.shotsOnTarget} on target`, n: s.goals },
    { key: 'shots', label: 'Shots', value: String(s.shots), sub: `${s.shotsOnTarget} on target`, n: s.shots },
    { key: 'passing', label: 'Passing', value: pct(s.passAccuracy), sub: `${s.passesCompleted}/${s.passesAttempted} completed`, n: s.passAccuracy ?? -1 },
    { key: 'keyPasses', label: 'Key passes', value: String(s.keyPasses), n: s.keyPasses },
    { key: 'dribbles', label: 'Dribbles won', value: `${s.dribblesWon}/${s.dribblesAttempted}`, n: s.dribblesWon },
    { key: 'tackles', label: 'Tackles won', value: `${s.tacklesWon}/${s.tackles}`, n: s.tacklesWon },
    { key: 'interceptions', label: 'Interceptions', value: String(s.interceptions), n: s.interceptions },
    { key: 'blocks', label: 'Blocks', value: String(s.blocks), n: s.blocks },
    { key: 'duels', label: 'Duels won', value: pct(s.duelsWonPct), sub: `${s.duelsWon} won · ${s.duelsLost} lost`, n: s.duelsWonPct ?? -1 },
    { key: 'pressures', label: 'Pressing actions', value: String(s.pressures), n: s.pressures },
    { key: 'recoveries', label: 'Recoveries', value: String(s.recoveries), n: s.recoveries },
    { key: 'errors', label: 'Errors', value: String(s.errors), n: s.errors, lowerIsBetter: true },
    { key: 'lost', label: 'Lost possession', value: String(s.lostPossession), n: s.lostPossession, lowerIsBetter: true },
    { key: 'fouls', label: 'Fouls', value: String(s.fouls), n: s.fouls, lowerIsBetter: true },
    { key: 'cards', label: 'Cards', value: String(s.cards), n: s.cards, lowerIsBetter: true },
  ]
}

export function StatCards({ stats, className }: { stats: Stats; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}>
      {statItems(stats).map((s) => (
        <div key={s.key} className="panel px-3 py-2">
          <dt className="label">{s.label}</dt>
          <dd>
            <span className="timecode mt-0.5 block text-lg font-semibold leading-tight">{s.value}</span>
            {s.sub && <span className="block text-2xs text-muted">{s.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
