import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cmd } from '@shared/timeline/commands'
import { clipDuration, clipEnd, groupMembers, timelineDuration } from '@shared/timeline/model'
import { snapPoints } from '@shared/timeline/ops'
import type { Clip, Track } from '@shared/types'
import { useStore } from '../store'
import { fmt } from './ui'

const ROLE_CLASS: Record<string, string> = { screen: 'screen', webcam: 'webcam', game: 'game', voice: 'voice', mix: 'mix' }

function tickStep(zoom: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((s) => s * zoom >= 72) ?? 600
}

interface DragState {
  mode: 'move' | 'trimL' | 'trimR'
  clip: Clip
  x0: number
  moved: boolean
}

export function Timeline() {
  const { project, selection, select, playhead, setPlayhead, zoom, setZoom, exec, undo, redo, historyVersion, splitAtPlayhead, deleteSelection, playing, setPlaying, viewMode, setViewMode } = useStore()
  const tl = project.timeline
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const total = timelineDuration(tl)
  const width = Math.max((total + 20) * zoom, 800)
  const step = tickStep(zoom)
  void historyVersion

  // Satırların (iz) sırası: görünür sıra tl.tracks sırasıdır (V2 üstte)
  const tracks = tl.tracks
  const selGroups = useMemo(() => {
    const ids = new Set<string>()
    for (const id of selection) for (const m of groupMembers(tl, id)) ids.add(m.id)
    return ids
  }, [selection, tl])

  const timeFromEvent = useCallback((clientX: number) => {
    const el = scrollRef.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, (clientX - r.left + el.scrollLeft) / zoom)
  }, [zoom])

  const snap = (t: number, exclude: string[]): number => {
    const pts = [...snapPoints(tl, exclude), playhead]
    const thr = 8 / zoom
    let best = t
    let bd = thr
    for (const p of pts) {
      const d = Math.abs(p - t)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  const onClipDown = (e: React.PointerEvent, clip: Clip, track: Track) => {
    e.stopPropagation()
    if (track.locked) return select([clip.id])
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const off = e.clientX - rect.left
    const mode: DragState['mode'] = off < 8 ? 'trimL' : off > rect.width - 8 ? 'trimR' : 'move'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, clip, x0: e.clientX, moved: false }
    if (e.shiftKey) select(selection.includes(clip.id) ? selection.filter((x) => x !== clip.id) : [...selection, clip.id])
    else if (!selection.includes(clip.id)) select([clip.id])
  }

  const onClipMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x0) / zoom
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return
    d.moved = true
    const ids = groupMembers(tl, d.clip.id).map((c) => c.id)
    if (d.mode === 'move') {
      let s = d.clip.start + dx
      // başlangıç ya da bitiş kenarı yapışsın
      const a = snap(s, ids)
      const b = snap(s + clipDuration(d.clip), ids) - clipDuration(d.clip)
      s = Math.abs(a - s) <= Math.abs(b - s) ? a : b
      // dikey: aynı türden başka ize bırak
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.laneId) as HTMLElement | undefined
      exec(cmd.move(d.clip.id, Math.max(0, s), under?.dataset.laneId))
    } else if (d.mode === 'trimL') {
      exec(cmd.trimStart(d.clip.id, snap(d.clip.start + dx, ids)))
    } else {
      const assets = useStore.getState().project.assets
      exec(cmd.trimEnd(d.clip.id, snap(clipEnd(d.clip) + dx, ids), (c) => assets.find((a) => a.id === c.assetId)?.durationSec ?? Infinity))
    }
  }

  const onClipUp = () => {
    drag.current = null
  }

  // Cetvel: tıkla / sürükle ile oynatma başlığı
  const scrubFrom = (e: React.PointerEvent) => {
    if (viewMode !== 'timeline') setViewMode('timeline')
    setPlayhead(timeFromEvent(e.clientX))
  }

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
    }
  }

  // Oynatma başlığı görünür kalsın
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = playhead * zoom
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }, [playhead, zoom, playing])

  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = 0; t <= (width / zoom); t += step) out.push(t)
    return out
  }, [width, zoom, step])

  return (
    <section className="timeline" aria-label="Zaman çizelgesi" data-testid="timeline">
      <div className="tl-toolbar">
        <button className="btn sm icon" onClick={undo} disabled={!useStore.getState().canUndo()} title="Geri al (Ctrl+Z)" aria-label="Geri al" data-testid="undo">↶</button>
        <button className="btn sm icon" onClick={redo} disabled={!useStore.getState().canRedo()} title="Yinele (Ctrl+Shift+Z)" aria-label="Yinele" data-testid="redo">↷</button>
        <span style={{ width: 8 }} />
        <button className="btn sm" onClick={splitAtPlayhead} title="Oynatma başlığında böl (S)" data-testid="split">✂ Böl</button>
        <button className="btn sm danger" onClick={deleteSelection} disabled={selection.length === 0} title="Sil (Delete)" data-testid="delete">Sil</button>
        <span style={{ width: 8 }} />
        <button className="btn sm" onClick={() => { setViewMode('timeline'); setPlaying(!playing) }} aria-label="Oynat/duraklat (Space)">{playing ? '⏸' : '▶'} <kbd>Space</kbd></button>
        <span className="tc" style={{ marginLeft: 6 }}>{fmt(playhead, true)}</span>
        <span className="spacer" />
        <span className="hint">J/K/L · S böl · Del sil · ←/→ kare</span>
        <label className="row" style={{ gap: 6, marginLeft: 12 }}>
          <span className="hint">Yakınlaştır</span>
          <input style={{ width: 120 }} type="range" min={Math.log(4)} max={Math.log(400)} step={0.01} value={Math.log(zoom)} onChange={(e) => setZoom(Math.exp(Number(e.target.value)))} aria-label="Yakınlaştırma" />
        </label>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <div style={{ height: 26, borderBottom: '1px solid var(--border)' }} />
          {tracks.map((t) => (
            <div key={t.id} className="tl-label" data-testid={`label-${t.id}`}>
              <div className="tn">
                <span>{t.name}</span>
                <span className="row" style={{ gap: 3 }}>
                  <button className={t.muted ? 'on' : ''} title={t.kind === 'video' ? 'Gizle' : 'Sustur'} aria-label={`${t.name} ${t.kind === 'video' ? 'gizle' : 'sustur'}`} onClick={() => exec(cmd.track(t.id, { muted: !t.muted }))}>{t.kind === 'video' ? 'G' : 'M'}</button>
                  <button className={t.locked ? 'on' : ''} title="Kilitle" aria-label={`${t.name} kilitle`} onClick={() => exec(cmd.track(t.id, { locked: !t.locked }))}>K</button>
                </span>
              </div>
              <span className="hint">{t.id}</span>
            </div>
          ))}
          <div className="tl-label"><div className="tn"><span>Altyazı</span></div><span className="hint">CC</span></div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onWheel={onWheel} onPointerDown={(e) => e.target === e.currentTarget && select([])}>
          <div className="tl-content" style={{ width }} onPointerDown={(e) => { if ((e.target as HTMLElement).dataset.laneId || (e.target as HTMLElement).classList.contains('tl-content')) select([]) }}>
            <div
              className="tl-ruler"
              data-testid="ruler"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubFrom(e) }}
              onPointerMove={(e) => e.buttons === 1 && scrubFrom(e)}
            >
              {ticks.map((t) => (
                <div key={t} className="tl-tick" style={{ left: t * zoom }}>{fmt(t)}</div>
              ))}
            </div>
            {tracks.map((t) => (
              <div
                key={t.id}
                className="tl-lane"
                data-lane-id={t.id}
                data-testid={`lane-${t.id}`}
                onPointerDown={(e) => { if (e.target === e.currentTarget) { select([]); if (viewMode !== 'timeline') setViewMode('timeline'); setPlayhead(timeFromEvent(e.clientX)) } }}
              >
                {t.clips.map((c) => (
                  <div
                    key={c.id}
                    className={`tl-clip ${ROLE_CLASS[t.role] ?? ''}${selection.includes(c.id) ? ' sel' : ''}${selGroups.has(c.id) && !selection.includes(c.id) ? ' grp' : ''}${t.locked ? ' locked' : ''}`}
                    style={{ left: c.start * zoom, width: Math.max(4, clipDuration(c) * zoom) }}
                    title={`${c.label}\nKaynak: ${fmt(c.srcIn)}–${fmt(c.srcOut)}`}
                    data-testid="clip"
                    data-clip-id={c.id}
                    onPointerDown={(e) => onClipDown(e, c, t)}
                    onPointerMove={onClipMove}
                    onPointerUp={onClipUp}
                    onPointerCancel={onClipUp}
                  >
                    <span className="h l" />
                    {c.label}
                    <span className="h r" />
                  </div>
                ))}
              </div>
            ))}
            <div className="tl-lane" data-testid="lane-CC">
              {tl.captions.map((c) => (
                <div key={c.id} className="tl-clip cap" style={{ left: c.start * zoom, width: Math.max(4, (c.end - c.start) * zoom) }} title={c.text}>{c.text}</div>
              ))}
            </div>
            <div className="tl-playhead" style={{ left: playhead * zoom }} data-testid="playhead" />
          </div>
        </div>
      </div>
    </section>
  )
}
