import * as D from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DropdownMenu = D.Root
export const DropdownMenuTrigger = D.Trigger
export const DropdownMenuSeparator = () => <D.Separator className="my-1 h-px bg-border" />
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof D.Label>) => (
  <D.Label className={cn('label px-2 py-1', className)} {...p} />
)

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface p-1 text-sm shadow-xl', className)}
        {...props}
      />
    </D.Portal>
  )
}

export function DropdownMenuItem({ className, danger, ...props }: React.ComponentPropsWithoutRef<typeof D.Item> & { danger?: boolean }) {
  return (
    <D.Item
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-raised', danger && 'text-danger', className)}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof D.CheckboxItem>) {
  return (
    <D.CheckboxItem
      className={cn('relative flex cursor-pointer select-none items-center rounded py-1.5 pl-7 pr-2 text-xs outline-none data-[highlighted]:bg-raised', className)}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <D.ItemIndicator>
          <Check className="h-3 w-3 text-accent" />
        </D.ItemIndicator>
      </span>
      {children}
    </D.CheckboxItem>
  )
}
