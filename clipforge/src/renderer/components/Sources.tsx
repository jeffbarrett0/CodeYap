import { useState } from 'react'
import type { MediaAsset } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Field, Num } from './ui'

const ROLES: [NonNullable<MediaAsset['role']> | '', string][] = [
  ['', 'Belirtilmedi'],
  ['screen', 'Ekran kaydı'],
  ['game', 'Oyun sesi'],
  ['voice', 'Konuşma sesi'],
  ['cam', 'Yüz kamerası']
]

type Slot = 'screen' | 'game' | 'voice' | 'cam'
const SLOTS: { key: Slot; label: string; accepts: (a: MediaAsset) => boolean }[] = [
  { key: 'screen', label: 'Ekran kaydı', accepts: (a) => a.kind === 'video' },
  { key: 'game', label: 'Oyun sesi', accepts: (a) => a.audioStreams.length > 0 },
  { key: 'voice', label: 'Konuşma sesi', accepts: (a) => a.audioStreams.length > 0 },
  { key: 'cam', label: 'Yüz kamerası', accepts: (a) => a.kind === 'video' }
]

/** Aynı yayının ayrı dosyalarını bağlar: bu dosyadan klip çıkarılınca hepsi aynı aralıkta eklenir. */
export function SourcesBlock({ asset }: { asset: MediaAsset }) {
  const { project, patchAsset } = useStore()
  const api = requireApi()
  if (asset.kind === 'image') return null
  const others = project.assets.filter((a) => a.id !== asset.id && a.kind !== 'image')
  const sources = asset.sources ?? {}
  const setSource = (k: Slot, id: string) => {
    const next = { ...sources, [k]: id || undefined }
    patchAsset(asset.id, { sources: next, ...(k === 'cam' ? { webcamAssetId: undefined } : {}) })
  }
  const camId = sources.cam ?? asset.webcamAssetId

  return (
    <div className="col" data-testid="sources-block">
      <div className="section-title" style={{ marginTop: 6 }}>Bu dosyanın rolü</div>
      <select aria-label="Dosya rolü" value={asset.role ?? ''} onChange={(e) => patchAsset(asset.id, { role: (e.target.value || undefined) as MediaAsset['role'] })} data-testid="role-select">
        {ROLES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
      </select>
      <div className="hint">Rol, bu dosyadan klip çıkarılırken sesin hangi ize (oyun / konuşma) ve görüntünün hangi katmana (ekran / yüz) gideceğini belirler.</div>

      <div className="section-title" style={{ marginTop: 6 }}>Bağlı kaynaklar (aynı yayının ayrı dosyaları)</div>
      {SLOTS.map((slot) => {
        const linked = project.assets.find((a) => a.id === sources[slot.key] || (slot.key === 'cam' && a.id === camId))
        return (
          <div key={slot.key} className="col" style={{ gap: 4 }}>
            <label className="field">
              <span>{slot.label}</span>
              <select aria-label={`${slot.label} kaynağı`} value={linked?.id ?? ''} onChange={(e) => setSource(slot.key, e.target.value)} data-testid={`src-${slot.key}`}>
                <option value="">— bu dosyanın kendisi / yok —</option>
                {others.filter(slot.accepts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {linked && (
              <div className="row">
                <label className="field grow">
                  <span>Senkron ofseti (sn): {slot.label} zamanı = bu dosya zamanı + ofset</span>
                  <Num value={linked.syncOffsetSec ?? 0} step={0.05} label={`${slot.label} ofseti`} onChange={(v) => patchAsset(linked.id, { syncOffsetSec: v })} />
                </label>
                <button
                  className="btn sm"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={async () => {
                    try {
                      const off = await api.invoke('media:syncOffset', { screenAssetId: asset.id, camAssetId: linked.id })
                      patchAsset(linked.id, { syncOffsetSec: off })
                      useStore.getState().toast('success', `Senkron ofseti bulundu: ${off.toFixed(2)} sn`)
                    } catch (e) {
                      useStore.getState().toast('error', (e as Error).message)
                    }
                  }}
                >
                  Sesten bul
                </button>
              </div>
            )}
          </div>
        )
      })}

      {asset.kind === 'video' && (
        <>
          <label className="field">
            <span>Yüz kamerası aynı dosyanın içindeyse (OBS birleşik kayıt)</span>
            <select aria-label="Kamera bölgesi" value={asset.webcamRegion ? 'region' : 'none'} onChange={(e) => patchAsset(asset.id, { webcamRegion: e.target.value === 'region' ? (asset.webcamRegion ?? { x: 0.72, y: 0.68, w: 0.28, h: 0.32 }) : undefined })}>
              <option value="none">Kamera bölgesi yok</option>
              <option value="region">Dosyanın bir köşesinde (bölge gir)</option>
            </select>
          </label>
          {asset.webcamRegion && (
            <div className="grid2">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <label className="field" key={k}>
                  <span>Bölge {k.toUpperCase()} (0–1)</span>
                  <input type="number" step={0.01} min={0} max={1} value={asset.webcamRegion![k]} onChange={(e) => patchAsset(asset.id, { webcamRegion: { ...asset.webcamRegion!, [k]: Math.min(1, Math.max(0, Number(e.target.value))) } })} />
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Dosyayı doğrudan bir ize ekler (aynı işi zaman çizelgesine sürükle-bırak da yapar). */
export function AddToTrack({ asset }: { asset: MediaAsset }) {
  const { project, addAssetToTrack, playhead } = useStore()
  const tracks = project.timeline.tracks.filter((t) => (asset.kind === 'image' ? t.kind === 'image' : asset.kind === 'video' ? t.kind === 'video' || t.kind === 'audio' : t.kind === 'audio'))
  const [trackId, setTrackId] = useState('')
  const [stream, setStream] = useState(-1)
  const [srcIn, setSrcIn] = useState(0)
  const [dur, setDur] = useState(asset.kind === 'image' ? 8 : 0)
  const tid = tracks.some((t) => t.id === trackId) ? trackId : (tracks[0]?.id ?? '')
  const track = tracks.find((t) => t.id === tid)
  const total = Math.max(0, ...project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + (c.srcOut - c.srcIn))))
  const go = (at: number) => track && addAssetToTrack(asset.id, track.id, { at, srcIn: asset.kind === 'image' ? 0 : srcIn, duration: dur > 0 ? dur : undefined, audioStream: track.kind === 'audio' && stream >= 0 ? stream : undefined })

  if (tracks.length === 0) return null
  return (
    <div className="col" data-testid="add-to-track">
      <div className="section-title" style={{ marginTop: 6 }}>Zaman çizelgesine ekle</div>
      <label className="field">
        <span>Hedef iz / katman</span>
        <select aria-label="Hedef iz" value={tid} onChange={(e) => setTrackId(e.target.value)} data-testid="target-track">
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
        </select>
      </label>
      {track?.kind === 'audio' && asset.audioStreams.length > 1 && (
        <label className="field">
          <span>Ses akışı</span>
          <select aria-label="Ses akışı" value={stream} onChange={(e) => setStream(Number(e.target.value))}>
            <option value={-1}>Otomatik (role göre)</option>
            {asset.audioStreams.map((s) => <option key={s.index} value={s.index}>Track {s.index + 1}{s.title ? ` · ${s.title}` : ''}</option>)}
          </select>
        </label>
      )}
      <div className="grid2">
        {asset.kind !== 'image' && <Field label="Kaynakta başlangıç (sn)"><Num value={srcIn} step={1} min={0} label="Kaynak başlangıcı" onChange={setSrcIn} /></Field>}
        <Field label={asset.kind === 'image' ? 'Süre (sn)' : 'Süre (sn, 0 = tamamı)'}><Num value={dur} step={1} min={0} label="Süre" onChange={setDur} /></Field>
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => go(playhead)} data-testid="add-at-playhead">Oynatma başlığına ekle</button>
        <button className="btn" onClick={() => go(total)} data-testid="add-at-end">Sona ekle</button>
      </div>
      <div className="hint">İpucu: kütüphanedeki dosyayı doğrudan zaman çizelgesindeki bir ize sürükleyebilirsiniz.</div>
    </div>
  )
}
