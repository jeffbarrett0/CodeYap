import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTimecode } from '@shared/text'
import { cutBoundsForWords, timelineWords, wordIndexAt } from '@shared/timeline/transcript'
import { useStore } from '../store'
import { fmt } from './ui'

interface W {
  text: string
  start: number
  end: number
  confidence?: number
  corrected?: string
  /** düzeltme için: kaynak transkript ve kelime indeksi */
  assetId?: string
  srcIndex?: number
}

const UNSURE = 0.5

/** start'a göre sıralı kelime dizisinde ikili arama */
function indexByStart(words: { start: number }[], start: number): number {
  let lo = 0
  let hi = words.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (Math.abs(words[mid].start - start) < 1e-6) return mid
    if (words[mid].start < start) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

function SilenceSettings() {
  const { settings, updateSettings } = useStore()
  return (
    <details>
      <summary className="hint" style={{ cursor: 'pointer' }}>Kesme ayarları</summary>
      <div className="col" style={{ marginTop: 6 }}>
        <label className="field"><span>Şundan uzun sessizlik kesilsin: {settings.silenceMinGapSec.toFixed(2)} sn</span><input type="range" min={0.3} max={3} step={0.05} value={settings.silenceMinGapSec} onChange={(e) => void updateSettings({ silenceMinGapSec: Number(e.target.value) })} aria-label="Sessizlik eşiği" /></label>
        <label className="field"><span>Kesimden sonra kalan boşluk (her yanda): {settings.silenceKeepSec.toFixed(2)} sn</span><input type="range" min={0} max={0.5} step={0.01} value={settings.silenceKeepSec} onChange={(e) => void updateSettings({ silenceKeepSec: Number(e.target.value) })} aria-label="Kalan boşluk" /></label>
        <label className="check"><input type="checkbox" checked={settings.cutFillers} onChange={(e) => void updateSettings({ cutFillers: e.target.checked })} /> ııı, eee, hımm gibi dolgu seslerini de kes</label>
      </div>
    </details>
  )
}

/** Kaynakta bir kerede gösterilen süre penceresi (çok uzun kayıtlarda arayüzü hafif tutar) */
const WINDOW_SEC = 600

/**
 * Transkript: kelimeye tıklayınca o ana atlar, kelime aralığı seçilip kesilebilir.
 *  - Zaman çizelgesi: çizelgedeki içeriğin transkripti; seçimi KES = tüm izlerden siler (sonrası kayar).
 *  - Kaynak: kaydın tamamı; seçimden klip oluşturulur.
 */
export function TranscriptPanel() {
  const { project, transcripts, selectedAssetId, playhead, sourceTime, viewMode, setViewMode, jumpTo, cutTimelineRange, openDraftFromRange, setPlayhead, setSourceTime, fixTranscriptWord, applyVocabulary } = useStore()
  const [mode, setMode] = useState<'timeline' | 'source'>('timeline')
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [code, setCode] = useState('')
  const [winStart, setWinStart] = useState(0)
  const dragging = useRef(false)
  const curRef = useRef<HTMLSpanElement>(null)
  const tl = project.timeline
  const tr = selectedAssetId ? transcripts[selectedAssetId] : undefined

  const all: W[] = useMemo(() => {
    if (mode === 'source') return (tr?.words ?? []).map((w, i) => ({ ...w, assetId: tr?.assetId, srcIndex: i }))
    return timelineWords(tl, transcripts).map((w) => ({ ...w, srcIndex: indexByStart(transcripts[w.assetId]?.words ?? [], w.sourceStart) }))
  }, [mode, tl, transcripts, tr])
  const unsure = useMemo(() => all.flatMap((w, i) => (w.confidence !== undefined && w.confidence < UNSURE && w.corrected === undefined && /\p{L}/u.test(w.text) ? [i] : [])), [all])
  const [fixText, setFixText] = useState('')
  const now = mode === 'timeline' ? playhead : sourceTime
  const cur = wordIndexAt(all, now)

  // kaynak modunda pencere oynatma konumunu izler
  useEffect(() => {
    if (mode === 'source' && (now < winStart || now > winStart + WINDOW_SEC)) setWinStart(Math.floor(now / WINDOW_SEC) * WINDOW_SEC)
  }, [mode, now, winStart])
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cur])
  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const visible = useMemo(() => {
    const idx: number[] = []
    for (let i = 0; i < all.length; i++) {
      if (mode === 'source' && (all[i].start < winStart || all[i].start >= winStart + WINDOW_SEC)) continue
      idx.push(i)
    }
    return idx
  }, [all, mode, winStart])

  // paragraflar: duraksama / cümle bitişinde böl
  const paras = useMemo(() => {
    const out: number[][] = []
    let curP: number[] = []
    for (const i of visible) {
      const prev = curP.length ? all[curP[curP.length - 1]] : null
      if (prev && (all[i].start - prev.end > 0.9 || /[.!?…]$/.test(prev.text.trim()) && curP.length > 12)) {
        out.push(curP)
        curP = []
      }
      curP.push(i)
    }
    if (curP.length) out.push(curP)
    return out
  }, [visible, all])

  const seek = (i: number) => {
    if (mode === 'timeline') {
      if (viewMode !== 'timeline') setViewMode('timeline')
      setPlayhead(all[i].start)
    } else {
      if (viewMode !== 'source') setViewMode('source')
      setSourceTime(all[i].start)
    }
  }

  const lo = sel ? Math.min(sel.a, sel.b) : -1
  const hi = sel ? Math.max(sel.a, sel.b) : -1
  const bounds = sel ? cutBoundsForWords(all, sel.a, sel.b) : null
  const selText = sel ? all.slice(lo, hi + 1).map((w) => w.text).join(' ') : ''

  const go = () => {
    const t = parseTimecode(code)
    if (t === null) return useStore.getState().toast('error', 'Zaman biçimi anlaşılamadı. Örnekler: 23:14, 1:02:03, 754')
    if (mode === 'source') setWinStart(Math.floor(t / WINDOW_SEC) * WINDOW_SEC)
    jumpTo(t)
  }

  return (
    <div className="panel-body" data-testid="transcript-panel">
      <div className="row">
        <button className={`btn sm grow${mode === 'timeline' ? ' active' : ''}`} onClick={() => { setMode('timeline'); setSel(null) }} data-testid="tw-mode-timeline">Zaman çizelgesi</button>
        <button className={`btn sm grow${mode === 'source' ? ' active' : ''}`} onClick={() => { setMode('source'); setSel(null) }} data-testid="tw-mode-source">Kaynak kayıt</button>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); go() }}>
        <input type="text" placeholder="Zamana git: 23:14" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Zaman damgasına git" data-testid="tw-jump-input" />
        <button className="btn" type="submit" data-testid="tw-jump-go">Git</button>
      </form>

      {mode === 'timeline' && all.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <button className="btn primary" onClick={() => useStore.getState().cutSilence()} data-testid="cut-silence" title="Konuşma olmayan sessiz aralıkları ve ııı / eee gibi dolgu seslerini tek tıkla keser (Ctrl+Z geri alır)">
            ✂ Sessizlikleri ve ııı/eee'leri kes
          </button>
          <SilenceSettings />
        </div>
      )}
      {mode === 'timeline' && all.length > 0 && (
        <button className="btn" onClick={() => useStore.getState().generateCaptions()} data-testid="tw-gen-captions" title="Zaman çizelgesindeki içeriğin transkriptinden altyazı satırları üretir (Altyazı sekmesinden biçimlenir)">
          Bu transkriptten altyazı üret
        </button>
      )}
      {mode === 'source' && !tr && <div className="infobox">Kaynak transkripti için Medya sekmesinden bir kayıt seçip transkripsiyonu başlatın.</div>}
      {mode === 'timeline' && all.length === 0 && <div className="empty">Zaman çizelgesinde transkripti olan içerik yok. Aramadan klip ekleyin ya da transkribe edilmiş bir kaydı ize ekleyin.</div>}

      {mode === 'source' && tr && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn sm" disabled={winStart <= 0} onClick={() => setWinStart(Math.max(0, winStart - WINDOW_SEC))}>◂ önceki 10 dk</button>
          <span className="hint">{fmt(winStart)} – {fmt(winStart + WINDOW_SEC)}</span>
          <button className="btn sm" disabled={winStart + WINDOW_SEC >= tr.durationSec} onClick={() => setWinStart(winStart + WINDOW_SEC)}>sonraki 10 dk ▸</button>
        </div>
      )}

      {sel && bounds && (
        <div className="cand" data-testid="tw-selection">
          <div className="hint">Seçili: {fmt(bounds[0], true)} → {fmt(bounds[1], true)} ({(bounds[1] - bounds[0]).toFixed(1)} sn)</div>
          <div style={{ fontSize: 12 }}>“{selText.length > 140 ? selText.slice(0, 140) + '…' : selText}”</div>
          <div className="row wrap">
            {mode === 'timeline' ? (
              <>
                <button className="btn sm danger" onClick={() => { cutTimelineRange(bounds[0], bounds[1], true); setSel(null) }} data-testid="tw-cut">✂ Seçimi kes (sonrası kayar)</button>
                <button className="btn sm" onClick={() => { cutTimelineRange(bounds[0], bounds[1], false); setSel(null) }} data-testid="tw-cut-gap">Sil, boşluk kalsın</button>
              </>
            ) : (
              <button
                className="btn sm primary"
                onClick={() => selectedAssetId && openDraftFromRange(selectedAssetId, all[lo].start, all[hi].end, lo, hi)} // kaynak modunda indeksler transkript kelime indeksleridir
                data-testid="tw-make-clip"
              >
                Seçimden klip oluştur
              </button>
            )}
            <button className="btn sm" onClick={() => setSel(null)}>Seçimi bırak</button>
          </div>
        </div>
      )}
      {unsure.length > 0 && (
        <div className="row wrap" data-testid="tw-unsure-bar">
          <span className="badge warn">⚠ {unsure.length} kelimeden emin olunamadı</span>
          <button className="btn sm" data-testid="tw-next-unsure" onClick={() => {
            const next = unsure.find((i) => all[i].start > now + 0.05) ?? unsure[0]
            setSel({ a: next, b: next })
            setFixText(all[next].text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
            seek(next)
          }}>Sonraki şüpheli ▸</button>
        </div>
      )}
      {(() => {
        const one = sel && lo === hi ? all[lo] : null
        if (!one || one.srcIndex === undefined || one.srcIndex < 0 || !one.assetId) return null
        const assetId = one.assetId
        const srcIndex = one.srcIndex
        const plain = one.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        return (
          <div className="cand" data-testid="tw-fix">
            <div className="hint">
              Kelimeyi düzelt{one.confidence !== undefined ? ` · güven %${Math.round(one.confidence * 100)}` : ''}
              {one.corrected ? ` · özgün yazım: "${one.corrected}"` : ''}
            </div>
            <input type="text" value={fixText || plain} onChange={(e) => setFixText(e.target.value)} aria-label="Düzeltilmiş yazım" data-testid="tw-fix-input" />
            <div className="row wrap">
              <button className="btn sm" onClick={() => { void fixTranscriptWord(assetId, srcIndex, fixText || plain, false); setFixText('') }} data-testid="tw-fix-one">Düzelt</button>
              <button className="btn sm primary" onClick={() => { void fixTranscriptWord(assetId, srcIndex, fixText || plain, true); setFixText('') }} data-testid="tw-fix-all" title="Aynı yazımdaki tüm geçişleri düzeltir ve özel sözlüğe ekler; sonraki transkripsiyonlarda da doğru yazılır">Tümünde düzelt + sözlüğe ekle</button>
            </div>
          </div>
        )
      })()}
      <div className="row wrap">
        <button className="btn sm" data-testid="tw-apply-vocab" onClick={() => { const ids = [...new Set(all.map((w) => w.assetId).filter(Boolean))] as string[]; (ids.length ? ids : selectedAssetId ? [selectedAssetId] : []).forEach((id) => void applyVocabulary(id)) }} title="Ayarlar → Transkripsiyon → Özel sözlükteki yazımları bu transkripte uygular">Özel sözlüğü uygula</button>
      </div>
      <div className="hint">Kelimeye tıkla: oraya atla · sürükle ya da Shift+tıkla: aralık seç.</div>

      <div className="tw" data-testid="tw-words" onMouseLeave={() => (dragging.current = false)}>
        {paras.map((p, pi) => (
          <p key={pi}>
            <button className="tw-time" onClick={() => seek(p[0])}>{fmt(all[p[0]].start)}</button>
            {p.map((i) => (
              <span
                key={i}
                ref={i === cur ? curRef : undefined}
                className={`tw-word${i === cur ? ' cur' : ''}${i >= lo && i <= hi ? ' sel' : ''}${all[i].confidence !== undefined && all[i].confidence! < UNSURE && all[i].corrected === undefined && /\p{L}/u.test(all[i].text) ? ' unsure' : ''}${all[i].corrected !== undefined ? ' fixed' : ''}`}
                title={all[i].corrected !== undefined ? `Düzeltildi: "${all[i].corrected}" → "${all[i].text}"` : all[i].confidence !== undefined && all[i].confidence! < UNSURE ? `Emin olunamadı (%${Math.round(all[i].confidence! * 100)}) — seçip düzeltebilirsiniz` : undefined}
                data-testid="tw-word"
                onMouseDown={(e) => {
                  if (e.shiftKey && sel) setSel({ a: sel.a, b: i })
                  else {
                    setSel({ a: i, b: i })
                    seek(i)
                    dragging.current = true
                  }
                }}
                onMouseEnter={() => dragging.current && setSel((s) => (s ? { a: s.a, b: i } : s))}
              >
                {all[i].text}{' '}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  )
}
