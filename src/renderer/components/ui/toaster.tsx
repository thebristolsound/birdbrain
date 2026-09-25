import type { CSSProperties, ReactNode } from 'react'
import { Check, Info, TriangleAlert, X } from 'lucide-react'
import { Toaster } from 'sonner'

// The mock's toast (Birdbrain.dc.html 3907-3923): bottom-centre, 22px up, at
// most 520px wide, sized to its content, gone after six seconds.
export const TOAST_DURATION_MS = 6000
const TOAST_MAX_WIDTH = 520
const TOAST_OFFSET = 22

function Medallion({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      data-testid="toast-medallion"
      className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full ${tone}`}
    >
      {children}
    </span>
  )
}

const ICON = { size: 10, strokeWidth: 3 }

// unstyled drops sonner's own skin, which is unlayered CSS and would otherwise
// outrank every Tailwind utility below; its stacking and swipe rules still apply.
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      offset={TOAST_OFFSET}
      closeButton
      style={{ '--width': `${TOAST_MAX_WIDTH}px` } as CSSProperties}
      icons={{
        success: (
          <Medallion tone="bg-success-surface text-success-fg">
            <Check {...ICON} />
          </Medallion>
        ),
        error: (
          <Medallion tone="bg-danger-surface text-danger-fg">
            <TriangleAlert {...ICON} />
          </Medallion>
        ),
        warning: (
          <Medallion tone="bg-warning-surface text-warning-fg">
            <TriangleAlert {...ICON} />
          </Medallion>
        ),
        info: (
          <Medallion tone="bg-accent-subtle text-accent">
            <Info {...ICON} />
          </Medallion>
        ),
        close: <X size={11} strokeWidth={2} />
      }}
      toastOptions={{
        unstyled: true,
        duration: TOAST_DURATION_MS,
        closeButtonAriaLabel: 'Dismiss',
        classNames: {
          toast:
            'inset-x-0 mx-auto flex w-fit max-w-[520px] items-center gap-[11px] rounded-lg border border-border-strong bg-card py-[9px] pr-[9px] pl-[13px] font-body shadow-[var(--shadow-overlay)] data-[front=false]:data-[expanded=false]:*:opacity-0',
          icon: 'flex shrink-0 empty:hidden',
          content: 'min-w-0',
          title: 'text-xs font-semibold text-text-primary',
          description: 'truncate text-[10px] text-text-muted',
          actionButton:
            'h-[26px] shrink-0 cursor-pointer rounded-lg border border-accent/35 bg-accent-subtle px-2.5 text-[11px] font-semibold text-accent hover:bg-accent/20',
          closeButton:
            'order-last grid h-[22px] w-[22px] shrink-0 cursor-pointer place-items-center rounded-md text-text-faint hover:bg-elevated hover:text-text-secondary'
        }
      }}
    />
  )
}
