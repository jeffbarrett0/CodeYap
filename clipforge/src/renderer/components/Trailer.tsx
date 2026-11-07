import { useState } from 'react'
import { clipEnd } from '@shared/timeline/model'
import { TRAILER_MAX_SEG, TRAILER_MIN_SEG, validateSegments, type TrailerResult, type TrailerSegment } from '@shared/trailer'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Modal, Num } from './ui'

/**
 * Fragman: "Videodan fragmanda görünmesini istediğiniz yerleri seçin" — 10–60 sn'lik parçalar (zaman çizelgesinden aralık ya da kütüphanedeki
 * kısa videolar). Seçilenlerden en güçlü anlar bulunup hızlı kurgulu, kancalı, kapanış kartlı AYRI bir fragman projesi yapılır (kaynak değişmez).
 */
export function TrailerDialog() {
  const api = requireApi()
  const { project, playhead, selection, projectPath, dirty, saveProject, openProject, openDialog, toast } = useStore()
  const tl = project.timeline
  const [segs, setSegs] = useState<TrailerSegment[]>([])
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(30)
  const [target, setTarget] = useState(45)
  const [title, setTitle] = useState('')
  const [sub, setSub] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TrailerResult | null>(null)
  const problem = segs.length ? validateSegments(segs) : null
  const nextId = () => `s${Date.now().toString(36)}${segs.length}`
  const add = (s: Omit<TrailerSegment, 'id'>) => setSegs((x) => [...x, { ...s, id: nextId() }])

  const addRange = () => {
    if (!(to > from)) return setError('Bitiş, başlangıçtan sonra olmalı.')
    const d = to - from
    if (d < TRAILER_MIN_SEG || d > TRAILER_MAX_SEG) return setError(`Parça ${d.toFixed(1)} sn: ${TRAILER_MIN_SEG}–${TRAILER_MAX_SEG} saniye arasında olmalı.`)
    setError('')
    add({ kind: 'timeline', start: from, end: to })
  }
  const addSelected = () => {
    const c = tl.tracks.flatMap((t) => t.clips).find((k) => selection.includes(k.id))
    if (!c) return setError('Önce zaman çizelgesinde bir klip seçin.')
    const d = clipEnd(c) - c.start
    if (d < TRAILER_MIN_SEG || d > TRAILER_MAX_SEG) return setError(`Seçili klip ${d.toFixed(1)} sn: ${TRAILER_MIN_SEG}–${TRAILER_MAX_SEG} saniye arasında olmalı. Aralığı elle yazın.`)
    setError('')
    add({ kind: 'timeline', start: c.start, end: clipEnd(c), label: c.label })
  }
  const libraryVideos = project.assets.filter((a) => a.kind === 'video' && a.durationSec >= TRAILER_MIN_SEG && a.durationSec <= TRAILER_MAX_SEG)

  const build = async () => {
    const p = validateSegments(segs)
    if (p) return setError(p)
    setBusy(true)
    setError('')
    setResult(null)
    try {
      if (!projectPath || dirty) await saveProject(!projectPath)
      const path = useStore.getState().projectPath
      if (!path) throw new Error('Önce projeyi kaydedin: fragman projenin yanındaki klasöre yazılır.')
      setResult(await api.invoke('trailer:build', { projectPath: path, segments: segs, targetSec: target, title: title.trim() || undefined, subtitle: sub.trim() || undefined }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Fragman — vlogdan seçtiğin yerlerden" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="trailer-dialog" style={{ gap: 10 }}>
        <div className="infobox" data-testid="trailer-intro">
          <b>Videodan fragmanda görünmesini istediğin yerleri seç.</b> Her parça {TRAILER_MIN_SEG}–{TRAILER_MAX_SEG} saniye olsun. Seçtiğin parçalardan en güçlü anları (vurgulu, heyecanlı, sayılı cümleler) bulur,
          kısa planlara keser, <b>en iyisini başa (kanca) koyar</b>, hızlı kurgu + kesim sesleri + hafif yakınlaşmalarla birleştirir ve sonda başlık kartı koyar. Ayrı bir proje olarak açılır; vlogunuz değişmez.
        </div>

        <div className="col" style={{ gap: 6, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 }}>
          <b>1) Zaman çizelgesinden parça ekle</b>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <label className="row" style={{ gap: 4 }}>Başlangıç (sn) <Num value={from} step={1} min={0} label="Parça başlangıcı" onChange={setFrom} /></label>
            <button className="btn sm" onClick={() => setFrom(Math.round(playhead * 10) / 10)} data-testid="trailer-from-now" title="Başlangıcı oynatma başlığının olduğu an yap">şimdiki an ({fmt(playhead)})</button>
            <label className="row" style={{ gap: 4 }}>Bitiş (sn) <Num value={to} step={1} min={0} label="Parça bitişi" onChange={setTo} /></label>
            <button className="btn sm" onClick={() => setTo(Math.round(playhead * 10) / 10)} data-testid="trailer-to-now">şimdiki an</button>
            <button className="btn primary sm" onClick={addRange} data-testid="trailer-add-range">Parçayı ekle</button>
            <button className="btn sm" onClick={addSelected} data-testid="trailer-add-selected" title="Zaman çizelgesinde seçili klibi parça olarak ekler">Seçili klibi ekle</button>
          </div>
        </div>

        {libraryVideos.length > 0 && (
          <div className="col" style={{ gap: 6, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 }} data-testid="trailer-library">
            <b>2) Kütüphanedeki kısa videolar ({TRAILER_MIN_SEG}–{TRAILER_MAX_SEG} sn)</b>
            {libraryVideos.map((a) => (
              <label key={a.id} className="check">
                <input type="checkbox" checked={segs.some((s) => s.kind === 'asset' && s.assetId === a.id)} onChange={(e) => (e.target.checked ? add({ kind: 'asset', assetId: a.id, start: 0, end: a.durationSec, label: a.name }) : setSegs((x) => x.filter((s) => !(s.kind === 'asset' && s.assetId === a.id))))} /> {a.name} · {a.durationSec.toFixed(0)} sn
              </label>
            ))}
          </div>
        )}

        <div className="col" style={{ gap: 4 }} data-testid="trailer-segments">
          <b>Seçilen parçalar ({segs.length})</b>
          {segs.length === 0 && <div className="hint">Henüz parça yok: yukarıdan ekleyin.</div>}
          {segs.map((s, i) => {
            const d = s.end - s.start
            const bad = d < TRAILER_MIN_SEG - 0.01 || d > TRAILER_MAX_SEG + 0.01
            return (
              <div key={s.id} className="row" style={{ gap: 8, alignItems: 'center' }} data-testid="trailer-segment">
                <span style={{ flex: 1, color: bad ? 'var(--danger, #e5484d)' : undefined }}>{i + 1}. {s.kind === 'asset' ? (s.label ?? 'Video') : `${fmt(s.start)} – ${fmt(s.end)}`} · {d.toFixed(1)} sn{bad ? ' ✕ (10–60 sn olmalı)' : ''}</span>
                <button className="btn sm danger" onClick={() => setSegs((x) => x.filter((y) => y.id !== s.id))} aria-label="Parçayı kaldır">Kaldır</button>
              </div>
            )
          })}
        </div>

        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row" style={{ gap: 6 }}>Fragman süresi
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Fragman süresi" data-testid="trailer-target">
              <option value={30}>~30 sn</option>
              <option value={45}>~45 sn</option>
              <option value={60}>~60 sn</option>
              <option value={90}>~90 sn</option>
            </select>
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kapanış kartı başlığı (vlog adı; boşsa kart yok)" aria-label="Kapanış kartı başlığı" style={{ flex: 1, minWidth: 220 }} data-testid="trailer-title" />
          <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Alt yazı (örn. 12 Kasım'da yayında)" aria-label="Kapanış kartı alt yazısı" style={{ minWidth: 200 }} />
        </div>

        {(error || problem) && <div className="warnbox" role="alert" data-testid="trailer-error">{error || problem}</div>}
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn primary" disabled={busy || segs.length === 0} onClick={() => void build()} data-testid="trailer-build">{busy ? 'Fragman hazırlanıyor…' : 'Fragmanı oluştur'}</button>
          <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(`clipforge klasöründe çalış. ${projectPath ? `Şu projeden (${projectPath}) ` : 'Vlogdan '}fragman yap: seçtiğim parçalardan en güçlü anları bul, kancayı başa koy, ritimli kurgula, ses efektleri/zoom/geçişlerle zenginleştir. Sahne senin; kendin karar ver.`).catch(() => undefined); toast('success', 'Claude Code komutu kopyalandı.') }} data-testid="trailer-claude" title="Daha yaratıcı bir fragman için komutu Claude Code'a yapıştırın">Claude ile fragman yap (komutu kopyala)</button>
        </div>
        {result && (
          <div className="col" data-testid="trailer-result" style={{ gap: 4 }}>
            <div className="hint"><b>Fragman hazır:</b> {Math.round(result.durationSec)} sn · {result.shots.length} plan. En güçlü an başa alındı. Ayrı proje olarak kaydedildi: {result.projectPath}</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn primary sm" onClick={() => void openProject(result.projectPath).then((ok) => ok && openDialog(null))} data-testid="trailer-open">Fragman projesini aç (sonra Dışa aktar)</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
