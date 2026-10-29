import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { useState } from 'react'
import { MatchBanner } from '@/components/MatchBanner'
import { Button } from '@/components/ui/button'
import { useLookups } from '@/store/hooks'
import { useCan } from '@/store/hooks'
import type { Match } from '@/types'
import { ImportMatchDialog } from '../matches/ImportMatchDialog'

const STATUS = { untagged: { label: 'Untagged', tone: 'muted' }, in_progress: { label: 'In review', tone: 'warning' }, complete: { label: 'Tagged', tone: 'success' } } as const

/** Match info strip at the top of the analysis screen (collapsible to win back vertical space). */
export function MatchHeader({ match }: { match: Match }) {
  const { teamById } = useLookups()
  const { canWrite } = useCan()
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('scoutdesk.header') !== 'closed' } catch { return true } })
  const [importing, setImporting] = useState(false)
  const home = teamById.get(match.homeTeamId)
  const away = teamById.get(match.awayTeamId)
  if (!home || !away) return null
  const toggle = () => { setOpen((o) => { try { localStorage.setItem('scoutdesk.header', o ? 'closed' : 'open') } catch { /* ignore */ } return !o }) }

  return (
    <div className="relative shrink-0 border-b border-border bg-background px-3 py-2">
      {open ? (
        <MatchBanner compact competition={match.competition} date={match.date.slice(0, 10)} venue={match.venue} home={home} away={away} homeScore={match.homeScore} awayScore={match.awayScore} status={STATUS[match.tagStatus]} />
      ) : (
        <p className="flex items-center justify-center gap-3 text-xs"><strong>{home.name}</strong><span className="timecode rounded bg-raised px-1.5">{match.homeScore ?? '–'} : {match.awayScore ?? '–'}</span><strong>{away.name}</strong><span className="text-muted">{match.competition} · {match.date.slice(0, 10)}</span></p>
      )}
      <div className="absolute right-4 top-3 flex items-center gap-1" style={{ top: open ? 38 : 6 }}>
        {canWrite && open && <Button variant="ghost" size="xs" onClick={() => setImporting(true)} title="Fill in this match from a SofaScore / Transfermarkt / other link"><Download className="h-3 w-3" /> Import from link</Button>}
        <Button variant="ghost" size="icon-sm" aria-label={open ? 'Collapse match header' : 'Expand match header'} aria-expanded={open} onClick={toggle}>{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</Button>
      </div>
      {importing && <ImportMatchDialog targetMatchId={match.id} onClose={() => setImporting(false)} onDone={() => setImporting(false)} />}
    </div>
  )
}
