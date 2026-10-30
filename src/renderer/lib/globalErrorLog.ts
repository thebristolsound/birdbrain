import type { LogCode } from '@shared/types'

// Errors nothing else caught: a throw in an event handler or timer, and a
// promise no caller awaited. Render errors reach ErrorBoundary instead, and
// query and mutation failures reach queryClient. These are logged without a
// toast, since the tester did nothing that a toast could name.
//
// Only the class name crosses to main, as in notify.ts: the message is prose
// that can carry a case name or a URL.
function report(code: LogCode, cause: unknown): void {
  const error = cause instanceof Error ? cause.name : 'UnknownError'
  void window.birdbrain.diagnostics.log({ level: 'error', code, error }).catch(() => undefined)
}

export function logUncaughtErrors(): () => void {
  const onError = (event: ErrorEvent): void => report('app.uncaught_exception', event.error)
  const onRejection = (event: PromiseRejectionEvent): void =>
    report('app.unhandled_rejection', event.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
