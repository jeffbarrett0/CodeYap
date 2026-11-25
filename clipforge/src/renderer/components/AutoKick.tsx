import { useEffect, useState } from 'react'
import type { TopicCandidate } from '@shared/topic'
import { LANGUAGES } from '@shared/settings'
import { fmtElapsed, type AutoKickStatus, type TranscriptionReadiness } from '@shared/autokick'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Field, Modal, Num, Progress } from './ui'

const STATUS_LABEL: Record<string, string> = { pending: 'Bekliyor', running: 'Çalışıyor', done: 'Bitti', skipped: 'Sonra', failed: 'Hata' }
const fmtMin = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)} sa ` : ''}${Math.round((s % 3600) / 60)} dk`

/** Aşama ağırlıkları: genel ilerleme çubuğu (transkripsiyon ve kodlama en uzun) */
const WEIGHT: Record<string, number> = { import: 0.05, transcribe: 0.55, silence: 0.05, gaps: 0.02, full: 0.33 }
export const overallProgress = (job: AutoKickStatus) => job.stages.reduce((n, s) => n + (WEIGHT[s.id] ?? 0) * (s.status === 'done' || s.status === 'skipped' ? 1 : s.progress), 0)

/** Biten işin YouTube zaman damgaları: metin doğrudan görünür (kopyala); liste başta verilmediyse/değişecekse şimdi yapıştırılıp çevrilir */
function TimestampsBox({ result }: { result: NonNullable<AutoKickStatus['result']> }) {
  const api = requireApi()
  const toast = useStore((s) => s.toast)
  const [text, setText] = useState(result.timestampsText ?? '')
  const [path, setPath] = useState(result.timestampsPath ?? '')
  const [list, setList] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const convert = async () => {
    setErr('')
    setBusy(true)
    try {
      const r = await api.invoke('autokick:timestamps', { projectPath: result.projectPath, list })
      setText(r.text)
      setPath(r.path)
      setWarnings(r.warnings)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="col" data-testid="autokick-ts-box">
      <div className="section-title">YouTube zaman damgaları</div>
      {text ? (
        <>
          <textarea readOnly rows={Math.min(14, text.split('\n').length + 1)} value={text} aria-label="Zaman damgaları" data-testid="autokick-ts-text" style={{ width: '100%' }} />
          <div className="row wrap">
            <button className="btn sm primary" onClick={() => { void navigator.clipboard?.writeText(text).catch(() => undefined); toast('success', 'Zaman damgaları kopyalandı: YouTube açıklamasına yapıştırın.') }} data-testid="autokick-ts-copy">Kopyala</button>
            {path && <button className="btn sm" onClick={() => void api.invoke('shell:reveal', path)}>Dosyayı aç</button>}
          </div>
        </>
      ) : (
        <div className="hint" data-testid="autokick-ts-none">Zaman damgası yazılmadı (liste verilmediyse ve otomatik bölümler çıkmadıysa). Aşağıdan listenizi yapıştırın.</div>
      )}
      {warnings.map((w, i) => <div key={i} className="hint">⚠ {w}</div>)}
      <details open={!text}>
        <summary>{text ? 'Listeyi değiştir / yeniden çevir' : 'Listeyi şimdi yapıştır'}</summary>
        <div className="col" style={{ marginTop: 6 }}>
          <textarea rows={5} value={list} onChange={(e) => setList(e.target.value)} placeholder={'Giriş - 00:00:00\nLeo - 00:34:00 (orijinal kayıt zamanı)'} aria-label="Zaman damgası listesi (sonradan)" data-testid="autokick-ts-list" style={{ width: '100%' }} />
          <button className="btn sm" disabled={busy || !list.trim()} onClick={() => void convert()} data-testid="autokick-ts-convert">{busy ? 'Çevriliyor…' : 'Kesimli videoya göre çevir'}</button>
          {err && <div className="warnbox" role="alert" data-testid="autokick-ts-error">{err}</div>}
        </div>
      </details>
    </div>
  )
}

function Job({ job }: { job: AutoKickStatus }) {
  const api = requireApi()
  const openProject = useStore((s) => s.openProject)
  const closeDialog = useStore((s) => s.openDialog)
  const toast = useStore((s) => s.toast)
  const outroNotes = useStore((s) => s.outroNotes)
  const r = job.result
  return (
    <div className="col autokick-job" data-testid="autokick-job" data-status={job.status}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b title={job.videoName}>{job.videoName}</b>
        <span className={`badge ${job.status === 'done' ? 'blue' : job.status === 'failed' ? 'red' : ''}`} data-testid="autokick-status">
          {{ running: 'Çalışıyor', done: 'Tamamlandı', failed: 'Hata', cancelled: 'İptal edildi' }[job.status]}
        </span>
      </div>
      <div className="col" style={{ gap: 3 }} data-testid="autokick-overall">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Genel ilerleme</span>
          <b>%{Math.round(overallProgress(job) * 100)}</b>
        </div>
        <Progress value={overallProgress(job)} fail={job.status === 'failed'} />
      </div>
      {job.stages.map((s) => (
        <div key={s.id} className="col" style={{ gap: 3 }} data-testid={`ak-stage-${s.id}`} data-stage-status={s.status}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : s.status === 'failed' ? '✕ ' : '○ '}{s.label}</span>
            <span className="hint">{STATUS_LABEL[s.status]}{s.status === 'running' ? ` %${Math.round(s.progress * 100)}` : ''}{s.startedAt && s.endedAt && s.endedAt - s.startedAt >= 2000 ? ` · ⏱ ${fmtElapsed(s.endedAt - s.startedAt)}` : ''}</span>
          </div>
          {s.status === 'running' && <Progress value={s.progress} />}
          {s.detail && <div className="hint" style={{ wordBreak: 'break-all' }}>{s.detail}</div>}
        </div>
      ))}
      {job.finishedAt && job.status === 'done' && <div className="hint" data-testid="autokick-elapsed"><b>⏱ Toplam süre: {fmtElapsed(job.finishedAt - job.startedAt)}</b></div>}
      {job.error && <div className="warnbox" role="alert" data-testid="autokick-error">{job.error}</div>}
      {(job.status === 'failed' || job.status === 'cancelled') && <button className="btn sm" onClick={() => void api.invoke('autokick:start', job.request)} data-testid="autokick-retry" title="Biten aşamalar atlanır, kaldığı yerden sürer">Yeniden dene (kaldığı yerden)</button>}
      {job.status === 'running' && <button className="btn sm danger" onClick={() => void api.invoke('autokick:cancel', job.id)} data-testid="autokick-cancel">İptal</button>}
      {r && (
        <div className="col" data-testid="autokick-result">
          {(() => {
            const added = outroNotes[r.fullVideoPath]
            const note = added?.note ?? r.outroNote
            const has = added?.ok || (!!r.outroNote && /eklendi|ekli/i.test(r.outroNote))
            return (
              <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                {note && <span className="hint" data-testid="autokick-outro-note">🎬 {note}</span>}
                {!has && <button className="btn sm" onClick={() => void api.invoke('autokick:outro', { fullVideoPath: r.fullVideoPath })} data-testid="autokick-outro-add" title="Tam videonun sonuna YouTube outro'sunu ekler (videoyu yeniden işlemeden; birkaç dakika sürebilir)">Outro'yu şimdi ekle</button>}
              </div>
            )
          })()}
          {r.cutReportPath && <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}><button className="btn sm" onClick={() => void api.invoke('shell:reveal', r.cutReportPath!)} data-testid="autokick-cutreport" title="Hangi yerlerin neden kesildiği: zaman + önce/sonra söylenenler">Kesim raporunu göster</button><span className="hint">Neyin kesildiğini (zaman + önce/sonra söylenenler) buradan kontrol edebilirsin.</span></div>}
          <div className="hint">
            {r.verified && <b>✓ Çıktı doğrulandı (süre, görüntü, ses; boşluk yok). </b>}Süre: {fmtMin(r.durationBeforeSec)} → <b>{fmtMin(r.durationAfterSec)}</b> ({fmtMin(r.removedSec)} kısaldı, {r.cuts} kesim, {r.fillers} dolgu sesi) · {r.words.toLocaleString('tr')} kelime
          </div>
          <div className="row wrap">
            {r.timestampsPath && <div className="hint" data-testid="autokick-timestamps" style={{ wordBreak: 'break-all' }}>YouTube zaman damgaları: {r.timestampsPath}</div>}
            <button className="btn sm" onClick={() => void api.invoke('shell:reveal', r.fullVideoPath)} data-testid="autokick-reveal">Klasörü aç</button>
            <button className="btn sm" onClick={() => void openProject(r.projectPath).then((ok) => ok && closeDialog(null))} data-testid="autokick-open">Projeyi uygulamada aç</button>
          </div>
          <TimestampsBox result={r} />
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

function Readiness() {
  const api = requireApi()
  const [r, setR] = useState<TranscriptionReadiness | null>(null)
  const check = () => void api.invoke('autokick:check').then(setR)
  useEffect(check, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null
  return (
    <div className={r.ok ? 'hint' : 'warnbox'} role={r.ok ? undefined : 'alert'} data-testid="autokick-readiness" data-ok={r.ok}>
      {r.ok && r.problems.length === 0 && <>✓ Transkripsiyon hazır ({r.provider}, {r.model}).</>}
      {r.problems.map((p, i) => <div key={i}>{r.ok ? 'ℹ ' : '⚠ '}{p}</div>)}
      {!r.ok && <button className="btn sm" onClick={check} data-testid="autokick-recheck">Yeniden denetle</button>}
    </div>
  )
}

export function AutoKickDialog() {
  const { settings, openDialog, autoKick, updateSettings } = useStore()
  const api = requireApi()
  const [video, setVideo] = useState('')
  const [outDir, setOutDir] = useState('')
  const [quality, setQuality] = useState<'fast' | 'high'>('fast')
  const [language, setLanguage] = useState(settings.language)
  const [minGap, setMinGap] = useState(settings.silenceMinGapSec)
  const [fillers, setFillers] = useState(settings.cutFillers)
  const [model, setModel] = useState(settings.whisperModel)
  const [hw, setHw] = useState<{ available: boolean; label: string } | null>(null)
  useEffect(() => { void api.invoke('hw:status').then(setHw).catch(() => setHw({ available: false, label: '' })) }, [api])
  const [err, setErr] = useState('')
  const [chapterList, setChapterList] = useState('')
  const jobs = Object.values(autoKick).sort((a, b) => b.startedAt - a.startedAt)

  /** Kayıt seçilir seçilmez iş BAŞLAR: içe aktarma → transkripsiyon → sessizleri kes → boşlukları kapat → tam video. Başka bir tuşa basmak gerekmez. */
  const pick = async () => {
    const paths = await api.invoke('dialog:openMedia')
    const v = paths.find((p) => /\.(mkv|mp4|mov|flv|m4v|webm)$/i.test(p))
    if (!v) {
      if (paths.length) setErr('Bir video dosyası seçin (MKV, MP4, MOV, FLV…).')
      return
    }
    setVideo(v)
    setErr('')
    try {
      await api.invoke('autokick:start', { videoPath: v, outDir: outDir.trim() || undefined, language, quality, model, silence: { minGapSec: minGap, keepSec: settings.silenceKeepSec, cutFillers: fillers }, chapterList: chapterList.trim() || undefined })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="Auto Kick — yayın kaydını otomatik işle" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="autokick-dialog">
        <div className="hint">
          Sıra: <b>içe aktar → transkripsiyon → sessiz alanları kes → boşlukları kapat → tam videoyu kaydet (full video)</b>. Kaydı seçmeniz yeter: iş kendiliğinden başlar ve biter.
          İş arka planda sürer; bu pencereyi kapatabilirsiniz ama uygulamayı kapatmayın. Orijinal kayda dokunulmaz.
        </div>
        <Readiness />
        <Field label="Hazır zaman damgası listesi (isteğe bağlı) — kaydı seçmeden ÖNCE yapıştırın">
          <textarea rows={4} value={chapterList} onChange={(e) => setChapterList(e.target.value)} placeholder={'Giriş - 00:00:00\nNoah Lang - 00:03:00\nLeo - 00:34:00 (ya da önce zaman: 00:34:00 - Leo)'} aria-label="Zaman damgası listesi" data-testid="autokick-chapter-list" style={{ width: '100%' }} />
        </Field>
        {chapterList.trim() && <div className="hint" data-testid="autokick-chapter-hint">Zamanlar <b>orijinal kayıta</b> göre yazılmalı (tek zaman: bölüm bir sonrakinin başına kadar sürer; "03:00 - 09:00 Ad" yazarsanız o aralık): Auto Kick sessizleri ve yayın başını kesince bunları kesimli videonun zamanına kendisi çevirir. Liste verilirse otomatik konu bölümleri çıkarılmaz ve <b>yatay (16:9) klipler yalnızca bu listedeki alanlardan</b> çıkar ("Giriş" klip olmaz); dikey klipler eskisi gibi otomatik konulardan üretilir.</div>}
        <button className="btn primary" style={{ padding: '14px 16px', fontSize: 15 }} onClick={() => void pick()} data-testid="autokick-pick">Yayın kaydını seç ve başlat…</button>
        {video && <div className="hint" data-testid="autokick-path" style={{ wordBreak: 'break-all' }}>Seçilen: {video}</div>}
        {err && <div className="warnbox" role="alert">{err}</div>}
        <div className="col" style={{ gap: 6 }} data-testid="autokick-speed">
          <b>Hız</b>
            <div className="hint" data-testid="autokick-hw-status">{hw === null ? 'Ekran kartı denetleniyor…' : hw.available ? `✓ Ekran kartı bulundu: ${hw.label} — otomatik kullanılır, elle bir şey yapmanız gerekmez.` : 'Ekran kartı kodlayıcısı bulunamadı (sürücü/ffmpeg desteği yok); işlemciyle kodlanır. Güncel NVIDIA sürücüsü kurulu olmalı.'}</div>
            <label className="check" title="Ekran kartın (NVIDIA / Intel / AMD) varsa tam video onunla kodlanır: işlemciyle kodlamaya göre çok daha hızlıdır. Kart yoksa ya da hata verirse kendiliğinden işlemciyle kodlanır."><input type="checkbox" checked={settings.autoKickHwEncode} onChange={(e) => void updateSettings({ autoKickHwEncode: e.target.checked })} data-testid="autokick-hw" /> Ekran kartıyla kodla (varsa; tam video çok daha hızlı biter)</label>
            <label className="row" style={{ gap: 6, alignItems: 'center' }} title="Transkripsiyon, Auto Kick'in en uzun aşamasıdır. Küçük model yaklaşık 2–3 kat hızlı biter; orta model isimleri/kelimeleri daha doğru yazar.">Transkripsiyon modeli
              <select value={model} onChange={(e) => setModel(e.target.value as typeof model)} aria-label="Transkripsiyon modeli" data-testid="autokick-model">
                <option value="base">Hızlı (base) — en hızlı, daha çok yanlış</option>
                <option value="small">Dengeli (small) — hızlı, iyi</option>
                <option value="medium">Doğru (medium) — en doğru, ~2–3 kat yavaş</option>
              </select>
            </label>
        </div>
        <details>
          <summary>Gelişmiş ayarlar (bir sonraki kayıt için)</summary>
          <div className="col" style={{ marginTop: 8 }}>
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
              <label className="check" title="Gözetimsiz çalışırken tüm işlemci çekirdeklerini kullanır: iş daha hızlı biter, bilgisayar o sırada yavaşlar"><input type="checkbox" checked={settings.autoKickFullSpeed} onChange={(e) => void updateSettings({ autoKickFullSpeed: e.target.checked })} data-testid="autokick-fullspeed" /> Tam hız (bilgisayarı yavaşlatır, iş daha çabuk biter)</label>
              <Field label="Şu kadar sn'den uzun sessizlik kesilir"><Num value={minGap} min={0.2} max={10} step={0.1} label="Sessizlik süresi" onChange={setMinGap} /></Field>
              <label className="check"><input type="checkbox" checked={fillers} onChange={(e) => setFillers(e.target.checked)} /> "ııı / eee" dolgu seslerini de kes</label>
              <label className="check" title="Whisper'ın kelime zamanları konuşmanın başını geç verebilir ya da bazı sözleri hiç yazmayabilir. Bu kutu açıkken kesilecek yerlerin gerçek ses seviyesine de bakılır: ses (konuşma) olan yer kesilmez."><input type="checkbox" checked={settings.silenceAudioGuard} onChange={(e) => void updateSettings({ silenceAudioGuard: e.target.checked })} data-testid="autokick-audioguard" /> Konuşmayı koru: gerçek ses seviyesine bakıp konuşulan yerleri ASLA kesme (önerilir)</label>
            </div>
          </div>
        </details>

        {jobs.length > 0 && <div className="section-title">İşler</div>}
        {jobs.map((j) => <Job key={j.id} job={j} />)}
        <TopicClips key={jobs.find((j) => j.result)?.result?.projectPath ?? 'none'} initialProject={jobs.find((j) => j.result)?.result?.projectPath ?? ''} />
      </div>
    </Modal>
  )
}
