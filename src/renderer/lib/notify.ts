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

// The mock's toast carries a subtitle line and at most one action.
export interface NotifySuccessOpts {
  description?: string
  action?: { label: string; onClick: () => void }
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

  success(message: string, { description, action }: NotifySuccessOpts = {}): void {
    // The subtitle joins the id because it can name a distinct result (two exports'
    // paths): keyed on the title alone, the second would overwrite the first.
    const id = toastId(description === undefined ? message : `${message}\n${description}`)
    toast.success(message, { id, description, action })
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
  'app.extension_sync_failed': "Couldn't prepare the extension folder for this version",
  'app.extension_sweep_failed': "Couldn't clear an old copy of the extension folder",
  // Fires when the advertised copy is consistent and its stamp is not this
  // version's, which includes a folder this build replaced but could not stamp
  // (pinned by `advertises the new copy under the previous stamp when only the
  // stamp write fails`), so the wording claims nothing about which bytes are
  // there. The
  // advice is quit-then-relaunch rather than "reload it" because retrying the
  // copy is what needs Chrome's handles released; a reload re-reads the same
  // path (#1493 rounds 3 to 5).
  'app.extension_version_stale':
    "The extension folder couldn't be fully refreshed for this version — quit Chrome, relaunch Birdbrain to retry, then load the folder Open extension folder opens",
  // --- appended: labels for the real console.* call sites Task 1 migrated ---
  'captureServer.selector_create_failed': "Couldn't create the selector",
  'captureServer.tag_apply_failed': "Couldn't apply the tag",
  'captureServer.note_create_failed': "Couldn't create the note",
  'captureServer.self_test_cleanup_failed': "Couldn't clean up after the pipeline self-test",
  // Errno-neutral on purpose: one label serves two surfaces. In the Log tab it
  // reads a boot EADDRINUSE entry; as a toast it can only follow a successful
  // bind, because boot fails before setLoggerWindow and exits — so a label
  // naming the port as in use would be wrong in the only case it can toast.
  // The entry's errorCode carries the errno either way.
  'captureServer.listen_failed': "The capture server's listener failed",
  'captureLifecycle.tls_refetch_failed': "Couldn't verify the site's certificate",
  'captureLifecycle.selector_match_failed': "Couldn't check this capture against selectors",
  'captureLifecycle.reprocess_failed': "Couldn't reprocess this capture",
  'captureLifecycle.duplicate_reconcile_failed':
    "The duplicate was created, but its trusted-time status couldn't be refreshed",
  'captureLifecycle.duplicate_cleanup_failed':
    "The duplicate failed, and its copied files couldn't be removed",
  'captureLifecycle.delete_purge_failed':
    "The capture was deleted, but its files couldn't be removed yet",
  'captureLifecycle.delete_recovery_failed':
    "Couldn't put back or remove the files of an interrupted capture delete",
  'backgroundRenderer.trim_failed': "Couldn't trim the screenshot",
  'backgroundRenderer.consent_blocker_disable_failed':
    "Couldn't turn off the cookie-notice blocker",
  'backgroundRenderer.consent_blocker_enable_failed': "Couldn't turn on the cookie-notice blocker",
  'consentBlocker.filter_engine_failed': "Couldn't load the cookie-notice filter lists",
  'selectorLifecycle.retroactive_match_failed':
    "Couldn't match the new selector against existing captures",
  'serverToken.token_invalid': 'Extension connection token was invalid',
  'serverToken.token_read_failed': "Couldn't read the extension connection token",
  'serverToken.token_persist_failed': "Couldn't save the extension connection token",
  'settings.schema_invalid': 'Saved settings were invalid — restored defaults',
  'thumbnails.generate_failed': "Couldn't generate a thumbnail",
  'timestampWorker.stamp_failed': "Couldn't get a trusted timestamp for this capture",
  'app.webview_attach_refused': "A page view was blocked by the app's security policy",
  'db.snapshot_created': 'Saved a database snapshot before upgrading',
  'db.snapshot_prune_failed': "Couldn't remove an old database snapshot",
  'db.snapshot_restore_failed': "Couldn't restore the database snapshot",
  'db.snapshot_restore_left_no_database':
    "Couldn't restore the database snapshot, and the database file is no longer readable",
  'db.restore_rejected': 'Restore refused — the database was not changed',
  'db.restore_replace_failed': "Couldn't replace the database with the restored file",
  'db.restore_snapshot_move_failed':
    "Restored the database, but couldn't add its pre-migration snapshot to the list",
  'db.reopen_failed': "Couldn't re-open the database — restart Birdbrain",
  'signingKey.unprotected_key_acknowledged':
    "This installation's signing key is not protected at rest — see Settings → Diagnostics",
  'signingKey.generation_declined': 'Birdbrain quit — the signing key warning was not acknowledged',
  'settings.unreadable_timestamping_fail_closed':
    "Couldn't read saved settings — restored defaults and turned trusted timestamping off",
  'settings.unreadable_write_refused':
    "Couldn't read saved settings — the change applies until Birdbrain quits but was not saved",
  'settings.fresh_install_seed_failed': "Couldn't save initial settings",
  'settings.retired_fields_cleanup_failed':
    "Couldn't remove retired AI settings from the settings file",
  'demoCase.seeded': 'Added the demonstration case',
  'demoCase.fixture_missing': 'The demonstration case is not bundled with this build',
  'demoCase.seed_failed': "Couldn't add the demonstration case",
  'demoCase.latch_failed': "Couldn't record that the demonstration case was set up",
  'demoCase.artifact_cleanup_failed':
    "The demonstration case was removed, but its files couldn't be deleted",
  'exhibits.backfill_failed': "Couldn't finish the exhibit migration for a case",
  'staging.commit_failed': "Couldn't commit a pooled file to the case",
  'staging.discard_failed': "Couldn't delete a pooled file; it stays in the pool",
  'persona.orphan_partitions_cleared': 'Cleared browser data left by a persona no longer on file',
  'persona.orphan_partition_clear_failed':
    "Couldn't clear browser data left by a persona no longer on file",
  'persona.orphan_sweep_skipped':
    'Skipped the persona browser data check because the data folders differ'
}

export function labelForCode(code: LogCode): string {
  return CODE_LABELS[code]
}
