import { toast } from 'sonner'
import type { LogCode } from '@shared/types'
import type { RendererLogPayload } from '@shared/ipc'

// The single boundary where a failure becomes both durable and visible.
// Errors and warnings are logged AND toasted; success and info are toast-only,
// because a durable log of "Case exported" is noise in a bug report.

// message is what the tester reads; code is what survives on disk. They are
// separate parameters precisely because the first may name a case and the
// second may not.
export interface NotifyOpts {
  code?: LogCode
  context?: RendererLogPayload['context']
  cause?: unknown
  correlationId?: string
}

// A retry loop would otherwise fire dozens of toasts and bury the app, so
// identical messages collapse onto one sonner id and repeat in place.
function toastId(message: string): string {
  let hash = 0
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) | 0
  }
  return `n${hash}`
}

// Only the constructor name crosses the boundary. cause.message is the prose
// vector the allowlist exists to exclude, and String(cause) is worse — for a
// thrown string it IS the prose.
function causeName(cause: unknown): string | undefined {
  if (cause === undefined) return undefined
  return cause instanceof Error ? cause.name : 'UnknownError'
}

function durable(level: 'error' | 'warn', opts: NotifyOpts): Promise<string | undefined> {
  // A missing code must NOT skip the write. notify.error(message) is the
  // advertised one-argument form, and silently dropping those entries would
  // leave the toast with no correlation id and the failure absent from the
  // bug report — breaking the guarantee that every error is both visible and
  // durable, for exactly the call sites that were least careful.
  const code = opts.code ?? 'app.unclassified_error'
  return window.birdbrain.diagnostics
    .log({ level, code, context: opts.context, error: causeName(opts.cause) })
    .catch(() => undefined)
  // The logger is best-effort; a failed log must not mask the original error.
}

function reportAction(correlationId?: string) {
  return {
    label: 'Report this',
    onClick: () =>
      window.dispatchEvent(new CustomEvent('birdbrain:report', { detail: { correlationId } }))
  }
}

// The log id is only known once the IPC round-trip resolves, but the toast has
// to appear immediately — a tester must not wait on the main process to see
// that something failed. So show the toast now with whatever id the caller
// supplied, then re-render it under the same sonner id once the real
// correlation id arrives. Without this second call, Report this dispatches
// undefined and the bug report cites no log entry at all.
function toastWithReport(kind: 'error' | 'warning', message: string, opts: NotifyOpts): void {
  const id = toastId(message)
  const show = (correlationId?: string): void => {
    const config = {
      id,
      // No correlation id yet means the log write is still in flight. Showing
      // an enabled Report this in that window is worse than showing none: the
      // click opens the dialog with an undefined id, and the later re-render
      // cannot reach into an already-open dialog to correct it — so the
      // tester's bundle silently fails to identify the failure they picked.
      // The toast itself appears immediately either way; only the action waits.
      action: correlationId ? reportAction(correlationId) : undefined
    }
    if (kind === 'error') toast.error(message, config)
    else toast.warning(message, config)
  }

  show(opts.correlationId)
  void durable(kind === 'error' ? 'error' : 'warn', opts).then((logged) => {
    if (logged) show(logged)
  })
}

export const notify = {
  error(message: string, opts: NotifyOpts = {}): void {
    toastWithReport('error', message, opts)
  },

  warn(message: string, opts: NotifyOpts = {}): void {
    toastWithReport('warning', message, opts)
  },

  success(message: string): void {
    toast.success(message, { id: toastId(message) })
  },

  info(message: string): void {
    toast.info(message, { id: toastId(message) })
  }
}

// Every string the old `message` parameter used to carry now lives only here:
// visible in toasts and the Log tab, never serialised. Record<LogCode, string>
// makes a new code a compile error until it has a label, which is what keeps
// this list and LOG_CODES from drifting apart.
const CODE_LABELS: Record<LogCode, string> = {
  'app.session_start': 'Session started',
  'app.uncaught_exception': 'Birdbrain hit an unexpected error',
  'app.unhandled_rejection': 'A background task failed',
  'app.render_process_gone': 'The window stopped responding',
  'app.child_process_gone': 'A helper process stopped',
  'app.storage_init_failed': "Couldn't open the storage folder — using the default location",
  'capture.failed': 'Capture failed',
  'capture.screenshot_dropped': 'Screenshot was skipped',
  'capture.server_started': 'Capture server started',
  'capture.extraction_failed': "Couldn't extract data from the page",
  'ipc.handler_threw': 'An internal request failed',
  'query.failed': "Couldn't load data",
  'mutation.failed': 'Something went wrong. Please try again.',
  'react.render_error': 'This part of the app failed to render',
  'app.unclassified_error': 'Something went wrong',
  'app.startup_failed': 'Birdbrain could not start',
  'app.bug_report_failed': 'Could not save the diagnostic report',
  'app.installation_id': 'Installation identified',
  // --- appended: labels for the real console.* call sites Task 1 migrated ---
  'captureServer.selector_create_failed': "Couldn't create the selector",
  'captureLifecycle.tls_refetch_failed': "Couldn't verify the site's certificate",
  'captureLifecycle.selector_match_failed': "Couldn't check this capture against selectors",
  'captureLifecycle.reprocess_failed': "Couldn't reprocess this capture",
  'backgroundRenderer.trim_failed': "Couldn't trim the screenshot",
  'backgroundRenderer.consent_blocker_disable_failed': "Couldn't turn off the cookie-notice blocker",
  'backgroundRenderer.consent_blocker_enable_failed': "Couldn't turn on the cookie-notice blocker",
  'consentBlocker.filter_engine_failed': "Couldn't load the cookie-notice filter lists",
  'selectorLifecycle.retroactive_match_failed':
    "Couldn't match the new selector against existing captures",
  'serverToken.token_invalid': 'Extension connection token was invalid',
  'serverToken.token_read_failed': "Couldn't read the extension connection token",
  'serverToken.token_persist_failed': "Couldn't save the extension connection token",
  'settings.schema_invalid': 'Saved settings were invalid — restored defaults',
  'thumbnails.generate_failed': "Couldn't generate a thumbnail",
  'openrouter.rate_limited': 'AI request was rate-limited — retrying',
  'openrouter.request_failed': 'AI request failed',
  'openrouter.retry': 'Retrying the AI request',
  'openrouter.retries_exhausted': 'AI request failed after several retries',
  'timestampWorker.stamp_failed': "Couldn't get a trusted timestamp for this capture",
  'db.snapshot_created': 'Saved a database snapshot before upgrading',
  'db.snapshot_prune_failed': "Couldn't remove an old database snapshot",
  'db.snapshot_restore_failed': "Couldn't restore the database snapshot",
  'db.snapshot_restore_left_no_database':
    "Couldn't restore the database snapshot, and the database file is no longer readable",
  'db.reopen_failed': "Couldn't re-open the database — restart Birdbrain"
}

export function labelForCode(code: LogCode): string {
  return CODE_LABELS[code]
}
