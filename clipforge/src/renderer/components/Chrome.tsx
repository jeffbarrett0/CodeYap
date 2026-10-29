import { useState } from 'react'
import { useStore } from '../store'
import { Progress } from './ui'

export function TopBar() {
  const { project, projectPath, dirty, pickAndImport, openProject, saveProject, openDialog, newProject, settings } = useStore()
  return (
    <header className="topbar">
      <div className="brand"><i /> ClipForge</div>
      <button className="btn" onClick={() => void newProject()}>Yeni</button>
      <button className="btn" onClick={() => void openProject()}>Aç</button>
      <button className="btn" onClick={() => void saveProject(false)} data-testid="save">Kaydet</button>
      <button className="btn" onClick={() => void pickAndImport()}>Kayıt içe aktar</button>
      <span className="projname" title={projectPath ?? ''}><b>{project.name}</b>{dirty ? ' •' : ''}</span>
      <span className="spacer" />
      <span className="badge" title="Transkripsiyon dili ve modeli">{settings.language.toUpperCase()} · {settings.whisperModel}</span>
      <button className="btn ghost" onClick={() => openDialog('help')} aria-label="Kısayollar">⌨</button>
      <button className="btn" onClick={() => openDialog('settings')} data-testid="settings-btn">Ayarlar</button>
      <button className="btn primary" onClick={() => openDialog('export')} data-testid="export-btn">Dışa aktar</button>
    </header>
  )
}

export function StatusBar() {
  const { tasks, cancelTask, lastExport } = useStore()
  const [open, setOpen] = useState(false)
  const list = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt)
  const active = list.filter((t) => t.status === 'running' || t.status === 'queued')
  const cur = active[0]
  return (
    <footer className="statusbar">
      <button className="taskbtn" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="tasks-btn">
        {cur ? (<><span>⏳ {cur.title}</span><span className="minibar"><Progress value={cur.progress} /></span><span>{Math.round(cur.progress * 100)}%</span></>) : <span>Görevler: boşta</span>}
        {active.length > 1 && <span className="badge">+{active.length - 1}</span>}
      </button>
      <span className="spacer" />
      {lastExport && <span className="hint" data-testid="last-export">Son dışa aktarma: {lastExport}</span>}
      {open && (
        <div className="taskpanel" role="region" aria-label="Görev kuyruğu" data-testid="task-panel">
          {list.length === 0 && <div className="hint">Görev yok.</div>}
          {list.map((t) => (
            <div key={t.id} className="task" data-testid="task" data-status={t.status}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="row">
                  <span className={`badge ${t.status === 'done' ? 'green' : t.status === 'failed' ? 'red' : t.status === 'cancelled' ? 'warn' : 'blue'}`}>{({ queued: 'sırada', running: 'çalışıyor', done: 'bitti', failed: 'hata', cancelled: 'iptal' } as const)[t.status]}</span>
                  {(t.status === 'running' || t.status === 'queued') && <button className="btn sm danger" onClick={() => cancelTask(t.id)} data-testid="cancel-task">İptal</button>}
                </span>
              </div>
              {(t.status === 'running' || t.status === 'queued') && <Progress value={t.progress} />}
              {t.message && t.status === 'running' && <span className="hint">{t.message}</span>}
              {t.error && <div className="errbox">{t.error}</div>}
            </div>
          ))}
        </div>
      )}
    </footer>
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useStore()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid="toast">
          <span style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Kapat">✕</button>
        </div>
      ))}
    </div>
  )
}
