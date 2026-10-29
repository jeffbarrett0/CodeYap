import * as T from '@radix-ui/react-tooltip'
import { Kbd } from './misc'

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <T.Provider delayDuration={350} skipDelayDuration={100}>
    {children}
  </T.Provider>
)

/** Wrap a single focusable element. `hotkey` renders a key hint. */
export function Tip({ label, hotkey, children, side = 'bottom' }: { label: string; hotkey?: string; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[60] flex items-center gap-2 rounded border border-border bg-raised px-2 py-1 text-xs text-foreground shadow-lg">
          {label}
          {hotkey && <Kbd>{hotkey}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
