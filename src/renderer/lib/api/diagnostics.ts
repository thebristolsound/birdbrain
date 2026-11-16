import { queryOptions } from '@tanstack/react-query'
import type { RendererLogPayload } from '@shared/ipc'
import type { BugReportInput, BugReportResult, LogEntry, SessionRecord } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { birdbrain } from '@renderer/lib/birdbrain'

// The diagnostics *components* migrate like any other feature code. Four
// lib-layer modules also call this namespace and stay on the bridge. The
// design's lib-layer exemption names queryClient.ts, mainLogBridge.ts and
// notify.ts, and globalErrorLog.ts does the same job: they are the
// error-reporting path, and routing them through another indirection is what
// that exemption exists to avoid.

// The panel polls, so the interval belongs to the call site rather than here —
// nothing else consuming this snapshot wants a 2s refetch.
export const diagnosticsQueryOptions = queryOptions({
  queryKey: queryKeys.diagnostics,
  queryFn: () => birdbrain.diagnostics.get()
})

// No refetchInterval, deliberately (#622): the scan reads and signature-
// verifies every case manifest on the main process, so it runs on mount and on
// an explicit refresh, never on a poll.
export const unreconciledDeletionsQueryOptions = queryOptions({
  queryKey: queryKeys.unreconciledDeletions,
  queryFn: () => birdbrain.diagnostics.unreconciledDeletions()
})

export function logDiagnosticEvent(payload: RendererLogPayload): Promise<string> {
  return birdbrain.diagnostics.log(payload)
}

export function recentLogEntries(limit: number): Promise<LogEntry[]> {
  return birdbrain.diagnostics.recentEntries(limit)
}

export function revealLogFile(): Promise<void> {
  return birdbrain.diagnostics.revealLog()
}

// Main derives the root itself; the renderer never hands it a path (#363).
export function openStorageRoot(): Promise<void> {
  return birdbrain.diagnostics.openStorageRoot()
}

// Take-once server-side: the first call after an unclean exit both returns and
// acknowledges the record.
export function lastSession(): Promise<SessionRecord | null> {
  return birdbrain.diagnostics.lastSession()
}

// Resolves null when the operator cancels the save-file dialog.
export function createBugReport(input: BugReportInput): Promise<BugReportResult | null> {
  return birdbrain.diagnostics.createReport(input)
}

// Saves only the current and rotated logs to a local archive chosen by the operator.
export function exportLogs(): Promise<{ path: string } | null> {
  return birdbrain.diagnostics.exportLogs()
}
