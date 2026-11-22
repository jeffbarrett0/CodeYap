import { useState } from 'react'
import { fmtElapsed } from '@shared/autokick'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Modal, Progress } from './ui'

const isMedia = (p: string) => /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i.test(p)

/**
 * YouTube dikey video: kullanıcı bir video verir → sessiz yerler kesilir + transkript çıkar (tam video / zaman damgası / otomatik klip YOK) →
 * bitince Auto Clips penceresi transkriptle açılır: kullanıcı transkripti okur, isim yazar/öneriden seçer, dikey (9:16) klipleri üretir.
 */
export function YtDikeyDialog() {
  const api = requireApi()
  const { openDialog, autoKick, settings } = useStore()
  const [video, setVideo] = useState('')
  const [err, setErr] = useState('')
  const job = Object.values(autoKick)
    .filter((j) => j.request.manual && (!video || j.request.videoPath === video))
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  const running = job?.status === 'running'

  const pick = async () => {
    const v = (await api.invoke('dialog:openMedia')).find(isMedia)
    if (v) (setVideo(v), setErr(''))
  }
  const start = async () => {
    if (!video) return setErr('Önce videoyu seçin.')
    setErr('')
    try {
      await api.invoke('autokick:start', { videoPath: video, language: settings.language, quality: 'fast', silence: { minGapSec: 0.55, keepSec: settings.silenceKeepSec, cutFillers: true }, manual: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="YouTube dikey video — transkriptten dikey klipler" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="ytdikey-dialog" style={{ gap: 10 }}>
        <div className="infobox">Videoyu seçin: <b>sessiz yerler kesilir</b> ve <b>transkript çıkarılır</b>. Bitince <b>Auto Clips penceresi transkriptle birlikte açılır</b>: transkripti okur, bir oyuncu/takım ismi yazar (ya da önerilen isimlerden birine tıklar) ve ismin geçtiği yerlerden <b>dikey (9:16) klipleri</b> seçip üretirsiniz. Klipleri otomatik üretmez; seçimi siz yaparsınız. Orijinal kayda dokunulmaz.</div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" readOnly value={video} placeholder="Video seçilmedi" aria-label="Video" data-testid="ytdikey-video" style={{ flex: 1, minWidth: 240 }} />
          <button className="btn" onClick={() => void pick()} disabled={running} data-testid="ytdikey-pick">Video seç…</button>
          <button className="btn primary" onClick={() => void start()} disabled={running || !video} data-testid="ytdikey-start">{running ? 'Hazırlanıyor…' : 'Sessizleri kes + transkript çıkar'}</button>
        </div>
        {err && <div className="warnbox" role="alert" data-testid="ytdikey-error">{err}</div>}
        {job && (
          <div className="col" style={{ gap: 4 }} data-testid="ytdikey-job" data-status={job.status}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b title={job.videoName}>{job.videoName}</b>
              <span className={`badge ${job.status === 'done' ? 'blue' : job.status === 'failed' ? 'red' : ''}`}>{{ running: 'Çalışıyor', done: 'Tamamlandı', failed: 'Hata', cancelled: 'İptal edildi' }[job.status]}</span>
            </div>
            {job.stages.filter((s) => s.id !== 'full').map((s) => (
              <div key={s.id} className="col" style={{ gap: 2 }} data-stage-status={s.status}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : s.status === 'failed' ? '✕ ' : '○ '}{s.label}</span>
                  <span className="hint">{s.detail ?? ''}</span>
                </div>
                {s.status === 'running' && <Progress value={s.progress} />}
              </div>
            ))}
            {job.finishedAt && job.status === 'done' && <div className="hint"><b>⏱ Toplam süre: {fmtElapsed(job.finishedAt - job.startedAt)}</b> · Transkript Auto Clips penceresinde açıldı.</div>}
            {job.error && <div className="warnbox" role="alert" data-testid="ytdikey-job-error">{job.error}</div>}
            {job.status === 'running' && <button className="btn sm danger" onClick={() => void api.invoke('autokick:cancel', job.id)}>İptal</button>}
            {(job.status === 'failed' || job.status === 'cancelled') && <button className="btn sm" onClick={() => void api.invoke('autokick:start', job.request)} title="Biten aşamalar atlanır">Yeniden dene (kaldığı yerden)</button>}
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Auto yatay video: Auto Kick'e bağlı. Auto Kick bitince, hazır zaman damgası listesi verildiyse, kesimli video buraya kendiliğinden gelir ve
 * listeye göre her satır ayrı yatay (16:9) MP4 olarak kesilir (+ abone butonu, + kesitin konuşma metni).
 */
export function AutoYatayDialog() {
  const api = requireApi()
  const { openDialog, tasks, ytcutResults, settings, updateSettings } = useStore()
  const jobs = Object.values(tasks).filter((t) => t.kind === 'ytcut' && t.title.startsWith('Auto yatay video')).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return (
    <Modal title="Auto yatay video — Auto Kick bitince listene göre yatay kesitler" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="autoyatay-dialog" style={{ gap: 10 }}>
        <div className="infobox">Mantık <b>YouTube yatay video</b> ile aynı, ama <b>Auto Kick'e bağlı</b>: Auto Kick bitince <b>kesimli (sessizsiz) tam video buraya kendiliğinden gelir</b> ve <b>Auto Kick penceresine yapıştırdığınız zaman damgası listesine göre her satır ayrı bir yatay (16:9) MP4</b> olarak kesilir. Her kesitin yanına konuşma metni (<i>… - transkript.txt</i>) da yazılır. Liste yapıştırmadıysanız hiçbir şey kesilmez. Listeyi <b>kaydı seçmeden ÖNCE</b> Auto Kick penceresine yapıştırın. Çıktı: <i>AutoKick/&lt;kayıt&gt;/Yatay/</i>.</div>
        <label className="check"><input type="checkbox" checked={settings.autoHorizontalAfterKick} onChange={(e) => void updateSettings({ autoHorizontalAfterKick: e.target.checked })} data-testid="autoyatay-after" /> Auto Kick bitince (liste verildiyse) yatay kesitleri kendiliğinden üret</label>
        <label className="check"><input type="checkbox" checked={settings.autoHorizontalCta} onChange={(e) => void updateSettings({ autoHorizontalCta: e.target.checked })} data-testid="autoyatay-cta" /> Her kesite YouTube abone butonunu ekle (her 50 saniyede bir, altta ortada)</label>
        {jobs.length === 0 && <div className="hint" data-testid="autoyatay-none">Henüz bir Auto yatay video işi yok. Auto Kick'i zaman damgası listesiyle başlatın; bitince burada görünür.</div>}
        {jobs.slice(0, 3).map((t) => {
          const r = ytcutResults[t.id]
          return (
            <div key={t.id} className="col" style={{ gap: 4, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 }} data-testid="autoyatay-job" data-status={t.status}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{t.title.replace(/^Auto yatay video: /, '')}</b>
                <span className={`badge ${t.status === 'done' ? 'blue' : t.status === 'failed' ? 'red' : ''}`}>{t.status === 'running' ? 'Kesiliyor' : t.status === 'queued' ? 'Sırada' : t.status === 'done' ? 'Tamamlandı' : t.status === 'failed' ? 'Hata' : 'İptal'}</span>
              </div>
              {(t.status === 'running' || t.status === 'queued') && (
                <>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>{t.message ?? 'Hazırlanıyor…'}</span><b>%{Math.round(t.progress * 100)}</b></div>
                  <Progress value={t.progress} />
                  <button className="btn sm danger" onClick={() => void api.invoke('task:cancel', t.id)}>İptal</button>
                </>
              )}
              {t.error && <div className="warnbox" role="alert">{t.error}</div>}
              {r && (
                <div className="col" style={{ gap: 2 }} data-testid="autoyatay-result">
                  {r.items.map((i) => <div key={i.index} data-testid="autoyatay-item">{i.path ? '✓' : '✕'} {i.index}. {i.title} · {fmt(i.durationSec)}{i.error ? ` — ${i.error}` : ''}</div>)}
                  {r.warnings.map((w, i) => <div key={i} className="hint">⚠ {w}</div>)}
                  <div className="row wrap"><button className="btn sm" onClick={() => void api.invoke('shell:reveal', r.items.find((i) => i.path)?.path ?? r.dir)} data-testid="autoyatay-reveal">Klasörü aç</button><span className="hint" style={{ wordBreak: 'break-all' }}>{r.dir}</span></div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
