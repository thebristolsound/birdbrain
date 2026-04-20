import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type ScrollAreaProps = HTMLAttributes<HTMLDivElement>

// Lightweight ScrollArea primitive in the shadcn style — a flex-collapsing
// scroll container with a thin native scrollbar. Kept Radix-free to match the
// rest of this project's ui/ primitives.
const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin',
        'scrollbar-thumb-border scrollbar-track-transparent',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
ScrollArea.displayName = 'ScrollArea'

export { ScrollArea }
