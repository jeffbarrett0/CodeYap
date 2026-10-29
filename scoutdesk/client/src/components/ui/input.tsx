import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

const field =
  'h-8 w-full rounded border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted/70 transition-colors hover:border-muted/50 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(field, className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'h-auto min-h-[60px] resize-y py-1.5', className)} {...props} />
))
Textarea.displayName = 'Textarea'

/** Native <select> — fastest, fully accessible, and plays well with dense layouts. */
const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b95a5' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, style, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(field, 'appearance-none pr-6', className)}
    // Inline so tailwind-merge can't mistake the position for a background *colour*.
    style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '12px', ...style }}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'

export function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-2xs text-muted">{hint}</span>}
    </label>
  )
}
