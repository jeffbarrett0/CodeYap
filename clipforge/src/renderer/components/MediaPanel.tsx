import { useState } from 'react'
import { LANGUAGES } from '@shared/settings'
import type { MediaAsset } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Progress } from './ui'

const ENC: Record<string, string> = { nvenc: 'NVENC', x264: 'x264', amf: 'AMF', qsv: 'QuickSync', apple: 'VideoToolbox', software: 'Yazılım', unknown: 'kodlayıcı ?' }

function ObsBadges({ a }: { a: MediaAsset }) {
  return (
    <div className="row wrap" style={{ gap: 4 }}>
      {a.obs.isObs ? <span className="badge green">OBS{a.obs.version ? ` ${a.obs.version}` : ''}</span> : <span className="badge">OBS değil / bilinmiyor</span>}
      <span className="badge">{a.videoCodec?.toUpperCase() ?? 'ses'}</span>
      <span className="badge">{ENC[a.obs.encoder]}</span>
      <span className="badge">{a.container.toUpperCase()}</span>
      <span className="badge">{a.audioStreams.length} ses track'i</span>
    </div>
  )
}

export function MediaPanel() {
  const { project, selectedAssetId, selectAsset, importPaths, pickAndImport, transcripts, patchAsset, startTranscription, settings, tasks } = useStore()
  const [over, setOver] = useState(false)
  const asset = project.assets.find((a) => a.id === selectedAssetId)
  const api = requireApi()
  const transcribing = Object.values(tasks).some((t) => t.kind === 'transcribe' && (t.status === 'running' || t.status === 'queued'))
  const proxying = Object.values(tasks).filter((t) => t.kind === 'proxy' && t.status === 'running')
  const tr = asset ? transcripts[asset.id] : undefined

  // Bırakma işlemini pencere düzeyindeki dinleyici (main.tsx) yapar; burada yalnızca görsel geri bildirim var.
  const onDrop = () => setOver(false)
  const cams = project.assets.filter((a) => a.id !== asset?.id && a.kind === 'video')

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

      {proxying.map((t) => (
        <div key={t.id} className="col" style={{ gap: 3 }}>
          <span className="hint">Önizleme kopyası hazırlanıyor… {Math.round(t.progress * 100)}%</span>
          <Progress value={t.progress} />
        </div>
      ))}

      <div>
        <div className="section-title">Medya kütüphanesi ({project.assets.length})</div>
        <div className="col">
          {project.assets.length === 0 && <div className="empty">Henüz medya yok.</div>}
          {project.assets.map((a) => (
            <div key={a.id} className={`asset${a.id === selectedAssetId ? ' sel' : ''}`} onClick={() => selectAsset(a.id)} data-testid="asset" role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && selectAsset(a.id)}>
              <div className="thumb" style={api.mediaUrl(a, 'thumb') ? { backgroundImage: `url(${api.mediaUrl(a, 'thumb')})` } : undefined}>{!api.mediaUrl(a, 'thumb') && 'önizleme yok'}</div>
              <div className="meta">
                <div className="name" title={a.path}>{a.name}</div>
                <div className="hint">{fmt(a.durationSec)} · {a.width}×{a.height} · {Math.round(a.fps)} fps</div>
                {a.missing && <span className="badge red">Dosya bulunamadı</span>}
                {transcripts[a.id] && <span className="badge blue">Transkript hazır</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {asset && (
        <div className="col" data-testid="asset-detail">
          <div className="section-title">Seçili kayıt</div>
          <ObsBadges a={asset} />
          {asset.obs.evidence.length > 0 && <div className="hint">Algılama: {asset.obs.evidence.join(' · ')}</div>}
          {asset.audioStreams.length === 0 ? (
            <div className="warnbox">Bu kayıtta ses akışı yok; transkripsiyon yapılamaz.</div>
          ) : (
            <table className="tracktable">
              <thead>
                <tr><th>Track</th><th>Ses</th><th title="Transkripsiyon kaynağı">Transkript</th><th>Rol</th></tr>
              </thead>
              <tbody>
                {asset.audioStreams.map((s) => {
                  const role = asset.audioMap.game === s.index ? 'game' : asset.audioMap.voice === s.index ? 'voice' : asset.audioMap.mix === s.index ? 'mix' : ''
                  return (
                    <tr key={s.index}>
                      <td>Track {s.index + 1}</td>
                      <td className="hint">{s.codec} · {s.channels}ch</td>
                      <td>
                        <input type="radio" name="trtrack" aria-label={`Track ${s.index + 1} transkript kaynağı`} checked={asset.transcriptionTrack === s.index} onChange={() => patchAsset(asset.id, { transcriptionTrack: s.index })} />
                      </td>
                      <td>
                        <select
                          aria-label={`Track ${s.index + 1} rolü`}
                          value={role}
                          onChange={(e) => {
                            const m = { ...asset.audioMap }
                            for (const k of ['mix', 'game', 'voice'] as const) if (m[k] === s.index && k !== 'mix') delete m[k]
                            if (e.target.value === 'mix') m.mix = s.index
                            else if (e.target.value === 'game') m.game = s.index
                            else if (e.target.value === 'voice') m.voice = s.index
                            patchAsset(asset.id, { audioMap: m })
                          }}
                        >
                          <option value="">—</option>
                          <option value="mix">Karışım</option>
                          <option value="game">Oyun sesi</option>
                          <option value="voice">Konuşma</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="hint">Varsayılan transkripsiyon kaynağı Track 1 (oyun + mikrofon karışımı). Oyun ve konuşma farklı track'lerdeyse klip oluşturulurken ayrı ses izlerine bölünür.</div>

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

          <div className="section-title" style={{ marginTop: 6 }}>Yüz kamerası</div>
          <label className="field">
            <span>Kamera kaynağı</span>
            <select
              aria-label="Kamera kaynağı"
              value={asset.webcamAssetId ? 'file' : asset.webcamRegion ? 'region' : 'none'}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'none') patchAsset(asset.id, { webcamAssetId: undefined, webcamRegion: undefined })
                else if (v === 'region') patchAsset(asset.id, { webcamAssetId: undefined, webcamRegion: asset.webcamRegion ?? { x: 0.72, y: 0.68, w: 0.28, h: 0.32 } })
                else patchAsset(asset.id, { webcamRegion: undefined, webcamAssetId: cams[0]?.id })
              }}
            >
              <option value="none">Yok</option>
              <option value="region">Aynı dosyada (OBS birleşik kayıt)</option>
              <option value="file" disabled={cams.length === 0}>Ayrı dosya</option>
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
          {asset.webcamAssetId && (
            <div className="col">
              <select aria-label="Kamera dosyası" value={asset.webcamAssetId} onChange={(e) => patchAsset(asset.id, { webcamAssetId: e.target.value })}>
                {cams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="row">
                <label className="field grow">
                  <span>Senkron ofseti (sn)</span>
                  <input type="number" step={0.05} value={project.assets.find((c) => c.id === asset.webcamAssetId)?.syncOffsetSec ?? 0} onChange={(e) => patchAsset(asset.webcamAssetId!, { syncOffsetSec: Number(e.target.value) })} />
                </label>
                <button
                  className="btn"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={async () => {
                    try {
                      const off = await api.invoke('media:syncOffset', { screenAssetId: asset.id, camAssetId: asset.webcamAssetId! })
                      patchAsset(asset.webcamAssetId!, { syncOffsetSec: off })
                      useStore.getState().toast('success', `Senkron ofseti bulundu: ${off.toFixed(2)} sn`)
                    } catch (e) {
                      useStore.getState().toast('error', (e as Error).message)
                    }
                  }}
                >
                  Sesten bul
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
