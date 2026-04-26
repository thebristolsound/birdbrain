import { forwardRef, isValidElement, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  /** Icon element (typically a lucide-react icon) or any ReactNode. */
  icon?: ReactNode
  title: string
  description?: ReactNode
  /** Optional action slot (e.g. a button). */
  action?: ReactNode
}

const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      className={cn(
        'flex min-h-[160px] w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className
      )}
      {...props}
    >
      {icon ? (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-muted"
          aria-hidden={isValidElement(icon) ? 'true' : undefined}
        >
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description ? (
          <p className="max-w-sm text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
)
EmptyState.displayName = 'EmptyState'

export { EmptyState }
export type { EmptyStateProps }
