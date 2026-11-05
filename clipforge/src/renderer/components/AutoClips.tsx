import { useEffect, useState } from 'react'
import type { AutoClipCandidate } from '@shared/autoclips'
import { DEFAULT_AUTOCLIP_LAYOUT, MAX_CLIP_SEC } from '@shared/autoclips'
import { fmtElapsed } from '@shared/autokick'
import type { NormRect } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Modal, Num, Progress } from './ui'

const mm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Auto Clips: Auto Kick'ten çıkan (sessizleri kesilmiş) videonun transkriptinden "şu aralıkta şunu konuşmuşsun, klip yapabilirsin"
 * önerileri; seçilenlerden 9:16 klip projeleri (yüz üstte, konuşulan görüntü altta). Auto Kick bitince video buraya otomatik devredilir.
 */
export function AutoClipsDialog() {
  const api = requireApi()
  const { autoClipsProject, setAutoClipsProject, openDialog, openProject, autoClipsJobs, settings, updateSettings } = useStore()
  const jobs = Object.values(autoClipsJobs).sort((a, b) => b.startedAt - a.startedAt)
  const job = jobs[0]
  // otomatik zincir çalışıyorsa/çalıştıysa elle bulma beklenmez (aynı işi ikinci kez yapmayalım)
  const autoRan = !!job && (!autoClipsProject || job.request.projectPath === autoClipsProject)
  const [path, setPath] = useState(autoClipsProject)
  const [cands, setCands] = useState<AutoClipCandidate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<{ projectPath: string; durationSec: number; name: string }[]>([])
  const [face, setFace] = useState<NormRect>(DEFAULT_AUTOCLIP_LAYOUT.face)
  const [facePos, setFacePos] = useState<'top' | 'bottom'>('top')
  const [maxSec, setMaxSec] = useState(MAX_CLIP_SEC)
  const [faceZoom, setFaceZoom] = useState(Math.round(DEFAULT_AUTOCLIP_LAYOUT.faceZoom * 100))
  const [focus, setFocus] = useState({ x: Math.round(DEFAULT_AUTOCLIP_LAYOUT.faceFocus.x * 100), y: Math.round(DEFAULT_AUTOCLIP_LAYOUT.faceFocus.y * 100) })
  const [zoom, setZoom] = useState(Math.round(DEFAULT_AUTOCLIP_LAYOUT.screenZoom * 100))
  const [share, setShare] = useState(Math.round(DEFAULT_AUTOCLIP_LAYOUT.faceShare * 1000) / 10)

  const find = async (p = path) => {
    if (!p) return
    setBusy(true)
    setError('')
    setCands(null)
    setMade([])
    try {
      const r = await api.invoke('autoclips:find', { projectPath: p, maxSec })
      setCands(r.candidates)
      setPicked(new Set(r.candidates.map((c) => c.id)))
      if (r.faceRegion) setFace(r.faceRegion)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  // Auto Kick'ten gelen proje varsa adaylar kendiliğinden bulunur
  useEffect(() => {
    if (autoClipsProject && !autoRan) void find(autoClipsProject)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = async () => {
    const p = await api.invoke('dialog:openFile', { title: 'Auto Kick projesi', extensions: ['clipforge'] })
    if (p) {
      setPath(p)
      setAutoClipsProject(p)
      void find(p)
    }
  }
  const make = async () => {
    if (!cands) return
    setBusy(true)
    setError('')
    try {
      const picks = cands.filter((c) => picked.has(c.id)).map((c) => ({ start: c.start, end: c.end, subject: c.subject }))
      setMade(await api.invoke('autoclips:make', { projectPath: path, picks, face, facePos, faceShare: share / 100, faceZoom: faceZoom / 100, faceFocus: { x: focus.x / 100, y: focus.y / 100 }, screenZoom: zoom / 100 }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const setF = (k: keyof NormRect, v: number) => setFace((f) => ({ ...f, [k]: Math.min(1, Math.max(0, v / 100)) }))

  return (
    <Modal title="Auto Clips — konuştuğunuz konulardan klipler" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="autoclips-dialog" style={{ gap: 10 }}>
        <div className="infobox">Auto Kick bitince tam video <b>buraya otomatik devredilir, bu pencere kendiliğinden açılır ve klipler kendiliğinden üretilir</b> (ayarlardan kapatılabilir). Transkripti okur, <b>kimin/neyin hakkında konuştuğunuzu</b> bulur ve “şu aralıkta şunu konuşmuşsun, klip olarak paylaşabilirsin” diye önerir. Seçtiklerinizden <b>9:16 klip projesi</b> yapar: yüzünüz üstte (kaynak karedeki yüz bölgesi), konuşulan görüntü altta.</div>
        <div className="col" data-testid="autoclips-auto" style={{ gap: 6, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 }}>
          <b>Otomatik zincir (bilgisayar başında olmasanız da)</b>
          <label className="check"><input type="checkbox" checked={settings.autoClipsAfterKick} onChange={(e) => void updateSettings({ autoClipsAfterKick: e.target.checked })} data-testid="autoclips-after" /> Auto Kick bitince klipleri kendiliğinden üret</label>
          <label className="check"><input type="checkbox" checked={settings.autoClipsExport} onChange={(e) => void updateSettings({ autoClipsExport: e.target.checked })} data-testid="autoclips-export" /> Klipleri MP4 olarak da dışa aktar (9:16)</label>
          <label className="row" style={{ gap: 6 }}>En çok klip <Num value={settings.autoClipsMax} step={1} min={1} max={30} label="En çok klip" onChange={(v) => void updateSettings({ autoClipsMax: Math.round(v) })} /></label>
          {job && (
            <div className="col" data-testid="autoclips-job" data-status={job.status} style={{ gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b title={job.name}>{job.name}</b>
                <span className={`badge ${job.status === 'done' ? 'blue' : job.status === 'failed' ? 'red' : ''}`} data-testid="autoclips-status">{{ running: 'Çalışıyor', done: 'Tamamlandı', failed: 'Hata', cancelled: 'İptal edildi' }[job.status]}</span>
              </div>
              {job.stages.map((s) => (
                <div key={s.id} className="col" style={{ gap: 2 }} data-testid={`ac-stage-${s.id}`} data-stage-status={s.status}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : s.status === 'failed' ? '✕ ' : '○ '}{s.label}</span>
                    <span className="hint">{s.detail ?? ''}</span>
                  </div>
                  {s.status === 'running' && <Progress value={s.progress} />}
                </div>
              ))}
              {job.finishedAt && job.status === 'done' && <div className="hint" data-testid="autoclips-elapsed"><b>⏱ Toplam süre: {fmtElapsed(job.finishedAt - job.startedAt)}</b>{job.result?.clips.some((c) => c.videoPath) ? ' (klipleri üretme + MP4 dışa aktarma dahil)' : ''}</div>}
              {job.error && <div className="warnbox" role="alert" data-testid="autoclips-job-error">{job.error}</div>}
              {job.status === 'running' && <button className="btn sm danger" onClick={() => void api.invoke('autoclips:cancel', job.id)} data-testid="autoclips-cancel">İptal</button>}
              {job.result && job.result.clips.length === 0 && <div className="hint" data-testid="autoclips-none">Klip olabilecek net bir konu bulunamadı.</div>}
              {job.result && job.result.clips.length > 0 && (
                <div className="col" data-testid="autoclips-results" style={{ gap: 4 }}>
                  <div className="hint"><b>{job.result.clips.filter((c) => c.projectPath).length} klip hazır</b>{job.result.clips.some((c) => c.videoPath) ? ` · ${job.result.clips.filter((c) => c.videoPath).length} MP4` : ''}{job.result.clips.some((c) => c.error) ? ` · ${job.result.clips.filter((c) => c.error).length} hatalı` : ''}</div>
                  {job.result.clips.map((c) => (
                    <div key={c.id} className="row wrap" style={{ gap: 8, alignItems: 'center' }} data-testid="autoclips-result">
                      <span style={{ flex: 1, minWidth: 160 }}><b>{mm(c.start)}–{mm(c.end)}</b> {c.headline}{c.error ? <span className="hint" style={{ color: 'var(--danger, #e5484d)' }}> · {c.error}</span> : ''}</span>
                      {c.videoPath && <button className="btn sm" onClick={() => void api.invoke('shell:reveal', c.videoPath!)} data-testid="autoclips-reveal">MP4'ü göster</button>}
                      {c.projectPath && <button className="btn sm" onClick={() => void openProject(c.projectPath!).then((ok) => ok && openDialog(null))} data-testid="autoclips-open-job">Projeyi aç</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => void pick()} data-testid="autoclips-pick">Auto Kick projesini seç…</button>
          <span className="hint" style={{ wordBreak: 'break-all' }} data-testid="autoclips-path">{path || 'Henüz seçilmedi (Auto Kick bitince otomatik gelir)'}</span>
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row" style={{ gap: 6 }}>En uzun klip (sn) <Num value={maxSec} step={10} min={30} max={MAX_CLIP_SEC} label="En uzun klip" onChange={setMaxSec} /></label>
          <button className="btn primary" disabled={!path || busy} onClick={() => void find()} data-testid="autoclips-find">{busy && !cands ? 'Konular bulunuyor…' : cands ? 'Yeniden bul' : 'Klip önerilerini bul'}</button>
        </div>
        {error && <div className="warnbox" role="alert" data-testid="autoclips-error">{error}</div>}
        {cands && cands.length === 0 && <div className="warnbox" data-testid="autoclips-empty">Klip olabilecek net bir konu bulunamadı (konuşmada kişi/takım adı az olabilir). “En uzun klip” süresini artırıp yeniden deneyin.</div>}
        {cands && cands.length > 0 && (
          <>
            <div className="hint">{cands.length} öneri · işaretlediklerinizden klip yapılır. Bunlar ÖNERİDİR; hangisini kullanacağınıza siz karar verirsiniz.</div>
            <div className="col" style={{ gap: 6, maxHeight: 300, overflow: 'auto' }}>
              {cands.map((c) => (
                <label key={c.id} className="col" data-testid="autoclips-cand" style={{ gap: 2, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8, cursor: 'pointer' }}>
                  <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} data-testid="autoclips-check" />
                    <b>{mm(c.start)} – {mm(c.end)}</b>
                    <span className="hint">· {Math.round(c.durationSec)} sn</span>
                  </span>
                  <span data-testid="autoclips-headline" style={{ fontWeight: 600 }}>{c.headline}</span>
                  <span className="hint">{c.summary}</span>
                </label>
              ))}
            </div>
            <details>
              <summary className="hint" style={{ cursor: 'pointer' }}>Klip düzeni: yüzüm kaynak karenin neresinde?</summary>
              <div className="col" style={{ gap: 6, marginTop: 6 }}>
                <div className="hint">Kaynak karede yüzünüzün bulunduğu dikdörtgen (% olarak; varsayılan sağ alt köşe). Klipte bu bölge büyütülüp {facePos === 'top' ? 'üstte' : 'altta'} gösterilir.</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <label className="row" style={{ gap: 4 }}>Sol (%) <Num value={Math.round(face.x * 100)} step={1} min={0} max={100} label="Yüz bölgesi sol" onChange={(v) => setF('x', v)} /></label>
                  <label className="row" style={{ gap: 4 }}>Üst (%) <Num value={Math.round(face.y * 100)} step={1} min={0} max={100} label="Yüz bölgesi üst" onChange={(v) => setF('y', v)} /></label>
                  <label className="row" style={{ gap: 4 }}>Genişlik (%) <Num value={Math.round(face.w * 100)} step={1} min={5} max={100} label="Yüz bölgesi genişlik" onChange={(v) => setF('w', v)} /></label>
                  <label className="row" style={{ gap: 4 }}>Yükseklik (%) <Num value={Math.round(face.h * 100)} step={1} min={5} max={100} label="Yüz bölgesi yükseklik" onChange={(v) => setF('h', v)} /></label>
                  <label className="row" style={{ gap: 4 }}>Yüz alanı (% kare yüksekliği) <Num value={share} step={1} min={20} max={70} label="Yüz alanı yüksekliği" onChange={setShare} /></label>
                  <label className="row" style={{ gap: 4 }}>Yüz yakınlığı (%) <Num value={faceZoom} step={5} min={100} max={300} label="Yüz yakınlığı" onChange={(v) => setFaceZoom(Math.round(v))} /></label>
                  <label className="row" style={{ gap: 4 }}>Kafa konumu: yatay (%) <Num value={focus.x} step={1} min={0} max={100} label="Kafa yatay konumu" onChange={(v) => setFocus((f) => ({ ...f, x: Math.round(v) }))} /></label>
                  <label className="row" style={{ gap: 4 }}>dikey (%) <Num value={focus.y} step={1} min={0} max={100} label="Kafa dikey konumu" onChange={(v) => setFocus((f) => ({ ...f, y: Math.round(v) }))} /></label>
                  <label className="row" style={{ gap: 4 }}>Alt görüntü yakınlığı (%) <Num value={zoom} step={5} min={100} max={200} label="Alt görüntü yakınlığı" onChange={(v) => setZoom(Math.round(v))} /></label>
                  <label className="check"><input type="checkbox" checked={settings.autoClipsOverlay} onChange={(e) => void updateSettings({ autoClipsOverlay: e.target.checked })} data-testid="autoclips-overlay" /> Klibe sosyal medya şeridini ekle (yüz ile görüntünün birleştiği çizgiye)</label>
                  <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input value={settings.autoClipsOverlayPath} onChange={(e) => void updateSettings({ autoClipsOverlayPath: e.target.value })} placeholder="(varsayılan şerit)" aria-label="Şerit görüntüsü" style={{ minWidth: 220 }} data-testid="autoclips-overlay-path" />
                    <button className="btn sm" onClick={() => void api.invoke('dialog:openFile', { title: 'Şerit görüntüsü (şeffaf PNG)', extensions: ['png', 'webp'] }).then((p) => p && void updateSettings({ autoClipsOverlayPath: p }))} data-testid="autoclips-overlay-pick">Seç…</button>
                  </span>
                  <label className="row" style={{ gap: 4 }}>Yüz
                    <select value={facePos} onChange={(e) => setFacePos(e.target.value as 'top' | 'bottom')} aria-label="Yüz konumu" data-testid="autoclips-facepos">
                      <option value="top">Üstte</option>
                      <option value="bottom">Altta</option>
                    </select>
                  </label>
                </div>
              </div>
            </details>
            <div className="row wrap" style={{ gap: 8 }}>
              <span style={{ flex: 1 }} />
              <button className="btn primary" disabled={busy || picked.size === 0} onClick={() => void make()} data-testid="autoclips-make">{busy ? 'Üretiliyor…' : `Seçilenlerden klip projesi üret (${picked.size})`}</button>
            </div>
          </>
        )}
        {made.length > 0 && (
          <div className="col" data-testid="autoclips-made" style={{ gap: 6 }}>
            <div className="hint"><b>✓ {made.length} klip projesi hazır</b> (Auto Kick projesine dokunulmadı). Uygulamada açıp altyazı ekleyebilir, yerleşimi ayarlayabilir, dışa aktarabilirsiniz.</div>
            {made.map((m) => (
              <div key={m.projectPath} className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{m.name}</span>
                <button className="btn sm" onClick={() => void openProject(m.projectPath).then((ok) => ok && openDialog(null))} data-testid="autoclips-open">Uygulamada aç</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
