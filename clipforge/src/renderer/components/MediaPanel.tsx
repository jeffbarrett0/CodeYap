import { useState } from 'react'
import { LANGUAGES } from '@shared/settings'
import type { MediaAsset } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Progress } from './ui'
import { SourcesBlock } from './Sources'

/**
 * Sol panel: YALNIZCA içe aktarma alanı ve medya kütüphanesi.
 * Bir dosyaya tıklamak onu seçer ve kaynak oynatıcıda hemen oynatmaya başlar.
 */
export function MediaLibrary() {
  const { project, selectedAssetId, playAsset, pickAndImport, transcripts } = useStore()
  const [over, setOver] = useState(false)
  const api = requireApi()
  // Bırakma işlemini pencere düzeyindeki dinleyici (main.tsx) yapar; burada yalnızca görsel geri bildirim var.
  const onDrop = () => setOver(false)
  return (
    <div className="panel-body">
      <div
        className={`dropzone${over ? ' over' : ''}`}
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>Yayın kaydını sürükleyip bırakın</div>
        <div className="hint" style={{ margin: '4px 0 10px' }}>MP4 · MOV · MKV · FLV (OBS için MKV önerilir)</div>
        <button className="btn primary" onClick={() => void pickAndImport()} data-testid="import-btn">Kayıt içe aktar…</button>
      </div>

      <div>
        <div className="section-title">Medya kütüphanesi ({project.assets.length})</div>
        <div className="col">
          {project.assets.length === 0 && <div className="empty">Henüz medya yok.</div>}
          {project.assets.map((a) => (
            <div key={a.id} className={`asset${a.id === selectedAssetId ? ' sel' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-clipforge-asset', a.id)} title="Zaman çizelgesindeki bir ize sürükleyip bırakabilirsiniz" onClick={() => playAsset(a.id)} data-testid="asset" role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && playAsset(a.id)}>
              <div className="thumb" style={api.mediaUrl(a, 'thumb') ? { backgroundImage: `url(${api.mediaUrl(a, 'thumb')})` } : undefined}>{!api.mediaUrl(a, 'thumb') && 'önizleme yok'}</div>
              <div className="meta">
                <div className="name" title={a.path}>{a.name}</div>
                <div className="hint">{a.kind === 'image' ? `Görsel · ${a.width}×${a.height}` : a.kind === 'audio' ? `Ses · ${fmt(a.durationSec)}` : `${fmt(a.durationSec)} · ${a.width}×${a.height} · ${Math.round(a.fps)} fps`}</div>
                {a.missing && <span className="badge red">Dosya bulunamadı</span>}
                {transcripts[a.id] && <span className="badge blue">Transkript hazır</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

/** Sağ panel "Kaynak" sekmesi: seçili dosyanın ayrıntıları, transkripsiyon, rol, bağlı kaynaklar, ize ekleme. */
export function MediaDetail() {
  const { project, selectedAssetId, transcripts, patchAsset, startTranscription, settings, tasks } = useStore()
  const asset = project.assets.find((a) => a.id === selectedAssetId)
  const api = requireApi()
  const transcribing = Object.values(tasks).some((t) => t.kind === 'transcribe' && (t.status === 'running' || t.status === 'queued'))
  const tr = asset ? transcripts[asset.id] : undefined
  const cams = project.assets.filter((a) => a.id !== asset?.id && a.kind === 'video')
  void api
  void cams

  return (
    <div className="col">
      {!asset && <div className="empty">Soldaki kütüphaneden bir dosya seçin.</div>}
      {asset && (
        <div className="col" data-testid="asset-detail">
          {asset.kind !== 'image' && asset.audioStreams.length === 0 && <div className="warnbox">Bu kayıtta ses akışı yok; transkripsiyon yapılamaz.</div>}
          <div className="row">
            <select
              aria-label="Transkripsiyon dili"
              value={settings.language}
              onChange={(e) => void useStore.getState().updateSettings({ language: e.target.value })}
            >
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          <div className="row wrap">
            <button className="btn primary" disabled={transcribing || asset.audioStreams.length === 0 || !!asset.missing} onClick={() => void startTranscription(asset.id)} data-testid="transcribe-btn">
              {tr ? 'Transkripti yeniden kullan' : 'Transkripsiyonu başlat'}
            </button>
            {tr && <button className="btn" disabled={transcribing} onClick={() => void startTranscription(asset.id, true)}>Yeniden üret</button>}
          </div>
          {tr && <div className="hint">{tr.words.length.toLocaleString('tr')} kelime · {tr.segments.length} cümle · Track {tr.audioTrack + 1} · {tr.language} · {tr.model}</div>}

          <SourcesBlock asset={asset} />
        </div>
      )}
    </div>
  )
}
