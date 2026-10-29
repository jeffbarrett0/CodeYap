import { useRef, useState } from 'react'
import { cmd } from '@shared/timeline/commands'
import { aspectSize, newId } from '@shared/timeline/model'
import type { AspectRatio, NormRect, TextAnimation, Track } from '@shared/types'
import { useStore } from '../store'
import { Field, Num, Slider } from './ui'

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Mode[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SNAP = 0.012

function snapAxis(start: number, size: number, others: number[]): number {
  // sol kenar, orta ve sağ kenar kare kenarlarına / ortasına / diğer katmanlara yapışır
  let best = start
  let bd = SNAP
  for (const o of [0, 0.5, 1, ...others]) {
    for (const off of [0, size / 2, size]) {
      const d = Math.abs(start + off - o)
      if (d < bd) (bd = d, (best = o - off))
    }
  }
  return best
}

/** Önizleme üzerinde katmanları sürükle-bırak ile taşıma ve 8 tutamaçla boyutlandırma. */
export function LayerOverlay() {
  const tl = useStore((s) => s.project.timeline)
  const selected = useStore((s) => s.selectedLayerId)
  const selectLayer = useStore((s) => s.selectLayer)
  const exec = useStore((s) => s.exec)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; mode: Mode; x0: number; y0: number; r: NormRect } | null>(null)
  const layers = tl.tracks.filter((t) => t.placement && (t.placement.visible || t.id === selected))

  const down = (e: React.PointerEvent, t: Track, mode: Mode) => {
    if (e.button !== 0) return // sağ tık bağlam menüsü içindir
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    selectLayer(t.id)
    drag.current = { id: t.id, mode, x0: e.clientX, y0: e.clientY, r: { ...(t.placement as NonNullable<Track['placement']>).rect } }
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    const box = ref.current?.getBoundingClientRect()
    if (!d || !box) return
    const dx = (e.clientX - d.x0) / box.width
    const dy = (e.clientY - d.y0) / box.height
    const MIN = 0.03
    let { x, y, w, h } = d.r
    const others = tl.tracks.filter((t) => t.placement?.visible && t.id !== d.id).flatMap((t) => [t.placement!.rect.x, t.placement!.rect.x + t.placement!.rect.w])
    const othersY = tl.tracks.filter((t) => t.placement?.visible && t.id !== d.id).flatMap((t) => [t.placement!.rect.y, t.placement!.rect.y + t.placement!.rect.h])
    if (d.mode === 'move') {
      x = snapAxis(d.r.x + dx, w, others)
      y = snapAxis(d.r.y + dy, h, othersY)
    } else {
      if (d.mode.includes('e')) w = Math.max(MIN, d.r.w + dx)
      if (d.mode.includes('s')) h = Math.max(MIN, d.r.h + dy)
      if (d.mode.includes('w')) {
        const nx = Math.min(d.r.x + d.r.w - MIN, d.r.x + dx)
        w = d.r.w + (d.r.x - nx)
        x = nx
      }
      if (d.mode.includes('n')) {
        const ny = Math.min(d.r.y + d.r.h - MIN, d.r.y + dy)
        h = d.r.h + (d.r.y - ny)
        y = ny
      }
    }
    exec(cmd.placement(d.id, { rect: { x, y, w, h } }))
  }

  return (
    <div className="layer-overlay" ref={ref} onPointerDown={(e) => e.button === 0 && selectLayer(null)} data-testid="layer-overlay">
      {[...layers].reverse().map((t) => {
        const r = t.placement!.rect
        const sel = t.id === selected
        return (
          <div
            key={t.id}
            className={`ly${sel ? ' sel' : ''}${t.placement!.visible ? '' : ' off'}`}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            onPointerDown={(e) => down(e, t, 'move')}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            data-testid={`ly-${t.id}`}
            title={`${t.name} — sürükleyerek taşıyın`}
          >
            {sel && <span className="ly-name">{t.name}</span>}
            {sel &&
              HANDLES.map((m) => (
                <span key={m} className={`hd hd-${m}`} onPointerDown={(e) => down(e, t, m)} onPointerMove={move} onPointerUp={() => (drag.current = null)} data-testid={`hd-${t.id}-${m}`} />
              ))}
          </div>
        )
      })}
    </div>
  )
}

const FONTS = ['Impact', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Trebuchet MS', 'Courier New']
const ANIMS: [TextAnimation, string][] = [['none', 'Yok'], ['fade', 'Belirme'], ['pulse', 'Nabız (vurgu)'], ['slide-up', 'Aşağıdan kayma']]
const KIND: Record<string, string> = { video: '🎞', image: '🖼', text: 'T' }

function LayerDetail({ track }: { track: Track }) {
  const { exec } = useStore()
  const pl = track.placement!
  const r = pl.rect
  const patchRect = (p: Partial<NormRect>) => exec(cmd.placement(track.id, { rect: { ...r, ...p } }))
  const pct = (v: number) => Math.round(v * 1000) / 10
  const textClip = track.clips.find((c) => c.text)
  const spec = textClip?.text ?? track.textDefault
  const setText = (patch: Partial<NonNullable<typeof spec>>) => {
    if (textClip) exec(cmd.textSpec(textClip.id, patch))
    else if (track.textDefault) exec(cmd.updateTrackText(track.id, { ...track.textDefault, ...patch }))
  }
  return (
    <div className="col" data-testid="layer-detail">
      <div className="section-title">Seçili katman: {track.name}</div>
      <label className="check"><input type="checkbox" checked={pl.visible} onChange={() => useStore.getState().toggleLayerVisible(track.id)} data-testid="layer-visible" /> Görünür</label>
      <div className="grid2">
        <Field label="X (%)"><Num value={pct(r.x)} step={0.5} label="X" onChange={(v) => patchRect({ x: v / 100 })} /></Field>
        <Field label="Y (%)"><Num value={pct(r.y)} step={0.5} label="Y" onChange={(v) => patchRect({ y: v / 100 })} /></Field>
        <Field label="Genişlik (%)"><Num value={pct(r.w)} step={0.5} min={1} label="Genişlik" onChange={(v) => patchRect({ w: Math.max(0.01, v / 100) })} /></Field>
        <Field label="Yükseklik (%)"><Num value={pct(r.h)} step={0.5} min={1} label="Yükseklik" onChange={(v) => patchRect({ h: Math.max(0.01, v / 100) })} /></Field>
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => exec(cmd.placement(track.id, { rect: { x: 0, y: 0, w: 1, h: 1 } }))}>Tam kare</button>
        <button className="btn sm" onClick={() => exec(cmd.placement(track.id, { rect: { x: 0, y: 0, w: 1, h: 0.5 } }))}>Üst yarı</button>
        <button className="btn sm" onClick={() => exec(cmd.placement(track.id, { rect: { x: 0, y: 0.5, w: 1, h: 0.5 } }))}>Alt yarı</button>
        <button className="btn sm" onClick={() => patchRect({ x: (1 - r.w) / 2, y: (1 - r.h) / 2 })}>Ortala</button>
      </div>
      {track.kind !== 'text' && (
        <Field label="Sığdırma">
          <select value={pl.fit} onChange={(e) => exec(cmd.placement(track.id, { fit: e.target.value as 'cover' | 'contain' }, false))} aria-label="Sığdırma">
            <option value="cover">Doldur (kırp)</option>
            <option value="contain">Sığdır (boşluk kalabilir)</option>
          </select>
        </Field>
      )}
      <Slider label="Saydamlık" value={pl.opacity} min={0.05} max={1} onChange={(v) => exec(cmd.placement(track.id, { opacity: v }))} format={(v) => `${Math.round(v * 100)}%`} />

      {track.kind === 'text' && spec && (
        <>
          <Field label="Metin (satır sonu için Enter)">
            <textarea rows={3} value={spec.text} onChange={(e) => setText({ text: e.target.value })} aria-label="Katman metni" data-testid="layer-text" />
          </Field>
          <div className="grid2">
            <Field label="Yazı tipi"><select value={spec.fontFamily} onChange={(e) => setText({ fontFamily: e.target.value })} aria-label="Yazı tipi">{FONTS.map((f) => <option key={f}>{f}</option>)}</select></Field>
            <Field label="Animasyon"><select value={spec.animation} onChange={(e) => setText({ animation: e.target.value as TextAnimation })} aria-label="Animasyon">{ANIMS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></Field>
          </div>
          <Slider label="Boyut" value={spec.fontSize} min={16} max={140} step={1} onChange={(v) => setText({ fontSize: v })} format={(v) => `${v}px`} />
          <div className="grid2">
            <Field label="Renk"><input type="color" value={spec.color} onChange={(e) => setText({ color: e.target.value })} aria-label="Metin rengi" /></Field>
            <Field label="Kontur"><input type="color" value={spec.outlineColor} onChange={(e) => setText({ outlineColor: e.target.value })} aria-label="Kontur rengi" /></Field>
          </div>
          <Slider label="Kontur kalınlığı" value={spec.outlineWidth} min={0} max={12} step={1} onChange={(v) => setText({ outlineWidth: v })} format={(v) => `${v}px`} />
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={spec.bold} onChange={(e) => setText({ bold: e.target.checked })} /> Kalın</label>
            <label className="check"><input type="checkbox" checked={!!spec.italic} onChange={(e) => setText({ italic: e.target.checked })} /> İtalik</label>
          </div>
          {textClip && <button className="btn sm" onClick={() => exec(cmd.extendToEnd(textClip.id))}>Süreyi zaman çizelgesi sonuna kadar uzat</button>}
          {!textClip && <div className="hint">Bu metin izinde henüz klip yok; ilk klip eklendiğinde bu metinle otomatik oluşur.</div>}
        </>
      )}
    </div>
  )
}

export function LayersPanel() {
  const { project, exec, selectedLayerId, selectLayer, userTemplates, applyLayoutTemplate, saveLayoutTemplate, deleteLayoutTemplate, toggleLayerVisible } = useStore()
  const tl = project.timeline
  const [name, setName] = useState('')
  const [tplId, setTplId] = useState('')
  const tpl = userTemplates.find((t) => t.id === tplId) ?? userTemplates[0]
  const layers = tl.tracks.filter((t) => t.placement)
  const sel = layers.find((t) => t.id === selectedLayerId)
  const aspects: AspectRatio[] = ['9:16', '1:1', '16:9']
  const sz = aspectSize(tl.aspect)
  /** Yeni katman ekler ve seçer. Metin katmanı BOŞ başlar (yazıyı kullanıcı kendisi yazar). */
  const addLayer = (kind: 'image' | 'text' | 'video') => {
    const id = newId('L')
    const rect = { x: 0.05, y: 0.45, w: 0.9, h: 0.1 }
    exec(
      cmd.addTrack(
        kind === 'text'
          ? { id, name: 'Metin katmanı', kind, role: 'text', placement: { rect, fit: 'contain', visible: true, opacity: 1 }, textDefault: { text: '', fontFamily: 'Impact', fontSize: 56, color: '#FFFFFF', outlineColor: '#000000', outlineWidth: 5, bold: false, animation: 'none' } }
          : { id, name: kind === 'image' ? 'Görsel katmanı' : 'Video katmanı', kind, role: kind === 'image' ? 'image' : 'screen' }
      )
    )
    if (kind === 'text') exec(cmd.fillText())
    selectLayer(id)
  }

  return (
    <div className="col" data-testid="layers-panel">
      <div className="section-title">Kayıtlı düzenlerim</div>
      {userTemplates.length > 0 && (
        <>
          <select value={tpl?.id ?? ''} onChange={(e) => setTplId(e.target.value)} aria-label="Kayıtlı düzen seç" data-testid="tpl-select">
            {userTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="row">
            <button className="btn grow" onClick={() => tpl && applyLayoutTemplate(tpl)} data-testid="tpl-apply">Uygula</button>
            <button className="btn danger" onClick={() => tpl && void deleteLayoutTemplate(tpl.id)} data-testid="tpl-delete">Sil</button>
          </div>
        </>
      )}
      <div className="row">
        <input type="text" placeholder="Düzen adı" value={name} onChange={(e) => setName(e.target.value)} aria-label="Düzen adı" data-testid="tpl-name" />
        <button className="btn" onClick={() => { void saveLayoutTemplate(name); setName('') }} data-testid="tpl-save">Düzeni kaydet</button>
      </div>

      <div className="section-title">En-boy oranı</div>
      <div className="row">
        {aspects.map((a) => <button key={a} className={`btn grow${tl.aspect === a ? ' active' : ''}`} onClick={() => exec(cmd.aspect(a))} data-testid={`aspect-${a}`} aria-pressed={tl.aspect === a}>{a}</button>)}
      </div>
      <div className="hint">Çıkış: {sz.width}×{sz.height}</div>

      <div className="section-title">Katmanlar (üstteki en önde)</div>
      <div className="col" style={{ gap: 4 }} data-testid="layer-list">
        {layers.map((t, i) => (
          <div key={t.id} className={`layer-row${t.id === selectedLayerId ? ' sel' : ''}`} onClick={() => selectLayer(t.id)} data-testid={`layer-${t.id}`}>
            <button className={`btn sm icon ghost${t.placement!.visible ? '' : ' dim'}`} title={t.placement!.visible ? 'Gizle' : 'Göster'} aria-label={`${t.name} ${t.placement!.visible ? 'gizle' : 'göster'}`} onClick={(e) => { e.stopPropagation(); toggleLayerVisible(t.id) }} data-testid={`eye-${t.id}`}>{t.placement!.visible ? '👁' : '⊘'}</button>
            <span className="kind">{KIND[t.kind]}</span>
            <span className="grow ellipsis">{t.name}</span>
            <button className="btn sm icon ghost" disabled={i === 0} title="Öne al" aria-label={`${t.name} öne al`} onClick={(e) => { e.stopPropagation(); exec(cmd.moveTrack(t.id, 'up')) }}>↑</button>
            <button className="btn sm icon ghost" disabled={i === layers.length - 1} title="Arkaya al" aria-label={`${t.name} arkaya al`} onClick={(e) => { e.stopPropagation(); exec(cmd.moveTrack(t.id, 'down')) }}>↓</button>
          </div>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => addLayer('image')} data-testid="add-image-layer">+ Görsel</button>
        <button className="btn sm" onClick={() => addLayer('text')} data-testid="add-text-layer">+ Metin</button>
        <button className="btn sm" onClick={() => addLayer('video')}>+ Video</button>
        {sel && !['V1', 'V2', 'I1', 'I2'].includes(sel.id) && <button className="btn sm danger" onClick={() => { exec(cmd.removeTrack(sel.id)); selectLayer(null) }}>Katmanı sil</button>}
      </div>
      {sel ? <LayerDetail track={sel} /> : <div className="hint">Ayarlamak için listeden ya da önizlemeden bir katman seçin; önizlemede sürükleyerek taşıyın, kenar tutamaçlarıyla boyutlandırın.</div>}
    </div>
  )
}
