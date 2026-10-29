import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { frameAt } from '@/lib/timecode'
import { cn } from '@/lib/utils'
import { useData } from '@/store/data'
import type { Match } from '@/types'
import { DRAW_COLORS, isVisible, useDrawing, type Shape } from './drawing'
import { usePlayback } from './playback'

const NAME: Record<Shape['type'], string> = {
  arrow: 'Ok', line: 'Çizgi', circle: 'Daire', zoom: 'Zoom (Player close up)', spot: 'Aydınlatma', link: 'Bağlantı', run: 'Koşu oku', area: 'Alan', number: 'Numara', player: 'Oyuncu',
}
const label = (s: Shape) => (s.type === 'player' ? `Oyuncu: ${s.text || '—'}` : s.type === 'number' ? `Numara ${s.text ?? ''}` : NAME[s.type])

/**
 * Side tab for the selected drawing: name a player tag (type it or pick from the match lineups),
 * change a number, colour, thickness and how long the drawing stays on screen, or delete it.
 */
export function DrawingInspector({ match }: { match: Match }) {
  const { shapes, selectedId, update, remove, select, setColor, setWidth, setHold } = useDrawing()
  const players = useData((s) => s.players)
  const teams = useData((s) => s.teams)
  const time = usePlayback((s) => s.time)
  const fps = usePlayback((s) => s.fps)
  const frame = frameAt(time, fps)
  const sel = shapes.find((s) => s.id === selectedId)
  const nameRef = useRef<HTMLInputElement>(null)

  const here = useMemo(() => shapes.filter((s) => isVisible(s, frame, fps, false)), [shapes, frame, fps])

  // The match's players: lineup first, then everyone from the two teams.
  const squad = useMemo(() => {
    const ids = new Set([...(match.lineups?.home ?? []), ...(match.lineups?.away ?? [])])
    const list = players.filter((p) => ids.has(p.id) || p.teamId === match.homeTeamId || p.teamId === match.awayTeamId)
    return list.sort((a, b) => Number(ids.has(b.id)) - Number(ids.has(a.id)) || (a.jersey ?? 99) - (b.jersey ?? 99))
  }, [players, match])
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.shortName ?? ''

  // A freshly placed player tag opens straight in the name box.
  useEffect(() => {
    if (sel?.type === 'player' && (sel.text === 'Oyuncu' || !sel.text)) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [sel?.id, sel?.type]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sel) {
    return (
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        <p className="text-muted">Bir çizime tıkla; adını, rengini ve süresini burada değiştirirsin. Oyuncu etiketinin adını da buradan yazarsın.</p>
        <div>
          <p className="label mb-1">Bu karedeki çizimler</p>
          {here.length === 0 ? <p className="text-muted">Bu karede çizim yok.</p> : (
            <ul className="space-y-1">
              {here.map((s) => <li key={s.id}><button type="button" onClick={() => select(s.id)} className="w-full rounded border border-border px-2 py-1 text-left hover:bg-raised">{label(s)}</button></li>)}
            </ul>
          )}
        </div>
      </div>
    )
  }

  const q = (sel.text ?? '').toLowerCase()
  const suggestions = squad.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 12)

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{NAME[sel.type]}</h3>
        <Button size="sm" variant="ghost" onClick={() => remove(sel.id)} aria-label="Bu çizimi sil"><Trash2 className="h-3.5 w-3.5" /> Sil</Button>
      </div>

      {sel.type === 'player' && (
        <div className="space-y-2">
          <Field label="Oyuncu adı" hint="Videodaki etikette bu yazar.">
            <Input ref={nameRef} value={sel.text ?? ''} onChange={(e) => update(sel.id, { text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="Oyuncu" aria-label="Oyuncu adı" />
          </Field>
          {suggestions.length > 0 && (
            <div>
              <p className="label mb-1">Maçın oyuncularından seç</p>
              <div className="flex flex-wrap gap-1">
                {suggestions.map((p) => (
                  <button key={p.id} type="button" onClick={() => update(sel.id, { text: p.name })} className="rounded border border-border px-1.5 py-0.5 hover:bg-raised">
                    {p.jersey != null && <span className="timecode mr-1 text-muted">{p.jersey}</span>}{p.name}{teamName(p.teamId) && <span className="ml-1 text-2xs text-muted">{teamName(p.teamId)}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {sel.type === 'number' && (
        <Field label="Numara"><Input value={sel.text ?? ''} maxLength={3} onChange={(e) => update(sel.id, { text: e.target.value })} aria-label="Numara" className="w-24" /></Field>
      )}

      <div>
        <p className="label mb-1">Renk</p>
        <div className="flex gap-1.5">
          {DRAW_COLORS.map((c) => <button key={c} type="button" aria-label={`Renk ${c}`} aria-pressed={sel.color === c} onClick={() => setColor(c)} className={cn('h-6 w-6 rounded-full border-2', sel.color === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />)}
        </div>
      </div>
      <label className="flex items-center gap-2 text-muted">Kalınlık
        <input type="range" min={2} max={14} value={Math.min(14, Math.max(2, Math.round(sel.width)))} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Çizgi kalınlığı" className="h-1 flex-1" />
      </label>
      <Field label="Çizim süresi" hint="Videoda oynarken ne kadar kalsın?">
        <Select value={String(sel.hold)} onChange={(e) => setHold(Number(e.target.value))} aria-label="Seçili çizimin süresi">
          <option value="0">Sadece bu kare</option>
          {[2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} sn</option>)}
        </Select>
      </Field>
    </div>
  )
}
