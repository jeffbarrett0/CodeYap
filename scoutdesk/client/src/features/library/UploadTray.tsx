import { CheckCircle2, ChevronDown, ChevronUp, RotateCw, UploadCloud, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/utils'
import { useUploads } from '@/store/uploads'

/** Floating progress tray — visible on every screen while uploads exist. */
export function UploadTray() {
  const { items, cancel, retry, clearFinished } = useUploads()
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null
  const busy = items.filter((i) => i.status === 'uploading' || i.status === 'queued').length

  return (
    <section aria-label="Uploads" className="fixed bottom-4 left-4 z-40 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
      <header className="flex h-9 items-center gap-2 border-b border-border px-3">
        <UploadCloud className="h-4 w-4 text-accent" />
        <span className="flex-1 text-xs font-semibold">{busy > 0 ? `Uploading ${busy} file${busy > 1 ? 's' : ''}…` : 'Uploads complete'}</span>
        <Button variant="ghost" size="icon-sm" aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
        {busy === 0 && (
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={clearFinished}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>
      {!collapsed && (
        <ul className="max-h-60 divide-y divide-border overflow-y-auto">
          {items.map((i) => (
            <li key={i.id} className="space-y-1.5 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={i.title}>{i.title}</span>
                {i.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Done" />}
                {(i.status === 'error' || i.status === 'cancelled') && <XCircle className="h-3.5 w-3.5 text-danger" aria-label="Failed" />}
                {i.status === 'error' && (
                  <Button variant="ghost" size="icon-sm" aria-label="Retry upload" onClick={() => retry(i.id)}>
                    <RotateCw className="h-3 w-3" />
                  </Button>
                )}
                {(i.status === 'uploading' || i.status === 'queued') && (
                  <Button variant="ghost" size="icon-sm" aria-label="Cancel upload" onClick={() => cancel(i.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {(i.status === 'uploading' || i.status === 'queued') && (
                <div role="progressbar" aria-valuenow={Math.round(i.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${i.title}`} className="h-1 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${i.progress * 100}%` }} />
                </div>
              )}
              <p className="text-2xs text-muted">
                {i.status === 'queued' && 'Waiting…'}
                {i.status === 'uploading' && `${Math.round(i.progress * 100)}% of ${formatBytes(i.file.size)}`}
                {i.status === 'done' && `${formatBytes(i.file.size)} · processing on server`}
                {(i.status === 'error' || i.status === 'cancelled') && (i.error ?? 'Cancelled')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
