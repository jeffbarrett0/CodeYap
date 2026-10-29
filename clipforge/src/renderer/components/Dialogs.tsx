import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, WHISPER_MODELS } from '@shared/settings'
import { COPYRIGHT_NOTICE, EXPORT_PRESETS, exportWarnings, optionsFromPreset } from '@shared/export/presets'
import { CHAT_EXPECTED_SCHEMA } from '@shared/chat/parse'
import { timelineDuration } from '@shared/timeline/model'
import type { ExportOptions, Settings } from '@shared/types'
import { requireApi } from '../api'
import { useStore } from '../store'
import { fmt, Field, Modal, Num } from './ui'

export function ExportDialog() {
  const { project, settings, openDialog, startExport, selection } = useStore()
  const tl = project.timeline
  const total = timelineDuration(tl)
  const initial = settings.exportDefaults.presetId || 'shorts'
  const [preset, setPreset] = useState(initial)
  const [opts, setOpts] = useState<ExportOptions>(() => optionsFromPreset(initial, settings.exportDefaults))
  const [name, setName] = useState(project.name === 'Adsız proje' ? 'klip' : project.name)
  const [mode, setMode] = useState<'all' | 'each' | 'selection'>('all')
  const [ack, setAck] = useState(false)
  const clipCount = tl.tracks.filter((t) => t.role === 'screen').reduce((n, t) => n + t.clips.length, 0)
  const warnings = exportWarnings(total, opts)
  const patch = (p: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...p }))

  const first = useRef(true)
  useEffect(() => {
    // ilk açılışta kullanıcı varsayılanları korunur; şablon değişince boyutlar ve sınırlar şablona döner
    if (first.current) {
      first.current = false
      return
    }
    setOpts(optionsFromPreset(preset))
  }, [preset])

  const mismatch = opts.aspect !== tl.aspect
  return (
    <Modal
      title="Dışa aktar"
      onClose={() => openDialog(null)}
      wide
      footer={
        <>
          <button className="btn" onClick={() => openDialog(null)}>Vazgeç</button>
          <button className="btn primary" disabled={!ack || total <= 0} onClick={() => void startExport({ options: opts, name, mode })} data-testid="export-go">Kuyruğa ekle ve dışa aktar</button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Şablon">
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Şablon" data-testid="export-preset">
            {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}
          </select>
        </Field>
        <Field label="Dosya adı"><input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Dosya adı" /></Field>
      </div>
      {mismatch && <div className="warnbox">Zaman çizelgesi {tl.aspect}, şablon {opts.aspect}. Dışa aktarma şablonun oranında ({opts.aspect}) üretilir; önizlemeyle birebir olması için Düzen sekmesinden oranı da {opts.aspect} yapın.</div>}
      <div className="grid3">
        <Field label="Kare hızı"><select value={opts.fps} onChange={(e) => patch({ fps: Number(e.target.value) })} aria-label="Kare hızı">{[24, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select></Field>
        <Field label="Video bitrate (kbps)"><Num value={opts.videoBitrateKbps} step={500} min={500} label="Video bitrate" onChange={(v) => patch({ videoBitrateKbps: v })} /></Field>
        <Field label="Ses bitrate (kbps)"><Num value={opts.audioBitrateKbps} step={32} min={64} label="Ses bitrate" onChange={(v) => patch({ audioBitrateKbps: v })} /></Field>
      </div>
      <div className="grid3">
        <Field label="Çözünürlük"><div className="row"><Num value={opts.width} step={2} label="Genişlik" onChange={(v) => patch({ width: Math.round(v / 2) * 2 })} /><span>×</span><Num value={opts.height} step={2} label="Yükseklik" onChange={(v) => patch({ height: Math.round(v / 2) * 2 })} /></div></Field>
        <Field label="Kalite (CRF, 0 = bitrate kullan)"><Num value={opts.crf} step={1} min={0} max={40} label="CRF" onChange={(v) => patch({ crf: v })} /></Field>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={opts.normalizeAudio} onChange={(e) => patch({ normalizeAudio: e.target.checked })} /> Sesi dengele (−14 LUFS)</label>
      </div>
      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
        <legend className="hint">Kapsam</legend>
        <label className="check"><input type="radio" name="mode" checked={mode === 'all'} onChange={() => setMode('all')} /> Tüm zaman çizelgesi, tek dosya ({fmt(total)})</label>
        <label className="check"><input type="radio" name="mode" checked={mode === 'each'} onChange={() => setMode('each')} disabled={clipCount < 2} /> Toplu: her klip ayrı dosya ({clipCount} klip)</label>
        <label className="check"><input type="radio" name="mode" checked={mode === 'selection'} onChange={() => setMode('selection')} disabled={selection.length === 0} /> Yalnızca seçili klip</label>
      </fieldset>
      {warnings.map((w, i) => <div key={i} className="warnbox" role="alert" data-testid="export-warning">⚠ {w}</div>)}
      <div className="infobox" data-testid="copyright-notice">{COPYRIGHT_NOTICE}</div>
      <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="export-ack" /> Hatırlatmayı okudum</label>
    </Modal>
  )
}

export function HelpDialog() {
  const { openDialog } = useStore()
  const keys: [string, string][] = [['Space', 'Oynat / duraklat'], ['S', 'Oynatma başlığında böl'], ['Delete / Backspace', 'Seçili klibi sil'], ['J / K / L', 'Geri / dur / ileri (tekrar basınca hızlanır)'], ['← / →', 'Bir kare geri / ileri (Shift: 1 sn)'], ['Ctrl/Cmd + Z', 'Geri al'], ['Ctrl/Cmd + Shift + Z', 'Yinele'], ['Ctrl/Cmd + S', 'Kaydet'], ['Ctrl/Cmd + E', 'Dışa aktar'], ['Ctrl + tekerlek', 'Zaman çizelgesini yakınlaştır']]
  return (
    <Modal title="Klavye kısayolları" onClose={() => openDialog(null)}>
      <table className="tracktable"><tbody>{keys.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
    </Modal>
  )
}

type Tab = 'trans' | 'search' | 'clip' | 'chat' | 'export' | 'tools'

export function SettingsDialog() {
  const { settings, updateSettings, openDialog, appInfo } = useStore()
  const [tab, setTab] = useState<Tab>('trans')
  const [s, setS] = useState<Settings>(settings)
  const api = requireApi()
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }))
  const tabs: [Tab, string][] = [['trans', 'Transkripsiyon'], ['search', 'Arama'], ['clip', 'Klip'], ['chat', 'Sohbet'], ['export', 'Dışa aktarma'], ['tools', 'FFmpeg / Araçlar']]
  const save = async () => {
    await updateSettings(s)
    openDialog(null)
  }
  return (
    <Modal
      title="Ayarlar"
      wide
      onClose={() => openDialog(null)}
      footer={
        <>
          <button className="btn" onClick={() => openDialog(null)}>Vazgeç</button>
          <button className="btn primary" onClick={() => void save()} data-testid="settings-save">Kaydet</button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {tabs.map(([id, n]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{n}</button>)}
      </div>

      {tab === 'trans' && (
        <div className="col">
          <div className="grid2">
            <Field label="Sağlayıcı">
              <select value={s.provider} onChange={(e) => set({ provider: e.target.value as Settings['provider'] })} aria-label="Sağlayıcı">
                <option value="whisper-cpp">whisper.cpp (yerel)</option>
                <option value="faster-whisper">faster-whisper (yerel, Python)</option>
                <option value="openai-api">OpenAI Whisper API (bulut)</option>
              </select>
            </Field>
            <Field label="Model">
              <select value={s.whisperModel} onChange={(e) => set({ whisperModel: e.target.value as Settings['whisperModel'] })} aria-label="Whisper modeli">
                {WHISPER_MODELS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Varsayılan dil"><select value={s.language} onChange={(e) => set({ language: e.target.value })} aria-label="Dil">{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></Field>
          {s.provider === 'whisper-cpp' && (
            <>
              <Field label="whisper-cli yolu (boş = PATH)"><input type="text" value={s.whisperCppPath} onChange={(e) => set({ whisperCppPath: e.target.value })} placeholder="/usr/local/bin/whisper-cli" /></Field>
              <Field label="Model klasörü (boş = uygulama verisi)"><input type="text" value={s.whisperModelDir} onChange={(e) => set({ whisperModelDir: e.target.value })} /></Field>
              <div className="section-title">Kurulu modeller</div>
              <div className="row wrap">
                {appInfo?.models.map((m) => (
                  <span key={m.size} className="row" style={{ gap: 4 }}>
                    <span className={`badge ${m.installed ? 'green' : ''}`}>{m.size}{m.installed ? ' ✓' : ''}</span>
                    {!m.installed && <button className="btn sm" onClick={() => void api.invoke('model:download', m.size)}>İndir</button>}
                  </span>
                ))}
              </div>
              <div className="hint">tiny ≈ 75 MB, base ≈ 142 MB, small ≈ 466 MB, medium ≈ 1.5 GB. Türkçe için en az "small" önerilir.</div>
            </>
          )}
          {s.provider === 'faster-whisper' && <Field label="Python yolu"><input type="text" value={s.fasterWhisperPython} onChange={(e) => set({ fasterWhisperPython: e.target.value })} /></Field>}
          {s.provider === 'openai-api' && (
            <div className="grid2">
              <Field label="API anahtarı"><input type="password" value={s.openaiApiKey} onChange={(e) => set({ openaiApiKey: e.target.value })} autoComplete="off" /></Field>
              <Field label="Taban URL"><input type="text" value={s.openaiBaseUrl} onChange={(e) => set({ openaiBaseUrl: e.target.value })} /></Field>
            </div>
          )}
          {s.provider === 'openai-api' && <div className="warnbox">Bulut modunda ses parçaları OpenAI'a yüklenir. Gizlilik tercihiniz buysa kullanın; yerel modlar hiçbir şey göndermez.</div>}
        </div>
      )}

      {tab === 'search' && (
        <div className="col">
          <label className="check"><input type="checkbox" checked={s.fuzzyEnabled} onChange={(e) => set({ fuzzyEnabled: e.target.checked })} /> Bulanık eşleşme</label>
          <Field label={`Bulanık eşik: ${s.fuzzyThreshold.toFixed(2)}`}><input type="range" min={0.5} max={1} step={0.01} value={s.fuzzyThreshold} onChange={(e) => set({ fuzzyThreshold: Number(e.target.value) })} /></Field>
          <Field label="Çok kelimeli sorgu pencere süresi (sn)"><Num value={s.windowSec} step={1} min={1} label="Pencere" onChange={(v) => set({ windowSec: v })} /></Field>
          <label className="check"><input type="checkbox" checked={s.semanticSearch} onChange={(e) => set({ semanticSearch: e.target.checked })} /> Anlamsal arama (embedding)</label>
          {s.semanticSearch && (
            <div className="grid3">
              <Field label="Taban URL (OpenAI uyumlu)"><input type="text" value={s.embeddingBaseUrl} onChange={(e) => set({ embeddingBaseUrl: e.target.value })} /></Field>
              <Field label="Model"><input type="text" value={s.embeddingModel} onChange={(e) => set({ embeddingModel: e.target.value })} /></Field>
              <Field label="API anahtarı (yerel sunucuda boş)"><input type="password" value={s.embeddingApiKey} onChange={(e) => set({ embeddingApiKey: e.target.value })} autoComplete="off" /></Field>
            </div>
          )}
          {s.semanticSearch && <div className="hint">Ollama / LM Studio gibi yerel bir OpenAI-uyumlu sunucu (ör. http://localhost:11434/v1) kullanırsanız metin cihazınızdan çıkmaz.</div>}
        </div>
      )}

      {tab === 'clip' && (
        <div className="col">
          <div className="grid3">
            <Field label="Pre-roll (sn)"><Num value={s.preRollSec} step={1} min={0} label="Pre-roll" onChange={(v) => set({ preRollSec: v })} /></Field>
            <Field label="Post-roll (sn)"><Num value={s.postRollSec} step={1} min={0} label="Post-roll" onChange={(v) => set({ postRollSec: v })} /></Field>
            <Field label="Hedef süre">
              <select value={s.targetDurationSec} onChange={(e) => set({ targetDurationSec: Number(e.target.value) })} aria-label="Hedef süre">
                <option value={0}>Yok (pre/post-roll)</option><option value={15}>15 sn</option><option value={30}>30 sn</option><option value={60}>60 sn</option>
              </select>
            </Field>
          </div>
          <Field label="Önizleme kopyası yüksekliği (px)"><Num value={s.proxyHeight} step={90} min={240} max={1080} label="Proxy yüksekliği" onChange={(v) => set({ proxyHeight: v })} /></Field>
        </div>
      )}

      {tab === 'chat' && (
        <div className="col">
          <div className="infobox" style={{ whiteSpace: 'pre-wrap' }}>{CHAT_EXPECTED_SCHEMA}</div>
          <div className="grid3">
            <Field label="Zaman sütunu (ad ya da sıra)"><input type="text" value={s.chatColumns.time ?? ''} onChange={(e) => set({ chatColumns: { ...s.chatColumns, time: e.target.value || undefined } })} placeholder="otomatik" /></Field>
            <Field label="Kullanıcı sütunu"><input type="text" value={s.chatColumns.user ?? ''} onChange={(e) => set({ chatColumns: { ...s.chatColumns, user: e.target.value || undefined } })} placeholder="otomatik" /></Field>
            <Field label="Mesaj sütunu"><input type="text" value={s.chatColumns.message ?? ''} onChange={(e) => set({ chatColumns: { ...s.chatColumns, message: e.target.value || undefined } })} placeholder="otomatik" /></Field>
          </div>
          <Field label="Yayın başlangıcı (ISO, mutlak zaman damgaları için; ör. 2024-05-12T20:00:00Z)"><input type="text" value={s.chatColumns.streamStart ?? ''} onChange={(e) => set({ chatColumns: { ...s.chatColumns, streamStart: e.target.value || undefined } })} /></Field>
          <Field label="Öneri anahtar kelimeleri (virgülle; boş = varsayılan tepki sözcükleri)"><input type="text" value={s.suggestKeywords.join(', ')} onChange={(e) => set({ suggestKeywords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
        </div>
      )}

      {tab === 'export' && (
        <div className="col">
          <Field label="Varsayılan şablon">
            <select value={s.exportDefaults.presetId} onChange={(e) => set({ exportDefaults: { ...s.exportDefaults, presetId: e.target.value } })} aria-label="Varsayılan şablon">
              {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="grid3">
            <Field label="Kare hızı"><Num value={s.exportDefaults.fps ?? 30} step={1} label="fps" onChange={(v) => set({ exportDefaults: { ...s.exportDefaults, fps: v } })} /></Field>
            <Field label="Video bitrate (kbps)"><Num value={s.exportDefaults.videoBitrateKbps ?? 8000} step={500} label="bitrate" onChange={(v) => set({ exportDefaults: { ...s.exportDefaults, videoBitrateKbps: v } })} /></Field>
            <Field label="Azami süre (sn, uyarı için)"><Num value={s.exportDefaults.maxDurationSec ?? 60} step={5} label="azami süre" onChange={(v) => set({ exportDefaults: { ...s.exportDefaults, maxDurationSec: v } })} /></Field>
          </div>
        </div>
      )}

      {tab === 'tools' && (
        <div className="col">
          <Field label="FFmpeg yolu (boş = paketle gelen / PATH)"><input type="text" value={s.ffmpegPath} onChange={(e) => set({ ffmpegPath: e.target.value })} /></Field>
          <Field label="FFprobe yolu"><input type="text" value={s.ffprobePath} onChange={(e) => set({ ffprobePath: e.target.value })} /></Field>
          <dl className="kv">
            <dt>FFmpeg</dt><dd>{appInfo?.ffmpeg.ok ? <span className="badge green">{appInfo.ffmpeg.version?.slice(0, 60)}</span> : <span className="badge red">{appInfo?.ffmpeg.error ?? 'bulunamadı'}</span>}</dd>
            <dt>FFprobe</dt><dd>{appInfo?.ffprobe.ok ? <span className="badge green">bulundu</span> : <span className="badge red">{appInfo?.ffprobe.error ?? 'bulunamadı'}</span>}</dd>
            <dt>whisper.cpp</dt><dd>{appInfo?.whisperCpp.ok ? <span className="badge green">bulundu</span> : <span className="badge warn">bulunamadı — yerel transkripsiyon için gerekli</span>}</dd>
            <dt>Uygulama verisi</dt><dd>{appInfo?.userDataDir}</dd>
            <dt>Sürüm</dt><dd>{appInfo?.version} · {appInfo?.platform}</dd>
          </dl>
        </div>
      )}
    </Modal>
  )
}
