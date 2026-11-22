import { useEffect, useState } from 'react'
import { FACE_TRIM_DEFAULT, FACE_TRIM_SHAPES, type FaceTrimShape } from '@shared/facetrim'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Modal, Num, Progress } from './ui'

/**
 * SportDeoPlus (yenilendi): bir DİKEY MP4 ver (yukarıda yüzün, ortada sosyal medyaların, aşağıda ekran görüntüsü). Ortadaki şerit ve alttaki ekran
 * silinir, yalnızca üstteki yüz alanı kalır ve MP4 olarak kaydedilir. Kesim çizgisi önizlemede görünür; gerekirse yüz alanı yüksekliğini ayarlarsın.
 */
export function SportPlusDialog() {
  const api = requireApi()
  const { openDialog, tasks, faceTrimResults } = useStore()
  const [video, setVideo] = useState('')
  const [share, setShare] = useState(Math.round(FACE_TRIM_DEFAULT.faceShare * 1000) / 10)
  const [strip, setStrip] = useState(FACE_TRIM_DEFAULT.stripCut)
  const [shape, setShape] = useState<FaceTrimShape>(FACE_TRIM_DEFAULT.shape)
  const [prev, setPrev] = useState<{ original: string; result: string; srcW: number; srcH: number; outW: number; outH: number; durationSec: number; hasAudio: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [taskId, setTaskId] = useState('')
  const task = taskId ? tasks[taskId] : undefined
  const running = task?.status === 'running' || task?.status === 'queued'
  const result = taskId ? faceTrimResults[taskId] : undefined

  // önizleme: ayar değişince kısa gecikmeyle yenilenir
  useEffect(() => {
    if (!video) return
    let cancelled = false
    const t = setTimeout(() => {
      void api.invoke('facetrim:preview', { videoPath: video, faceShare: share / 100, stripCut: strip, shape }).then((r) => {
        if (cancelled) return
        setPrev(r)
        setErr('')
      }).catch((e) => {
        if (cancelled) return
        setPrev(null)
        setErr(e instanceof Error ? e.message : String(e))
      })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [video, share, strip, shape, api])

  const pick = async () => {
    const v = (await api.invoke('dialog:openMedia')).find((p) => /\.(mp4|mov|mkv|m4v|webm)$/i.test(p))
    if (v) (setVideo(v), setErr(''), setTaskId(''))
  }
  const save = async () => {
    setErr('')
    try {
      setTaskId(await api.invoke('facetrim:start', { videoPath: video, faceShare: share / 100, stripCut: strip, shape }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="SportDeoPlus — MP4'ten yalnızca yüzü al" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="sport-dialog" style={{ gap: 10 }}>
        <div className="infobox">Bir <b>dikey MP4</b> seçin (yukarıda yüzünüz, ortada sosyal medyalarınız, aşağıda ekran görüntüsü). <b>Ortadaki şerit ve alttaki ekran silinir</b>, yalnızca <b>yüzünüzün olduğu üst bölüm</b> kalır ve MP4 olarak kaydedilir. Ses aynen korunur. Orijinal dosyaya dokunulmaz; yeni dosya videonun yanına <i>“… - sadece yüz.mp4”</i> adıyla yazılır.</div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" readOnly value={video} placeholder="MP4 seçilmedi" aria-label="MP4" data-testid="sport-video" style={{ flex: 1, minWidth: 260 }} />
          <button className="btn" onClick={() => void pick()} disabled={running} data-testid="sport-pick">MP4 seç…</button>
        </div>
        {video && (
          <>
            <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>Yüz alanı yüksekliği (% kare)
                <button className="btn sm" onClick={() => setShare((v) => Math.max(20, Math.round((v - 0.5) * 10) / 10))} data-testid="sport-share-m">−0,5</button>
                <Num value={share} step={0.5} min={20} max={70} label="Yüz alanı yüksekliği" onChange={(v) => setShare(Math.round(v * 10) / 10)} />
                <button className="btn sm" onClick={() => setShare((v) => Math.min(70, Math.round((v + 0.5) * 10) / 10))} data-testid="sport-share-p">+0,5</button>
              </label>
              <label className="check"><input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} data-testid="sport-strip" /> Ortada sosyal medya şeridi var (onu da kes)</label>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>Çıkış biçimi
                <select value={shape} onChange={(e) => setShape(e.target.value as FaceTrimShape)} aria-label="Çıkış biçimi" data-testid="sport-shape">
                  {FACE_TRIM_SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            </div>
            <div className="hint">Kırmızı çizgi kesimin yeri: <b>çizginin üstü kalır, altı silinir</b>. Çizgi yüzünüzün altına denk gelmiyorsa yüz alanı yüksekliğini ayarlayın (Auto Clips klibinde varsayılan %41,5).</div>
            {prev && (
              <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }} data-testid="sport-preview">
                <div className="col" style={{ gap: 4 }}>
                  <span className="hint">Orijinal ({prev.srcW}×{prev.srcH}) + kesim çizgisi</span>
                  <img src={prev.original} alt="Orijinal kare" style={{ maxHeight: 360, borderRadius: 6 }} data-testid="sport-original" />
                </div>
                <div className="col" style={{ gap: 4 }}>
                  <span className="hint" data-testid="sport-outsize">Çıkacak görüntü: <b>{prev.outW}×{prev.outH}</b>{prev.hasAudio ? ' · ses var' : ' · ses yok'} · {Math.round(prev.durationSec)} sn</span>
                  <img src={prev.result} alt="Çıkacak görüntü" style={{ maxHeight: 360, borderRadius: 6 }} data-testid="sport-result-img" />
                </div>
              </div>
            )}
            {shape === 'vertical' && <div className="warnbox" data-testid="sport-warn">Dikey 9:16 için yüz alanı çok büyütülür (yaklaşık 2,5 kat): görüntü yumuşar. En net sonuç “Olduğu gibi”dir.</div>}
          </>
        )}
        {err && <div className="warnbox" role="alert" data-testid="sport-error">{err}</div>}
        {task?.status === 'failed' && <div className="warnbox" role="alert" data-testid="sport-failed">{task.error}</div>}
        <div className="row wrap" style={{ gap: 8 }}>
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={!video || running || !prev} onClick={() => void save()} data-testid="sport-save">{running ? 'Kaydediliyor…' : 'Yalnızca yüzü MP4 olarak kaydet'}</button>
        </div>
        {running && task && (
          <div className="col" style={{ gap: 3 }} data-testid="sport-progress">
            <div className="row" style={{ justifyContent: 'space-between' }}><span>{task.message ?? 'Hazırlanıyor…'}</span><b>%{Math.round(task.progress * 100)}</b></div>
            <Progress value={task.progress} />
            <button className="btn sm danger" onClick={() => void api.invoke('task:cancel', task.id)}>İptal</button>
          </div>
        )}
        {result && (
          <div className="col" style={{ gap: 4 }} data-testid="sport-done">
            <div><b>✓ Kaydedildi:</b> {result.width}×{result.height} · {Math.round(result.durationSec)} sn</div>
            <div className="row wrap"><button className="btn sm" onClick={() => void api.invoke('shell:reveal', result.outputPath)} data-testid="sport-reveal">Dosyayı göster</button><span className="hint" style={{ wordBreak: 'break-all' }}>{result.outputPath}</span></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
