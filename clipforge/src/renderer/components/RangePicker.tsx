import { useMemo, useRef, useState } from 'react'
import { buildSegments } from '@shared/transcript/sentences'
import { timelineWords } from '@shared/timeline/transcript'
import { TRAILER_MAX_SEG } from '@shared/trailer'
import { useStore } from '../store'
import { fmt } from './ui'

const r1 = (n: number) => Math.round(n * 10) / 10
const WINDOWS = [30, 60, 120, 300] as const

/**
 * Fare ile aralık seçici: ÜSTTE tüm videoyu (örn. 20 dk) gösteren şerit — tıkla/sürükle: ayrıntı penceresi oraya gider; ALTTA o bölgenin
 * ayrıntılı şeridi — sürükleyerek aralığı seç (saniye yazmak gerekmez). Üzerinde gezinirken o sırada ne konuşulduğu görünür.
 * Seçilen aralık `onChange(başlangıç, bitiş)` ile bildirilir (sn). Daha önce eklenen aralıklar renkli blok olarak gösterilir.
 */
export function RangePicker({ total, from, to, taken, min, onChange }: { total: number; from: number; to: number; taken: { start: number; end: number }[]; min: number; onChange: (a: number, b: number) => void }) {
  const playhead = useStore((s) => s.playhead)
  const tl = useStore((s) => s.project.timeline)
  const transcripts = useStore((s) => s.transcripts)
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(60)
  const [wStart, setWStart] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const drag = useRef<{ kind: 'overview' | 'detail'; anchor: number } | null>(null)

  const sentences = useMemo(() => {
    const words = timelineWords(tl, transcripts)
    return words.length ? buildSegments(words) : []
  }, [tl, transcripts])
  const textAt = (t: number) => sentences.find((s) => t >= s.start - 0.2 && t <= s.end + 0.2)?.text

  const wLen = Math.min(win, Math.max(5, total))
  const ws = Math.min(Math.max(0, wStart), Math.max(0, total - wLen))
  const clamp = (t: number) => Math.min(total, Math.max(0, t))
  const dur = to - from
  const bad = dur < min - 0.01 || dur > TRAILER_MAX_SEG + 0.01

  const xToTime = (e: React.PointerEvent<HTMLDivElement>, kind: 'overview' | 'detail') => {
    const rect = e.currentTarget.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return kind === 'overview' ? f * total : ws + f * wLen
  }
  const centerOn = (t: number) => setWStart(clamp(t - wLen / 2))

  if (!(total > 1)) return <div className="hint" data-testid="range-empty">Zaman çizelgesi boş: önce videoyu çizelgeye ekleyin; sonra burada fareyle seçebilirsiniz.</div>

  const tickEvery = total > 3600 ? 600 : total > 900 ? 120 : total > 300 ? 60 : 30
  const ticks: number[] = []
  for (let t = 0; t <= total; t += tickEvery) ticks.push(t)
  const pct = (t: number, a: number, len: number) => `${((t - a) / len) * 100}%`
  const detailTicks: number[] = []
  const dEvery = wLen <= 30 ? 5 : wLen <= 60 ? 10 : wLen <= 120 ? 20 : 60
  for (let t = Math.ceil(ws / dEvery) * dEvery; t <= ws + wLen; t += dEvery) detailTicks.push(t)

  const barBase = { position: 'relative', border: '1px solid var(--border, #2a3a30)', borderRadius: 6, background: 'var(--panel2, #0f1a14)', overflow: 'hidden', cursor: 'crosshair', touchAction: 'none', userSelect: 'none' } as const
  const selColor = bad ? 'rgba(229,72,77,.45)' : 'rgba(80,200,120,.45)'

  return (
    <div className="col" style={{ gap: 6 }} data-testid="range-picker">
      <div className="hint">Üstteki şeritte vlogun tamamı ({fmt(total)}): bir yere tıkla ya da sürükle → altta o bölge büyür. <b>Alttaki şeritte sürükleyerek aralığı seç.</b></div>
      <div
        style={{ ...barBase, height: 34 }}
        data-testid="range-overview"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { kind: 'overview', anchor: 0 }; centerOn(xToTime(e, 'overview')) }}
        onPointerMove={(e) => { setHover(xToTime(e, 'overview')); if (drag.current?.kind === 'overview') centerOn(xToTime(e, 'overview')) }}
        onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => setHover(null)}
      >
        {taken.map((s, i) => <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(s.start, 0, total), width: `${Math.max(0.4, ((s.end - s.start) / total) * 100)}%`, background: 'rgba(250,200,60,.6)' }} title="Eklenmiş aralık" />)}
        {to > from && <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(from, 0, total), width: `${Math.max(0.4, (dur / total) * 100)}%`, background: selColor }} />}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(ws, 0, total), width: `${(wLen / total) * 100}%`, border: '2px solid #fff', boxSizing: 'border-box', borderRadius: 4, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(playhead, 0, total), width: 2, background: '#ff5252', pointerEvents: 'none' }} title="Oynatma başlığı" />
        {ticks.map((t) => <span key={t} style={{ position: 'absolute', left: pct(t, 0, total), bottom: 0, fontSize: 9, opacity: 0.7, paddingLeft: 2, pointerEvents: 'none' }}>{fmt(t)}</span>)}
      </div>

      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn sm" onClick={() => setWStart(clamp(ws - wLen / 2))} aria-label="Geri" data-testid="range-prev">◀</button>
        <label className="row" style={{ gap: 4 }}>Ayrıntı penceresi
          <select value={win} onChange={(e) => { const v = Number(e.target.value) as (typeof WINDOWS)[number]; setWin(v); setWStart(clamp(ws + wLen / 2 - Math.min(v, total) / 2)) }} aria-label="Ayrıntı penceresi" data-testid="range-window">
            {WINDOWS.map((w) => <option key={w} value={w}>{w < 60 ? `${w} sn` : `${w / 60} dk`}</option>)}
          </select>
        </label>
        <button className="btn sm" onClick={() => setWStart(clamp(ws + wLen / 2))} aria-label="İleri" data-testid="range-next">▶</button>
        <button className="btn sm" onClick={() => centerOn(playhead)} title="Pencereyi oynatma başlığına götür">oynatma başlığına git</button>
        <span className="hint">{fmt(ws)} – {fmt(ws + wLen)}</span>
      </div>

      <div
        style={{ ...barBase, height: 64 }}
        data-testid="range-detail"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const t = r1(xToTime(e, 'detail')); drag.current = { kind: 'detail', anchor: t }; onChange(t, t) }}
        onPointerMove={(e) => {
          const t = xToTime(e, 'detail')
          setHover(t)
          if (drag.current?.kind === 'detail') {
            const a = drag.current.anchor
            const b = r1(t)
            onChange(Math.min(a, b), Math.max(a, b))
          }
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => setHover(null)}
      >
        {taken.map((s, i) => (s.end > ws && s.start < ws + wLen ? <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(Math.max(s.start, ws), ws, wLen), width: `${((Math.min(s.end, ws + wLen) - Math.max(s.start, ws)) / wLen) * 100}%`, background: 'rgba(250,200,60,.45)' }} /> : null))}
        {to > from && to > ws && from < ws + wLen && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(Math.max(from, ws), ws, wLen), width: `${((Math.min(to, ws + wLen) - Math.max(from, ws)) / wLen) * 100}%`, background: selColor, borderLeft: '2px solid #fff', borderRight: '2px solid #fff', boxSizing: 'border-box' }} data-testid="range-selection">
            <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 11, fontWeight: 700 }}>{dur.toFixed(1)} sn</span>
          </div>
        )}
        {playhead >= ws && playhead <= ws + wLen && <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(playhead, ws, wLen), width: 2, background: '#ff5252', pointerEvents: 'none' }} />}
        {detailTicks.map((t) => <span key={t} style={{ position: 'absolute', left: pct(t, ws, wLen), bottom: 0, fontSize: 9, opacity: 0.7, borderLeft: '1px solid #ffffff40', paddingLeft: 2, height: 14, pointerEvents: 'none' }}>{fmt(t)}</span>)}
      </div>

      <div className="hint" style={{ minHeight: 18 }} data-testid="range-hover">
        {hover !== null ? <><b>{fmt(hover)}</b>{textAt(hover) ? ` · “${textAt(hover)}”` : ''}</> : 'Üzerine gelince o anda söylenen cümle görünür.'}
      </div>
      <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
        <span className="hint">İnce ayar:</span>
        <button className="btn sm" onClick={() => onChange(Math.max(0, r1(from - 0.5)), to)} data-testid="range-start-minus">başlangıç −0,5</button>
        <button className="btn sm" onClick={() => onChange(Math.min(r1(from + 0.5), to), to)}>+0,5</button>
        <button className="btn sm" onClick={() => onChange(from, Math.max(from, r1(to - 0.5)))}>bitiş −0,5</button>
        <button className="btn sm" onClick={() => onChange(from, Math.min(total, r1(to + 0.5)))}>+0,5</button>
        {to > from && <span className="hint">{fmt(from)} → {fmt(to)} · {dur.toFixed(1)} sn{bad ? ' (uygun değil)' : ''}</span>}
      </div>
    </div>
  )
}
