import { Clock, CornerDownRight, MessageSquare, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatClock } from '@/lib/timecode'
import { initials } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import type { ClipComment } from '@/types'
import { player } from './playback'

const MENTION = /@(\d{1,2}:\d{2}(?::\d{2})?)/g

export function mentionSeconds(text: string): number {
  const parts = text.split(':').map(Number)
  return parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!
}

/** Render a comment body, turning `@m:ss` mentions into buttons that seek the video. */
export function CommentBody({ text }: { text: string }) {
  const nodes: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(MENTION)) {
    nodes.push(text.slice(last, m.index))
    const t = mentionSeconds(m[1]!)
    nodes.push(
      <button key={m.index} type="button" onClick={() => (player.skip(0), player.seek(t))} title={`Jump to ${m[1]}`} aria-label={`Jump to ${m[1]}`} className="timecode inline-flex items-center gap-0.5 rounded bg-accent/15 px-1 text-accent hover:bg-accent/25">
        <Clock className="h-2.5 w-2.5" />{m[1]}
      </button>,
    )
    last = m.index! + m[0].length
  }
  nodes.push(text.slice(last))
  return <>{nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`
}

/** Threaded comments on a clip. Type `@1:23` to reference a moment; the button inserts the playhead time. */
export function ClipComments({ clipId, canComment }: { clipId: string; canComment: boolean }) {
  const userId = useApp((s) => s.userId)
  const myRole = useData((s) => s.users.find((u) => u.id === userId)?.role)
  const [list, setList] = useState<ClipComment[] | null>(null)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(() => api.comments(clipId).then(setList).catch(() => setList([])), [clipId])
  useEffect(() => { setList(null); void load() }, [load])

  const threads = useMemo(() => {
    const top = (list ?? []).filter((c) => !c.parentId)
    return top.map((c) => ({ c, replies: (list ?? []).filter((r) => r.parentId === c.id) }))
  }, [list])

  const post = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const c = await api.createComment({ clipId, body: text.trim(), parentId: replyTo })
      setList((l) => [...(l ?? []), c])
      setText('')
      setReplyTo(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not post comment') } finally { setBusy(false) }
  }
  const remove = async (c: ClipComment) => {
    try { await api.deleteComment(c.id); setList((l) => (l ?? []).filter((x) => x.id !== c.id && x.parentId !== c.id)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete') }
  }
  const row = (c: ClipComment, reply = false) => (
    <li key={c.id} className={reply ? 'ml-6 mt-1.5' : 'mt-2'}>
      <div className="flex gap-2">
        <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-black" style={{ background: c.author.color }}>{initials(c.author.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs"><strong className="text-xs">{c.author.name}</strong> <span className="text-muted">{ago(c.createdAt)}</span></p>
          <p className="whitespace-pre-wrap break-words text-xs"><CommentBody text={c.body} /></p>
          <div className="mt-0.5 flex gap-2 text-2xs text-muted">
            {!reply && canComment && <button type="button" className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => { setReplyTo(c.id); box.current?.focus() }}><CornerDownRight className="h-2.5 w-2.5" /> Reply</button>}
            {(c.author.id === userId || myRole === "admin") && <button type="button" aria-label="Delete comment" className="inline-flex items-center gap-0.5 hover:text-danger" onClick={() => void remove(c)}><Trash2 className="h-2.5 w-2.5" /> Delete</button>}
          </div>
        </div>
      </div>
    </li>
  )

  return (
    <section aria-label="Comments" className="space-y-2 border-t border-border pt-3">
      <h3 className="label flex items-center gap-1.5"><MessageSquare className="h-3 w-3" /> Comments {list && list.length > 0 && <span className="timecode text-muted">({list.length})</span>}</h3>
      {list === null ? <p className="text-xs text-muted">Loading…</p> : threads.length === 0 ? <p className="text-xs text-muted">No comments yet.</p> : (
        <ul>{threads.map(({ c, replies }) => <Fragment key={c.id}>{row(c)}{replies.map((r) => row(r, true))}</Fragment>)}</ul>
      )}
      {canComment ? (
        <div className="space-y-1">
          {replyTo && <p className="flex items-center justify-between text-2xs text-muted">Replying in thread <button type="button" className="hover:text-foreground" onClick={() => setReplyTo(null)}>Cancel</button></p>}
          <Textarea ref={box} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post() }} placeholder="Add a comment… use @1:23 to reference a moment" aria-label="Write a comment" />
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="xs" onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${formatClock(player.currentTime)} `)}><Clock className="h-3 w-3" /> Insert time</Button>
            <Button variant="primary" size="xs" disabled={busy || !text.trim()} onClick={() => void post()}>{replyTo ? 'Reply' : 'Comment'}</Button>
          </div>
        </div>
      ) : <p className="text-2xs text-muted">Viewers can read comments but not post.</p>}
    </section>
  )
}
