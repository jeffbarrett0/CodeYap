import * as T from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = T.Root
export const TabsContent = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof T.Content>) => (
  <T.Content className={cn('min-h-0 flex-1 outline-none data-[state=inactive]:hidden', className)} {...p} />
)
export const TabsList = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof T.List>) => (
  <T.List className={cn('flex shrink-0 items-center gap-0.5 border-b border-border px-1.5', className)} {...p} />
)
export const TabsTrigger = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof T.Trigger>) => (
  <T.Trigger
    className={cn('relative -mb-px flex h-8 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground data-[state=active]:border-accent data-[state=active]:text-foreground', className)}
    {...p}
  />
)
