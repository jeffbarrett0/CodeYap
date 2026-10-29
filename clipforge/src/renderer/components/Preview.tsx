import { useCallback, useEffect, useRef, useState } from 'react'
import { timelineDuration } from '@shared/timeline/model'
import { requireApi } from '../api'
import { PreviewEngine, previewSize } from '../preview/engine'
import { useStore } from '../store'
import { fmt } from './ui'
import { LayerOverlay } from './Layers'

function Scrubber({ value, max, onSeek, range, marks }: { value: number; max: number; onSeek: (t: number) => void; range?: [number, number]; marks?: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const seek = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    onSeek(Math.min(max, Math.max(0, ((clientX - r.left) / r.width) * max)))
  }
  const pct = (t: number) => `${(Math.min(max, Math.max(0, t)) / Math.max(max, 0.001)) * 100}%`
  return (
    <div
      className="scrub"
      ref={ref}
      role="slider"
      aria-label="Konum"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seek(e.clientX)
      }}
      onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(max, value + 1))
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, value - 1))
      }}
    >
      <div className="bar" />
      {range && <div className="range" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />}
      {marks?.map((m, i) => <div key={i} className="mark" style={{ left: pct(m) }} />)}
      <div className="head" style={{ left: pct(value) }} />
    </div>
  )
}

/** Kaynak kaydı oynatır (proxy); klip taslağı varken sınırlar üzerinden ince ayar yapılır. */
function SourcePlayer() {
  const { project, selectedAssetId, sourceTime, setSourceTime, clipDraft, patchDraft, snapDraft } = useStore()
  const asset = project.assets.find((a) => a.id === (clipDraft?.assetId ?? selectedAssetId))
  const api = requireApi()
  const vref = useRef<HTMLVideoElement>(null)
  const aref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const selfSet = useRef(0)
  const videoUrl = asset ? api.mediaUrl(asset, 'video') : null
  const audioUrl = asset && asset.audioStreams.length ? api.mediaUrl(asset, 'audio', asset.audioMap.mix) : null
  const markers = (asset && project.markers[asset.id]?.map((m) => m.time)) || []

  // dışarıdan gelen arama (sonuç tıklama vb.)
  useEffect(() => {
    const v = vref.current
    if (!v) return
    if (Math.abs(v.currentTime - sourceTime) > 0.25 && Math.abs(selfSet.current - sourceTime) > 0.01) {
      v.currentTime = sourceTime
      if (aref.current) aref.current.currentTime = sourceTime
    }
  }, [sourceTime])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = vref.current
      if (v && !v.paused) {
        selfSet.current = v.currentTime
        setSourceTime(v.currentTime)
        const a = aref.current
        if (a && Math.abs(a.currentTime - v.currentTime) > 0.2) a.currentTime = v.currentTime
        if (clipDraft && v.currentTime >= clipDraft.end) {
          v.pause()
          aref.current?.pause()
          setPlaying(false)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [setSourceTime, clipDraft])

  const toggle = useCallback(() => {
    const v = vref.current
    if (!v) return
    if (v.paused) {
      if (clipDraft && (v.currentTime >= clipDraft.end - 0.05 || v.currentTime < clipDraft.start)) v.currentTime = clipDraft.start
      void v.play().catch(() => undefined)
      void aref.current?.play().catch(() => undefined)
      setPlaying(true)
    } else {
      v.pause()
      aref.current?.pause()
      setPlaying(false)
    }
  }, [clipDraft])

  const dur = asset?.durationSec ?? 0
  return (
    <>
      <div className="stage-area">
        {asset ? (
          <video ref={vref} src={videoUrl ?? undefined} muted playsInline preload="auto" data-testid="source-video" />
        ) : (
          <div className="empty">Bir kayıt içe aktarın ve seçin.</div>
        )}
        {audioUrl && <audio ref={aref} src={audioUrl} preload="auto" />}
      </div>
      <div className="transport">
        <button className="btn icon" onClick={toggle} disabled={!asset} aria-label={playing ? 'Duraklat' : 'Oynat'}>{playing ? '⏸' : '▶'}</button>
        <button className="btn icon" onClick={() => setSourceTime(sourceTime - 5)} aria-label="5 sn geri">−5</button>
        <button className="btn icon" onClick={() => setSourceTime(sourceTime + 5)} aria-label="5 sn ileri">+5</button>
        <span className="tc" data-testid="source-tc">{fmt(sourceTime, true)} / {fmt(dur)}</span>
        <Scrubber value={sourceTime} max={dur} onSeek={setSourceTime} range={clipDraft ? [clipDraft.start, clipDraft.end] : undefined} marks={markers} />
        {clipDraft && (
          <>
            <button className="btn sm" onClick={() => patchDraft({ start: sourceTime })} title="Başlangıcı buraya al">[ Baş</button>
            <button className="btn sm" onClick={() => patchDraft({ end: sourceTime })} title="Bitişi buraya al">Son ]</button>
            <button className="btn sm" onClick={() => snapDraft('start')} title="Başlangıcı en yakın cümle başına yapıştır">⇤ cümle</button>
            <button className="btn sm" onClick={() => snapDraft('end')} title="Bitişi en yakın cümle sonuna yapıştır">cümle ⇥</button>
          </>
        )}
      </div>
    </>
  )
}

/** Zaman çizelgesi önizlemesi: canvas bileşimi + senkron gizli medya öğeleri. */
function TimelinePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PreviewEngine | null>(null)
  const rateRef = useRef(1)
  const [rate, setRate] = useState(1)
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  const tl = useStore((s) => s.project.timeline)
  const total = timelineDuration(tl)
  const { width, height } = previewSize(tl)
  // Canvas, alanı en-boy oranını koruyarak doldurur; katman tutamaçları aynı kutuya oturur
  const areaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth - 20
      const ch = el.clientHeight - 20
      const ar = width / height
      const w = Math.max(0, Math.min(cw, ch * ar))
      setBox({ w, h: w / ar })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, height])

  useEffect(() => {
    engineRef.current = new PreviewEngine(requireApi())
    return () => engineRef.current?.dispose()
  }, [])

  // oynatma saati
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const st = useStore.getState()
      const r = rateRef.current
      const next = st.playhead + dt * r
      const end = timelineDuration(st.project.timeline)
      if (next >= end && r > 0) {
        st.setPlayhead(end)
        st.setPlaying(false)
        return
      }
      if (next <= 0 && r < 0) {
        st.setPlayhead(0)
        st.setPlaying(false)
        return
      }
      st.setPlayhead(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // her değişiklikte (playhead, timeline, ayarlar) yeniden çiz
  useEffect(() => {
    const eng = engineRef.current
    const c = canvasRef.current
    if (!eng || !c) return
    const st = useStore.getState()
    eng.sync(tl, st.project.assets, playhead, playing && rateRef.current > 0, Math.abs(rateRef.current) || 1)
    const ctx = c.getContext('2d')
    if (ctx) eng.draw(ctx, c.width, c.height, tl, st.project.assets, playhead, !st.playing)
  }, [playhead, tl, playing, width, height])

  // video kareleri sonradan yüklenince de çiz
  useEffect(() => {
    if (!playing) {
      const id = setInterval(() => {
        const eng = engineRef.current
        const c = canvasRef.current
        const st = useStore.getState()
        const ctx = c?.getContext('2d')
        if (eng && c && ctx) eng.draw(ctx, c.width, c.height, st.project.timeline, st.project.assets, st.playhead, true)
      }, 250)
      return () => clearInterval(id)
    }
  }, [playing])

  // J/K/L hız ayarı için dışarıdan olay
  useEffect(() => {
    const h = (e: Event) => {
      const r = (e as CustomEvent<number>).detail
      rateRef.current = r
      setRate(r)
    }
    window.addEventListener('cf-rate', h)
    return () => window.removeEventListener('cf-rate', h)
  }, [])

  const { setPlayhead, setPlaying } = useStore.getState()
  return (
    <>
      <div className="stage-area" ref={areaRef}>
        <div className="canvas-box" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} width={width} height={height} data-testid="timeline-canvas" aria-label="Zaman çizelgesi önizlemesi" />
          <LayerOverlay />
        </div>
      </div>
      <div className="transport">
        <button className="btn icon" onClick={() => { rateRef.current = 1; setRate(1); setPlaying(!playing) }} aria-label={playing ? 'Duraklat' : 'Oynat'} data-testid="tl-play">{playing ? '⏸' : '▶'}</button>
        <button className="btn icon" onClick={() => setPlayhead(playhead - 1 / tl.fps)} aria-label="Bir kare geri">◂</button>
        <button className="btn icon" onClick={() => setPlayhead(playhead + 1 / tl.fps)} aria-label="Bir kare ileri">▸</button>
        <span className="tc" data-testid="tl-tc">{fmt(playhead, true)} / {fmt(total)}</span>
        <Scrubber value={playhead} max={Math.max(total, 1)} onSeek={setPlayhead} />
        {rate !== 1 && <span className="badge">{rate}×</span>}
      </div>
    </>
  )
}

export function Preview() {
  const { viewMode, setViewMode, project, clipDraft } = useStore()
  const tl = project.timeline
  return (
    <section className="stage-wrap" aria-label="Önizleme">
      <div className="stage-top">
        <button className={`btn sm${viewMode === 'source' ? ' active' : ''}`} onClick={() => setViewMode('source')} data-testid="mode-source">Kaynak</button>
        <button className={`btn sm${viewMode === 'timeline' ? ' active' : ''}`} onClick={() => setViewMode('timeline')} data-testid="mode-timeline">Zaman çizelgesi ({tl.aspect})</button>
        <span className="spacer" />
        {clipDraft && viewMode === 'source' && <span className="badge green">Klip sınırı ince ayarı: {fmt(clipDraft.start, true)} → {fmt(clipDraft.end, true)}</span>}
      </div>
      {viewMode === 'source' ? <SourcePlayer /> : <TimelinePreview />}
    </section>
  )
}
