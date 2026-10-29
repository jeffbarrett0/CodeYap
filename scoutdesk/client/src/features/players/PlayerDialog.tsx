import { Camera, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import { useCan } from '@/store/hooks'
import type { Player } from '@/types'

export const POSITIONS = ['GK', 'RB', 'RWB', 'CB', 'LB', 'LWB', 'DM', 'CM', 'AM', 'RM', 'LM', 'RW', 'LW', 'CF', 'ST']

/** Create (player = null) or edit a player. Viewers get a read-only form. */
export function PlayerDialog({ player, defaultTeamId, onClose }: { player: Player | null; defaultTeamId?: string | null; onClose: () => void }) {
  const { teams, upsertPlayer, removePlayer } = useData()
  const { canWrite, isAdmin } = useCan()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState({
    name: player?.name ?? '',
    jersey: player?.jersey?.toString() ?? '',
    teamId: player?.teamId ?? defaultTeamId ?? '',
    positions: player?.positions ?? [],
    foot: player?.foot ?? '',
    heightCm: player?.heightCm?.toString() ?? '',
    age: player?.age?.toString() ?? '',
    nationality: player?.nationality ?? '',
    notes: player?.notes ?? '',
  })
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = photo ? URL.createObjectURL(photo) : player?.photoUrl ?? null
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    setBusy(true)
    try {
      const body = {
        name: f.name.trim(), jersey: num(f.jersey), teamId: f.teamId || null, positions: f.positions, foot: (f.foot || null) as Player['foot'],
        heightCm: num(f.heightCm), age: num(f.age), nationality: f.nationality.trim() || null, notes: f.notes,
      }
      let saved = player ? await api.patchPlayer(player.id, body) : await api.createPlayer(body)
      if (photo) saved = await api.uploadPlayerPhoto(saved.id, photo)
      upsertPlayer(saved)
      toast.success(player ? 'Player saved' : 'Player created')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save player')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!player || !confirm(`Delete ${player.name}? Their clips stay but lose the player link.`)) return
    try {
      await api.deletePlayer(player.id)
      removePlayer(player.id)
      toast.success('Player deleted')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={player ? (canWrite ? 'Edit player' : player.name) : 'New player'} className="max-w-xl">
        <DialogBody>
          <fieldset disabled={!canWrite || busy} className="space-y-3">
            <div className="flex items-center gap-3">
              <PlayerAvatar player={{ name: f.name || '?', photoUrl: preview }} size={56} />
              <div className="space-x-2">
                <Button size="sm" onClick={() => fileRef.current?.click()}><Camera className="h-3.5 w-3.5" /> {preview ? 'Change photo' : 'Add photo'}</Button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Player photo" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                <span className="text-2xs text-muted">JPG, PNG or WebP, up to 5 MB</span>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_72px] gap-3">
              <Field label="Name"><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Jersey"><Input inputMode="numeric" value={f.jersey} onChange={(e) => set('jersey', e.target.value.replace(/\D/g, '').slice(0, 2))} className="font-mono" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Team">
                <Select value={f.teamId} onChange={(e) => set('teamId', e.target.value)}>
                  <option value="">Free agent / unassigned</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Nationality"><Input value={f.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
            </div>
            <div className="space-y-1">
              <span className="label">Positions</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Positions">
                {POSITIONS.map((p) => {
                  const on = f.positions.includes(p)
                  return <button key={p} type="button" aria-pressed={on} onClick={() => set('positions', on ? f.positions.filter((x) => x !== p) : [...f.positions, p])} className={cn('h-6 min-w-[34px] rounded border px-1.5 font-mono text-2xs font-semibold transition-colors', on ? 'border-accent bg-accent/15 text-foreground' : 'border-border text-muted hover:text-foreground')}>{p}</button>
                })}
              </div>
              <p className="text-2xs text-muted">The first selected position is the primary one (used for position averages and formation placement).</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Foot"><Select value={f.foot} onChange={(e) => set('foot', e.target.value as typeof f.foot)}><option value="">—</option><option value="right">Right</option><option value="left">Left</option><option value="both">Both</option></Select></Field>
              <Field label="Height (cm)"><Input inputMode="numeric" value={f.heightCm} onChange={(e) => set('heightCm', e.target.value.replace(/\D/g, '').slice(0, 3))} className="font-mono" /></Field>
              <Field label="Age"><Input inputMode="numeric" value={f.age} onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 2))} className="font-mono" /></Field>
            </div>
            <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Strengths, weaknesses, scouting notes…" /></Field>
          </fieldset>
        </DialogBody>
        <DialogFooter className="justify-between">
          {player && isAdmin ? <Button variant="danger" size="sm" onClick={() => void remove()}><Trash2 className="h-3.5 w-3.5" /> Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{canWrite ? 'Cancel' : 'Close'}</Button>
            {canWrite && <Button variant="primary" disabled={busy || f.name.trim() === ''} onClick={() => void save()}>{player ? 'Save' : 'Create player'}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
