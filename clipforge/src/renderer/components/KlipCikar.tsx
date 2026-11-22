import { useEffect, useMemo, useState } from 'react'
import type { SceneCandidate } from '@shared/clipsearch'
import { MAX_CLIP_SEC } from '@shared/autoclips'
import { fmtElapsed } from '@shared/autokick'
import { requireApi } from '../api'
import { useStore } from '../store'
import { Modal, Num, Progress } from './ui'

const stamp = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s - h * 3600 - m * 60
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${sec.toFixed(1).padStart(4, '0')}`
}

/**
 * Klip çıkar: kullanıcı bir anı düz Türkçe anlatır ("Okan Buruk'un kırmızı kart gördüğü yer") → konuşmada kim + ne oldu birlikte geçtiği yerler bulunur →
 * kullanıcı adayı seçer, BAŞINI/SONUNU ince ayar eder → TEK klip: dikey (yüz üstte, ortada sosyal medya şeridi, altta ekran) ve/veya yatay (normal video), MP4.
 * Konuşma yoksa bulunamaz (görüntüye bakılmaz).
 */
export function KlipCikarDialog() {
  const api = requireApi()
  const { openDialog, autoKick, settings, clipFindProject, autoClipsJobs } = useStore()
  const [video, setVideo] = useState('')
  const [err, setErr] = useState('')
  const [project, setProject] = useState(clipFindProject)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [cands, setCands] = useState<SceneCandidate[] | null>(null)
  const [lines, setLines] = useState<{ start: number; end: number; text: string }[]>([])
  const [totalSec, setTotalSec] = useState(0)
  const [pick, setPick] = useState(-1)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [vertical, setVertical] = useState(true)
  const [horizontal, setHorizontal] = useState(true)
  const [note, setNote] = useState('')

  const job = Object.values(autoKick).filter((j) => j.request.after === 'clipfind' && (!video || j.request.videoPath === video)).sort((a, b) => b.startedAt - a.startedAt)[0]
  const running = job?.status === 'running'
  useEffect(() => {
    if (clipFindProject && clipFindProject !== project) setProject(clipFindProject)
  }, [clipFindProject, project])

  // proje hazırsa transkripti yükle (aralık ince ayarında okunur)
  useEffect(() => {
    if (!project) return
    let cancelled = false
    void api.invoke('autoclips:transcript', { projectPath: project }).then((r) => {
      if (cancelled) return
      setLines(r.lines)
      setTotalSec(r.totalSec)
    }).catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [project, api])

  const pickVideo = async () => {
    const v = (await api.invoke('dialog:openMedia')).find((p) => /\.(mkv|mp4|mov|flv|m4v|webm|ts)$/i.test(p))
    if (v) (setVideo(v), setErr(''))
  }
  const pickProject = async () => {
    const p = await api.invoke('dialog:openFile', { title: 'Auto Kick projesi', extensions: ['clipforge'] })
    if (p) (setProject(p), setErr(''), setCands(null))
  }
  const prepare = async () => {
    if (!video) return setErr('Önce videoyu seçin.')
    setErr('')
    try {
      await api.invoke('autokick:start', { videoPath: video, language: settings.language, quality: 'fast', silence: { minGapSec: 0.55, keepSec: settings.silenceKeepSec, cutFillers: true }, manual: true, after: 'clipfind' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const search = async () => {
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const r = await api.invoke('clipfind:search', { projectPath: project, query })
      setCands(r.candidates)
      setTotalSec(r.totalSec)
      if (r.candidates.length === 0) setNote('Konuşmada bulunamadı. Bu an konuşulmadıysa (yalnızca görüntü varsa) program bulamaz. Farklı sözcüklerle deneyin (ör. yalnızca "kırmızı kart" ya da yalnızca ismi).')
      else choose(r.candidates, 0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const choose = (list: SceneCandidate[], i: number) => {
    setPick(i)
    setStart(list[i].start)
    setEnd(list[i].end)
  }
  const clampStart = (v: number) => setStart(Math.max(0, Math.min(v, end - 1)))
  const clampEnd = (v: number) => setEnd(Math.min(totalSec || v, Math.max(v, start + 1)))
  const dur = Math.max(0, end - start)

  const save = async () => {
    setErr('')
    setNote('')
    if (!vertical && !horizontal) return setErr('Dikey ya da yatay (ya da ikisi) seçin.')
    if (!(dur >= 1)) return setErr('Klip en az 1 saniye olmalı.')
    const title = (query.trim() || 'Klip').slice(0, 60)
    const ranges = [{ start, end, title }]
    const base = { projectPath: project, ranges, exact: true, exportVideos: true } as const
    try {
      if (vertical) await api.invoke('autoclips:start', { ...base, ...(settings.autoClipsCaptions ? { captions: true } : {}) })
      if (horizontal) await api.invoke('autoclips:start', { ...base, horizontal: true })
      setNote(`Klip kaydediliyor (${[vertical ? 'dikey' : '', horizontal ? 'yatay' : ''].filter(Boolean).join(' + ')}). İlerleme aşağıda.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const jobs = useMemo(() => Object.values(autoClipsJobs).filter((j) => j.request.projectPath === project && j.request.exact).sort((a, b) => b.startedAt - a.startedAt).slice(0, 4), [autoClipsJobs, project])
  const inRange = (l: { start: number; end: number }) => l.end > start && l.start < end

  return (
    <Modal title="Klip çıkar — bir anı anlat, başını sonunu ayarla, tek klip olarak kaydet" onClose={() => openDialog(null)} wide>
      <div className="col" data-testid="klipcikar-dialog" style={{ gap: 10 }}>
        {!project && (
          <>
            <div className="infobox">Tam videoyu seçin: <b>sessizler kesilir, transkript çıkar</b> (uzun kayıtta zaman alır). Sonra <b>ne aradığınızı düz Türkçe yazarsınız</b> (ör. <i>Okan Buruk'un kırmızı kart gördüğü yer</i>); program konuşmada bulur, <b>başını ve sonunu siz ayarlarsınız</b>. Bu an yayında <b>konuşulmadıysa bulunamaz</b> (görüntüye bakılmaz). Daha önce işlenmiş bir Auto Kick projeniz varsa doğrudan seçebilirsiniz.</div>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <input type="text" readOnly value={video} placeholder="Video seçilmedi" aria-label="Video" data-testid="klipcikar-video" style={{ flex: 1, minWidth: 240 }} />
              <button className="btn" onClick={() => void pickVideo()} disabled={running} data-testid="klipcikar-pick">Video seç…</button>
              <button className="btn primary" onClick={() => void prepare()} disabled={running || !video} data-testid="klipcikar-prepare">{running ? 'Hazırlanıyor…' : 'Hazırla (sessizleri kes + transkript)'}</button>
              <button className="btn" onClick={() => void pickProject()} disabled={running} data-testid="klipcikar-pick-project">Hazır projeyi seç…</button>
            </div>
            {job && (
              <div className="col" style={{ gap: 4 }} data-testid="klipcikar-job" data-status={job.status}>
                {job.stages.filter((s) => s.id !== 'full').map((s) => (
                  <div key={s.id} className="col" style={{ gap: 2 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{s.status === 'done' ? '✓ ' : s.status === 'running' ? '⏳ ' : s.status === 'failed' ? '✕ ' : '○ '}{s.label}</span>
                      <span className="hint">{s.detail ?? ''}</span>
                    </div>
                    {s.status === 'running' && <Progress value={s.progress} />}
                  </div>
                ))}
                {job.finishedAt && job.status === 'done' && <div className="hint"><b>⏱ {fmtElapsed(job.finishedAt - job.startedAt)}</b></div>}
                {job.error && <div className="warnbox" role="alert">{job.error}</div>}
                {job.status === 'running' && <button className="btn sm danger" onClick={() => void api.invoke('autokick:cancel', job.id)}>İptal</button>}
              </div>
            )}
          </>
        )}
        {project && (
          <>
            <div className="hint" style={{ wordBreak: 'break-all' }} data-testid="klipcikar-project">Proje: {project} <button className="btn sm" onClick={() => (setProject(''), setCands(null), setLines([]))} data-testid="klipcikar-change">Başka video…</button></div>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) void search() }} placeholder="Ne arıyorsunuz? (ör. Okan Buruk'un kırmızı kart gördüğü yer)" aria-label="Aranan an" style={{ flex: 1, minWidth: 320 }} data-testid="klipcikar-query" />
              <button className="btn primary" disabled={busy || !query.trim()} onClick={() => void search()} data-testid="klipcikar-search">{busy ? 'Aranıyor…' : 'Bul'}</button>
            </div>
            {note && !jobs.length && <div className="hint" data-testid="klipcikar-note">{note}</div>}
            {cands && cands.length > 0 && (
              <div className="col" style={{ gap: 4 }} data-testid="klipcikar-cands">
                <div className="hint">{cands.length} yer bulundu · doğru olanı seçin, sonra başını/sonunu ayarlayın</div>
                {cands.map((c, i) => (
                  <label key={i} className="col" data-testid="klipcikar-cand" style={{ gap: 2, padding: 8, border: `1px solid ${i === pick ? 'var(--accent, #4cff2a)' : 'var(--border, #2a3a30)'}`, borderRadius: 8, cursor: 'pointer' }}>
                    <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <input type="radio" name="klipcikar-cand" checked={i === pick} onChange={() => choose(cands, i)} />
                      <b>{stamp(c.start)} – {stamp(c.end)}</b>
                      <span className="hint">· {c.matched.join(' + ')}{c.missing.length ? ` (eksik: ${c.missing.join(', ')})` : ''}</span>
                    </span>
                    <span className="hint">{c.text}</span>
                  </label>
                ))}
              </div>
            )}
            {(pick >= 0 || cands !== null) && (
              <div className="col" style={{ gap: 6, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 }} data-testid="klipcikar-range">
                <b>Klip aralığı (başı ve sonu ayarlayın)</b>
                <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
                  <span className="row" style={{ gap: 4, alignItems: 'center' }}>Başlangıç
                    <button className="btn sm" onClick={() => clampStart(start - 1)} data-testid="klipcikar-start-m1">−1 sn</button>
                    <button className="btn sm" onClick={() => clampStart(start - 0.5)}>−0,5</button>
                    <Num value={Math.round(start * 10) / 10} step={0.5} min={0} max={Math.max(1, totalSec)} label="Başlangıç (sn)" onChange={clampStart} />
                    <button className="btn sm" onClick={() => clampStart(start + 0.5)}>+0,5</button>
                    <button className="btn sm" onClick={() => clampStart(start + 1)} data-testid="klipcikar-start-p1">+1 sn</button>
                  </span>
                  <span className="row" style={{ gap: 4, alignItems: 'center' }}>Bitiş
                    <button className="btn sm" onClick={() => clampEnd(end - 1)} data-testid="klipcikar-end-m1">−1 sn</button>
                    <button className="btn sm" onClick={() => clampEnd(end - 0.5)}>−0,5</button>
                    <Num value={Math.round(end * 10) / 10} step={0.5} min={1} max={Math.max(2, totalSec)} label="Bitiş (sn)" onChange={clampEnd} />
                    <button className="btn sm" onClick={() => clampEnd(end + 0.5)}>+0,5</button>
                    <button className="btn sm" onClick={() => clampEnd(end + 1)} data-testid="klipcikar-end-p1">+1 sn</button>
                  </span>
                </div>
                <div className="hint" data-testid="klipcikar-dur">{stamp(start)} – {stamp(end)} · <b>{dur.toFixed(1)} sn</b>{vertical && dur > MAX_CLIP_SEC ? ' · dikey için uzun (Shorts/Reels 3 dk sınırı; yine de kaydedilir)' : ''}</div>
                <div className="col" style={{ gap: 2, maxHeight: 220, overflow: 'auto', fontSize: 13 }} data-testid="klipcikar-lines">
                  {lines.filter((l) => l.end > start - 25 && l.start < end + 25).map((l, i) => (
                    <div key={i} className="row" style={{ gap: 8, alignItems: 'baseline', background: inRange(l) ? 'rgba(76, 255, 42, 0.14)' : undefined }} data-inrange={inRange(l) ? '1' : undefined}>
                      <span className="hint" style={{ minWidth: 58, fontVariantNumeric: 'tabular-nums' }}>{stamp(l.start)}</span>
                      <span style={{ flex: 1 }}>{l.text}</span>
                      <button className="btn sm" onClick={() => clampStart(l.start)} title="Klip bu cümleden başlasın" data-testid="klipcikar-line-start">başla</button>
                      <button className="btn sm" onClick={() => clampEnd(l.end + 0.3)} title="Klip bu cümleyle bitsin" data-testid="klipcikar-line-end">bitir</button>
                    </div>
                  ))}
                </div>
                <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
                  <b>Biçim:</b>
                  <label className="check"><input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} data-testid="klipcikar-vertical" /> Dikey (9:16): yüzün üstte, ortada sosyal medyaların, altta ekran görüntüsü</label>
                  <label className="check"><input type="checkbox" checked={horizontal} onChange={(e) => setHorizontal(e.target.checked)} data-testid="klipcikar-horizontal" /> Yatay (16:9): normal video</label>
                </div>
                <div className="hint">Her ikisinde de YouTube butonu (her 50 sn'de bir) ve +5 kontrast/+5 keskinlik uygulanır. Çıktı tek klip (MP4).</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span style={{ flex: 1 }} />
                  <button className="btn primary" disabled={!(dur >= 1) || (!vertical && !horizontal)} onClick={() => void save()} data-testid="klipcikar-save">Klibi MP4 olarak kaydet</button>
                </div>
              </div>
            )}
          </>
        )}
        {err && <div className="warnbox" role="alert" data-testid="klipcikar-error">{err}</div>}
        {note && !!jobs.length && <div className="hint" data-testid="klipcikar-save-note"><b>✓ {note}</b></div>}
        {jobs.map((j) => (
          <div key={j.id} className="col" style={{ gap: 4, padding: 8, border: '1px solid var(--border, #2a3a30)', borderRadius: 8 }} data-testid="klipcikar-job-out" data-status={j.status}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{j.request.horizontal ? 'Yatay' : 'Dikey'} klip</b>
              <span className={`badge ${j.status === 'done' ? 'blue' : j.status === 'failed' ? 'red' : ''}`}>{{ running: 'Kaydediliyor', done: 'Hazır', failed: 'Hata', cancelled: 'İptal' }[j.status]}</span>
            </div>
            {j.stages.filter((s) => s.status === 'running').map((s) => <div key={s.id}><div className="hint">{s.label}</div><Progress value={s.progress} /></div>)}
            {j.error && <div className="warnbox" role="alert">{j.error}</div>}
            {j.result?.clips.map((c) => (
              <div key={c.id} className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{c.error ? <span style={{ color: 'var(--danger, #e5484d)' }}>{c.error}</span> : `✓ ${c.headline} · ${Math.round(c.durationSec)} sn`}</span>
                {c.videoPath && <button className="btn sm" onClick={() => void api.invoke('shell:reveal', c.videoPath!)} data-testid="klipcikar-reveal">MP4'ü göster</button>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}
