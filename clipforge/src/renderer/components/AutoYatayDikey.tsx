import { useState } from 'react'
import { fmtElapsed } from '@shared/autokick'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Modal, Progress } from './ui'

/**
 * YouTube outro (kapanış) videosu: HER yatay videonun sonuna eklenir (YouTube yatay video, Auto yatay video, yatay Klip çıkar).
 * Dosya senin bilgisayarında kalır (yol ayarlara kaydedilir); boşsa outro eklenmez.
 */
export function OutroPicker({ disabled }: { disabled?: boolean }) {
  const api = requireApi()
  const { settings, updateSettings } = useStore()
  const pick = async () => {
    const v = (await api.invoke('dialog:openMedia')).find((p) => /\.(mkv|mp4|mov|m4v|webm)$/i.test(p))
    if (v) await updateSettings({ outroPath: v })
  }
  return (
    <div className="col" style={{ gap: 4 }} data-testid="outro-picker">
      <label className="check"><input type="checkbox" checked={settings.outroEnabled} onChange={(e) => void updateSettings({ outroEnabled: e.target.checked })} disabled={disabled} data-testid="outro-enabled" /> <b>Her yatay videonun sonuna YouTube outro (kapanış) videosunu ekle</b></label>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <span>Outro dosyası</span>
        <input type="text" readOnly value={settings.outroPath} placeholder="Seçilmedi (uygulamayla gelen Berkalog outro kullanılır)" aria-label="Outro videosu" data-testid="outro-path" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn sm" onClick={() => void pick()} disabled={disabled} data-testid="outro-pick">Outro seç…</button>
        <button className="btn sm" onClick={() => void api.invoke('outro:folder').then((d) => api.invoke('shell:reveal', d))} data-testid="outro-folder" title="Outro videonu bu klasöre bırakman yeterli (ayrıca seçmene gerek yok)">Kapanış klasörünü aç</button>
        {settings.outroPath && <button className="btn sm" onClick={() => void updateSettings({ outroPath: '' })} disabled={disabled} data-testid="outro-clear">Kaldır</button>}
      </div>
      <div className="hint">Seçtiğin video, her yatay videonun SONUNA eklenir (ölçüsü ve sesi videoya uydurulur; ana video yeniden kodlanmaz). Seçmezsen, <b>kapanış klasörüne</b> bıraktığın ilk video kullanılır (klasörü yukarıdaki düğmeyle açarsın); o da yoksa uygulamayla gelen outro (Berkalog) kullanılır.</div>
    </div>
  )
}

const isMedia = (p: string) => /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i.test(p)

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
        <div className="hint" data-testid="outro-auto-note">Kapanış: <b>Berkalog YouTube outro</b> her videonun sonuna kendiliğinden eklenir (ayrıca seçmenize gerek yok).</div>
        <label className="check"><input type="checkbox" checked={settings.autoHorizontalAfterKick} onChange={(e) => void updateSettings({ autoHorizontalAfterKick: e.target.checked })} data-testid="autoyatay-after" /> Auto Kick bitince (liste verildiyse) yatay kesitleri kendiliğinden üret</label>
        <label className="check"><input type="checkbox" checked={settings.autoHorizontalCta} onChange={(e) => void updateSettings({ autoHorizontalCta: e.target.checked })} data-testid="autoyatay-cta" /> Her kesite YouTube abone butonunu ekle (2. saniyede ilk, sonra her 20 saniyede bir, altta ortada)</label>
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
