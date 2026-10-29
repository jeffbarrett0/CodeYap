import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { formatTimecode, frameAt, parseTimecode } from '@/lib/timecode'
import { useData } from '@/store/data'
import type { Match } from '@/types'
import { ColorPicker } from './ColorPicker'
import { DRAWING_NAME, LIGHT_DIRS, drawingLabel, isVisible, useDrawing, type Shape } from './drawing'
import { player, usePlayback } from './playback'

/** Start time of a drawing as text; applies on Enter / leaving the box. */
function StartField({ shape, fps }: { shape: Shape; fps: number }) {
  const update = useDrawing((s) => s.update)
  const shown = formatTimecode(shape.frame / fps, fps)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown, shape.id])
  const apply = () => {
    const t = parseTimecode(text, fps)
    if (t == null || t < 0) return setText(shown)
    update(shape.id, { frame: Math.round(t * fps) })
  }
  return <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} aria-label="Çizimin başlangıç zamanı" className="timecode" />
}


/**
 * Side tab for the selected drawing: name a player tag (type it or pick from the match lineups),
 * change a number, colour, thickness and how long the drawing stays on screen, or delete it.
 */
export function DrawingInspector({ match }: { match: Match }) {
  const { shapes, selectedId, update, remove, select, setColor, setWidth } = useDrawing()
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
      // Slightly delayed: the mouse press that placed the tag would otherwise take the focus back.
      const t = window.setTimeout(() => { nameRef.current?.focus(); nameRef.current?.select() }, 60)
      return () => window.clearTimeout(t)
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
              {here.map((s) => <li key={s.id}><button type="button" onClick={() => select(s.id)} className="w-full rounded border border-border px-2 py-1 text-left hover:bg-raised">{drawingLabel(s)}</button></li>)}
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
        <h3 className="text-sm font-semibold">{DRAWING_NAME[sel.type]}</h3>
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

      {(sel.type === 'player' || sel.type === 'number') && (
        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-muted">{sel.type === 'player' ? 'Yazı boyutu' : 'Numara boyutu'}</span>
          <input type="range" min={0.5} max={4} step={0.1} value={sel.size ?? 1} onChange={(e) => update(sel.id, { size: Number(e.target.value) })} aria-label={sel.type === 'player' ? 'Yazı boyutu' : 'Numara boyutu'} className="h-1 flex-1" />
          <span className="timecode w-9 text-right">{Math.round((sel.size ?? 1) * 100)}%</span>
        </label>
      )}
      {sel.type === 'zoom' && (
        <div className="space-y-2">
          <p className="text-muted">Close-up penceresinde sürükle: kaydır. Tekerlek: yakınlaştır/uzaklaştır. Kenardaki nokta: boyutu değiştir.</p>
          <label className="flex items-center gap-2"><span className="w-20 shrink-0 text-muted">Yakınlaştırma</span>
            <input type="range" min={0.4} max={8} step={0.1} value={sel.zk ?? 1} onChange={(e) => update(sel.id, { zk: Number(e.target.value) })} aria-label="Close-up yakınlaştırma" className="h-1 flex-1" />
            <span className="timecode w-9 text-right">{(sel.zk ?? 1).toFixed(1)}×</span></label>
          <label className="flex items-center gap-2"><span className="w-20 shrink-0 text-muted">Pencere</span>
            <input type="range" min={0.5} max={2} step={0.05} value={sel.zs ?? 1} onChange={(e) => update(sel.id, { zs: Number(e.target.value) })} aria-label="Close-up pencere boyutu" className="h-1 flex-1" />
            <span className="timecode w-9 text-right">{Math.round((sel.zs ?? 1) * 100)}%</span></label>
          <Button size="sm" variant="secondary" onClick={() => update(sel.id, { zdx: 0, zdy: 0, zk: 1 })}>Kaydırmayı sıfırla</Button>
        </div>
      )}

      {sel.type === 'spot' && (
        <div className="space-y-2">
          <div>
            <p className="label mb-1">Işığın yönü</p>
            <div className="grid grid-cols-2 gap-1">
              {LIGHT_DIRS.map((d) => <button key={d.id} type="button" aria-pressed={(sel.ldir ?? 'down') === d.id} onClick={() => update(sel.id, { ldir: d.id })} className={`rounded border px-2 py-1 ${(sel.ldir ?? 'down') === d.id ? 'border-accent bg-accent text-accent-foreground' : 'border-border hover:bg-raised'}`}>{d.label}</button>)}
            </div>
          </div>
          <label className="flex items-center gap-2"><span className="w-20 shrink-0 text-muted">Yoğunluk</span>
            <input type="range" min={0.1} max={1} step={0.05} value={sel.lint ?? 0.6} onChange={(e) => update(sel.id, { lint: Number(e.target.value) })} aria-label="Işık yoğunluğu" className="h-1 flex-1" />
            <span className="timecode w-9 text-right">{Math.round((sel.lint ?? 0.6) * 100)}%</span></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sel.lanim ?? true} onChange={(e) => update(sel.id, { lanim: e.target.checked })} aria-label="Işık ilerleyerek yayılsın" /> Süre boyunca ilerleyerek yayılsın</label>
        </div>
      )}

      <div className="space-y-2 rounded border border-border p-2">
        <p className="label">Zaman çizelgesindeki yeri</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Başlangıç"><StartField shape={sel} fps={fps} /></Field>
          <Field label="Süre (sn)" hint="0 = sadece o kare">
            <Input type="number" min={0} max={120} step={0.5} value={sel.hold} onChange={(e) => update(sel.id, { hold: Math.max(0, Number(e.target.value) || 0) })} aria-label="Çizimin süresi (sn)" />
          </Field>
        </div>
        <Button size="xs" variant="secondary" onClick={() => { player.pause(); player.seek((sel.frame + 0.5) / fps) }}>Bu çizimin başına git</Button>
      </div>

      <div>
        <p className="label mb-1">Renk</p>
        <ColorPicker value={sel.color} onChange={setColor} />
      </div>
      <label className="flex items-center gap-2 text-muted">Kalınlık
        <input type="range" min={2} max={14} value={Math.min(14, Math.max(2, Math.round(sel.width)))} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Çizgi kalınlığı" className="h-1 flex-1" />
      </label>
    </div>
  )
}
