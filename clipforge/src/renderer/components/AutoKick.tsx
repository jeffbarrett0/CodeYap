import { useState } from 'react'
import type { TopicCandidate } from '@shared/topic'
import { LANGUAGES } from '@shared/settings'
import type { AutoKickStatus } from '@shared/autokick'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Field, Modal, Num, Progress } from './ui'

const STATUS_LABEL: Record<string, string> = { pending: 'Bekliyor', running: 'Çalışıyor', done: 'Bitti', skipped: 'Sonra', failed: 'Hata' }
const fmtMin = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)} sa ` : ''}${Math.round((s % 3600) / 60)} dk`

function Job({ job }: { job: AutoKickStatus }) {
  const api = requireApi()
  const openProject = useStore((s) => s.openProject)
  const closeDialog = useStore((s) => s.openDialog)
  const r = job.result
  return (
    <div className="col autokick-job" data-testid="autokick-job" data-status={job.status}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b title={job.videoName}>{job.videoName}</b>
        <span className={`badge ${job.status === 'done' ? 'blue' : job.status === 'failed' ? 'red' : ''}`} data-testid="autokick-status">
          {{ running: 'Çalışıyor', done: 'Tamamlandı', failed: 'Hata', cancelled: 'İptal edildi' }[job.status]}
        </span>
      </div>
      {job.stages.map((s) => (
        <div key={s.id} className="col" style={{ gap: 3 }} data-testid={`ak-stage-${s.id}`} data-stage-status={s.status}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : s.status === 'failed' ? '✕ ' : '○ '}{s.label}</span>
            <span className="hint">{STATUS_LABEL[s.status]}{s.status === 'running' ? ` %${Math.round(s.progress * 100)}` : ''}</span>
          </div>
          {s.status === 'running' && <Progress value={s.progress} />}
          {s.detail && <div className="hint" style={{ wordBreak: 'break-all' }}>{s.detail}</div>}
        </div>
      ))}
      {job.error && <div className="warnbox" role="alert" data-testid="autokick-error">{job.error}</div>}
      {job.status === 'running' && <button className="btn sm danger" onClick={() => void api.invoke('autokick:cancel', job.id)} data-testid="autokick-cancel">İptal</button>}
      {r && (
        <div className="col" data-testid="autokick-result">
          <div className="hint">
            {r.verified && <b>✓ Çıktı doğrulandı (süre, görüntü, ses; boşluk yok). </b>}Süre: {fmtMin(r.durationBeforeSec)} → <b>{fmtMin(r.durationAfterSec)}</b> ({fmtMin(r.removedSec)} kısaldı, {r.cuts} kesim, {r.fillers} dolgu sesi) · {r.words.toLocaleString('tr')} kelime
          </div>
          <div className="row wrap">
            <button className="btn sm" onClick={() => void api.invoke('shell:reveal', r.fullVideoPath)} data-testid="autokick-reveal">Klasörü aç</button>
            <button className="btn sm" onClick={() => void openProject(r.projectPath).then((ok) => ok && closeDialog(null))} data-testid="autokick-open">Projeyi uygulamada aç</button>
          </div>
        </div>
      )}
    </div>
  )
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Konu klibi: "Osimhen'le ilgili klip çıkar" → transkriptte konuyu bul, aday öner, seçilenden bağımsız klip projesi üret */
function TopicClips({ initialProject }: { initialProject: string }) {
  const api = requireApi()
  const openProject = useStore((s) => s.openProject)
  const openDialog = useStore((s) => s.openDialog)
  const [project, setProject] = useState(initialProject)
  const [topic, setTopic] = useState('')
  const [maxSec, setMaxSec] = useState(60)
  const [cands, setCands] = useState<TopicCandidate[] | null>(null)
  const [made, setMade] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const pickProject = async () => {
    const p = await api.invoke('dialog:openFile', { title: 'Auto Kick projesi', extensions: ['clipforge'] })
    if (p) (setProject(p), setCands(null), setMade({}))
  }
  const search = async () => {
    if (!project) return setErr('Önce bir Auto Kick projesi seçin (ya da yukarıdaki işin sonucundan kullanın).')
    if (!topic.trim()) return setErr('Konuyu yazın (ör. Osimhen).')
    setErr('')
    setBusy('search')
    try {
      setCands(await api.invoke('autokick:topic', { projectPath: project, topic: topic.trim(), maxSec }))
      setMade({})
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const create = async (c: TopicCandidate) => {
    setBusy(c.id)
    try {
      const r = await api.invoke('autokick:makeClip', { projectPath: project, topic: topic.trim(), start: c.start, end: c.end })
      setMade((m) => ({ ...m, [c.id]: r.projectPath }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="col" data-testid="topic-clips">
      <div className="section-title">Konu klibi</div>
      <div className="hint">Bir konu yazın (ör. <i>Osimhen</i>): Auto Kick transkriptinde geçtiği yerler bulunur, aday klipler önerilir; siz seçersiniz. Klip, Auto Kick projesine dokunmadan <b>ayrı bir projede</b> açılır (düzenleme adımı sonra).</div>
      <Field label="Auto Kick projesi">
        <div className="row">
          <input type="text" readOnly value={project} placeholder="Seçilmedi" aria-label="Auto Kick projesi" data-testid="topic-project" style={{ flex: 1 }} />
          <button className="btn" onClick={() => void pickProject()} data-testid="topic-pick-project">Proje seç…</button>
        </div>
      </Field>
      <div className="grid2">
        <Field label="Konu"><input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Osimhen" aria-label="Konu" data-testid="topic-input" /></Field>
        <Field label="En uzun klip (sn)"><Num value={maxSec} min={10} max={300} step={5} label="En uzun klip" onChange={setMaxSec} /></Field>
      </div>
      {err && <div className="warnbox" role="alert" data-testid="topic-error">{err}</div>}
      <button className="btn primary" disabled={busy === 'search'} onClick={() => void search()} data-testid="topic-search">{busy === 'search' ? 'Aranıyor…' : 'Klip adaylarını bul'}</button>
      {cands && cands.length === 0 && <div className="empty" data-testid="topic-none">Bu konuda transkriptte geçiş bulunamadı. Yazılışı değiştirip deneyin.</div>}
      {cands?.map((c, i) => (
        <div key={c.id} className="col topic-cand" data-testid="topic-cand">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{i + 1}. aday · {mmss(c.start)}–{mmss(c.end)} · {Math.round(c.durationSec)} sn</b>
            <span className="badge">{c.hits} geçiş</span>
          </div>
          <div className="hint" style={{ maxHeight: 64, overflow: 'auto' }}>{c.text}</div>
          {made[c.id] ? (
            <div className="row wrap">
              <span className="badge blue" data-testid="topic-made">Klip projesi oluşturuldu</span>
              <button className="btn sm" onClick={() => void api.invoke('shell:reveal', made[c.id])}>Klasörü aç</button>
              <button className="btn sm" onClick={() => void openProject(made[c.id]).then((ok) => ok && openDialog(null))} data-testid="topic-open">Uygulamada aç</button>
            </div>
          ) : (
            <button className="btn sm" disabled={!!busy} onClick={() => void create(c)} data-testid="topic-make">{busy === c.id ? 'Oluşturuluyor…' : 'Bu adaydan klip projesi oluştur'}</button>
          )}
        </div>
      ))}
    </div>
  )
}

export function AutoKickDialog() {
  const { settings, openDialog, autoKick } = useStore()
  const api = requireApi()
  const [video, setVideo] = useState('')
  const [outDir, setOutDir] = useState('')
  const [quality, setQuality] = useState<'fast' | 'high'>('fast')
  const [language, setLanguage] = useState(settings.language)
  const [minGap, setMinGap] = useState(settings.silenceMinGapSec)
  const [fillers, setFillers] = useState(settings.cutFillers)
  const [err, setErr] = useState('')
  const jobs = Object.values(autoKick).sort((a, b) => b.startedAt - a.startedAt)

  const pick = async () => {
    const paths = await api.invoke('dialog:openMedia')
    const v = paths.find((p) => /\.(mkv|mp4|mov|flv|m4v|webm)$/i.test(p))
    if (v) (setVideo(v), setErr(''))
    else if (paths.length) setErr('Bir video dosyası seçin (MKV, MP4, MOV, FLV…).')
  }
  const start = async () => {
    if (!video) return setErr('Önce bir yayın kaydı seçin.')
    try {
      await api.invoke('autokick:start', { videoPath: video, outDir: outDir.trim() || undefined, language, quality, silence: { minGapSec: minGap, keepSec: settings.silenceKeepSec, cutFillers: fillers } })
      setVideo('')
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="Auto Kick — yayın kaydını otomatik işle" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="autokick-dialog">
        <div className="hint">
          Sıra: <b>içe aktar → transkripsiyon → sessiz alanları kes → boşlukları kapat → tam videoyu kaydet (full video)</b>. Siz hiçbir şeye dokunmazsınız.
          İş arka planda sürer; bu pencereyi kapatabilirsiniz ama uygulamayı kapatmayın. Orijinal kayda dokunulmaz.
        </div>
        <Field label="Yayın kaydı">
          <div className="row">
            <input type="text" readOnly value={video} placeholder="Henüz seçilmedi" aria-label="Yayın kaydı yolu" data-testid="autokick-path" style={{ flex: 1 }} />
            <button className="btn" onClick={() => void pick()} data-testid="autokick-pick">Kayıt seç…</button>
          </div>
        </Field>
        <Field label="Çıkış klasörü (boşsa kaydın yanında AutoKick/<kayıt adı>/)">
          <input type="text" value={outDir} onChange={(e) => setOutDir(e.target.value)} aria-label="Çıkış klasörü" placeholder="Varsayılan" />
        </Field>
        <div className="grid2">
          <Field label="Konuşma dili">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Dil">{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
          </Field>
          <Field label="Tam video kalitesi">
            <select value={quality} onChange={(e) => setQuality(e.target.value as 'fast' | 'high')} aria-label="Kalite" data-testid="autokick-quality">
              <option value="fast">Hızlı (önerilen — uzun yayın)</option>
              <option value="high">Maksimum (çok daha yavaş)</option>
            </select>
          </Field>
          <Field label="Şu kadar sn'den uzun sessizlik kırpılır"><Num value={minGap} min={0.2} max={10} step={0.1} label="Sessizlik süresi" onChange={setMinGap} /></Field>
          <label className="check"><input type="checkbox" checked={fillers} onChange={(e) => setFillers(e.target.checked)} /> "ııı / eee" dolgu seslerini de kes</label>
        </div>
        {err && <div className="warnbox" role="alert">{err}</div>}
        <button className="btn primary" onClick={() => void start()} data-testid="autokick-start">Auto Kick'i başlat</button>

        {jobs.length > 0 && <div className="section-title">İşler</div>}
        {jobs.map((j) => <Job key={j.id} job={j} />)}
        <TopicClips key={jobs.find((j) => j.result)?.result?.projectPath ?? 'none'} initialProject={jobs.find((j) => j.result)?.result?.projectPath ?? ''} />
      </div>
    </Modal>
  )
}
