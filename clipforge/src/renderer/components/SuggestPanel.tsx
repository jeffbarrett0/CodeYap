import { useState } from 'react'
import { useStore } from '../store'
import { fmt, Progress } from './ui'

export function SuggestPanel() {
  const { project, selectedAssetId, importChat, chatError, runSuggest, suggesting, openDraftFromCandidate, setCandidateStatus, adjustCandidate, tasks, setSourceTime, setViewMode, openDialog } = useStore()
  const [scene, setScene] = useState(false)
  const asset = project.assets.find((a) => a.id === selectedAssetId)
  const chat = project.chatLogs.find((c) => c.assetId === selectedAssetId)
  const cands = project.candidates.filter((c) => c.assetId === selectedAssetId)
  const markers = (selectedAssetId && project.markers[selectedAssetId]) || []
  const running = Object.values(tasks).find((t) => t.kind === 'analyze' && t.status === 'running')

  return (
    <div className="panel-body">
      <div className="infobox">Arama yapmadan tepki anlarını bulur: ses enerjisindeki ani artışlar, sohbet hızı, tepki sözcükleri{markers.length ? ' ve yayın sırasında koyduğunuz işaretler' : ''}.</div>

      <div className="col">
        <div className="section-title">Sohbet günlüğü (isteğe bağlı)</div>
        <div className="row wrap">
          <button className="btn" onClick={() => void importChat()} disabled={!asset} data-testid="chat-btn">Sohbet dökümü içe aktar…</button>
          {chat && <span className="badge green">{chat.messages.length} mesaj · {chat.sourceName}</span>}
        </div>
        <div className="hint">CSV / JSON (Kick yayın sonrası dökümü dahil) / düz metin. Sütun adları farklıysa <a href="#" onClick={(e) => { e.preventDefault(); openDialog('settings') }}>Ayarlar → Sohbet</a> bölümünden eşleyin.</div>
        {chatError && <div className="errbox" role="alert" data-testid="chat-error">{chatError}</div>}
        {markers.length > 0 && <span className="badge blue">{markers.length} yayıncı işareti bulundu</span>}
      </div>

      <div className="col">
        <label className="check"><input type="checkbox" checked={scene} onChange={(e) => setScene(e.target.checked)} /> Sahne değişimi yoğunluğunu da kullan (yavaş, isteğe bağlı)</label>
        <button className="btn primary" disabled={!asset || suggesting} onClick={() => void runSuggest(scene)} data-testid="suggest-btn">{suggesting ? 'Analiz ediliyor…' : 'Tepki anlarını bul'}</button>
        {running && <Progress value={running.progress} />}
      </div>

      <div>
        <div className="section-title">Adaylar ({cands.length})</div>
        <div className="col" data-testid="candidates">
          {cands.length === 0 && <div className="empty">Henüz aday yok.</div>}
          {cands.map((c) => (
            <div key={c.id} className={`cand ${c.status}`} data-testid="candidate">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button className="btn ghost sm" onClick={() => { setViewMode('source'); setSourceTime(c.start) }}><b className="tc">{fmt(c.start)}–{fmt(c.end)}</b></button>
                <span className="row"><span className="score"><i style={{ width: `${c.score * 100}%` }} /></span><span className="hint">{(c.score * 100).toFixed(0)}</span></span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {c.reasons.map((r, i) => <li key={i} className="hint">{r.label}</li>)}
              </ul>
              <div className="row wrap">
                <button className="btn sm primary" onClick={() => openDraftFromCandidate(c)}>Kabul et → klip</button>
                <button className="btn sm" onClick={() => setCandidateStatus(c.id, c.status === 'rejected' ? 'pending' : 'rejected')}>{c.status === 'rejected' ? 'Geri al' : 'Reddet'}</button>
                <button className="btn sm" title="Başlangıcı 2 sn öne al" onClick={() => adjustCandidate(c.id, { start: Math.max(0, c.start - 2) })}>−2 sn baş</button>
                <button className="btn sm" title="Bitişi 2 sn uzat" onClick={() => adjustCandidate(c.id, { end: Math.min(asset?.durationSec ?? c.end + 2, c.end + 2) })}>+2 sn son</button>
                {c.status === 'accepted' && <span className="badge green">kabul edildi</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
