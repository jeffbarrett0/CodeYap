import { cn, readableOn } from '@/lib/utils'

export interface BannerTeam {
  name: string
  shortName?: string
  color?: string
  formation?: string | null
}

/** Shield crest with the club's initial; tinted with the team colour. */
export function Crest({ team, size = 44 }: { team: BannerTeam; size?: number }) {
  const color = team.color ?? '#64748b'
  const short = (team.shortName ?? team.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(1).map((w) => w[0]).join('')).slice(0, 3).toUpperCase()
  return (
    <svg viewBox="0 0 40 46" width={size} height={(size * 46) / 40} aria-hidden className="shrink-0">
      <path d="M20 2 37 8v16c0 10-8 17-17 20C11 41 3 34 3 24V8Z" fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.6} />
      <text x="20" y="25" textAnchor="middle" fontSize="17" fontWeight="700" fill="currentColor" style={{ fontFamily: 'inherit' }}>{team.name.trim()[0]?.toUpperCase()}</text>
      {short && <text x="20" y="35.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" opacity={0.75} style={{ fontFamily: 'inherit' }}>{short}</text>}
    </svg>
  )
}

export const STATUS_TONE = {
  success: 'border-success/40 text-success',
  warning: 'border-accent/40 text-accent',
  muted: 'border-border text-muted',
} as const

/**
 * The match header: competition · date · venue, both crests, the score, and who is home/away
 * with their formation. Used on the analysis screen and in the import preview.
 */
export function MatchBanner({ competition, date, venue, home, away, homeScore, awayScore, status, compact, className }: {
  competition: string
  date: string | null
  venue: string | null
  home: BannerTeam
  away: BannerTeam
  homeScore: number | null
  awayScore: number | null
  status?: { label: string; tone: keyof typeof STATUS_TONE }
  compact?: boolean
  className?: string
}) {
  const played = homeScore != null && awayScore != null
  const meta = [competition || 'Match', date, venue].filter(Boolean).join(' · ')
  return (
    <section aria-label={`${home.name} versus ${away.name}`} className={cn('relative rounded-lg border border-border bg-surface', compact ? 'px-4 py-2' : 'px-5 py-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="label truncate">{meta}</p>
        {status && <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-2xs font-medium', STATUS_TONE[status.tone])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status.label}</span>}
      </div>
      <div className={cn('grid grid-cols-[1fr_auto_1fr] items-center gap-4', compact ? 'mt-1' : 'mt-2')}>
        <div className="flex min-w-0 items-center justify-end gap-3">
          <div className="min-w-0 text-right">
            <p className={cn('truncate font-semibold', compact ? 'text-sm' : 'text-base')}>{home.name}</p>
            <p className="truncate text-2xs text-muted">Home{home.formation ? ` · ${home.formation}` : ''}</p>
          </div>
          <Crest team={home} size={compact ? 34 : 44} />
        </div>
        <div className="text-center">
          <p className={cn('timecode font-semibold tracking-wide', compact ? 'text-2xl' : 'text-3xl')} aria-label={played ? `Score ${homeScore} to ${awayScore}` : 'No score'}>{played ? `${homeScore} : ${awayScore}` : '– : –'}</p>
          <p className="label mt-0.5 text-[9px]">{played ? 'Full time' : 'Score unknown'}</p>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <Crest team={away} size={compact ? 34 : 44} />
          <div className="min-w-0">
            <p className={cn('truncate font-semibold', compact ? 'text-sm' : 'text-base')}>{away.name}</p>
            <p className="truncate text-2xs text-muted">Away{away.formation ? ` · ${away.formation}` : ''}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

export { readableOn }
