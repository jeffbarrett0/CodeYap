import { useState } from 'react'
import type { VideoIdea } from '@shared/ideas'
import { useStore } from '../store'
import { fmt } from './ui'

const mm = (s: number) => `${String(Math.floor(s / 3600)).padStart(1, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function IdeaCard({ idea, i, assetId }: { idea: VideoIdea; i: number; assetId: string }) {
  const { openDraftFromRange, setSourceTime, setViewMode, toast } = useStore()
  const [copied, setCopied] = useState(-1)
  const copy = (t: string, k: number) => {
    void navigator.clipboard?.writeText(t).catch(() => undefined)
    setCopied(k)
    toast('info', 'Başlık kopyalandı.')
  }
  return (
    <div className="col idea-card" data-testid="idea" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{i + 1}. öneri · {mm(idea.start)}–{mm(idea.end)} · {Math.round(idea.durationSec / 60)} dk</b>
        <span className="badge" title="Ayrı video adayı olma skoru">{Math.round(idea.score * 100)}</span>
      </div>
      <div className="col" style={{ gap: 3 }}>
        <div className="hint">{idea.titleSource === 'ai' ? 'Önerilen YouTube başlıkları' : 'Taslak başlıklar (daha iyisi için Ayarlar → Başlık önerileri)'}</div>
        {idea.titles.map((t, k) => (
          <div key={k} className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
            <span data-testid={k === 0 ? 'idea-title' : undefined} style={{ fontWeight: k === 0 ? 700 : 400 }}>{k === 0 ? '★ ' : '• '}{t}</span>
            <button className="btn ghost sm" onClick={() => copy(t, k)} aria-label="Başlığı kopyala">{copied === k ? '✓' : 'Kopyala'}</button>
          </div>
        ))}
      </div>
      {idea.hook && <div className="hint">Açılış fikri: “{idea.hook}”</div>}
      <div className="row wrap">{idea.keywords.map((k) => <span key={k} className="badge blue">{k}</span>)}</div>
      <div className="hint" style={{ maxHeight: 74, overflow: 'auto' }}>{idea.description ?? idea.summary}</div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => { setViewMode('source'); setSourceTime(idea.start) }}>Kaynakta git</button>
        <button className="btn sm primary" onClick={() => openDraftFromRange(assetId, idea.start, idea.end, idea.firstWord, idea.lastWord)} data-testid="idea-draft" title="Bu bölümü klip taslağı olarak açar; oradan 'Yeni projede aç' ile ayrı bir proje yapabilirsiniz">Klip taslağı aç</button>
      </div>
    </div>
  )
}

/** Video önerileri: uzun yayını konu bölümlerine ayırır, her biri için "ayrı video olabilir" + YouTube başlığı önerir */
export function IdeasPanel() {
  const { project, selectedAssetId, transcripts, ideas, ideasBusy, ideasError, generateIdeas, settings, openDialog } = useStore()
  const asset = project.assets.find((a) => a.id === selectedAssetId)
  const res = selectedAssetId ? ideas[selectedAssetId] : undefined
  const aiReady = settings.llmProvider !== 'off'
  const [useAi, setUseAi] = useState(true)
  const hasTranscript = !!(asset && transcripts[asset.id])

  return (
    <div className="panel-body" data-testid="ideas-panel">
      <div className="infobox">Yayının transkriptine bakar; <b>ayrı bir video olabilecek konu bölümlerini</b> (ör. 15 dakika boyunca yapay zekâ konuşulmuş) bulur, her biri için YouTube başlığı önerir. Karar sizindir: önerileri klip taslağına çevirmek ya da yok saymak size kalmış.</div>
      {!asset && <div className="empty">Soldaki kütüphaneden bir kayıt seçin.</div>}
      {asset && !hasTranscript && <div className="warnbox">Bu kayıt henüz transkribe edilmemiş: Kaynak sekmesi → "Transkripsiyonu başlat".</div>}
      {asset && (
        <>
          <label className="check" title={aiReady ? '' : 'Ayarlar → Başlık önerileri bölümünden bir sağlayıcı ve API anahtarı girin'}>
            <input type="checkbox" checked={useAi && aiReady} disabled={!aiReady} onChange={(e) => setUseAi(e.target.checked)} data-testid="ideas-ai" /> Başlıkları yapay zekâ yazsın
          </label>
          {!aiReady && <div className="hint">Yapay zekâ kapalı: taslak başlıklar anahtar kelimelerden üretilir. Daha iyi başlıklar için <a href="#" onClick={(e) => { e.preventDefault(); openDialog('settings') }}>Ayarlar → Başlık önerileri</a>.</div>}
          <button className="btn primary" disabled={!hasTranscript || ideasBusy} onClick={() => void generateIdeas(useAi && aiReady)} data-testid="ideas-run">{ideasBusy ? 'Bölümler inceleniyor…' : 'Video önerilerini bul'}</button>
        </>
      )}
      {ideasError && <div className="warnbox" role="alert" data-testid="ideas-error">{ideasError}</div>}
      {res?.ai.error && <div className="warnbox" data-testid="ideas-ai-error">Yapay zekâ başlığı: {res.ai.error}</div>}
      {res && res.ideas.length > 0 && <div className="hint">{res.ideas.length} öneri · kayıt {fmt(res.totalSec)} · skora göre sıralı</div>}
      {res?.ideas.map((idea, i) => <IdeaCard key={idea.id} idea={idea} i={i} assetId={selectedAssetId!} />)}
    </div>
  )
}
