import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from './button'

type ErrorStateProps = HTMLAttributes<HTMLDivElement> & {
  title?: string
  description?: ReactNode
  /** The underlying error. If present and no description is provided, its message is rendered. */
  error?: unknown
  onRetry?: () => void
  retryLabel?: string
}

function errorMessage(error: unknown): string | null {
  if (!error) return null
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return null
}

const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(
  (
    {
      className,
      title = 'Something went wrong',
      description,
      error,
      onRetry,
      retryLabel = 'Try again',
      ...props
    },
    ref
  ) => {
    const resolvedDescription = description ?? errorMessage(error)
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          'flex min-h-[160px] w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center',
          className
        )}
        {...props}
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500"
          aria-hidden="true"
        >
          <AlertTriangle width={22} height={22} />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          {resolvedDescription ? (
            <p className="max-w-sm text-sm text-text-muted">{resolvedDescription}</p>
          ) : null}
        </div>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
            {retryLabel}
          </Button>
        ) : null}
      </div>
    )
  }
)
ErrorState.displayName = 'ErrorState'

export { ErrorState }
export type { ErrorStateProps }
