import type { MediaAsset } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Num } from './ui'

type Slot = 'screen' | 'game' | 'voice' | 'cam'
const SLOTS: { key: Slot; label: string; accepts: (a: MediaAsset) => boolean }[] = [
  { key: 'screen', label: 'Ekran kaydı', accepts: (a) => a.kind === 'video' },
  { key: 'game', label: 'Oyun sesi', accepts: (a) => a.audioStreams.length > 0 },
  { key: 'voice', label: 'Konuşma sesi', accepts: (a) => a.audioStreams.length > 0 },
  { key: 'cam', label: 'Üst video (kamera)', accepts: (a) => a.kind === 'video' }
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
            <span>Üst video, bu dosyanın bir köşesinden alınacaksa (isteğe bağlı)</span>
            <select aria-label="Kamera bölgesi" value={asset.webcamRegion ? 'region' : 'none'} onChange={(e) => patchAsset(asset.id, { webcamRegion: e.target.value === 'region' ? (asset.webcamRegion ?? { x: 0.72, y: 0.68, w: 0.28, h: 0.32 }) : undefined })}>
              <option value="none">Bölge yok (kendiliğinden kırpma yapılmaz)</option>
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
