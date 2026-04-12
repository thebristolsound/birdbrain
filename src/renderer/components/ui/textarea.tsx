import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'w-full rounded-lg border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent placeholder:text-text-faint disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
