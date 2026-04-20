import { forwardRef, type HTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

type LoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  label?: string
  /** Size of the spinner icon (px). Defaults to 20. */
  iconSize?: number
}

const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ className, label = 'Loading...', iconSize = 20, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex min-h-[120px] w-full flex-col items-center justify-center gap-3 text-text-muted',
        className
      )}
      {...props}
    >
      <Loader2
        className="animate-spin text-text-muted"
        width={iconSize}
        height={iconSize}
        aria-hidden="true"
      />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  )
)
LoadingState.displayName = 'LoadingState'

export { LoadingState }
export type { LoadingStateProps }
