import { useState } from 'react'
import { clipEnd } from '@shared/timeline/model'
import { TRAILER_EXACT_MIN, TRAILER_MAX_SEG, TRAILER_MIN_SEG, parseClock, validateSegments, type TrailerMode, type TrailerResult, type TrailerSegment } from '@shared/trailer'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Modal } from './ui'

const MODES: { id: TrailerMode; label: string; help: string }[] = [
  { id: 'exact', label: '🎯 Klip seç', help: `Vlogdan istediğin yerleri tam olarak seç (örn. 1:10 – 1:20). Seçtiklerini OLDUĞU GİBİ, verdiğin sırayla güzelce birleştiririm (kesim sesleri, hafif yakınlaşma, giriş/çıkış, kapanış kartı). Her klip ${TRAILER_EXACT_MIN}–${TRAILER_MAX_SEG} sn.` },
  { id: 'moments', label: '🔎 Parçalardan en güçlü anları bul', help: `${TRAILER_MIN_SEG}–${TRAILER_MAX_SEG} sn'lik parçalar seç; içlerinden en güçlü anları (vurgulu, heyecanlı, sayılı cümleler) ben bulurum, en iyisini başa (kanca) koyarım.` },
  { id: 'auto', label: '🤖 Otomatik fragman', help: 'Hiçbir şey seçme: tüm vlogu tarar, en güçlü anları kendim bulur ve fragmanı kurarım (transkript gerekir).' }
]

/**
 * Fragman: yön (yatay 16:9 / dikey 9:16) + üç yol: (1) Klip seç (olduğu gibi birleştirilir), (2) parçalardan en güçlü anları bul, (3) otomatik.
 * Sonuç AYRI bir fragman projesidir (kaynak vlog değişmez).
 */
export function TrailerDialog() {
  const api = requireApi()
  const { project, playhead, selection, projectPath, dirty, saveProject, openProject, openDialog, toast } = useStore()
  const tl = project.timeline
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9')
  const [mode, setMode] = useState<TrailerMode>('exact')
  const [lists, setLists] = useState<Record<'exact' | 'moments', TrailerSegment[]>>({ exact: [], moments: [] })
  const [from, setFrom] = useState('0:00')
  const [to, setTo] = useState('0:10')
  const [target, setTarget] = useState(45)
  const [title, setTitle] = useState('')
  const [sub, setSub] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrailerResult | null>(null)
  const segs = mode === 'auto' ? [] : lists[mode]
  const setSegs = (f: (x: TrailerSegment[]) => TrailerSegment[]) => mode !== 'auto' && setLists((l) => ({ ...l, [mode]: f(l[mode]) }))
  const problem = segs.length ? validateSegments(segs, mode) : null
  const min = mode === 'exact' ? TRAILER_EXACT_MIN : TRAILER_MIN_SEG
  const add = (s: Omit<TrailerSegment, 'id'>) => setSegs((x) => [...x, { ...s, id: `s${Date.now().toString(36)}${x.length}` }])
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

  const addRange = () => {
    const a = parseClock(from)
    const b = parseClock(to)
    if (a === null || b === null) return setError('Zamanı dakika:saniye olarak yazın (örn. 1:10) ya da saniye (70).')
    if (!(b > a)) return setError('Bitiş, başlangıçtan sonra olmalı.')
    const d = b - a
    if (d < min - 0.01 || d > TRAILER_MAX_SEG + 0.01) return setError(`Seçim ${d.toFixed(1)} sn: ${min}–${TRAILER_MAX_SEG} saniye arasında olmalı.`)
    setError('')
    add({ kind: 'timeline', start: a, end: b })
  }
  const addSelected = () => {
    const c = tl.tracks.flatMap((t) => t.clips).find((k) => selection.includes(k.id))
    if (!c) return setError('Önce zaman çizelgesinde bir klip seçin.')
    const d = clipEnd(c) - c.start
    if (d < min - 0.01 || d > TRAILER_MAX_SEG + 0.01) return setError(`Seçili klip ${d.toFixed(1)} sn: ${min}–${TRAILER_MAX_SEG} saniye arasında olmalı. Aralığı elle yazın.`)
    setError('')
    add({ kind: 'timeline', start: c.start, end: clipEnd(c), label: c.label })
  }
  const libraryVideos = project.assets.filter((a) => a.kind === 'video' && a.durationSec >= min && a.durationSec <= TRAILER_MAX_SEG)
  const totalSec = segs.reduce((n, s) => n + (s.end - s.start), 0)

  const build = async () => {
    const p = validateSegments(segs, mode)
    if (p) return setError(p)
    setBusy(true)
    setError('')
    setResult(null)
    try {
      if (!projectPath || dirty) await saveProject(!projectPath)
      const path = useStore.getState().projectPath
      if (!path) throw new Error('Önce projeyi kaydedin: fragman projenin yanındaki klasöre yazılır.')
      setResult(await api.invoke('trailer:build', { projectPath: path, segments: segs, mode, aspect, targetSec: target, title: title.trim() || undefined, subtitle: sub.trim() || undefined }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const box = { gap: 6, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 } as const
  return (
    <Modal title="Fragman — vlogdan seçtiğin yerlerden" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="trailer-dialog" style={{ gap: 10 }}>
        <div className="infobox" data-testid="trailer-intro">
          <b>Videodan fragmanda görünmesini istediğin yerleri seç.</b> Üç yoldan birini seç: kendin klip seç, parçalardan en güçlü anları buldur ya da hepsini otomatik bırak. Sonuç ayrı bir proje olarak açılır; vlogunuz değişmez.
        </div>

        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <b>Yön:</b>
          <button className={`btn${aspect === '16:9' ? ' primary' : ''}`} onClick={() => setAspect('16:9')} aria-pressed={aspect === '16:9'} data-testid="trailer-aspect-16:9" title="YouTube için">Yatay 16:9</button>
          <button className={`btn${aspect === '9:16' ? ' primary' : ''}`} onClick={() => setAspect('9:16')} aria-pressed={aspect === '9:16'} data-testid="trailer-aspect-9:16" title="Shorts / Reels / TikTok için (kaynak görüntünün ortası kırpılır)">Dikey 9:16</button>
        </div>

        <div className="row wrap" style={{ gap: 8 }} data-testid="trailer-modes">
          {MODES.map((m) => (
            <button key={m.id} className={`btn${mode === m.id ? ' primary' : ''}`} onClick={() => { setMode(m.id); setError(''); setResult(null) }} aria-pressed={mode === m.id} data-testid={`trailer-mode-${m.id}`}>{m.label}</button>
          ))}
        </div>
        <div className="hint" data-testid="trailer-mode-help">{MODES.find((m) => m.id === mode)?.help}</div>

        {mode !== 'auto' && (
          <div className="col" style={box}>
            <b>{mode === 'exact' ? 'Klip ekle' : 'Parça ekle'} (zaman çizelgesinden)</b>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <label className="row" style={{ gap: 4 }}>Başlangıç <input value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 80 }} aria-label="Başlangıç" placeholder="1:10" data-testid="trailer-from" /></label>
              <button className="btn sm" onClick={() => setFrom(clock(playhead))} data-testid="trailer-from-now" title="Başlangıcı oynatma başlığının olduğu an yap">şimdiki an ({fmt(playhead)})</button>
              <label className="row" style={{ gap: 4 }}>Bitiş <input value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 80 }} aria-label="Bitiş" placeholder="1:20" data-testid="trailer-to" /></label>
              <button className="btn sm" onClick={() => setTo(clock(playhead))} data-testid="trailer-to-now">şimdiki an</button>
              <button className="btn primary sm" onClick={addRange} data-testid="trailer-add-range">{mode === 'exact' ? 'Klibi ekle' : 'Parçayı ekle'}</button>
              <button className="btn sm" onClick={addSelected} data-testid="trailer-add-selected" title="Zaman çizelgesinde seçili klibi ekler">Seçili klibi ekle</button>
            </div>
            <div className="hint">Zamanı dakika:saniye yaz (örn. 1:10 → 1:20). Oynatmayı istediğin yerde durdurup "şimdiki an"a da basabilirsin.</div>
          </div>
        )}

        {mode !== 'auto' && libraryVideos.length > 0 && (
          <div className="col" style={box} data-testid="trailer-library">
            <b>Kütüphanedeki kısa videolar ({min}–{TRAILER_MAX_SEG} sn)</b>
            {libraryVideos.map((a) => (
              <label key={a.id} className="check">
                <input type="checkbox" checked={segs.some((s) => s.kind === 'asset' && s.assetId === a.id)} onChange={(e) => (e.target.checked ? add({ kind: 'asset', assetId: a.id, start: 0, end: a.durationSec, label: a.name }) : setSegs((x) => x.filter((s) => !(s.kind === 'asset' && s.assetId === a.id))))} /> {a.name} · {a.durationSec.toFixed(0)} sn
              </label>
            ))}
          </div>
        )}

        {mode !== 'auto' && (
          <div className="col" style={{ gap: 4 }} data-testid="trailer-segments">
            <b>{mode === 'exact' ? 'Seçilen klipler' : 'Seçilen parçalar'} ({segs.length}){mode === 'exact' && segs.length ? ` · toplam ${totalSec.toFixed(0)} sn` : ''}</b>
            {segs.length === 0 && <div className="hint">Henüz seçim yok: yukarıdan ekleyin.</div>}
            {segs.map((s, i) => {
              const d = s.end - s.start
              const bad = d < min - 0.01 || d > TRAILER_MAX_SEG + 0.01
              return (
                <div key={s.id} className="row" style={{ gap: 8, alignItems: 'center' }} data-testid="trailer-segment">
                  <span style={{ flex: 1, color: bad ? 'var(--danger, #e5484d)' : undefined }}>{i + 1}. {s.kind === 'asset' ? (s.label ?? 'Video') : `${fmt(s.start)} – ${fmt(s.end)}`} · {d.toFixed(1)} sn{bad ? ` ✕ (${min}–${TRAILER_MAX_SEG} sn olmalı)` : ''}</span>
                  <button className="btn sm danger" onClick={() => setSegs((x) => x.filter((y) => y.id !== s.id))} aria-label="Kaldır">Kaldır</button>
                </div>
              )
            })}
          </div>
        )}

        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          {mode !== 'exact' && (
            <label className="row" style={{ gap: 6 }}>Fragman süresi
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Fragman süresi" data-testid="trailer-target">
                <option value={30}>~30 sn</option>
                <option value={45}>~45 sn</option>
                <option value={60}>~60 sn</option>
                <option value={90}>~90 sn</option>
              </select>
            </label>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kapanış kartı başlığı (vlog adı; boşsa kart yok)" aria-label="Kapanış kartı başlığı" style={{ flex: 1, minWidth: 220 }} data-testid="trailer-title" />
          <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Alt yazı (örn. 12 Kasım'da yayında)" aria-label="Kapanış kartı alt yazısı" style={{ minWidth: 200 }} />
        </div>

        {(error || problem) && <div className="warnbox" role="alert" data-testid="trailer-error">{error || problem}</div>}
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn primary" disabled={busy || (mode !== 'auto' && segs.length === 0)} onClick={() => void build()} data-testid="trailer-build">{busy ? 'Fragman hazırlanıyor…' : mode === 'auto' ? 'Otomatik fragman yap' : 'Fragmanı oluştur'}</button>
          <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(`clipforge klasöründe çalış. ${projectPath ? `Şu projeden (${projectPath}) ` : 'Vlogdan '}${aspect === '9:16' ? 'dikey (9:16) ' : 'yatay (16:9) '}fragman yap: ${mode === 'exact' ? 'seçtiğim klipleri' : 'en güçlü anları bul, kancayı başa koy ve'} ritimli kurgula, ses efektleri/zoom/geçişlerle zenginleştir. Sahne senin; kendin karar ver.`).catch(() => undefined); toast('success', 'Claude Code komutu kopyalandı.') }} data-testid="trailer-claude" title="Daha yaratıcı bir fragman için komutu Claude Code'a yapıştırın">Claude ile fragman yap (komutu kopyala)</button>
        </div>
        {result && (
          <div className="col" data-testid="trailer-result" style={{ gap: 4 }}>
            <div className="hint"><b>Fragman hazır:</b> {Math.round(result.durationSec)} sn · {result.shots.length} plan · {aspect === '9:16' ? 'dikey' : 'yatay'}. Ayrı proje olarak kaydedildi: {result.projectPath}</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn primary sm" onClick={() => void openProject(result.projectPath).then((ok) => ok && openDialog(null))} data-testid="trailer-open">Fragman projesini aç (sonra Dışa aktar{aspect === '9:16' ? ': Shorts şablonu' : ''})</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
