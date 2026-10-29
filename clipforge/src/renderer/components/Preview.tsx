import { useCallback, useEffect, useRef, useState } from 'react'
import { timelineDuration } from '@shared/timeline/model'
import { requireApi } from '../api'
import { PreviewEngine, previewSize } from '../preview/engine'
import { useStore } from '../store'
import { fmt } from './ui'
import { LayerOverlay } from './Layers'
import { CaptionOverlay } from './CaptionOverlay'
import { CropOverlay, findCropTarget, PreviewContextMenu, type MenuState } from './CropTools'

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
  const { project, selectedAssetId, sourceTime, setSourceTime, clipDraft, patchDraft, snapDraft, playRequest } = useStore()
  const asset = project.assets.find((a) => a.id === (clipDraft?.assetId ?? selectedAssetId))
  const api = requireApi()
  const vref = useRef<HTMLVideoElement>(null)
  const aref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const selfSet = useRef(0)
  const isVideo = asset?.kind === 'video'
  const isImage = asset?.kind === 'image'
  const videoUrl = asset && isVideo ? api.mediaUrl(asset, 'video') : null
  const audioUrl = asset && asset.audioStreams.length ? api.mediaUrl(asset, 'audio', asset.audioMap.mix) : null
  const imageUrl = asset && isImage ? api.mediaUrl(asset, 'image') : null
  const markers = (asset && project.markers[asset.id]?.map((m) => m.time)) || []
  const audioPending = !!asset && !api.isMock && asset.audioStreams.length > 0 && !asset.audioStreams[asset.audioMap.mix]?.proxyPath && !/\.(mp4|m4v|mov|webm|mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(asset.path)
  /** Zamanı yöneten öğe: video varsa video (ses ayrı <audio>'dan), ses dosyasında <audio>'nun kendisi */
  const master = () => (isVideo ? vref.current : aref.current)

  // dışarıdan gelen arama (sonuç tıklama vb.)
  useEffect(() => {
    const m = master()
    if (!m) return
    if (Math.abs(m.currentTime - sourceTime) > 0.25 && Math.abs(selfSet.current - sourceTime) > 0.01) {
      m.currentTime = sourceTime
      if (isVideo && aref.current) aref.current.currentTime = sourceTime
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTime])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const m = master()
      if (m && !m.paused) {
        selfSet.current = m.currentTime
        setSourceTime(m.currentTime)
        const a = aref.current
        if (isVideo && a && Math.abs(a.currentTime - m.currentTime) > 0.2) a.currentTime = m.currentTime
        if (clipDraft && m.currentTime >= clipDraft.end) {
          m.pause()
          aref.current?.pause()
          setPlaying(false)
        }
      } else if (m && m.paused && playing && m.ended) setPlaying(false)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSourceTime, clipDraft, isVideo, playing])

  const play = useCallback(() => {
    const m = master()
    if (!m) return
    if (clipDraft && (m.currentTime >= clipDraft.end - 0.05 || m.currentTime < clipDraft.start)) m.currentTime = clipDraft.start
    void m.play().catch(() => undefined)
    if (isVideo) void aref.current?.play().catch(() => undefined)
    setPlaying(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipDraft, isVideo])

  const toggle = useCallback(() => {
    const m = master()
    if (!m) return
    if (m.paused) play()
    else {
      m.pause()
      aref.current?.pause()
      setPlaying(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, isVideo])

  // Kütüphanede bir dosyaya tıklanınca (playRequest artar) seçilen dosya BAŞTAN otomatik oynatılır
  useEffect(() => {
    if (playRequest === 0 || !asset || isImage) return
    let cancelled = false
    const start = () => {
      if (cancelled) return
      const m = master()
      if (!m) return
      m.currentTime = 0
      if (aref.current) aref.current.currentTime = 0
      play()
    }
    // öğenin kaynağı yeni atanmış olabilir: hazır olunca (ya da hemen) başlat
    const m = master()
    if (m && m.readyState >= 2) start()
    else {
      const t = setTimeout(() => {
        const mm = master()
        if (!mm) return
        if (mm.readyState >= 2) start()
        else mm.addEventListener('canplay', start, { once: true })
      }, 0)
      return () => (cancelled = true, clearTimeout(t))
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequest])

  const dur = asset?.durationSec ?? 0
  return (
    <>
      <div
        className="stage-area"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, clipId: null })
        }}
      >
        {asset && isVideo && <video ref={vref} src={videoUrl ?? undefined} muted playsInline preload="auto" data-testid="source-video" />}
        {asset && isImage && <img src={imageUrl ?? undefined} alt={asset.name} className="source-image" data-testid="source-image" />}
        {asset && asset.kind === 'audio' && <div className="empty" data-testid="source-audio">Ses dosyası: {asset.name}</div>}
        {!asset && <div className="empty">Soldaki kütüphaneden bir dosya seçin.</div>}
        {audioUrl && <audio ref={aref} src={audioUrl} preload="auto" onEnded={() => !isVideo && setPlaying(false)} />}
        {menu && <SourceCropMenu menu={menu} onClose={() => setMenu(null)} />}
      </div>
      <div className="transport">
        <button className="btn icon" onClick={toggle} disabled={!asset || isImage} aria-label={playing ? 'Duraklat' : 'Oynat'} data-testid="source-play">{playing ? '⏸' : '▶'}</button>
        <button className="btn icon" onClick={() => setSourceTime(sourceTime - 5)} disabled={isImage} aria-label="5 sn geri">−5</button>
        <button className="btn icon" onClick={() => setSourceTime(sourceTime + 5)} disabled={isImage} aria-label="5 sn ileri">+5</button>
        {audioPending && <span className="badge warn" title="Önizleme kopyası bitince ses de çalar" data-testid="audio-pending">Ses önizlemesi hazırlanıyor…</span>}
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
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [menu, setMenu] = useState<MenuState | null>(null)
  const cropClipId = useStore((s) => s.cropClipId)
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
    eng.cropClipId = st.cropClipId
    eng.sync(tl, st.project.assets, playhead, playing && rateRef.current > 0, Math.abs(rateRef.current) || 1)
    const ctx = c.getContext('2d')
    if (ctx) eng.draw(ctx, c.width, c.height, tl, st.project.assets, playhead, !st.playing)
  }, [playhead, tl, playing, width, height, cropClipId])

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
      <div
        className="stage-area"
        ref={areaRef}
        onContextMenu={(e) => {
          // Orta düzenleme alanında sağ tık: "Crop / Kırp" menüsü
          e.preventDefault()
          const st = useStore.getState()
          const r = boxRef.current?.getBoundingClientRect()
          const pt = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } : undefined
          const target = findCropTarget(st.project.timeline, st.playhead, st.selection, pt)
          setMenu({ x: e.clientX, y: e.clientY, clipId: target?.id ?? null })
        }}
      >
        <div className="canvas-box" ref={boxRef} style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} width={width} height={height} data-testid="timeline-canvas" aria-label="Zaman çizelgesi önizlemesi" />
          {cropClipId ? (
            <CropOverlay boxW={box.w} boxH={box.h} />
          ) : (
            <>
              <LayerOverlay />
              <CaptionOverlay />
            </>
          )}
        </div>
        {menu && <PreviewContextMenu menu={menu} onClose={() => setMenu(null)} />}
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

/** Kaynak görünümünde sağ tık: kırpma zaman çizelgesindeki klip üzerinde yapıldığı için oraya yönlendirir. */
function SourceCropMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: Event) => (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) && onClose()
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])
  return (
    <div className="ctx-menu" ref={ref} style={{ left: menu.x, top: menu.y }} role="menu" data-testid="ctx-menu">
      <button
        role="menuitem"
        data-testid="ctx-crop"
        onClick={() => {
          onClose()
          const st = useStore.getState()
          const target = findCropTarget(st.project.timeline, st.playhead, st.selection)
          if (!target) return st.toast('info', 'Kırpmak için önce klibi zaman çizelgesine ekleyin; kırpma zaman çizelgesindeki klip üzerinde yapılır.')
          st.startCrop(target.id)
        }}
      >
        ✂ Crop / Kırp
      </button>
    </div>
  )
}
