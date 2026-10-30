import { useMemo, useState } from 'react'
import type { SearchResult, Transcript } from '@shared/types'
import { useStore } from '../store'
import { fmt } from './ui'

/** Cümle metnini transkript kelimelerinden kurup eşleşen kelimeleri vurgular */
function Highlighted({ r, tr }: { r: SearchResult; tr?: Transcript }) {
  const set = useMemo(() => new Set(r.matchedWords.map((m) => m.index)), [r])
  if (!tr) return <>{r.sentence}</>
  const parts: React.ReactNode[] = []
  for (let i = 0; i < tr.words.length; i++) {
    const w = tr.words[i]
    if (w.end < r.sentenceStart - 0.01) continue
    if (w.start > r.sentenceEnd + 0.01) break
    parts.push(set.has(i) ? <mark key={i}>{w.text}</mark> : <span key={i}>{w.text}</span>, ' ')
  }
  return <>{parts}</>
}

const KIND: Record<string, string> = { exact: 'Tam', fuzzy: 'Bulanık', window: 'Yakın kelimeler', semantic: 'Anlamsal' }

export function SearchPanel() {
  const { query, results, searching, runSearch, project, transcripts, selectedAssetId, selectedResults, toggleResult, openDraftFromResult, createClipsFromResults, settings, updateSettings, setSourceTime, setViewMode, searchedAssetId } = useStore()
  const [text, setText] = useState(query)
  const asset = project.assets.find((a) => a.id === selectedAssetId)
  const tr = searchedAssetId ? transcripts[searchedAssetId] : undefined
  const noTranscript = asset && !transcripts[asset.id]

  return (
    <div className="panel-body">
      <form className="searchbox" onSubmit={(e) => { e.preventDefault(); void runSearch(text) }} role="search">
        <input type="search" placeholder="Bir isim, kelime ya da cümle yazın…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Konuşmada ara" data-testid="search-input" />
        <button className="btn primary" type="submit" disabled={searching} data-testid="search-btn">{searching ? '…' : 'Ara'}</button>
      </form>

      {project.searchHistory.length > 0 && (
        <div>
          <div className="section-title">Son aramalar</div>
          <div className="chips" data-testid="history">
            {project.searchHistory.map((h) => (
              <button key={h} className="chip" onClick={() => { setText(h); void runSearch(h) }}>{h}</button>
            ))}
          </div>
        </div>
      )}

      <details>
        <summary className="hint" style={{ cursor: 'pointer' }}>Arama ayarları</summary>
        <div className="col" style={{ marginTop: 8 }}>
          <label className="check"><input type="checkbox" checked={settings.fuzzyEnabled} onChange={(e) => void updateSettings({ fuzzyEnabled: e.target.checked })} /> Bulanık eşleşme (yazım hataları)</label>
          <label className="field">
            <span>Bulanık eşik: {settings.fuzzyThreshold.toFixed(2)} <span className="hint">(yüksek = daha sıkı)</span></span>
            <input type="range" min={0.5} max={1} step={0.01} value={settings.fuzzyThreshold} onChange={(e) => void updateSettings({ fuzzyThreshold: Number(e.target.value) })} aria-label="Bulanık eşik" />
          </label>
          <label className="field">
            <span>Kelimeler arası pencere: {settings.windowSec} sn</span>
            <input type="range" min={2} max={60} step={1} value={settings.windowSec} onChange={(e) => void updateSettings({ windowSec: Number(e.target.value) })} aria-label="Pencere" />
          </label>
          <label className="check"><input type="checkbox" checked={settings.semanticSearch} onChange={(e) => void updateSettings({ semanticSearch: e.target.checked })} /> Anlamsal arama (embedding sağlayıcısı gerekir)</label>
        </div>
      </details>

      {noTranscript && (
        <div className="infobox">Bu kayıt için henüz transkript yok. Medya sekmesinden <b>Transkripsiyonu başlat</b>'a basın.</div>
      )}

      {query && !searching && results.length === 0 && !noTranscript && <div className="empty" data-testid="no-results">"{query}" için eşleşme bulunamadı. Bulanık eşiği düşürmeyi veya pencereyi genişletmeyi deneyin.</div>}

      {results.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="section-title" style={{ margin: 0 }} data-testid="result-count">{results.length} sonuç · zamana göre</div>
            <button className="btn sm" onClick={() => useStore.getState().clearResults()} data-testid="clear-results" title="Arama sonuçlarını listeden temizler">Sonuçları temizle</button>
            <button className="btn sm" disabled={selectedResults.length === 0} onClick={() => createClipsFromResults(selectedResults)} data-testid="batch-btn">
              Seçilenlerden klip ({selectedResults.length})
            </button>
          </div>
          <div className="col" data-testid="results">
            {results.map((r) => (
              <div
                key={r.id}
                className={`result${selectedResults.includes(r.id) ? ' sel' : ''}`}
                data-testid="result"
                onClick={() => { setViewMode('source'); setSourceTime(Math.max(0, r.start - 1)) }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row">
                    <input type="checkbox" checked={selectedResults.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleResult(r.id)} aria-label={`${fmt(r.start)} sonucunu seç`} />
                    <span className="time">{fmt(r.start)}</span>
                    <span className="badge">{KIND[r.kind]}</span>
                    {r.matchCount > 1 && <span className="badge">{r.matchCount} eşleşme</span>}
                    {r.missingTerms && <span className="badge warn" title={`Eksik: ${r.missingTerms.join(', ')}`}>kısmi</span>}
                  </span>
                  <span className="row" title={`Skor ${(r.score * 100).toFixed(0)}`}>
                    <span className="score"><i style={{ width: `${r.score * 100}%` }} /></span>
                    <span className="hint">{(r.score * 100).toFixed(0)}</span>
                  </span>
                </div>
                {r.before.length > 0 && <div className="ctx">…{r.before.slice(-1)[0]}</div>}
                <div className="main"><Highlighted r={r} tr={tr} /></div>
                {r.after.length > 0 && <div className="ctx">{r.after[0]}…</div>}
                <div className="row">
                  <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); openDraftFromResult(r) }} data-testid="make-clip">Klip oluştur</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
