import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, Film, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/utils'
import { useExports } from '@/store/exports'

/** Export job queue: progress for running FFmpeg jobs, download links for finished ones. */
export function ExportsTray() {
  const { jobs, refresh, remove } = useExports()
  const [open, setOpen] = useState(true)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running')

  useEffect(() => { void refresh().catch(() => {}) }, [refresh])
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => void refresh().catch(() => {}), 1200)
    return () => clearInterval(id)
  }, [active, refresh])

  const visible = jobs.filter((j) => (j.status === 'queued' || j.status === 'running') || !dismissed.has(j.id)).filter((j) => active || Date.now() - new Date(j.createdAt).getTime() < 15 * 60_000).slice(0, 6)
  if (visible.length === 0) return null

  return (
    <section aria-label="Exports" className="fixed bottom-4 right-4 z-40 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
      <header className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Film className="h-4 w-4 text-accent" />
        <span className="flex-1 text-xs font-semibold">{active ? 'Exporting video…' : 'Exports'}</span>
        <Button variant="ghost" size="icon-sm" aria-label={open ? 'Collapse exports' : 'Expand exports'} onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</Button>
        {!active && <Button variant="ghost" size="icon-sm" aria-label="Dismiss exports" onClick={() => setDismissed(new Set(jobs.map((j) => j.id)))}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </header>
      {open && (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto">
          {visible.map((j) => (
            <li key={j.id} className="space-y-1.5 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={j.label}>{j.label}</span>
                {j.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Done" />}
                {j.status === 'failed' && <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-label="Failed" />}
              </div>
              {(j.status === 'queued' || j.status === 'running') && (
                <div role="progressbar" aria-valuenow={Math.round(j.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Exporting ${j.label}`} className="h-1 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(4, j.progress * 100)}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-2xs text-muted">
                <span>{j.status === 'queued' ? 'Queued' : j.status === 'running' ? `${Math.round(j.progress * 100)}% · ${j.kind}` : j.status === 'failed' ? (j.error ?? 'Failed') : `${j.kind} · ${formatBytes(j.sizeBytes)}`}</span>
                {j.status === 'done' && j.downloadUrl && <a href={j.downloadUrl} download={j.fileName ?? undefined} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"><Download className="h-3 w-3" /> Download MP4</a>}
                {j.status === 'failed' && <button type="button" className="hover:text-foreground" onClick={() => void remove(j.id)}>Remove</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
