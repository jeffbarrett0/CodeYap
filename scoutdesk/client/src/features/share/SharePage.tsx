import { AlertTriangle, Clock, Film, Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dot, EmptyState, Spinner } from '@/components/ui/misc'
import { formatClock } from '@/lib/timecode'
import { cn, formatDate } from '@/lib/utils'
import type { DisplayClip, SharePayload } from '@/types'
import { PlaylistPlayer, type PlayItem } from '../playlists/PlaylistPlayer'

type State =
  | { s: 'loading' }
  | { s: 'password'; label: string; wrong: boolean }
  | { s: 'error'; status: number; message: string }
  | { s: 'ready'; data: SharePayload }

const clipTitle = (c: DisplayClip) => `${c.tag}${c.player ? ` · ${c.player}` : ''}`

/** Public, read-only viewer for a shared playlist or match. No account, no sidebar, nothing editable. */
export function SharePage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<State>({ s: 'loading' })
  const key = `scoutdesk.share.${token}`

  const load = useCallback(async (password?: string) => {
    const pw = password ?? sessionStorage.getItem(key) ?? undefined
    const res = await fetch(`/api/public/shares/${encodeURIComponent(token)}`, { headers: pw ? { 'x-share-password': pw } : {} })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      if (pw) sessionStorage.setItem(key, pw)
      return setState({ s: 'ready', data: body as SharePayload })
    }
    if (res.status === 401 || (res.status === 403 && body.passwordRequired)) {
      sessionStorage.removeItem(key)
      return setState({ s: 'password', label: body.label ?? 'Shared video', wrong: res.status === 403 })
    }
    setState({ s: 'error', status: res.status, message: body.error ?? 'Something went wrong' })
  }, [token, key])
  useEffect(() => { void load().catch(() => setState({ s: 'error', status: 0, message: 'Could not reach the server' })) }, [load])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-4">
        <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden><rect x="6" y="9" width="20" height="14" rx="1.5" fill="none" stroke="hsl(var(--accent))" strokeWidth="2.4" /><path d="M16 9v14" stroke="hsl(var(--accent))" strokeWidth="2.4" /><circle cx="16" cy="16" r="3" fill="none" stroke="hsl(var(--accent))" strokeWidth="2.4" /></svg>
        <span className="text-sm font-semibold">ScoutDesk</span>
        <span className="text-xs text-muted">· shared, read-only</span>
        {state.s === 'ready' && <span className="ml-auto truncate text-xs text-muted">{state.data.label}{state.data.expiresAt ? ` · link expires ${formatDate(state.data.expiresAt)}` : ''}</span>}
      </header>
      <main className="min-h-0 flex-1">
        {state.s === 'loading' && <div className="flex h-full items-center justify-center" role="status"><Spinner /></div>}
        {state.s === 'password' && <PasswordGate label={state.label} wrong={state.wrong} onSubmit={(pw) => void load(pw)} />}
        {state.s === 'error' && (
          <EmptyState className="h-full" icon={state.status === 410 ? Clock : AlertTriangle} title={state.status === 410 ? 'This link has expired' : state.status === 404 ? 'This link is no longer available' : 'Can’t open this link'} description={state.status === 410 ? 'Ask the person who shared it for a new link.' : state.status === 404 ? 'It may have been revoked or never existed.' : state.message} />
        )}
        {state.s === 'ready' && (state.data.kind === 'playlist' ? <PlaylistView data={state.data} /> : <MatchView data={state.data} />)}
      </main>
    </div>
  )
}

function PasswordGate({ label, wrong, onSubmit }: { label: string; wrong: boolean; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState('')
  return (
    <form className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 px-6 text-center" onSubmit={(e) => { e.preventDefault(); if (pw) onSubmit(pw) }}>
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-raised"><Lock className="h-5 w-5 text-muted" /></div>
      <h1 className="text-sm font-semibold">{label}</h1>
      <p className="text-xs text-muted">This link is password protected.</p>
      <Input type="password" autoFocus autoComplete="off" aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" aria-invalid={wrong} />
      {wrong && <p role="alert" className="text-xs text-danger">Wrong password. Try again.</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={!pw}>Open</Button>
    </form>
  )
}

function PlaylistView({ data }: { data: Extract<SharePayload, { kind: 'playlist' }> }) {
  const [index, setIndex] = useState(0)
  const items = useMemo<PlayItem[]>(() => data.items.map((i) => ({ id: i.id, title: i.title || clipTitle(i.clip), subtitle: i.clip.notes || undefined, videoId: i.clip.videoId, start: i.clip.startSec, end: i.clip.endSec, transition: i.transition })), [data])
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="min-h-0 flex-1"><PlaylistPlayer className="h-full" items={items} videos={data.videos} index={index} onIndexChange={setIndex} /></div>
      <aside className="max-h-48 shrink-0 overflow-y-auto border-t border-border md:max-h-none md:w-80 md:border-l md:border-t-0" aria-label="Clips in this playlist">
        <div className="border-b border-border px-3 py-2"><h1 className="text-sm font-semibold">{data.title}</h1>{data.description && <p className="text-xs text-muted">{data.description}</p>}</div>
        <ol>
          {data.items.map((it, i) => (
            <li key={it.id}>
              <button type="button" onClick={() => setIndex(i)} aria-current={i === index} className={cn('flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-xs hover:bg-raised/50', i === index && 'bg-accent/10')}>
                <span className="timecode w-5 text-right text-muted">{i + 1}</span><Dot color={it.clip.color} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.title || clipTitle(it.clip)}</span><span className="block truncate text-2xs text-muted">{it.clip.notes || it.clip.category}</span></span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}

function MatchView({ data }: { data: Extract<SharePayload, { kind: 'match' }> }) {
  const video = data.videos.find((v) => v.angle === 'Main') ?? data.videos[0]
  const ref = useRef<HTMLVideoElement>(null)
  const stopAt = useRef<number | null>(null)
  const [cat, setCat] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const cats = useMemo(() => [...new Map(data.clips.map((c) => [c.category, c.color]))], [data.clips])
  const clips = data.clips.filter((c) => !cat || c.category === cat)

  const play = (c: DisplayClip) => {
    const v = ref.current
    if (!v) return
    setActive(c.id)
    v.currentTime = c.startSec
    stopAt.current = c.endSec
    void v.play().catch(() => {})
  }
  if (!video) return <EmptyState className="h-full" icon={Film} title="No video available" />
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="flex min-h-0 flex-1 flex-col bg-black">
        <video ref={ref} src={video.streamUrl} controls playsInline preload="metadata" className="min-h-0 flex-1" aria-label={`${data.match.home} v ${data.match.away}`} onTimeUpdate={(e) => { if (stopAt.current != null && e.currentTarget.currentTime >= stopAt.current) { e.currentTarget.pause(); stopAt.current = null } }} onSeeking={() => { /* manual scrubbing cancels clip auto-stop */ }} onPlay={() => undefined} />
        <div className="shrink-0 border-t border-border bg-surface px-4 py-2 text-xs"><strong>{data.match.home}</strong> <span className="timecode mx-1 rounded bg-raised px-1.5 py-0.5">{data.match.homeScore ?? '–'} – {data.match.awayScore ?? '–'}</span> <strong>{data.match.away}</strong><span className="ml-2 text-muted">{formatDate(data.match.date)} · {data.match.competition}</span></div>
      </div>
      <aside className="flex max-h-64 shrink-0 flex-col border-t border-border md:max-h-none md:w-96 md:border-l md:border-t-0" aria-label="Tagged clips">
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
          <button type="button" aria-pressed={!cat} onClick={() => setCat('')} className={cn('rounded border px-2 py-0.5 text-2xs', !cat ? 'border-accent bg-accent/15' : 'border-border text-muted')}>All ({data.clips.length})</button>
          {cats.map(([name, color]) => <button key={name} type="button" aria-pressed={cat === name} onClick={() => setCat(cat === name ? '' : name)} className={cn('flex items-center gap-1 rounded border px-2 py-0.5 text-2xs', cat === name ? 'border-accent bg-accent/15' : 'border-border text-muted')}><Dot color={color} />{name}</button>)}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {clips.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => play(c)} aria-current={active === c.id} className={cn('flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-xs hover:bg-raised/50', active === c.id && 'bg-accent/10')}>
                <span className="timecode w-10 text-muted">{formatClock(c.timeSec)}</span><Dot color={c.color} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{clipTitle(c)}</span>{c.notes && <span className="block truncate text-2xs text-muted">{c.notes}</span>}</span>
                <span className={cn('text-2xs', c.outcome === 'success' ? 'text-success' : c.outcome === 'fail' ? 'text-danger' : 'text-muted')}>{c.outcome === 'success' ? '✓' : c.outcome === 'fail' ? '✗' : '–'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
