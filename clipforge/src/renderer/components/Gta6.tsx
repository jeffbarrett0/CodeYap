import { useState } from 'react'
import { fmt } from './ui'
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
  return <RangeClipsDialog mode="gta" />
}

/** Videodan klip çıkart: GTA 6 düğmesinin kopyası; fark: oyun/ekran Auto Clips gibi BÜYÜK (sohbet/chatting yayınları) */
export function VideodanKlipDialog() {
  return <RangeClipsDialog mode="videodan" />
}

/** YouTube dikey video: yayın + elle yazılan aralıklar → standart dikey klipler (yüz üstte, ekran altta); transkript YOK, buton/outro YOK */
export function YtDikeyDialog() {
  return <RangeClipsDialog mode="dikey" />
}

function RangeClipsDialog({ mode }: { mode: 'gta' | 'dikey' | 'videodan' }) {
  const gta = mode === 'gta'
  const vd = mode === 'videodan'
  const pre = vd ? 'videodan' : gta ? 'gta' : 'ytdikey'
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
      const r = await api.invoke('gta:start', { videoPath: video, text, mode })
      setJobId(r.jobId)
      setWarnings(r.warnings)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={gta ? 'GTA 6 klip çıkar' : vd ? 'Videodan klip çıkart' : 'YouTube dikey video — aralıklardan dikey klip'} onClose={() => openDialog(null)} wide>
      <div className="col" data-testid={`${pre}-dialog`} style={{ gap: 10 }}>
        {vd ? (
          <div className="infobox">Bir video seçin ve <b>klip olacak aralıkları</b> yazın (her satıra bir aralık). <b>Transkript yapılmaz</b>; yazdığınız saniyeler aynen klip olur. Düzen (Auto Clips gibi): <b>üstte yüzünüz</b>, ortada sosyal medya şeridi, altta <b>ekran görüntüsü büyük</b>; <b>YouTube abone butonu</b> eklenir, sonunda <b>Kick outro</b> gelir. Orijinal videoya dokunulmaz.</div>
        ) : gta ? (
          <div className="infobox">Bütün yayını seçin, <b>kesmek istediğiniz aralıkları</b> yazın (her satıra bir aralık). <b>Transkript yapılmaz</b>; yazdığınız saniyeler aynen klip olur. Düzen: <b>üstte yüzünüz</b>, ortada sosyal medya şeridi, altında <b>oyun ekranı (birazcık büyütülmüş)</b>, altında <b>bulanık kopyası</b> ve <b>YouTube abone butonu</b>; sonunda <b>Kick outro</b>. Orijinal yayına dokunulmaz.</div>
        ) : (
          <div className="infobox">Bir video seçin (yatay yayın/video) ve <b>klip olacak aralıkları</b> yazın (her satıra bir aralık). <b>Transkript yapılmaz</b>; yazdığınız saniyeler aynen <b>dikey (9:16) klip</b> olur: üstte yüzünüz, ortada sosyal medya şeridi, altta ekran görüntüsü. Dikey videoda YouTube butonu/outro yoktur. Orijinal videoya dokunulmaz. Transkriptten klip için <b>Transcript ile clip</b> düğmesini kullanın.</div>
        )}
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" readOnly value={video} placeholder="Video seçilmedi" aria-label="Video" data-testid={`${pre}-video`} style={{ flex: 1, minWidth: 260 }} />
          <button className="btn" onClick={() => void pick()} disabled={running} data-testid={`${pre}-pick`}>Video seç…</button>
        </div>
        <label className="col" style={{ gap: 4 }}>Aralıklar (dakika:saniye; her satıra bir klip, istersen sonuna isim)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={running} placeholder={'0:28 - 0:45\n1:02:10 - 1:03:00 Heist sahnesi\n95 - 140'} data-testid={`${pre}-ranges`} style={{ width: '100%', fontFamily: 'inherit' }} />
        </label>
        {err && <div className="warnbox" role="alert" data-testid={`${pre}-error`}>{err}</div>}
        {warnings.map((w) => <div key={w} className="warnbox" data-testid={`${pre}-warning`}>{w}</div>)}
        <div className="row wrap" style={{ gap: 8 }}>
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={running || !video} onClick={() => void start()} data-testid={`${pre}-start`}>{busy ? 'Hazırlanıyor…' : running ? 'Klipler hazırlanıyor…' : 'Klipleri çıkar'}</button>
        </div>
        {job && (
          <div className="col" style={{ gap: 4 }} data-testid={`${pre}-job`} data-status={job.status}>
            {job.stages.filter((s) => s.id !== 'find').map((s) => (
              <div key={s.id} className="col" style={{ gap: 2 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : '○ '}{s.label}</span><span className="hint">{s.detail ?? ''}</span></div>
                {s.status === 'running' && <Progress value={s.progress} />}
              </div>
            ))}
            {job.error && <div className="warnbox" role="alert" data-testid={`${pre}-job-error`}>{job.error}</div>}
            {job.status === 'done' && job.result && (
              <div className="col" style={{ gap: 4 }} data-testid={`${pre}-done`}>
                <b>✓ {job.result.clips.filter((c) => c.videoPath).length} klip MP4 olarak hazır</b>
                {job.result.clips.map((c) => (
                  <div key={c.id} className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <span>{c.subject} · {Math.round(c.durationSec)} sn</span>
                    {c.videoPath ? <button className="btn sm" onClick={() => void api.invoke('shell:reveal', c.videoPath!)} data-testid={`${pre}-reveal`}>MP4'ü göster</button> : <span className="err">{c.error}</span>}
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

/**
 * GTA 6 yayın edit: BÜTÜN yayın videosu; transkript YOK, kesim YOK. Videonun 2. saniyesinde YouTube abone butonu, sonra her 2 dakikada bir;
 * sonda YouTube outro; +5 kontrast/+5 keskinlik (Ayarlar'daki otomatik görüntü ayarı). Çıktı yayının yanındaki "GTA 6 Yayın Edit" klasörüne yazılır.
 */
export function GtaEditDialog() {
  const api = requireApi()
  const { openDialog, tasks, ytcutResult } = useStore()
  const [video, setVideo] = useState('')
  const [err, setErr] = useState('')
  const [taskId, setTaskId] = useState('')
  const task = taskId ? tasks[taskId] : undefined
  const running = task?.status === 'running' || task?.status === 'queued'
  const result = ytcutResult && ytcutResult.taskId === taskId ? ytcutResult : null
  const pick = async () => {
    const v = (await api.invoke('dialog:openMedia')).find(isMedia)
    if (v) (setVideo(v), setErr(''), setTaskId(''))
  }
  const start = async () => {
    if (!video) return setErr('Önce yayın videosunu seçin.')
    setErr('')
    try {
      setTaskId(await api.invoke('gtaedit:start', { videoPath: video }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Modal title="GTA 6 yayın edit" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="gtaedit-dialog" style={{ gap: 10 }}>
        <div className="infobox">Yayın videonuzu seçin. <b>Transkript çıkarılmaz</b>, hiçbir yer kesilmez. Videonun <b>2. saniyesinde YouTube abone butonu</b>, sonra <b>her 2 dakikada bir</b> buton eklenir; <b>en sonda outro</b> gelir; görüntüye <b>+5 kontrast ve +5 keskinlik</b> uygulanır. Orijinal videoya dokunulmaz; sonuç yayının yanındaki <b>GTA 6 Yayın Edit</b> klasörüne yazılır. Uzun yayında kodlama süresi alır (ekran kartı varsa kullanılır).</div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" readOnly value={video} placeholder="Yayın videosu seçilmedi" aria-label="Yayın videosu" data-testid="gtaedit-video" style={{ flex: 1, minWidth: 260 }} />
          <button className="btn" onClick={() => void pick()} disabled={running} data-testid="gtaedit-pick">Video seç…</button>
        </div>
        {err && <div className="warnbox" role="alert" data-testid="gtaedit-error">{err}</div>}
        {task?.status === 'failed' && <div className="warnbox" role="alert" data-testid="gtaedit-failed">{task.error}</div>}
        <div className="row wrap" style={{ gap: 8 }}>
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={running || !video} onClick={() => void start()} data-testid="gtaedit-start">{running ? 'Hazırlanıyor…' : 'Yayını düzenle'}</button>
        </div>
        {running && task && (
          <div className="col" style={{ gap: 3 }} data-testid="gtaedit-progress">
            <div className="row" style={{ justifyContent: 'space-between' }}><span>{task.message ?? 'Hazırlanıyor…'}</span><b>%{Math.round(task.progress * 100)}</b></div>
            <Progress value={task.progress} />
            <button className="btn sm danger" onClick={() => void api.invoke('task:cancel', task.id)}>İptal</button>
          </div>
        )}
        {result && (
          <div className="col" style={{ gap: 4 }} data-testid="gtaedit-done">
            {result.items.map((i) => (
              <div key={i.index}>{i.path ? '✓' : '✕'} {i.title} · {fmt(i.durationSec)}{i.ctaAt?.length ? ` · ${i.ctaAt.length} buton` : ''}{i.outroSec ? ` · outro +${Math.round(i.outroSec)} sn` : ''}{i.error ? ` — ${i.error}` : ''}</div>
            ))}
            {result.warnings.map((w, i) => <div key={i} className="hint">⚠ {w}</div>)}
            <div className="row wrap">
              <button className="btn sm" onClick={() => void api.invoke('shell:reveal', result.items.find((i) => i.path)?.path ?? result.dir)} data-testid="gtaedit-reveal">Dosyayı göster</button>
              <span className="hint" style={{ wordBreak: 'break-all' }}>{result.dir}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
