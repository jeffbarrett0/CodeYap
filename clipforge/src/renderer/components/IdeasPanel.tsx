import { useState } from 'react'
import type { VideoIdea } from '@shared/ideas'
import { useStore } from '../store'
import { fmt } from './ui'

const mm = (s: number) => `${String(Math.floor(s / 3600)).padStart(1, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function IdeaCard({ idea, i, assetId }: { idea: VideoIdea; i: number; assetId: string }) {
  const { openDraftFromRange, setSourceTime, setViewMode, toast } = useStore()
  const title = idea.titleSource === 'ai' ? idea.titles[0] : undefined
  const mins = Math.max(1, Math.round(idea.durationSec / 60))
  return (
    <div className="col idea-card" data-testid="idea" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, gap: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }} data-testid="idea-headline">{i + 1}. {idea.headline}</div>
      <div data-testid="idea-meta"><b>{mm(idea.start)} – {mm(idea.end)}</b> <span className="hint">· {mins} dk · klip olarak paylaşabilirsin</span></div>
      <div className="hint" data-testid="idea-summary">{idea.description ?? idea.summary}</div>
      {title && (
        <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
          <span data-testid="idea-title">YouTube başlığı: <b>{title}</b></span>
          <button className="btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(title).catch(() => undefined); toast('info', 'Başlık kopyalandı.') }}>Kopyala</button>
        </div>
      )}
      {idea.hook && <div className="hint">Açılış cümlesi: “{idea.hook}”</div>}
      <div className="row wrap">
        <button className="btn sm" onClick={() => { setViewMode('source'); setSourceTime(idea.start) }}>Kaynakta git</button>
        <button className="btn sm primary" onClick={() => openDraftFromRange(assetId, idea.start, idea.end, idea.firstWord, idea.lastWord)} data-testid="idea-draft" title="Bu bölümü klip taslağı olarak açar; oradan 'Yeni projede aç' ile ayrı bir proje yapabilirsiniz">Klip yap</button>
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
      <div className="infobox">Transkripti okur ve <b>YouTube'da klip olarak paylaşabileceğiniz 2–30 dakikalık bölümleri</b> bulur (ör. "Batrakov hakkında konuşmuşsun · 6 dk"). Hangisini klip yapacağınıza siz karar verirsiniz.</div>
      {!asset && <div className="empty">Soldaki kütüphaneden bir kayıt seçin.</div>}
      {asset && !hasTranscript && <div className="warnbox">Bu kayıt henüz transkribe edilmemiş: Kaynak sekmesi → "Transkripsiyonu başlat".</div>}
      {asset && (
        <>
          <label className="check" title={aiReady ? '' : 'Ayarlar → Yapay zekâ bölümünden bir sağlayıcı ve API anahtarı girin'}>
            <input type="checkbox" checked={useAi && aiReady} disabled={!aiReady} onChange={(e) => setUseAi(e.target.checked)} data-testid="ideas-ai" /> YouTube başlığı da önersin (yapay zekâ)
          </label>
          {!aiReady && <div className="hint">Başlık önerisi için <a href="#" onClick={(e) => { e.preventDefault(); openDialog('settings') }}>Ayarlar → Yapay zekâ</a>.</div>}
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
