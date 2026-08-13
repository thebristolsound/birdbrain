import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type SectionLabelProps = HTMLAttributes<HTMLDivElement> & { emphasis?: 'faint' | 'strong' }

// Panel heads are an eyebrow, not a heading — 10px/600/uppercase at the label
// tracking. `strong` is the 11px step for the heads that carry more weight.
const SectionLabel = forwardRef<HTMLDivElement, SectionLabelProps>(
  ({ className, emphasis = 'faint', ...props }, ref) => (
    <div
      className={cn(
        'font-display font-semibold uppercase leading-none tracking-label',
        emphasis === 'strong' ? 'text-[11px] text-text-secondary' : 'text-[10px] text-text-faint',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
SectionLabel.displayName = 'SectionLabel'

export { SectionLabel }
