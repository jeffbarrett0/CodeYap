import { Copy, Link2, Lock, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import type { ShareLink } from '@/types'

const EXPIRY = [{ v: '', l: 'Never expires' }, { v: '1', l: '1 day' }, { v: '7', l: '7 days' }, { v: '30', l: '30 days' }, { v: '90', l: '90 days' }]

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`

/** Create / list / revoke read-only links (optional password and expiry) for a playlist or match. */
export function ShareDialog({ kind, refId, label, onClose }: { kind: 'playlist' | 'match'; refId: string; label: string; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [password, setPassword] = useState('')
  const [days, setDays] = useState('7')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api.shares(kind, refId).then(setLinks).catch(() => setLinks([])), [kind, refId])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    setBusy(true)
    try {
      const s = await api.createShare({ kind, refId, password: password || undefined, expiresInDays: days ? Number(days) : undefined })
      await navigator.clipboard?.writeText(shareUrl(s.token)).catch(() => {})
      toast.success('Link created and copied')
      setPassword('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create link') } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Share “${label}”`} description="Anyone with the link can watch read-only — no account needed." className="max-w-lg">
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Password (optional)" hint="At least 4 characters"><Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="No password" /></Field>
            <Field label="Expires"><Select value={days} onChange={(e) => setDays(e.target.value)}>{EXPIRY.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</Select></Field>
          </div>
          <Button variant="primary" disabled={busy || (password.length > 0 && password.length < 4)} onClick={() => void create()}><Link2 className="h-3.5 w-3.5" /> Create link</Button>

          <div>
            <h3 className="label mb-1.5">Active links</h3>
            {links === null ? <p className="text-xs text-muted">Loading…</p> : links.length === 0 ? <p className="text-xs text-muted">No links yet.</p> : (
              <ul className="divide-y divide-border rounded border border-border">
                {links.map((l) => {
                  const expired = l.expiresAt && new Date(l.expiresAt) < new Date()
                  return (
                    <li key={l.id} className="flex items-center gap-2 px-2.5 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-2xs">{shareUrl(l.token)}</p>
                        <p className="text-2xs text-muted">
                          {l.hasPassword && <span className="mr-2 inline-flex items-center gap-0.5"><Lock className="h-2.5 w-2.5" /> password</span>}
                          {expired ? <span className="text-danger">expired</span> : l.expiresAt ? `expires ${formatDate(l.expiresAt)}` : 'no expiry'} · {l.views} view{l.views === 1 ? '' : 's'}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(shareUrl(l.token)); toast.success('Link copied') }}><Copy className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Revoke link" onClick={() => void api.deleteShare(l.id).then(load)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
