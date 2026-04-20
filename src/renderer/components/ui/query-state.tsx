import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { LoadingState } from './loading-state'
import { ErrorState } from './error-state'

/**
 * The minimal shape of a TanStack Query result that QueryState consumes. Using a
 * structural subset keeps this component trivially testable with a plain object
 * and decoupled from a specific TanStack Query version.
 */
export type QueryLike<TData> = {
  isPending: boolean
  isError: boolean
  error: unknown
  data: TData | undefined
  refetch: () => unknown
}

export type QueryStatus<TData> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'empty'; data: TData }
  | { status: 'success'; data: TData }

/**
 * Narrow a QueryLike result into a tagged status for callers that want to
 * render their own branches inline (e.g. inside a grid cell) without a wrapper.
 */
export function useQueryState<TData>(
  query: QueryLike<TData>,
  options: { isEmpty?: (data: TData) => boolean } = {}
): QueryStatus<TData> {
  if (query.isPending) return { status: 'loading' }
  if (query.isError) {
    return { status: 'error', error: query.error, retry: () => query.refetch() }
  }
  const data = query.data as TData
  const empty = options.isEmpty ? options.isEmpty(data) : false
  return empty ? { status: 'empty', data } : { status: 'success', data }
}

type ErrorRenderer = (error: unknown, retry: () => void) => ReactNode

interface QueryStateProps<TData> {
  query: QueryLike<TData>
  /**
   * Predicate that determines whether a successful response should render the
   * `empty` slot. Defaults to always-not-empty, i.e. `children` is called.
   */
  isEmpty?: (data: TData) => boolean
  /** Override the default <LoadingState />. */
  loading?: ReactNode
  /**
   * Override the default <ErrorState onRetry={refetch}>. Either a ReactNode or
   * a render function receiving `(error, retry)`.
   */
  error?: ReactNode | ErrorRenderer
  /** Rendered when `isEmpty(data)` returns true. */
  empty?: ReactNode
  /** Rendered when the query is successful and non-empty. */
  children: (data: TData) => ReactNode
}

function isErrorRenderer(value: ReactNode | ErrorRenderer): value is ErrorRenderer {
  return typeof value === 'function' && !isValidElement(value as unknown as ReactElement)
}

/**
 * Declarative wrapper around a TanStack Query result. Renders one of
 * loading / error / empty / success based on the query's current state,
 * and provides sensible defaults for every branch except `children`.
 */
export function QueryState<TData>({
  query,
  isEmpty,
  loading,
  error,
  empty,
  children
}: QueryStateProps<TData>): ReactElement | null {
  const state = useQueryState(query, { isEmpty })

  if (state.status === 'loading') {
    return <>{loading ?? <LoadingState />}</>
  }

  if (state.status === 'error') {
    if (error === undefined) {
      return <ErrorState error={state.error} onRetry={state.retry} />
    }
    if (isErrorRenderer(error)) {
      return <>{error(state.error, state.retry)}</>
    }
    return <>{error}</>
  }

  if (state.status === 'empty') {
    return <>{empty ?? null}</>
  }

  return <>{children(state.data)}</>
}
