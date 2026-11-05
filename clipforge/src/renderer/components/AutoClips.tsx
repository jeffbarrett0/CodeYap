import { useEffect, useState } from 'react'
import type { AutoClipCandidate } from '@shared/autoclips'
import { DEFAULT_AUTOCLIP_LAYOUT } from '@shared/autoclips'
import type { NormRect } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Modal, Num } from './ui'

const mm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Auto Clips: Auto Kick'ten çıkan (sessizleri kesilmiş) videonun transkriptinden "şu aralıkta şunu konuşmuşsun, klip yapabilirsin"
 * önerileri; seçilenlerden 9:16 klip projeleri (yüz üstte, konuşulan görüntü altta). Auto Kick bitince video buraya otomatik devredilir.
 */
export function AutoClipsDialog() {
  const api = requireApi()
  const { autoClipsProject, setAutoClipsProject, openDialog, openProject } = useStore()
  const [path, setPath] = useState(autoClipsProject)
  const [cands, setCands] = useState<AutoClipCandidate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<{ projectPath: string; durationSec: number; name: string }[]>([])
  const [face, setFace] = useState<NormRect>(DEFAULT_AUTOCLIP_LAYOUT.face)
  const [facePos, setFacePos] = useState<'top' | 'bottom'>('top')
  const [maxSec, setMaxSec] = useState(90)
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
    if (autoClipsProject) void find(autoClipsProject)
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
      setMade(await api.invoke('autoclips:make', { projectPath: path, picks, face, facePos, faceShare: share / 100 }))
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
        <div className="infobox">Auto Kick bitince tam video <b>buraya otomatik devredilir</b>. Transkripti okur, <b>kimin/neyin hakkında konuştuğunuzu</b> bulur ve “şu aralıkta şunu konuşmuşsun, klip olarak paylaşabilirsin” diye önerir. Seçtiklerinizden <b>9:16 klip projesi</b> yapar: yüzünüz üstte (kaynak karedeki yüz bölgesi), konuşulan görüntü altta.</div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => void pick()} data-testid="autoclips-pick">Auto Kick projesini seç…</button>
          <span className="hint" style={{ wordBreak: 'break-all' }} data-testid="autoclips-path">{path || 'Henüz seçilmedi (Auto Kick bitince otomatik gelir)'}</span>
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row" style={{ gap: 6 }}>En uzun klip (sn) <Num value={maxSec} step={10} min={20} max={180} label="En uzun klip" onChange={setMaxSec} /></label>
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
