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
        accent: 'border-transparent bg-accent-subtle text-accent'
      },
      size: {
        sm: 'px-2 py-0.5 font-mono',
        default: 'px-2.5 py-0.5'
      }
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'sm'
    }
  }
)

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size, className }))} {...props} />
  )
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
