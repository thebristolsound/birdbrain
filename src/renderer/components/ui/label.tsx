import { forwardRef, type LabelHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label className={cn('mb-1 block text-sm text-text-muted', className)} ref={ref} {...props} />
  )
)
Label.displayName = 'Label'

export { Label }
