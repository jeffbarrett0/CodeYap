import { useEffect, useRef } from 'react'
import { clipEnd } from '@shared/timeline/model'
import type { Clip, MediaAsset, NormRect, Timeline } from '@shared/types'
import { containRect } from '../preview/engine'
import { useStore } from '../store'
import { Num } from './ui'

/**
 * Sağ tıklanan noktadaki (yoksa seçili / en üstteki) görünür video-görsel klibini bulur.
 * `point`: canvas kutusuna göre 0..1; yoksa yalnızca seçime / en üst katmana bakılır.
 */
export function findCropTarget(tl: Timeline, t: number, selection: string[], point?: { x: number; y: number }): Clip | null {
  const active = (tracks: typeof tl.tracks) =>
    tracks
      .filter((tr) => (tr.kind === 'video' || tr.kind === 'image') && tr.placement?.visible)
      .map((tr) => ({ tr, clip: tr.clips.find((c) => t >= c.start && t < clipEnd(c)) }))
      .filter((x): x is { tr: (typeof tl.tracks)[number]; clip: Clip } => !!x.clip)
  const list = active(tl.tracks) // iz sırası = üstten alta
  if (point) {
    const hit = list.find(({ tr }) => {
      const r = tr.placement!.rect
      return point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h
    })
    if (hit) return hit.clip
  }
  const sel = list.find(({ clip }) => selection.includes(clip.id))
  if (sel) return sel.clip
  if (list[0]) return list[0].clip
  // Oynatma başlığının altında görünür klip yoksa: seçili klip, o da yoksa ilk video/görsel klibi
  const all = tl.tracks.filter((tr) => (tr.kind === 'video' || tr.kind === 'image') && tr.placement?.visible).flatMap((tr) => tr.clips)
  return all.find((c) => selection.includes(c.id)) ?? all.sort((a, b) => a.start - b.start)[0] ?? null
}

export interface MenuState {
  x: number
  y: number
  clipId: string | null
}

/** Önizlemede sağ tıkla açılan menü: "Crop / Kırp" (ve varsa "Kırpmayı sıfırla"). */
export function PreviewContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { project, startCrop, setCrop, toast } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  const clip = menu.clipId ? project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === menu.clipId) : undefined

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
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
          if (!clip) return toast('info', 'Kırpılacak bir video/görsel bulunamadı: oynatma başlığının altında görünür bir video katmanı olmalı.')
          startCrop(clip.id)
        }}
      >
        ✂ Crop / Kırp
      </button>
      {clip?.crop && (
        <button role="menuitem" data-testid="ctx-crop-reset" onClick={() => { onClose(); setCrop(clip.id, undefined) }}>
          ↺ Kırpmayı sıfırla
        </button>
      )}
    </div>
  )
}

type H = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'
const HANDLES: H[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * Kırpma modu: klibin TAMAMI katman alanına sığdırılmış gösterilir; üstündeki kırpma dikdörtgeninin
 * kenar/köşe tutamaçları sürüklenerek (özellikle alt kenar yukarı doğru) serbestçe kırpılır.
 * Kırpma, kaynak karesine göre normalize (x, y, w, h) olarak klipte saklanır ve dışa aktarmaya aynen yansır.
 */
export function CropOverlay({ boxW, boxH }: { boxW: number; boxH: number }) {
  const { project, cropClipId, setCrop, endCrop } = useStore()
  const drag = useRef<{ mode: H; x0: number; y0: number; c: NormRect } | null>(null)
  const found = cropClipId ? project.timeline.tracks.map((t) => ({ t, c: t.clips.find((c) => c.id === cropClipId) })).find((x) => x.c) : undefined

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && endCrop()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [endCrop])

  if (!found || !found.c || !found.t.placement) return null
  const { t: track, c: clip } = found
  const asset: MediaAsset | undefined = project.assets.find((a) => a.id === clip.assetId)
  const sw = asset?.width || 16
  const sh = asset?.height || 9
  const r = track.placement!.rect
  // klibin sığdırılmış tam karesi (canvas kutusu içinde, piksel)
  const frame = containRect(sw, sh, { x: r.x * boxW, y: r.y * boxH, w: r.w * boxW, h: r.h * boxH })
  const crop: NormRect = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x0) / frame.w
    const dy = (e.clientY - d.y0) / frame.h
    const MIN = 0.05
    let { x, y, w, h } = d.c
    if (d.mode === 'move') {
      x = Math.min(1 - w, Math.max(0, d.c.x + dx))
      y = Math.min(1 - h, Math.max(0, d.c.y + dy))
    } else {
      if (d.mode.includes('e')) w = Math.min(1 - d.c.x, Math.max(MIN, d.c.w + dx))
      if (d.mode.includes('s')) h = Math.min(1 - d.c.y, Math.max(MIN, d.c.h + dy))
      if (d.mode.includes('w')) {
        const nx = Math.min(d.c.x + d.c.w - MIN, Math.max(0, d.c.x + dx))
        w = d.c.w + (d.c.x - nx)
        x = nx
      }
      if (d.mode.includes('n')) {
        const ny = Math.min(d.c.y + d.c.h - MIN, Math.max(0, d.c.y + dy))
        h = d.c.h + (d.c.y - ny)
        y = ny
      }
    }
    setCrop(clip.id, { x, y, w, h })
  }
  const down = (e: React.PointerEvent, mode: H) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, x0: e.clientX, y0: e.clientY, c: { ...crop } }
  }
  const pct = (v: number) => `${v * 100}%`
  const bottomCut = Math.round((1 - crop.y - crop.h) * 1000) / 10

  return (
    <div className="crop-overlay" data-testid="crop-overlay">
      <div className="crop-bar" onPointerDown={(e) => e.stopPropagation()}>
        <b>Kırp</b>
        <label className="row" style={{ gap: 4 }}>
          <span className="hint">Alttan %</span>
          <Num value={bottomCut} step={1} min={0} max={95} label="Alttan kırp (%)" onChange={(v) => setCrop(clip.id, { ...crop, h: Math.max(0.05, 1 - crop.y - Math.min(95, Math.max(0, v)) / 100) })} />
        </label>
        <button className="btn sm" onClick={() => setCrop(clip.id, undefined)} data-testid="crop-reset">Sıfırla</button>
        <button className="btn sm primary" onClick={endCrop} data-testid="crop-done">Bitti</button>
      </div>
      {/* tam kare çerçevesi */}
      <div className="crop-frame" style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}>
        {/* kırpılacak (dışarıda kalan) bölgeler gölgelenir */}
        <div className="crop-shade" style={{ left: 0, top: 0, width: '100%', height: pct(crop.y) }} />
        <div className="crop-shade" style={{ left: 0, top: pct(crop.y + crop.h), width: '100%', height: pct(1 - crop.y - crop.h) }} />
        <div className="crop-shade" style={{ left: 0, top: pct(crop.y), width: pct(crop.x), height: pct(crop.h) }} />
        <div className="crop-shade" style={{ left: pct(crop.x + crop.w), top: pct(crop.y), width: pct(1 - crop.x - crop.w), height: pct(crop.h) }} />
        <div
          className="crop-rect"
          style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
          onPointerDown={(e) => down(e, 'move')}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          data-testid="crop-rect"
        >
          {HANDLES.map((m) => (
            <span key={m} className={`hd hd-${m} crop-hd`} onPointerDown={(e) => down(e, m)} onPointerMove={move} onPointerUp={() => (drag.current = null)} data-testid={`crop-hd-${m}`} />
          ))}
        </div>
      </div>
    </div>
  )
}
