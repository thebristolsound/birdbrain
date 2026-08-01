import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { notify } from '@renderer/lib/notify'

// Mutations toast; queries only log. With retry:false and services that are
// not ready at launch, toasting query errors would greet every tester with a
// wall of toasts on startup. A mutation is user-initiated, so a silent failure
// there is always worth surfacing.

export function failureMessage(mutation: { options?: { meta?: unknown } }): string {
  const meta = mutation.options?.meta
  const action =
    meta && typeof meta === 'object' && 'action' in meta && typeof meta.action === 'string'
      ? meta.action
      : null
  return action ? `Couldn't ${action}.` : 'Something went wrong. Please try again.'
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      notify.error(failureMessage(mutation), { code: 'mutation.failed', cause: error })
    }
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      // .catch, not bare void: if the main process is gone or the handler is
      // not registered yet, invoke() rejects. An unconsumed rejection here
      // turns one handled query failure into a second, renderer-level
      // unhandledrejection — the logging path manufacturing the very event
      // class it exists to record.
      window.birdbrain.diagnostics
        .log({
          level: 'warn',
          code: 'query.failed',
          context: { domain: String(query.queryKey[0] ?? 'unknown') },
          error: error instanceof Error ? error.name : 'UnknownError'
        })
        .catch(() => {})
    }
  })
})
