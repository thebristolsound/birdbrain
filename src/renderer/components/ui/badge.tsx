import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border text-xs font-medium transition-colors shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-white',
        secondary: 'border-transparent bg-elevated text-text-muted',
        outline: 'border-border text-text-secondary',
        accent: 'border-transparent bg-accent-subtle text-accent',
        success: 'border-success-line bg-success-surface text-success-fg',
        danger: 'border-danger-line bg-danger-surface text-danger-fg',
        warning: 'border-warning-line bg-warning-surface text-warning-fg'
      },
      size: {
        sm: 'px-2 py-0.5 font-mono',
        default: 'px-2.5 py-0.5',
        pill: 'h-7 px-2.5 gap-1.5 text-xs'
      }
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'sm'
    }
  }
)

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & { dot?: boolean; pulse?: boolean }

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, dot, pulse, children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size, className }))} {...props}>
      {dot && (
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', pulse && 'animate-pulse')}
        />
      )}
      {children}
    </span>
  )
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
