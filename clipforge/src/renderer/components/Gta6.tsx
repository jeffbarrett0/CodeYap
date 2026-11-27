import { useState } from 'react'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Modal, Progress } from './ui'

const isMedia = (p: string) => /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i.test(p)

/**
 * GTA 6 klip çıkar: bütün yayını seç, zaman aralıklarını yaz (ör. 0:28 - 0:45) → her aralık dikey (9:16) bir MP4.
 * Transkript YOK. Düzen: üstte yüz (kamera kutusu), ortada sosyal medya şeridi, altında OYUN TAM KARE (yakınlaştırma yok),
 * oyunun altındaki boş yerde YouTube abone butonu. Klipler yayının yanındaki "GTA 6 Klipleri" klasörüne yazılır.
 */
export function Gta6Dialog() {
  const api = requireApi()
  const { openDialog, autoClipsJobs } = useStore()
  const [video, setVideo] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const job = jobId ? autoClipsJobs[jobId] : undefined
  const running = busy || job?.status === 'running'

  const pick = async () => {
    const v = (await api.invoke('dialog:openMedia')).find(isMedia)
    if (v) (setVideo(v), setErr(''), setJobId(''))
  }
  const start = async () => {
    if (!video) return setErr('Önce yayın videosunu seçin.')
    if (!text.trim()) return setErr('En az bir zaman aralığı yazın (ör. 0:28 - 0:45).')
    setErr('')
    setBusy(true)
    try {
      const r = await api.invoke('gta:start', { videoPath: video, text })
      setJobId(r.jobId)
      setWarnings(r.warnings)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="GTA 6 klip çıkar" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="gta-dialog" style={{ gap: 10 }}>
        <div className="infobox">Bütün yayını seçin, <b>kesmek istediğiniz aralıkları</b> yazın (her satıra bir aralık). <b>Transkript yapılmaz</b>; yazdığınız saniyeler aynen klip olur. Düzen: <b>üstte yüzünüz</b>, ortada sosyal medya şeridi, altında <b>oyun ekranı tam sığar (yakınlaştırılmaz)</b>, oyunun altındaki boşlukta <b>YouTube abone butonu</b>. Orijinal yayına dokunulmaz.</div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" readOnly value={video} placeholder="Yayın videosu seçilmedi" aria-label="Yayın videosu" data-testid="gta-video" style={{ flex: 1, minWidth: 260 }} />
          <button className="btn" onClick={() => void pick()} disabled={running} data-testid="gta-pick">Video seç…</button>
        </div>
        <label className="col" style={{ gap: 4 }}>Aralıklar (dakika:saniye; her satıra bir klip, istersen sonuna isim)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={running} placeholder={'0:28 - 0:45\n1:02:10 - 1:03:00 Heist sahnesi\n95 - 140'} data-testid="gta-ranges" style={{ width: '100%', fontFamily: 'inherit' }} />
        </label>
        {err && <div className="warnbox" role="alert" data-testid="gta-error">{err}</div>}
        {warnings.map((w) => <div key={w} className="warnbox" data-testid="gta-warning">{w}</div>)}
        <div className="row wrap" style={{ gap: 8 }}>
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={running || !video} onClick={() => void start()} data-testid="gta-start">{busy ? 'Hazırlanıyor…' : running ? 'Klipler hazırlanıyor…' : 'Klipleri çıkar'}</button>
        </div>
        {job && (
          <div className="col" style={{ gap: 4 }} data-testid="gta-job" data-status={job.status}>
            {job.stages.filter((s) => s.id !== 'find').map((s) => (
              <div key={s.id} className="col" style={{ gap: 2 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : '○ '}{s.label}</span><span className="hint">{s.detail ?? ''}</span></div>
                {s.status === 'running' && <Progress value={s.progress} />}
              </div>
            ))}
            {job.error && <div className="warnbox" role="alert" data-testid="gta-job-error">{job.error}</div>}
            {job.status === 'done' && job.result && (
              <div className="col" style={{ gap: 4 }} data-testid="gta-done">
                <b>✓ {job.result.clips.filter((c) => c.videoPath).length} klip MP4 olarak hazır</b>
                {job.result.clips.map((c) => (
                  <div key={c.id} className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <span>{c.subject} · {Math.round(c.durationSec)} sn</span>
                    {c.videoPath ? <button className="btn sm" onClick={() => void api.invoke('shell:reveal', c.videoPath!)} data-testid="gta-reveal">MP4'ü göster</button> : <span className="err">{c.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
