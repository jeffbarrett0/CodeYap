import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-label="Loading" className={cn('h-4 w-4 animate-spin text-muted', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded bg-raised', className)} />
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-raised px-1 font-mono text-[10px] font-medium text-muted', className)}>
      {children}
    </kbd>
  )
}

export function Badge({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span style={style} className={cn('inline-flex items-center gap-1 rounded-sm border border-border bg-raised px-1.5 py-px text-2xs font-medium text-muted', className)}>
      {children}
    </span>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: color }} />
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-16 text-center', className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-raised">
        <Icon className="h-5 w-5 text-muted" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className, ariaLabel }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; title?: string }[]
  className?: string
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded border border-border bg-background p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('rounded-[3px] px-2 py-0.5 text-xs font-medium transition-colors', value === o.value ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Checkbox({ checked, indeterminate, onChange, label, className }: {
  checked: boolean
  indeterminate?: boolean
  onChange: (next: boolean, e: React.MouseEvent) => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked, e)
      }}
      className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors', checked || indeterminate ? 'border-accent bg-accent text-accent-foreground' : 'border-muted/60 hover:border-foreground', className)}
    >
      {indeterminate ? <span className="h-0.5 w-2 bg-current" /> : checked ? (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 6.5 2.3 2.3 4.7-5" /></svg>
      ) : null}
    </button>
  )
}

/** Purely visual check box for use inside role="option" rows (the row itself carries the semantics). */
export function CheckGlyph({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border', checked ? 'border-accent bg-accent text-accent-foreground' : 'border-muted/60', className)}>
      {checked && (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 6.5 2.3 2.3 4.7-5" /></svg>
      )}
    </span>
  )
}
