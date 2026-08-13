import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'w-full rounded-md border border-border-strong bg-canvas px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent placeholder:text-text-faint disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
