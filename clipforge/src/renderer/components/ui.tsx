import { useEffect, type ReactNode } from 'react'
import { formatTime } from '@shared/text'

export const fmt = (s: number, ms = false) => formatTime(s, ms)

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  // Esc ile kapanır
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <header>
          <span>{title}</span>
          <button className="btn ghost icon" onClick={onClose} aria-label="Kapat">✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Progress({ value, fail }: { value: number; fail?: boolean }) {
  return (
    <div className={`progress${fail ? ' fail' : ''}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="field">
      <span className="row" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span>{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  )
}

export function Num({ value, onChange, step = 0.1, min, max, label }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label?: string }) {
  return <input type="number" value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0} step={step} min={min} max={max} aria-label={label} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
}
