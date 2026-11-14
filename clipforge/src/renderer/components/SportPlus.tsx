import { useState } from 'react'
import type { TopicCandidate } from '@shared/topic'
import { FACE_ONLY_SHAPES, type FaceOnlyShape } from '@shared/autoclips'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Field, Modal, Num } from './ui'

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Sport diyor Plus: yayından konuşulan konunun (ör. Osimhen) ~40 sn'lik kesiti; ekran YOK, yalnızca yüz tüm kareyi doldurur.
 * Auto Kick projesinden konu bulunur → aday seçilir → ayrı klip projesi (+ MP4) üretilir.
 */
export function SportPlusDialog() {
  const api = requireApi()
  const openDialog = useStore((s) => s.openDialog)
  const openProject = useStore((s) => s.openProject)
  const [project, setProject] = useState('')
  const [topic, setTopic] = useState('')
  const [maxSec, setMaxSec] = useState(45)
  const [shape, setShape] = useState<FaceOnlyShape>('vertical')
  const [captions, setCaptions] = useState(true)
  const [exportVideo, setExportVideo] = useState(true)
  const [cands, setCands] = useState<TopicCandidate[] | null>(null)
  const [made, setMade] = useState<Record<string, { project: string; video?: string }>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const pick = async () => {
    const p = await api.invoke('dialog:openFile', { title: 'Auto Kick projesi', extensions: ['clipforge'] })
    if (p) (setProject(p), setCands(null), setMade({}))
  }
  const search = async () => {
    if (!project) return setErr('Önce Auto Kick projesini seçin.')
    if (!topic.trim()) return setErr('Konuyu yazın (ör. Osimhen).')
    setErr('')
    setBusy('search')
    try {
      setCands(await api.invoke('autokick:topic', { projectPath: project, topic: topic.trim(), maxSec, minSec: 15 }))
      setMade({})
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const create = async (c: TopicCandidate) => {
    setBusy(c.id)
    setErr('')
    try {
      const r = await api.invoke('faceclip:make', { projectPath: project, subject: topic.trim(), start: c.start, end: c.end, shape, captions, exportVideo })
      setMade((m) => ({ ...m, [c.id]: { project: r.projectPath, video: r.videoPath } }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title="SportDeoPlus — yalnızca yüz kesiti" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="sport-plus">
        <div className="hint">Bir konu yazın (ör. <i>Osimhen</i>): yayında o konuyu konuştuğunuz yerler bulunur; <b>ekran olmadan, yalnızca yüzünüz tüm karede</b> ~40 sn'lik kesit çıkarılır. Auto Kick projesine dokunulmaz; kesit ayrı projede (ve istenirse MP4 olarak) üretilir. Kamera kutusu kayıtta küçükse görüntü büyütüldüğü için keskinlik düşebilir.</div>
        <Field label="Auto Kick projesi">
          <div className="row">
            <input type="text" readOnly value={project} placeholder="Seçilmedi" aria-label="Auto Kick projesi" data-testid="sport-project" style={{ flex: 1 }} />
            <button className="btn" onClick={() => void pick()} data-testid="sport-pick-project">Proje seç…</button>
          </div>
        </Field>
        <div className="grid2">
          <Field label="Konu"><input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Osimhen" aria-label="Konu" data-testid="sport-topic" /></Field>
          <Field label="En uzun kesit (sn)"><Num value={maxSec} min={15} max={120} step={5} label="En uzun kesit" onChange={setMaxSec} /></Field>
        </div>
        <div className="grid2">
          <Field label="Biçim">
            <select value={shape} onChange={(e) => setShape(e.target.value as FaceOnlyShape)} aria-label="Biçim" data-testid="sport-shape">
              {(Object.keys(FACE_ONLY_SHAPES) as FaceOnlyShape[]).map((k) => <option key={k} value={k}>{FACE_ONLY_SHAPES[k].label}</option>)}
            </select>
          </Field>
          <div className="col">
            <label className="row"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} data-testid="sport-captions" /> Altyazı ekle</label>
            <label className="row"><input type="checkbox" checked={exportVideo} onChange={(e) => setExportVideo(e.target.checked)} data-testid="sport-export" /> MP4 olarak da dışa aktar</label>
          </div>
        </div>
        {err && <div className="warnbox" role="alert" data-testid="sport-error">{err}</div>}
        <button className="btn primary" disabled={busy === 'search'} onClick={() => void search()} data-testid="sport-search">{busy === 'search' ? 'Aranıyor…' : 'Kesit adaylarını bul'}</button>
        {cands && cands.length === 0 && <div className="empty" data-testid="sport-none">Bu konuda transkriptte geçiş bulunamadı. Yazılışı değiştirip deneyin.</div>}
        {cands?.map((c, i) => (
          <div key={c.id} className="col topic-cand" data-testid="sport-cand">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{i + 1}. aday · {mmss(c.start)}–{mmss(c.end)} · {Math.round(c.durationSec)} sn</b>
              <span className="badge">{c.hits} geçiş</span>
            </div>
            <div className="hint" style={{ maxHeight: 64, overflow: 'auto' }}>{c.text}</div>
            {made[c.id] ? (
              <div className="row wrap">
                <span className="badge blue" data-testid="sport-made">Kesit hazır{made[c.id].video ? ' (MP4 dahil)' : ''}</span>
                <button className="btn sm" onClick={() => void api.invoke('shell:reveal', made[c.id].video ?? made[c.id].project)}>Klasörü aç</button>
                <button className="btn sm" onClick={() => void openProject(made[c.id].project).then((ok) => ok && openDialog(null))}>Uygulamada aç</button>
              </div>
            ) : (
              <button className="btn sm" disabled={!!busy} onClick={() => void create(c)} data-testid="sport-make">{busy === c.id ? 'Hazırlanıyor…' : 'Bu adaydan yüz kesiti üret'}</button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
