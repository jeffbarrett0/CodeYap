import { useState } from 'react'
import { parseChapterList } from '@shared/chapters'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Field, Modal, Progress } from './ui'
import { OutroPicker } from './AutoYatayDikey'

/**
 * YouTube yatay video: BÜTÜN yayın + zaman damgaları → her zaman damgası ayrı bir yatay (16:9) MP4.
 * Kesim doğrudan orijinal kayıttan yapılır (sessiz kırpma yok): zamanlar yazdığın gibi kalır.
 */
export function YtCutDialog() {
  const api = requireApi()
  const { openDialog, tasks, ytcutResult } = useStore()
  const [video, setVideo] = useState('')
  const [list, setList] = useState('')
  const [outDir, setOutDir] = useState('')
  const [quality, setQuality] = useState<'fast' | 'high'>('fast')
  const [cta, setCta] = useState(true)
  const [taskId, setTaskId] = useState('')
  const [err, setErr] = useState('')
  const task = taskId ? tasks[taskId] : undefined
  const parsed = parseChapterList(list)
  const running = task?.status === 'running' || task?.status === 'queued'
  const result = ytcutResult && ytcutResult.taskId === taskId ? ytcutResult : null

  const pick = async () => {
    const v = (await api.invoke('dialog:openMedia')).find((p) => /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i.test(p))
    if (v) (setVideo(v), setErr(''))
  }
  const start = async () => {
    if (!video) return setErr('Önce bütün yayın kaydını seçin.')
    if (parsed.length === 0) return setErr('Zaman damgası listesi boş ya da okunamadı. Örnek: 00:34:00 - Leo')
    setErr('')
    try {
      setTaskId(await api.invoke('ytcut:start', { videoPath: video, list, outDir: outDir.trim() || undefined, quality, cta }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="YouTube yatay video — zaman damgalarını ayrı videolara kes" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="ytcut-dialog">
        <div className="hint">Bütün yayın kaydını ve zaman damgalarını verin: <b>her satır ayrı bir yatay (16:9) video</b> olarak kesilip kaydedilir (dosya adı = sıra + yazdığınız başlık). Kesim doğrudan orijinal kayıttan yapılır; zamanlar yazdığınız gibi kalır, sessiz kısımlar kırpılmaz. Orijinal kayda dokunulmaz.</div>
        <Field label="1) Bütün yayın kaydı">
          <div className="row">
            <input type="text" readOnly value={video} placeholder="Seçilmedi" aria-label="Yayın kaydı" data-testid="ytcut-video" style={{ flex: 1 }} />
            <button className="btn" onClick={() => void pick()} data-testid="ytcut-pick" disabled={running}>Kayıt seç…</button>
          </div>
        </Field>
        <Field label="2) Zaman damgaları (orijinal kayıt zamanı)">
          <textarea rows={7} value={list} onChange={(e) => setList(e.target.value)} placeholder={'Giriş - 00:00:00\nNoah Lang - 00:03:00\nLeo - 00:34:00\n(ya da önce zaman: 00:34:00 - Leo)'} aria-label="Zaman damgaları" data-testid="ytcut-list" style={{ width: '100%' }} disabled={running} />
        </Field>
        <div className="hint" data-testid="ytcut-parsed">{parsed.length ? `${parsed.length} satır okundu (başlık önce, zaman sonda ya da zaman önce: ikisi de olur). Tek zaman yazarsanız bölüm bir sonraki satırın başına kadar sürer (son satır: kaydın sonuna); "34:00 - 41:00 Ad" yazarsanız tam o aralık kesilir.` : 'Henüz okunan satır yok. Her satırda bir zaman olmalı: "Leo - 00:34:00" ya da "00:34:00 - Leo".'}</div>
        <div className="grid2">
          <Field label="Kalite">
            <select value={quality} onChange={(e) => setQuality(e.target.value as 'fast' | 'high')} aria-label="Kalite" data-testid="ytcut-quality" disabled={running}>
              <option value="fast">Hızlı (iyi kalite)</option>
              <option value="high">Yüksek (daha yavaş, daha küçük dosya)</option>
            </select>
          </Field>
          <Field label="Çıkış klasörü (boşsa kaydın yanında YouTube Yatay/<kayıt adı>/)">
            <input type="text" value={outDir} onChange={(e) => setOutDir(e.target.value)} aria-label="Çıkış klasörü" placeholder="Varsayılan" disabled={running} />
          </Field>
        </div>
        <label className="check" title="İlk buton 2. saniyede, sonra her 20 saniyede bir; altta ortada, küçük. Yeşil perde kesilir, yalnızca buton görünür. 8 sn'den kısa kesitte sığmaz.">
          <input type="checkbox" checked={cta} onChange={(e) => setCta(e.target.checked)} disabled={running} data-testid="ytcut-cta" /> Her kesite YouTube abone butonunu ekle (2. saniyede ilk, sonra her 20 saniyede bir, altta ortada)
        </label>
        <OutroPicker disabled={running} />
        {err && <div className="warnbox" role="alert" data-testid="ytcut-error">{err}</div>}
        {task?.status === 'failed' && <div className="warnbox" role="alert" data-testid="ytcut-failed">{task.error}</div>}
        <button className="btn primary" disabled={running} onClick={() => void start()} data-testid="ytcut-start">{running ? 'Kesiliyor…' : 'Videoları kes ve kaydet'}</button>
        {running && task && (
          <div className="col" style={{ gap: 3 }} data-testid="ytcut-progress">
            <div className="row" style={{ justifyContent: 'space-between' }}><span>{task.message ?? 'Hazırlanıyor…'}</span><b>%{Math.round(task.progress * 100)}</b></div>
            <Progress value={task.progress} />
            <button className="btn sm danger" onClick={() => void api.invoke('task:cancel', task.id)}>İptal</button>
          </div>
        )}
        {result && (
          <div className="col" data-testid="ytcut-result">
            <div className="section-title">Çıktı</div>
            {result.items.map((i) => (
              <div key={i.index} className="row" style={{ justifyContent: 'space-between' }} data-testid="ytcut-item">
                <span>{i.path ? '✓' : '✕'} {i.index}. {i.title} · {fmt(i.durationSec)}{i.ctaAt?.length ? ` · buton: ${i.ctaAt.map((t) => fmt(t)).join(', ')}` : ''}{i.error ? ` — ${i.error}` : ''}</span>
              </div>
            ))}
            {result.warnings.map((w, i) => <div key={i} className="hint">⚠ {w}</div>)}
            <div className="row wrap">
              <button className="btn sm" onClick={() => void api.invoke('shell:reveal', result.items.find((i) => i.path)?.path ?? result.dir)} data-testid="ytcut-reveal">Klasörü aç</button>
              <span className="hint" style={{ wordBreak: 'break-all' }}>{result.dir}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
