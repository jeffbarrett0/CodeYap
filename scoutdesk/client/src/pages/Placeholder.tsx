import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/misc'

export function Placeholder({ icon, title, phase, description }: { icon: LucideIcon; title: string; phase: number; description: string }) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} />
      <EmptyState icon={icon} title={`${title} arrive in phase ${phase}`} description={description} className="flex-1" />
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-sm font-semibold">{title}</h1>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  )
}
